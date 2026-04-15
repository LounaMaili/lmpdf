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
Object.defineProperty(exports, "__esModule", { value: true });
exports.MfaService = void 0;
const common_1 = require("@nestjs/common");
const otplib_1 = require("otplib");
const QRCode = require("qrcode");
const bcryptjs_1 = require("bcryptjs");
const crypto_1 = require("crypto");
const prisma_service_1 = require("../prisma/prisma.service");
const crypto_util_1 = require("./crypto.util");
const BACKUP_CODE_COUNT = 8;
const APP_NAME = 'LMPdf';
let MfaService = class MfaService {
    constructor(prisma) {
        this.prisma = prisma;
        this.logger = new common_1.Logger('MfaService');
        if ((0, crypto_util_1.isEncryptionEnabled)()) {
            this.logger.log('Chiffrement TOTP AES-256-GCM activé');
        }
        else {
            this.logger.warn('MFA_ENCRYPTION_KEY non configurée — secrets TOTP stockés en clair');
        }
    }
    async generateSetup(userId, email) {
        const secret = (0, otplib_1.generateSecret)();
        const otpauthUrl = (0, otplib_1.generateURI)({
            secret,
            issuer: APP_NAME,
            label: email,
            algorithm: 'sha1',
            digits: 6,
            period: 30,
        });
        const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
        return { secret, otpauthUrl, qrCodeDataUrl };
    }
    verifyToken(token, secret) {
        try {
            const result = (0, otplib_1.verifySync)({ token, secret });
            return result?.valid === true;
        }
        catch {
            return false;
        }
    }
    async confirmEnrollment(userId, secret, token) {
        if (!this.verifyToken(token, secret)) {
            return { success: false };
        }
        const plainCodes = this.generateBackupCodes();
        const hashedCodes = plainCodes.map((code) => ({
            codeHash: (0, bcryptjs_1.hashSync)(code, 10),
        }));
        await this.prisma.$transaction(async (tx) => {
            await tx.userBackupCode.deleteMany({ where: { userId } });
            const encryptedSecret = (0, crypto_util_1.encryptSecret)(secret);
            await tx.user.update({
                where: { id: userId },
                data: {
                    mfaEnabled: true,
                    mfaSecret: encryptedSecret,
                },
            });
            await tx.userBackupCode.createMany({
                data: hashedCodes.map((hc) => ({
                    userId,
                    codeHash: hc.codeHash,
                })),
            });
        });
        return { success: true, backupCodes: plainCodes };
    }
    async disableMfa(userId) {
        await this.prisma.$transaction(async (tx) => {
            await tx.user.update({
                where: { id: userId },
                data: {
                    mfaEnabled: false,
                    mfaSecret: null,
                },
            });
            await tx.userBackupCode.deleteMany({ where: { userId } });
        });
    }
    async verifyUserTotp(userId, token) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { mfaSecret: true, mfaEnabled: true },
        });
        if (!user?.mfaEnabled || !user.mfaSecret)
            return false;
        let secret;
        try {
            secret = (0, crypto_util_1.decryptSecret)(user.mfaSecret);
        }
        catch (err) {
            this.logger.error(`Erreur déchiffrement TOTP pour user ${userId}: ${err.message}`);
            return false;
        }
        return this.verifyToken(token, secret);
    }
    async verifyBackupCode(userId, code) {
        const codes = await this.prisma.userBackupCode.findMany({
            where: { userId, usedAt: null },
        });
        for (const entry of codes) {
            if ((0, bcryptjs_1.compareSync)(code, entry.codeHash)) {
                await this.prisma.userBackupCode.update({
                    where: { id: entry.id },
                    data: { usedAt: new Date() },
                });
                return true;
            }
        }
        return false;
    }
    async regenerateBackupCodes(userId) {
        const plainCodes = this.generateBackupCodes();
        await this.prisma.$transaction(async (tx) => {
            await tx.userBackupCode.deleteMany({ where: { userId } });
            await tx.userBackupCode.createMany({
                data: plainCodes.map((code) => ({
                    userId,
                    codeHash: (0, bcryptjs_1.hashSync)(code, 10),
                })),
            });
        });
        return plainCodes;
    }
    async getMfaStatus(userId) {
        const user = await this.prisma.user.findUnique({
            where: { id: userId },
            select: { mfaEnabled: true },
        });
        if (!user?.mfaEnabled) {
            return { mfaEnabled: false, backupCodesRemaining: 0, backupCodesTotal: 0 };
        }
        const total = await this.prisma.userBackupCode.count({ where: { userId } });
        const remaining = await this.prisma.userBackupCode.count({ where: { userId, usedAt: null } });
        return { mfaEnabled: true, backupCodesRemaining: remaining, backupCodesTotal: total };
    }
    generateBackupCodes() {
        const codes = [];
        for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
            const buf = (0, crypto_1.randomBytes)(4);
            const hex = buf.toString('hex');
            codes.push(`${hex.slice(0, 4)}-${hex.slice(4, 8)}`);
        }
        return codes;
    }
};
exports.MfaService = MfaService;
exports.MfaService = MfaService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], MfaService);
//# sourceMappingURL=mfa.service.js.map