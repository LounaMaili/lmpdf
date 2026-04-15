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
exports.MfaController = void 0;
const common_1 = require("@nestjs/common");
const throttler_1 = require("@nestjs/throttler");
const mfa_service_1 = require("./mfa.service");
const prisma_service_1 = require("../prisma/prisma.service");
const bcryptjs_1 = require("bcryptjs");
const runtime_settings_1 = require("../config/runtime-settings");
let MfaController = class MfaController {
    constructor(mfa, prisma) {
        this.mfa = mfa;
        this.prisma = prisma;
    }
    async status(req) {
        const settings = await (0, runtime_settings_1.loadRuntimeSettings)();
        const mfaStatus = await this.mfa.getMfaStatus(req.user.id);
        return {
            ...mfaStatus,
            policy: settings.mfa?.policy ?? 'optional',
        };
    }
    async setup(req) {
        const user = await this.prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user)
            throw new common_1.UnauthorizedException();
        if (user.authSource !== 'local') {
            throw new common_1.ForbiddenException('MFA disponible uniquement pour les comptes locaux');
        }
        const result = await this.mfa.generateSetup(user.id, user.email);
        return result;
    }
    async confirm(req, body) {
        if (!body.secret || !body.token) {
            throw new common_1.UnauthorizedException('Vérification MFA échouée');
        }
        const result = await this.mfa.confirmEnrollment(req.user.id, body.secret, body.token);
        if (!result.success) {
            throw new common_1.UnauthorizedException('Vérification MFA échouée');
        }
        return {
            success: true,
            backupCodes: result.backupCodes,
            message: 'MFA activé avec succès',
        };
    }
    async disable(req, body) {
        const user = await this.prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user)
            throw new common_1.UnauthorizedException();
        if (!user.passwordHash || !(0, bcryptjs_1.compareSync)(body.password, user.passwordHash)) {
            throw new common_1.UnauthorizedException('Vérification échouée');
        }
        await this.mfa.disableMfa(user.id);
        return { success: true, message: 'MFA désactivé' };
    }
    async regenerateBackupCodes(req, body) {
        const user = await this.prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user)
            throw new common_1.UnauthorizedException();
        if (!user.passwordHash || !(0, bcryptjs_1.compareSync)(body.password, user.passwordHash)) {
            throw new common_1.UnauthorizedException('Vérification échouée');
        }
        const codes = await this.mfa.regenerateBackupCodes(user.id);
        return { success: true, backupCodes: codes };
    }
};
exports.MfaController = MfaController;
__decorate([
    (0, common_1.Get)('status'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MfaController.prototype, "status", null);
__decorate([
    (0, common_1.Post)('setup'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], MfaController.prototype, "setup", null);
__decorate([
    (0, common_1.Post)('confirm'),
    (0, throttler_1.Throttle)({ default: { limit: 5, ttl: 60_000 } }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MfaController.prototype, "confirm", null);
__decorate([
    (0, common_1.Post)('disable'),
    (0, throttler_1.Throttle)({ default: { limit: 3, ttl: 60_000 } }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MfaController.prototype, "disable", null);
__decorate([
    (0, common_1.Post)('regenerate-backup-codes'),
    (0, throttler_1.Throttle)({ default: { limit: 3, ttl: 60_000 } }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], MfaController.prototype, "regenerateBackupCodes", null);
exports.MfaController = MfaController = __decorate([
    (0, common_1.Controller)('auth/mfa'),
    __metadata("design:paramtypes", [mfa_service_1.MfaService,
        prisma_service_1.PrismaService])
], MfaController);
//# sourceMappingURL=mfa.controller.js.map