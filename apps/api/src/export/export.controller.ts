import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Post,
  Get,
  Query,
  Request,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { promises as fsP } from 'fs';
import { Roles } from '../auth/roles.decorator';
import { loadRuntimeSettings } from '../config/runtime-settings';
import { canUser } from '../config/permission-matrix';
import { resolveExport } from './export-resolver';
import { validateAllowedRoots } from './export-security';
import type { ExportContext, ExportSettings } from './export-types';
import { defaultExportSettings } from './export-types';
import { writeExportFile } from './export-writer';
import { PrismaService } from '../prisma/prisma.service';

// ── Helper: build ExportContext from JWT user + optional overrides ──
async function buildExportContext(
  user: { id: string; email: string; displayName: string; role: string; authSource?: string },
  prisma: PrismaService,
  overrides?: Partial<ExportContext>,
): Promise<ExportContext> {
  // Fetch group names for the user
  const memberships = await prisma.groupMember.findMany({
    where: { userId: user.id },
    include: { group: { select: { name: true } } },
  });
  const groups = memberships.map((m) => m.group.name);

  return {
    username: user.email?.split('@')[0] || user.displayName || 'unknown',
    displayName: user.displayName || '',
    email: user.email || '',
    authSource: (user.authSource as 'local' | 'ldap') || 'local',
    role: user.role || 'viewer',
    groups,
    ...overrides,
  };
}

// ═══════════════════════════════════════════════════════════════
// Admin-only controller (kept at /admin/export for backward compat)
// ═══════════════════════════════════════════════════════════════

@Controller('admin/export')
@Roles('admin')
export class ExportAdminController {
  /**
   * GET /admin/export/config
   */
  @Get('config')
  async getConfig() {
    const settings = await loadRuntimeSettings();
    const exportCfg: ExportSettings = settings.export ?? defaultExportSettings();
    return exportCfg;
  }

  /**
   * POST /admin/export/validate
   */
  @Post('validate')
  async validate() {
    const settings = await loadRuntimeSettings();
    const exportCfg: ExportSettings = settings.export ?? defaultExportSettings();
    const errors: string[] = [];

    errors.push(...validateAllowedRoots(exportCfg.allowedRoots));

    for (const dest of exportCfg.destinations) {
      if (!exportCfg.allowedRoots.includes(dest.rootPath)) {
        errors.push(`Destination "${dest.name}" utilise une racine non autorisée : "${dest.rootPath}"`);
      }
      if (!dest.name.trim()) {
        errors.push('Une destination a un nom vide');
      }
    }

    const destNames = new Set(exportCfg.destinations.map((d) => d.name));
    for (const rule of exportCfg.rules) {
      if (!destNames.has(rule.destinationName)) {
        errors.push(`Règle "${rule.label}" référence une destination inexistante : "${rule.destinationName}"`);
      }
    }

    const seenNames = new Set<string>();
    for (const dest of exportCfg.destinations) {
      if (seenNames.has(dest.name)) {
        errors.push(`Nom de destination en double : "${dest.name}"`);
      }
      seenNames.add(dest.name);
    }

    return { valid: errors.length === 0, errors };
  }

  /**
   * POST /admin/export/preview
   */
  @Post('preview')
  async preview(@Body() body: ExportContext) {
    const settings = await loadRuntimeSettings();
    const exportCfg: ExportSettings = settings.export ?? defaultExportSettings();
    return resolveExport(exportCfg, body);
  }
}

// ═══════════════════════════════════════════════════════════════
// User-facing controller (at /export)
// ═══════════════════════════════════════════════════════════════

@Controller('export')
export class ExportController {
  constructor(private readonly prisma: PrismaService) {}

  /** Fire-and-forget export log helper */
  private logExport(
    user: { id: string; email: string; displayName: string },
    body: { templateName?: string; templateId?: string },
    resolved: { ruleLabelMatched?: string; destinationName?: string; conflictStrategy?: string } | null,
    status: string,
    finalPath: string | null,
    errorMessage: string | null,
    fileSizeBytes?: number,
  ) {
    this.prisma.exportLog.create({
      data: {
        userId: user.id,
        userEmail: user.email || '',
        userDisplayName: user.displayName || '',
        templateName: body.templateName || null,
        templateId: body.templateId || null,
        ruleLabelMatched: resolved?.ruleLabelMatched || null,
        destinationName: resolved?.destinationName || null,
        conflictStrategy: resolved?.conflictStrategy || null,
        finalPath: finalPath || null,
        status,
        errorMessage: errorMessage || null,
        fileSizeBytes: fileSizeBytes ?? null,
      },
    }).catch((err) => {
      console.error('[ExportLog] Failed to record export log:', err?.message);
    });
  }

  /**
   * POST /export/resolve
   *
   * Resolve export destination for the current user.
   * Used by the UI to check if server-side export is available
   * and show the resolved path before actually running it.
   */
  @Post('resolve')
  async resolve(
    @Body() body: { templateName?: string; templateId?: string },
    @Request() req: any,
  ) {
    const user = req.user;
    if (!user) throw new ForbiddenException('Authentification requise');

    if (!(await canUser(user.role, 'exportPdf'))) {
      throw new ForbiddenException('Droits insuffisants pour exporter');
    }

    const settings = await loadRuntimeSettings();
    const exportCfg: ExportSettings = settings.export ?? defaultExportSettings();

    if (!exportCfg.enabled) {
      return { matched: false, errors: ['Export désactivé'], enabled: false };
    }

    const ctx = await buildExportContext(user, this.prisma, {
      templateName: body.templateName || undefined,
      templateId: body.templateId || undefined,
    });

    const result = resolveExport(exportCfg, ctx);
    return { ...result, enabled: true };
  }

  /**
   * POST /export/run
   *
   * Accepts a multipart upload with:
   *   - file: the generated PDF bytes (from the front-end)
   *   - templateName (optional): for path placeholders
   *   - templateId (optional): for rule matching
   *
   * Resolves destination using current config + authenticated user context,
   * then writes the file to the filesystem.
   *
   * Requires `exportPdf` permission.
   */
  @Post('run')
  @UseInterceptors(
    FileInterceptor('file', {
      storage: diskStorage({
        destination: 'uploads/tmp-export',
        filename: (_, _file, cb) => cb(null, `export-${randomUUID()}.pdf`),
      }),
      limits: { fileSize: 50 * 1024 * 1024 }, // 50 MB
    }),
  )
  async runExport(
    @UploadedFile() file: Express.Multer.File | undefined,
    @Body() body: { templateName?: string; templateId?: string },
    @Request() req: any,
  ) {
    // ── Permission check ──
    const user = req.user;
    if (!user) throw new ForbiddenException('Authentification requise');

    if (!(await canUser(user.role, 'exportPdf'))) {
      throw new ForbiddenException('Droits insuffisants pour exporter');
    }

    if (!file) {
      throw new BadRequestException('Fichier PDF manquant');
    }

    // ── Basic PDF validation (magic bytes) ──
    const pdfBuffer = await fsP.readFile(file.path);
    if (pdfBuffer.length < 5 || pdfBuffer.slice(0, 5).toString() !== '%PDF-') {
      await fsP.unlink(file.path).catch(() => {});
      throw new BadRequestException('Le fichier envoyé n\'est pas un PDF valide');
    }

    try {
      // ── Load config and resolve destination ──
      const settings = await loadRuntimeSettings();
      const exportCfg: ExportSettings = settings.export ?? defaultExportSettings();

      if (!exportCfg.enabled) {
        throw new BadRequestException('L\'export externe est désactivé');
      }

      const ctx = await buildExportContext(user, this.prisma, {
        templateName: body.templateName || undefined,
        templateId: body.templateId || undefined,
      });

      const resolved = resolveExport(exportCfg, ctx);

      if (!resolved.matched || resolved.errors.length > 0) {
        // Log the error
        this.logExport(user, body, resolved, 'error', null, resolved.errors.join('; ') || 'Aucune règle ne correspond');
        throw new BadRequestException(
          resolved.errors.length > 0
            ? resolved.errors.join('; ')
            : 'Aucune règle d\'export ne correspond au contexte',
        );
      }

      if (!resolved.fullPath) {
        this.logExport(user, body, resolved, 'error', null, 'Chemin d\'export résolu vide');
        throw new BadRequestException('Chemin d\'export résolu vide');
      }

      // ── Write to filesystem ──
      const writeResult = await writeExportFile(
        resolved.fullPath,
        pdfBuffer,
        resolved.conflictStrategy || 'overwrite',
      );

      // ── Determine status for log ──
      const logStatus = writeResult.skipped
        ? 'skipped'
        : writeResult.renamed
          ? 'renamed'
          : 'written';

      // ── Record export log (fire-and-forget — don't block response) ──
      this.logExport(user, body, resolved, logStatus, writeResult.finalPath, null, pdfBuffer.length);

      return {
        ok: true,
        written: writeResult.written,
        finalPath: writeResult.finalPath,
        skipped: writeResult.skipped ?? false,
        renamed: writeResult.renamed ?? false,
        ruleLabelMatched: resolved.ruleLabelMatched,
        destinationName: resolved.destinationName,
      };
    } catch (err) {
      // If it's already a NestJS HTTP exception, re-throw — it was already logged above
      if (err instanceof BadRequestException || err instanceof ForbiddenException) {
        throw err;
      }
      // Unexpected error — log it
      this.logExport(user, body, null, 'error', null, (err as Error)?.message || 'Erreur interne', pdfBuffer.length);
      throw err;
    } finally {
      // Clean up temporary file
      await fsP.unlink(file.path).catch(() => {});
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// Admin controller for export logs (at /admin/export/logs)
// ═══════════════════════════════════════════════════════════════

@Controller('admin/export')
@Roles('admin')
export class ExportLogsController {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /admin/export/logs
   *
   * Returns the latest export logs for admin review.
   * Query params:
   *   - limit: max entries (default 50, max 200)
   *   - offset: pagination offset (default 0)
   *   - status: filter by status (written | skipped | renamed | error)
   *   - userId: filter by userId
   *   - userEmail: partial email search (contains, case-insensitive)
   *   - from: ISO date string — only logs after this date
   *   - to: ISO date string — only logs before this date
   */
  @Get('logs')
  async getLogs(
    @Query('limit') limitParam?: string,
    @Query('offset') offsetParam?: string,
    @Query('status') status?: string,
    @Query('userId') userId?: string,
    @Query('userEmail') userEmail?: string,
    @Query('from') fromDate?: string,
    @Query('to') toDate?: string,
  ) {
    const take = Math.min(Math.max(parseInt(limitParam || '50', 10) || 50, 1), 200);
    const skip = Math.max(parseInt(offsetParam || '0', 10) || 0, 0);

    const where: Record<string, unknown> = {};
    if (status && ['written', 'skipped', 'renamed', 'error'].includes(status)) {
      where.status = status;
    }
    if (userId) {
      where.userId = userId;
    }
    if (userEmail && userEmail.trim()) {
      where.userEmail = { contains: userEmail.trim(), mode: 'insensitive' };
    }

    // Date range filter
    const createdAtFilter: Record<string, Date> = {};
    if (fromDate) {
      const d = new Date(fromDate);
      if (!isNaN(d.getTime())) createdAtFilter.gte = d;
    }
    if (toDate) {
      const d = new Date(toDate);
      if (!isNaN(d.getTime())) createdAtFilter.lte = d;
    }
    if (Object.keys(createdAtFilter).length > 0) {
      where.createdAt = createdAtFilter;
    }

    const [logs, total] = await Promise.all([
      this.prisma.exportLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take,
        skip,
      }),
      this.prisma.exportLog.count({ where }),
    ]);

    return { logs, total, limit: take, offset: skip };
  }

  /**
   * GET /admin/export/stats
   *
   * Returns aggregate statistics about exports.
   */
  @Get('stats')
  async getStats() {
    const [
      totalExports,
      totalWritten,
      totalRenamed,
      totalSkipped,
      totalErrors,
      totalFileSize,
      lastExportArr,
      lastErrorArr,
    ] = await Promise.all([
      this.prisma.exportLog.count(),
      this.prisma.exportLog.count({ where: { status: 'written' } }),
      this.prisma.exportLog.count({ where: { status: 'renamed' } }),
      this.prisma.exportLog.count({ where: { status: 'skipped' } }),
      this.prisma.exportLog.count({ where: { status: 'error' } }),
      this.prisma.exportLog.aggregate({ _sum: { fileSizeBytes: true } }),
      this.prisma.exportLog.findMany({ orderBy: { createdAt: 'desc' }, take: 1 }),
      this.prisma.exportLog.findMany({ where: { status: 'error' }, orderBy: { createdAt: 'desc' }, take: 1 }),
    ]);

    // Unique users who exported
    const uniqueUsersResult = await this.prisma.exportLog.findMany({
      distinct: ['userId'],
      select: { userId: true },
    });

    return {
      totalExports,
      totalWritten,
      totalRenamed,
      totalSkipped,
      totalErrors,
      totalFileSizeBytes: totalFileSize._sum.fileSizeBytes || 0,
      uniqueUsers: uniqueUsersResult.length,
      lastExport: lastExportArr[0] || null,
      lastError: lastErrorArr[0] || null,
    };
  }

  /**
   * DELETE /admin/export/logs
   *
   * Purge export logs.
   * Query params:
   *   - olderThanDays: delete logs older than N days (min 1)
   *   - all: if "true", delete all logs (requires confirmation)
   *   - confirm: must be "yes" for safety
   */
  @Delete('logs')
  async purgeLogs(
    @Query('olderThanDays') olderThanDaysParam?: string,
    @Query('all') allParam?: string,
    @Query('confirm') confirmParam?: string,
  ) {
    if (confirmParam !== 'yes') {
      throw new BadRequestException('Confirmation requise : ajoutez ?confirm=yes');
    }

    const purgeAll = allParam === 'true';
    const olderThanDays = parseInt(olderThanDaysParam || '0', 10);

    if (!purgeAll && (!olderThanDays || olderThanDays < 1)) {
      throw new BadRequestException(
        'Spécifiez olderThanDays (≥ 1) ou all=true pour purger les logs.',
      );
    }

    let where: Record<string, unknown> = {};
    if (!purgeAll && olderThanDays > 0) {
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - olderThanDays);
      where = { createdAt: { lt: cutoff } };
    }

    const result = await this.prisma.exportLog.deleteMany({ where });

    return {
      purged: result.count,
      mode: purgeAll ? 'all' : `older_than_${olderThanDays}_days`,
    };
  }
}
