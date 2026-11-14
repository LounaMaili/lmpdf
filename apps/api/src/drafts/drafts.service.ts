import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { sanitizeRichTextHtml } from '../utils/sanitizeRichText';

export interface DraftPayload {
  name: string;
  fields: any[];
  rotation: number;
  pageCount: number;
  preset?: any;
  [key: string]: any;
}

@Injectable()
export class DraftsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Sanitize rich-text HTML values in draft fields before storage.
   * Only fields with type === 'text' are sanitized.
   */
  private sanitizePayloadFields(payload: DraftPayload): DraftPayload {
    if (!payload.fields || !Array.isArray(payload.fields)) return payload;
    return {
      ...payload,
      fields: payload.fields.map((f: any) => {
        if (f.type === 'text' && typeof f.value === 'string') {
          return { ...f, value: sanitizeRichTextHtml(f.value) };
        }
        return f;
      }),
    };
  }

  /**
   * Upsert a single draft per user + (templateId OR sourceFileId).
   * Only one slot exists – no history.
   */
  async upsert(
    userId: string,
    key: { templateId?: string; sourceFileId?: string },
    payload: DraftPayload,
  ) {
    // Determine unique constraint target
    if (key.templateId) {
      return this.prisma.draft.upsert({
        where: {
          userId_templateId: { userId, templateId: key.templateId },
        },
        create: {
          userId,
          templateId: key.templateId,
          sourceFileId: key.sourceFileId ?? null,
          payload: this.sanitizePayloadFields(payload) as any,
        },
        update: {
          sourceFileId: key.sourceFileId ?? null,
          payload: this.sanitizePayloadFields(payload) as any,
          // updatedAt handled by @updatedAt
        },
      });
    }

    if (key.sourceFileId) {
      return this.prisma.draft.upsert({
        where: {
          userId_sourceFileId: { userId, sourceFileId: key.sourceFileId },
        },
        create: {
          userId,
          sourceFileId: key.sourceFileId,
          payload: this.sanitizePayloadFields(payload) as any,
        },
        update: {
          payload: this.sanitizePayloadFields(payload) as any,
        },
      });
    }

    throw new Error('templateId or sourceFileId required');
  }

  /**
   * Get the current draft for user + key.
   */
  async get(userId: string, key: { templateId?: string; sourceFileId?: string }) {
    if (key.templateId) {
      return this.prisma.draft.findUnique({
        where: {
          userId_templateId: { userId, templateId: key.templateId },
        },
      });
    }
    if (key.sourceFileId) {
      return this.prisma.draft.findUnique({
        where: {
          userId_sourceFileId: { userId, sourceFileId: key.sourceFileId },
        },
      });
    }
    return null;
  }

  /**
   * Clear draft after explicit save.
   */
  async clear(userId: string, key: { templateId?: string; sourceFileId?: string }, preservedPayload?: DraftPayload) {
    const where = key.templateId ? { userId, templateId: key.templateId }
      : key.sourceFileId ? { userId, sourceFileId: key.sourceFileId } : null;
    if (!where) throw new BadRequestException('templateId ou sourceFileId requis');

    // The unique user/key indexes allow at most one match. A completed DELETE
    // with count=0 proves absence; an exception (including P2025) does not.
    // Do not turn a lost acknowledgement or a database failure into success.
    const { count } = await this.prisma.draft.deleteMany({ where: {
      ...where,
      // Equality is part of the DELETE itself, not a racy read-then-delete.
      ...(preservedPayload ? { payload: { equals: this.sanitizePayloadFields(preservedPayload) as any } } : {}),
    } });
    if (count === 0) {
      if (preservedPayload) {
        const existing = await this.get(userId, key);
        if (existing) throw new ConflictException('Brouillon modifié depuis sa copie : suppression refusée');
      }
      return { cleared: true, outcome: 'absent' as const };
    }
    if (count === 1) return { cleared: true, outcome: 'deleted' as const };
    throw new Error('Résultat de suppression de brouillon inattendu');
  }
}
