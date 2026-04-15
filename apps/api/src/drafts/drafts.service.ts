import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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
          payload: payload as any,
        },
        update: {
          sourceFileId: key.sourceFileId ?? null,
          payload: payload as any,
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
          payload: payload as any,
        },
        update: {
          payload: payload as any,
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
  async clear(userId: string, key: { templateId?: string; sourceFileId?: string }) {
    try {
      if (key.templateId) {
        await this.prisma.draft.delete({
          where: {
            userId_templateId: { userId, templateId: key.templateId },
          },
        });
      } else if (key.sourceFileId) {
        await this.prisma.draft.delete({
          where: {
            userId_sourceFileId: { userId, sourceFileId: key.sourceFileId },
          },
        });
      }
    } catch {
      // Not found → no-op
    }
    return { cleared: true };
  }
}
