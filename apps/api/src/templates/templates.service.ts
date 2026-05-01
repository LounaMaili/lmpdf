import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { FieldType, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTemplateDto } from './dto/create-template.dto';
import { sanitizeRichTextHtml } from '../utils/sanitizeRichText';

type AuthUser = { id: string; role: Role };

function isAdmin(user: AuthUser) {
  return user.role === 'admin';
}

function toApiFieldType(type: FieldType): 'text' | 'checkbox' | 'counter-tally' | 'counter-numeric' | 'date' {
  if (type === 'counter_tally') return 'counter-tally';
  if (type === 'counter_numeric') return 'counter-numeric';
  return type as any;
}

@Injectable()
export class TemplatesService {
  constructor(private readonly prisma: PrismaService) {}

  private normalizeTemplate<T extends { fields: Array<{ type: FieldType }> }>(tpl: T) {
    return {
      ...tpl,
      fields: tpl.fields.map((f) => ({
        ...f,
        type: toApiFieldType(f.type),
      })),
    };
  }

  /** Get group IDs the user belongs to */
  private async userGroupIds(userId: string): Promise<string[]> {
    const memberships = await this.prisma.groupMember.findMany({
      where: { userId },
      select: { groupId: true },
    });
    return memberships.map((m) => m.groupId);
  }

  /** Check if user has access to a document (owner, admin, or via DocumentPermission) */
  private async hasDocAccess(documentId: string, user: AuthUser): Promise<boolean> {
    if (isAdmin(user)) return true;

    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) return false;
    if (doc.ownerId === user.id) return true;

    // Check direct user permission
    const userPerm = await this.prisma.documentPermission.findUnique({
      where: { documentId_userId: { documentId, userId: user.id } },
    });
    if (userPerm) return true;

    // Check group permissions
    const groupIds = await this.userGroupIds(user.id);
    if (groupIds.length > 0) {
      const groupPerm = await this.prisma.documentPermission.findFirst({
        where: { documentId, groupId: { in: groupIds } },
      });
      if (groupPerm) return true;
    }

    return false;
  }

  async create(payload: CreateTemplateDto, user: AuthUser) {
    if (payload.sourceFileId) {
      const hasAccess = await this.hasDocAccess(payload.sourceFileId, user);
      if (!hasAccess) throw new ForbiddenException('Accès refusé au document source');
    }

    const created = await this.prisma.template.create({
      data: {
        name: payload.name,
        sourceFileId: payload.sourceFileId,
        rotation: payload.rotation ?? 0,
        ownerId: user.id,
        fields: {
          create: payload.fields.map((f) => {
            const typeMap: Record<string, FieldType> = {
              text: 'text',
              checkbox: 'checkbox',
              'counter-tally': 'counter_tally',
              'counter-numeric': 'counter_numeric',
              date: 'date' as any,
            };
            const isTextField = f.type === 'text';
            return {
              label: f.label,
              value: isTextField ? sanitizeRichTextHtml(f.value ?? '') : (f.value ?? ''),
              style: f.style ?? undefined,
              x: f.x,
              y: f.y,
              w: f.w,
              h: f.h,
              type: typeMap[f.type] ?? 'text',
              locked: f.locked ?? false,
              overlayVisible: f.overlayVisible ?? true,
              pageNumber: f.pageNumber ?? 1,
            } as any;
          }),
        },
      },
      include: { fields: true },
    });

    return this.normalizeTemplate(created);
  }

  async list(user: AuthUser) {
    if (isAdmin(user)) {
      const rows = await this.prisma.template.findMany({
        include: { fields: true },
        orderBy: { createdAt: 'desc' },
      });
      return rows.map((t) => this.normalizeTemplate(t));
    }

    const groupIds = await this.userGroupIds(user.id);

    // Find document IDs the user has permission on
    const docPerms = await this.prisma.documentPermission.findMany({
      where: {
        OR: [
          { userId: user.id },
          ...(groupIds.length > 0 ? [{ groupId: { in: groupIds } }] : []),
        ],
      },
      select: { documentId: true },
    });
    const sharedDocIds = [...new Set(docPerms.map((p) => p.documentId))];

    const rows = await this.prisma.template.findMany({
      where: {
        OR: [
          { ownerId: user.id },
          ...(sharedDocIds.length > 0 ? [{ sourceFileId: { in: sharedDocIds } }] : []),
        ],
      },
      include: { fields: true },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((t) => this.normalizeTemplate(t));
  }

  async get(id: string, user: AuthUser) {
    const found = await this.prisma.template.findUnique({
      where: { id },
      include: { fields: true },
    });
    if (!found) throw new NotFoundException('Template introuvable');

    // Check access: owner, admin, or has doc permission
    if (!isAdmin(user) && found.ownerId !== user.id) {
      if (found.sourceFileId) {
        const hasAccess = await this.hasDocAccess(found.sourceFileId, user);
        if (!hasAccess) throw new ForbiddenException('Accès refusé');
      } else {
        throw new ForbiddenException('Accès refusé');
      }
    }

    return this.normalizeTemplate(found);
  }

  async rename(id: string, name: string, user: AuthUser) {
    const found = await this.prisma.template.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Template introuvable');
    if (!isAdmin(user) && found.ownerId && found.ownerId !== user.id) {
      throw new ForbiddenException('Accès refusé');
    }

    const updated = await this.prisma.template.update({
      where: { id },
      data: { name },
      include: { fields: true },
    });
    return this.normalizeTemplate(updated);
  }

  async delete(id: string, user: AuthUser) {
    const found = await this.prisma.template.findUnique({ where: { id } });
    if (!found) throw new NotFoundException('Template introuvable');
    if (!isAdmin(user) && found.ownerId && found.ownerId !== user.id) {
      throw new ForbiddenException('Accès refusé');
    }

    await this.prisma.template.delete({ where: { id } });
    return { deleted: true };
  }
}
