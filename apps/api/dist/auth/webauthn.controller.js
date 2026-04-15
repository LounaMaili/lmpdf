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
exports.WebAuthnController = void 0;
const common_1 = require("@nestjs/common");
const throttler_1 = require("@nestjs/throttler");
const webauthn_service_1 = require("./webauthn.service");
const prisma_service_1 = require("../prisma/prisma.service");
const bcryptjs_1 = require("bcryptjs");
let WebAuthnController = class WebAuthnController {
    constructor(webauthn, prisma) {
        this.webauthn = webauthn;
        this.prisma = prisma;
    }
    async listCredentials(req) {
        return this.webauthn.listCredentials(req.user.id);
    }
    async beginRegistration(req, body) {
        const user = await this.prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user)
            throw new common_1.UnauthorizedException();
        if (user.authSource !== 'local') {
            throw new common_1.ForbiddenException('WebAuthn disponible uniquement pour les comptes locaux');
        }
        if (!body.password || !user.passwordHash || !(0, bcryptjs_1.compareSync)(body.password, user.passwordHash)) {
            throw new common_1.UnauthorizedException('Vérification échouée');
        }
        const options = await this.webauthn.beginRegistration(user.id, user.email);
        return options;
    }
    async finishRegistration(req, body) {
        if (!body.response) {
            throw new common_1.BadRequestException('Réponse WebAuthn manquante');
        }
        const result = await this.webauthn.finishRegistration(req.user.id, body.response, body.label);
        if (!result.success) {
            throw new common_1.BadRequestException(result.error || 'Enregistrement échoué');
        }
        return { success: true, credentialId: result.credentialId };
    }
    async deleteCredential(req, id) {
        const deleted = await this.webauthn.deleteCredential(req.user.id, id);
        if (!deleted)
            throw new common_1.BadRequestException('Clé introuvable');
        return { success: true };
    }
    async renameCredential(req, id, body) {
        if (!body.label?.trim()) {
            throw new common_1.BadRequestException('Label requis');
        }
        const renamed = await this.webauthn.renameCredential(req.user.id, id, body.label.trim());
        if (!renamed)
            throw new common_1.BadRequestException('Clé introuvable');
        return { success: true };
    }
};
exports.WebAuthnController = WebAuthnController;
__decorate([
    (0, common_1.Get)('credentials'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], WebAuthnController.prototype, "listCredentials", null);
__decorate([
    (0, common_1.Post)('register/begin'),
    (0, throttler_1.Throttle)({ default: { limit: 5, ttl: 60_000 } }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], WebAuthnController.prototype, "beginRegistration", null);
__decorate([
    (0, common_1.Post)('register/finish'),
    (0, throttler_1.Throttle)({ default: { limit: 5, ttl: 60_000 } }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object]),
    __metadata("design:returntype", Promise)
], WebAuthnController.prototype, "finishRegistration", null);
__decorate([
    (0, common_1.Delete)('credentials/:id'),
    (0, throttler_1.Throttle)({ default: { limit: 5, ttl: 60_000 } }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String]),
    __metadata("design:returntype", Promise)
], WebAuthnController.prototype, "deleteCredential", null);
__decorate([
    (0, common_1.Patch)('credentials/:id'),
    (0, throttler_1.Throttle)({ default: { limit: 5, ttl: 60_000 } }),
    __param(0, (0, common_1.Request)()),
    __param(1, (0, common_1.Param)('id')),
    __param(2, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, String, Object]),
    __metadata("design:returntype", Promise)
], WebAuthnController.prototype, "renameCredential", null);
exports.WebAuthnController = WebAuthnController = __decorate([
    (0, common_1.Controller)('auth/webauthn'),
    __metadata("design:paramtypes", [webauthn_service_1.WebAuthnService,
        prisma_service_1.PrismaService])
], WebAuthnController);
//# sourceMappingURL=webauthn.controller.js.map