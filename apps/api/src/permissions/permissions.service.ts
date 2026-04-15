import { ForbiddenException, Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { DocRole, Role } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';

type AuthUser = { id: string; role: Role };

@Injectable()
export class PermissionsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve the effective DocRole a user has on a document.
   * Priority: admin → direct owner → DocumentPermission (user) → DocumentPermission (group) → null
   */
  async resolveDocRole(documentId: string, user: AuthUser): Promise<DocRole | null> {
    // Global admin bypasses everything
    if (user.role === 'admin') return 'owner';

    const doc = await this.prisma.document.findUnique({ where: { id: documentId } });
    if (!doc) return null;

    // Document owner gets owner role
    if (doc.ownerId === user.id) return 'owner';

    // Check direct user permission
    const userPerm = await this.prisma.documentPermission.findUnique({
      where: { documentId_userId: { documentId, userId: user.id } },
    });
    if (userPerm) return userPerm.docRole;

    // Check group permissions (user may belong to multiple groups)
    const memberships = await this.prisma.groupMember.findMany({
      where: { userId: user.id },
      select: { groupId: true },
    });
    if (memberships.length > 0) {
      const groupIds = memberships.map((m) => m.groupId);
      const groupPerms = await this.prisma.documentPermission.findMany({
        where: { documentId, groupId: { in: groupIds } },
      });
      if (groupPerms.length > 0) {
        // Return highest role: owner > editor > filler
        const priority: Record<DocRole, number> = { owner: 3, editor: 2, filler: 1 };
        groupPerms.sort((a, b) => priority[b.docRole] - priority[a.docRole]);
        return groupPerms[0].docRole;
      }
    }

    return null;
  }

  /**
   * Check that a user has at least the required DocRole on a document.
   * Throws ForbiddenException if not.
   */
  async requireDocRole(documentId: string, user: AuthUser, minRole: DocRole): Promise<DocRole> {
    const effective = await this.resolveDocRole(documentId, user);
    if (!effective) throw new ForbiddenException('Accès refusé à ce document');

    const priority: Record<DocRole, number> = { owner: 3, editor: 2, filler: 1 };
    if (priority[effective] < priority[minRole]) {
      throw new ForbiddenException(`Rôle insuffisant (requis: ${minRole}, actuel: ${effective})`);
    }
    return effective;
  }

  /**
   * Share a document with a user or group.
   * Only owner (or admin) can share.
   */
  async share(documentId: string, caller: AuthUser, targetUserId?: string, targetGroupId?: string, docRole: DocRole = 'filler') {
    if (!targetUserId && !targetGroupId) {
      throw new BadRequestException('userId ou groupId requis');
    }

    // Caller must be owner of the document
    await this.requireDocRole(documentId, caller, 'owner');

    if (targetUserId) {
      // Verify target user exists
      const targetUser = await this.prisma.user.findUnique({ where: { id: targetUserId } });
      if (!targetUser) throw new NotFoundException('Utilisateur cible introuvable');

      return this.prisma.documentPermission.upsert({
        where: { documentId_userId: { documentId, userId: targetUserId } },
        update: { docRole },
        create: { documentId, userId: targetUserId, docRole },
      });
    }

    if (targetGroupId) {
      const targetGroup = await this.prisma.group.findUnique({ where: { id: targetGroupId } });
      if (!targetGroup) throw new NotFoundException('Groupe cible introuvable');

      return this.prisma.documentPermission.upsert({
        where: { documentId_groupId: { documentId, groupId: targetGroupId } },
        update: { docRole },
        create: { documentId, groupId: targetGroupId, docRole },
      });
    }
  }

  /**
   * Revoke a share.
   */
  async revoke(documentId: string, caller: AuthUser, targetUserId?: string, targetGroupId?: string) {
    if (!targetUserId && !targetGroupId) {
      throw new BadRequestException('userId ou groupId requis');
    }

    await this.requireDocRole(documentId, caller, 'owner');

    if (targetUserId) {
      const existing = await this.prisma.documentPermission.findUnique({
        where: { documentId_userId: { documentId, userId: targetUserId } },
      });
      if (!existing) throw new NotFoundException('Permission introuvable');
      await this.prisma.documentPermission.delete({ where: { id: existing.id } });
    }

    if (targetGroupId) {
      const existing = await this.prisma.documentPermission.findUnique({
        where: { documentId_groupId: { documentId, groupId: targetGroupId } },
      });
      if (!existing) throw new NotFoundException('Permission introuvable');
      await this.prisma.documentPermission.delete({ where: { id: existing.id } });
    }

    return { revoked: true };
  }

  /**
   * List all permissions on a document (owner only).
   */
  async listPermissions(documentId: string, caller: AuthUser) {
    await this.requireDocRole(documentId, caller, 'owner');

    return this.prisma.documentPermission.findMany({
      where: { documentId },
      include: {
        user: { select: { id: true, email: true, displayName: true } },
        group: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
