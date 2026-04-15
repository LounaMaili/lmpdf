"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.ExportLogsController = exports.ExportController = exports.ExportAdminController = void 0;
const common_1 = require("@nestjs/common");
const platform_express_1 = require("@nestjs/platform-express");
const multer_1 = require("multer");
const crypto_1 = require("crypto");
const fs_1 = require("fs");
const roles_decorator_1 = require("../auth/roles.decorator");
const runtime_settings_1 = require("../config/runtime-settings");
const permission_matrix_1 = require("../config/permission-matrix");
const export_resolver_1 = require("./export-resolver");
const export_security_1 = require("./export-security");
const export_types_1 = require("./export-types");
const export_writer_1 = require("./export-writer");
const prisma_service_1 = require("../prisma/prisma.service");
async function buildExportContext(user, prisma, overrides) {
    const memberships = await prisma.groupMember.findMany({
        where: { userId: user.id },
        include: { group: { select: { name: true } } },
    });
    const groups = memberships.map((m) => m.group.name);
    return {
        username: user.email?.split('@')[0] || user.displayName || 'unknown',
        displayName: user.displayName || '',
        email: user.email || '',
        authSource: user.authSource || 'local',
        role: user.role || 'viewer',
        groups,
        ...overrides,
    };
}
let ExportAdminController = class ExportAdminController {
    async getConfig() {
        const settings = await (0, runtime_settings_1.loadRuntimeSettings)();
        const exportCfg = settings.export ?? (0, export_types_1.defaultExportSettings)();
        return exportCfg;
    }
    async validate() {
        const settings = await (0, runtime_settings_1.loadRuntimeSettings)();
        const exportCfg = settings.export ?? (0, export_types_1.defaultExportSettings)();
        const errors = [];
        errors.push(...(0, export_security_1.validateAllowedRoots)(exportCfg.allowedRoots));
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
        const seenNames = new Set();
        for (const dest of exportCfg.destinations) {
            if (seenNames.has(dest.name)) {
                errors.push(`Nom de destination en double : "${dest.name}"`);
            }
            seenNames.add(dest.name);
        }
        return { valid: errors.length === 0, errors };
    }
    async preview(body) {
        const settings = await (0, runtime_settings_1.loadRuntimeSettings)();
        const exportCfg = settings.export ?? (0, export_types_1.defaultExportSettings)();
        return (0, export_resolver_1.resolveExport)(exportCfg, body);
    }
};
exports.ExportAdminController = ExportAdminController;
__decorate([
    (0, common_1.Get)('config'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ExportAdminController.prototype, "getConfig", null);
__decorate([
    (0, common_1.Post)('validate'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ExportAdminController.prototype, "validate", null);
__decorate([
    (0, common_1.Post)('preview'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], ExportAdminController.prototype, "preview", null);
exports.ExportAdminController = ExportAdminController = __decorate([
    (0, common_1.Controller)('admin/export'),
    (0, roles_decorator_1.Roles)('admin')
], ExportAdminController);
let ExportController = class ExportController {
    constructor(prisma) {
        this.prisma = prisma;
    }
    logExport(user, body, resolved, status, finalPath, errorMessage, fileSizeBytes) {
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
    async resolve(body, req) {
        const user = req.user;
        if (!user)
            throw new common_1.ForbiddenException('Authentification requise');
        if (!(await (0, permission_matrix_1.canUser)(user.role, 'exportPdf'))) {
            throw new common_1.ForbiddenException('Droits insuffisants pour exporter');
        }
        const settings = await (0, runtime_settings_1.loadRuntimeSettings)();
        const exportCfg = settings.export ?? (0, export_types_1.defaultExportSettings)();
        if (!exportCfg.enabled) {
            return { matched: false, errors: ['Export désactivé'], enabled: false };
        }
        const ctx = await buildExportContext(user, this.prisma, {
            templateName: body.templateName || undefined,
            templateId: body.templateId || undefined,
        });
        const result = (0, export_resolver_1.resolveExport)(exportCfg, ctx);
        return { ...result, enabled: true };
    }
    async runExport(file, body, req) {
        const user = req.user;
        if (!user)
            throw new common_1.ForbiddenException('Authentification requise');
        if (!(await (0, permission_matrix_1.canUser)(user.role, 'exportPdf'))) {
            throw new common_1.ForbiddenException('Droits insuffisants pour exporter');
        }
        if (!file) {
            throw new common_1.BadRequestException('Fichier PDF manquant');
        }
        const pdfBuffer = await fs_1.promises.readFile(file.path);
        if (pdfBuffer.length < 5 || pdfBuffer.slice(0, 5).toString() !== '%PDF-') {
            await fs_1.promises.unlink(file.path).catch(() => { });
            throw new common_1.BadRequestException('Le fichier envoyé n\'est pas un PDF valide');
        }
        try {
            const settings = await (0, runtime_settings_1.loadRuntimeSettings)();
            const exportCfg = settings.export ?? (0, export_types_1.defaultExportSettings)();
            if (!exportCfg.enabled) {
                throw new common_1.BadRequestException('L\'export externe est désactivé');
            }
            const ctx = await buildExportContext(user, this.prisma, {
                templateName: body.templateName || undefined,
                templateId: body.templateId || undefined,
            });
            const resolved = (0, export_resolver_1.resolveExport)(exportCfg, ctx);
            if (!resolved.matched || resolved.errors.length > 0) {
                this.logExport(user, body, resolved, 'error', null, resolved.errors.join('; ') || 'Aucune règle ne correspond');
                throw new common_1.BadRequestException(resolved.errors.length > 0
                    ? resolved.errors.join('; ')
                    : 'Aucune règle d\'export ne correspond au contexte');
            }
            if (!resolved.fullPath) {
                this.logExport(user, body, resolved, 'error', null, 'Chemin d\'export résolu vide');
                throw new common_1.BadRequestException('Chemin d\'export résolu vide');
            }
            const writeResult = await (0, export_writer_1.writeExportFile)(resolved.fullPath, pdfBuffer, resolved.conflictStrategy || 'overwrite');
            const logStatus = writeResult.skipped
                ? 'skipped'
                : writeResult.renamed
                    ? 'renamed'
                    : 'written';
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
        }
        catch (err) {
            if (err instanceof common_1.BadRequestException || err instanceof common_1.ForbiddenException) {
                throw err;
            }
            this.logExport(user, body, null, 'error', null, err?.message || 'Erreur interne', pdfBuffer.length);
            throw err;
        }
        finally {
            await fs_1.promises.unlink(file.path).catch(() => { });
        }
    }
};
exports.ExportController = ExportController;
__decorate([
    (0, common_1.Post)('resolve'),
    __param(0, (0, common_1.Body)()),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], ExportController.prototype, "resolve", null);
__decorate([
    (0, common_1.Post)('run'),
    (0, common_1.UseInterceptors)((0, platform_express_1.FileInterceptor)('file', {
        storage: (0, multer_1.diskStorage)({
            destination: 'uploads/tmp-export',
            filename: (_, _file, cb) => cb(null, `export-${(0, crypto_1.randomUUID)()}.pdf`),
        }),
        limits: { fileSize: 50 * 1024 * 1024 },
    })),
    __param(0, (0, common_1.UploadedFile)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, Object]),
    __metadata("design:returntype", Promise)
], ExportController.prototype, "runExport", null);
exports.ExportController = ExportController = __decorate([
    (0, common_1.Controller)('export'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ExportController);
let ExportLogsController = class ExportLogsController {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async getLogs(limitParam, offsetParam, status, userId, userEmail, fromDate, toDate) {
        const take = Math.min(Math.max(parseInt(limitParam || '50', 10) || 50, 1), 200);
        const skip = Math.max(parseInt(offsetParam || '0', 10) || 0, 0);
        const where = {};
        if (status && ['written', 'skipped', 'renamed', 'error'].includes(status)) {
            where.status = status;
        }
        if (userId) {
            where.userId = userId;
        }
        if (userEmail && userEmail.trim()) {
            where.userEmail = { contains: userEmail.trim(), mode: 'insensitive' };
        }
        const createdAtFilter = {};
        if (fromDate) {
            const d = new Date(fromDate);
            if (!isNaN(d.getTime()))
                createdAtFilter.gte = d;
        }
        if (toDate) {
            const d = new Date(toDate);
            if (!isNaN(d.getTime()))
                createdAtFilter.lte = d;
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
    async getStats() {
        const [totalExports, totalWritten, totalRenamed, totalSkipped, totalErrors, totalFileSize, lastExportArr, lastErrorArr,] = await Promise.all([
            this.prisma.exportLog.count(),
            this.prisma.exportLog.count({ where: { status: 'written' } }),
            this.prisma.exportLog.count({ where: { status: 'renamed' } }),
            this.prisma.exportLog.count({ where: { status: 'skipped' } }),
            this.prisma.exportLog.count({ where: { status: 'error' } }),
            this.prisma.exportLog.aggregate({ _sum: { fileSizeBytes: true } }),
            this.prisma.exportLog.findMany({ orderBy: { createdAt: 'desc' }, take: 1 }),
            this.prisma.exportLog.findMany({ where: { status: 'error' }, orderBy: { createdAt: 'desc' }, take: 1 }),
        ]);
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
    async purgeLogs(olderThanDaysParam, allParam, confirmParam) {
        if (confirmParam !== 'yes') {
            throw new common_1.BadRequestException('Confirmation requise : ajoutez ?confirm=yes');
        }
        const purgeAll = allParam === 'true';
        const olderThanDays = parseInt(olderThanDaysParam || '0', 10);
        if (!purgeAll && (!olderThanDays || olderThanDays < 1)) {
            throw new common_1.BadRequestException('Spécifiez olderThanDays (≥ 1) ou all=true pour purger les logs.');
        }
        let where = {};
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
};
exports.ExportLogsController = ExportLogsController;
__decorate([
    (0, common_1.Get)('logs'),
    __param(0, (0, common_1.Query)('limit')),
    __param(1, (0, common_1.Query)('offset')),
    __param(2, (0, common_1.Query)('status')),
    __param(3, (0, common_1.Query)('userId')),
    __param(4, (0, common_1.Query)('userEmail')),
    __param(5, (0, common_1.Query)('from')),
    __param(6, (0, common_1.Query)('to')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], ExportLogsController.prototype, "getLogs", null);
__decorate([
    (0, common_1.Get)('stats'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], ExportLogsController.prototype, "getStats", null);
__decorate([
    (0, common_1.Delete)('logs'),
    __param(0, (0, common_1.Query)('olderThanDays')),
    __param(1, (0, common_1.Query)('all')),
    __param(2, (0, common_1.Query)('confirm')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String]),
    __metadata("design:returntype", Promise)
], ExportLogsController.prototype, "purgeLogs", null);
exports.ExportLogsController = ExportLogsController = __decorate([
    (0, common_1.Controller)('admin/export'),
    (0, roles_decorator_1.Roles)('admin'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ExportLogsController);
//# sourceMappingURL=export.controller.js.map