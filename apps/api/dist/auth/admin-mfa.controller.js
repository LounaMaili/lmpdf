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
exports.AdminMfaController = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../prisma/prisma.service");
const roles_guard_1 = require("./roles.guard");
const roles_decorator_1 = require("./roles.decorator");
let AdminMfaController = class AdminMfaController {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger('AdminMfa');
    }
    async findUserOrThrow(userId) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { id: true, email: true, displayName: true, authSource: true },
        });
        if (!user)
            throw new common_1.NotFoundException('Utilisateur introuvable');
        return user;
    }
    audit(adminEmail, action, targetEmail, details) {
        const msg = `[ADMIN-MFA] ${adminEmail} → ${action} pour ${targetEmail}${details ? ` (${details})` : ''}`;
        this.logger.warn(msg);
    }
    async getMfaStatus(userId) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: {
                id: true,
                email: true,
                displayName: true,
                role: true,
                authSource: true,
                mfaEnabled: true,
                mfaSecret: false,
            },
        });
        if (!user)
            throw new common_1.NotFoundException('Utilisateur introuvable');
        const backupCodesTotal = await this.prisma.userBackupCode.count({
            where: { userId },
        });
        const backupCodesRemaining = await this.prisma.userBackupCode.count({
            where: { userId, usedAt: null },
        });
        const backupCodesUsed = backupCodesTotal - backupCodesRemaining;
        const webauthnCredentials = await this.prisma.userWebAuthnCredential.findMany({
            where: { userId },
            select: {
                id: true,
                label: true,
                createdAt: true,
                lastUsedAt: true,
                transports: true,
            },
            orderBy: { createdAt: 'desc' },
        });
        const hasMfaSecret = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { mfaSecret: true },
        });
        return {
            userId: user.id,
            email: user.email,
            displayName: user.displayName,
            role: user.role,
            authSource: user.authSource,
            mfaEnabled: user.mfaEnabled,
            totpConfigured: !!hasMfaSecret?.mfaSecret,
            backupCodes: {
                total: backupCodesTotal,
                remaining: backupCodesRemaining,
                used: backupCodesUsed,
            },
            webauthnCredentials,
            webauthnCount: webauthnCredentials.length,
        };
    }
    async resetTotp(userId, req) {
        const target = await this.findUserOrThrow(userId);
        const adminEmail = req.user?.email || 'unknown-admin';
        await this.prisma.user.update({
            where: { id: userId },
            data: {
                mfaEnabled: false,
                mfaSecret: null,
            },
        });
        this.audit(adminEmail, 'RESET_TOTP', target.email);
        return { success: true, message: `TOTP désactivé pour ${target.email}` };
    }
    async deleteAllBackupCodes(userId, req) {
        const target = await this.findUserOrThrow(userId);
        const adminEmail = req.user?.email || 'unknown-admin';
        const { count } = await this.prisma.userBackupCode.deleteMany({
            where: { userId },
        });
        this.audit(adminEmail, 'DELETE_ALL_BACKUP_CODES', target.email, `${count} codes supprimés`);
        return { success: true, deleted: count, message: `${count} backup codes supprimés pour ${target.email}` };
    }
    async deleteWebauthnCredential(userId, credentialId, req) {
        const target = await this.findUserOrThrow(userId);
        const adminEmail = req.user?.email || 'unknown-admin';
        const cred = await this.prisma.userWebAuthnCredential.findFirst({
            where: { id: credentialId, userId },
        });
        if (!cred)
            throw new common_1.BadRequestException('Clé WebAuthn introuvable pour cet utilisateur');
        await this.prisma.userWebAuthnCredential.delete({
            where: { id: credentialId },
        });
        this.audit(adminEmail, 'DELETE_WEBAUTHN_KEY', target.email, `clé "${cred.label}" (${credentialId})`);
        return { success: true, message: `Clé WebAuthn "${cred.label}" supprimée pour ${target.email}` };
    }
    async deleteAllWebauthnCredentials(userId, req) {
        const target = await this.findUserOrThrow(userId);
        const adminEmail = req.user?.email || 'unknown-admin';
        const { count } = await this.prisma.userWebAuthnCredential.deleteMany({
            where: { userId },
        });
        this.audit(adminEmail, 'DELETE_ALL_WEBAUTHN_KEYS', target.email, `${count} clés supprimées`);
        return { success: true, deleted: count, message: `${count} clés WebAuthn supprimées pour ${target.email}` };
    }
    async resetAllMfa(userId, req) {
        const target = await this.findUserOrThrow(userId);
        const adminEmail = req.user?.email || 'unknown-admin';
        const result = await this.prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: userId },
                data: {
                    mfaEnabled: false,
                    mfaSecret: null,
                },
            });
            const backupResult = await tx.userBackupCode.deleteMany({
                where: { userId },
            });
            const webauthnResult = await tx.userWebAuthnCredential.deleteMany({
                where: { userId },
            });
            return {
                backupCodesDeleted: backupResult.count,
                webauthnKeysDeleted: webauthnResult.count,
            };
        });
        this.audit(adminEmail, 'RESET_ALL_MFA', target.email, `TOTP reset, ${result.backupCodesDeleted} backup codes, ${result.webauthnKeysDeleted} clés WebAuthn supprimés`);
        return {
            success: true,
            message: `MFA complètement réinitialisé pour ${target.email}`,
            details: result,
        };
    }
};
exports.AdminMfaController = AdminMfaController;
__decorate([
    (0, common_1.Get)(),
    __param(0, (0, common_1.Param)('userId')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", Promise)
], AdminMfaController.prototype, "getMfaStatus", null);
__decorate([
    (0, common_1.Post)('reset-totp'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminMfaController.prototype, "resetTotp", null);
__decorate([
    (0, common_1.Delete)('backup-codes'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminMfaController.prototype, "deleteAllBackupCodes", null);
__decorate([
    (0, common_1.Delete)('webauthn/:credentialId'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Param)('credentialId')),
    __param(2, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, Object]),
    __metadata("design:returntype", Promise)
], AdminMfaController.prototype, "deleteWebauthnCredential", null);
__decorate([
    (0, common_1.Delete)('webauthn'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminMfaController.prototype, "deleteAllWebauthnCredentials", null);
__decorate([
    (0, common_1.Post)('reset-all'),
    __param(0, (0, common_1.Param)('userId')),
    __param(1, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object]),
    __metadata("design:returntype", Promise)
], AdminMfaController.prototype, "resetAllMfa", null);
exports.AdminMfaController = AdminMfaController = __decorate([
    (0, common_1.Controller)('admin/users/:userId/mfa'),
    (0, common_1.UseGuards)(roles_guard_1.RolesGuard),
    (0, roles_decorator_1.Roles)('admin'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AdminMfaController);
//# sourceMappingURL=admin-mfa.controller.js.map