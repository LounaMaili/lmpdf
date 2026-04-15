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
exports.WebAuthnService = void 0;
const common_1 = require("@nestjs/common");
const server_1 = require("@simplewebauthn/server");
const prisma_service_1 = require("../prisma/prisma.service");
function getRpConfig() {
    const rpID = process.env.WEBAUTHN_RP_ID || process.env.RP_ID || 'localhost';
    const rpName = process.env.WEBAUTHN_RP_NAME || 'LMPdf';
    const rpOrigin = process.env.WEBAUTHN_RP_ORIGIN || `http://${rpID}:4173`;
    return { rpID, rpName, rpOrigin };
}
const CHALLENGE_TTL_MS = 2 * 60 * 1000;
const CHALLENGE_STORE_MAX_SIZE = 10_000;
const CLEANUP_INTERVAL_MS = 60 * 1000;
const challengeStore = new Map();
const passwordlessChallengeStore = new Map();
function cleanupStore(store) {
    const now = Date.now();
    for (const [key, entry] of store) {
        if (now > entry.expiresAt) {
            store.delete(key);
        }
    }
}
setInterval(() => {
    cleanupStore(challengeStore);
    cleanupStore(passwordlessChallengeStore);
}, CLEANUP_INTERVAL_MS).unref();
function setChallenge(userId, challenge) {
    if (challengeStore.size >= CHALLENGE_STORE_MAX_SIZE) {
        cleanupStore(challengeStore);
    }
    if (challengeStore.size >= CHALLENGE_STORE_MAX_SIZE) {
        const firstKey = challengeStore.keys().next().value;
        if (firstKey)
            challengeStore.delete(firstKey);
    }
    challengeStore.set(userId, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
}
function getChallenge(userId) {
    const entry = challengeStore.get(userId);
    if (!entry)
        return null;
    challengeStore.delete(userId);
    if (Date.now() > entry.expiresAt)
        return null;
    return entry.challenge;
}
function setPasswordlessChallenge(email, challenge) {
    const key = email.toLowerCase();
    if (passwordlessChallengeStore.size >= CHALLENGE_STORE_MAX_SIZE) {
        cleanupStore(passwordlessChallengeStore);
    }
    if (passwordlessChallengeStore.size >= CHALLENGE_STORE_MAX_SIZE) {
        const firstKey = passwordlessChallengeStore.keys().next().value;
        if (firstKey)
            passwordlessChallengeStore.delete(firstKey);
    }
    passwordlessChallengeStore.set(key, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
}
function getPasswordlessChallenge(email) {
    const key = email.toLowerCase();
    const entry = passwordlessChallengeStore.get(key);
    if (!entry)
        return null;
    passwordlessChallengeStore.delete(key);
    if (Date.now() > entry.expiresAt)
        return null;
    return entry.challenge;
}
let WebAuthnService = class WebAuthnService {
    constructor(prisma) {
        this.prisma = prisma;
    }
    async beginRegistration(userId, userEmail) {
        const { rpID, rpName } = getRpConfig();
        const existingCreds = await this.prisma.userWebAuthnCredential.findMany({
            where: { userId },
            select: { credentialId: true, transports: true },
        });
        const excludeCredentials = existingCreds.map((c) => ({
            id: c.credentialId,
            transports: (c.transports || []),
        }));
        const options = await (0, server_1.generateRegistrationOptions)({
            rpName,
            rpID,
            userName: userEmail,
            userDisplayName: userEmail,
            excludeCredentials,
            authenticatorSelection: {
                residentKey: 'preferred',
                userVerification: 'preferred',
            },
            attestationType: 'none',
        });
        setChallenge(userId, options.challenge);
        return options;
    }
    async finishRegistration(userId, response, label) {
        const { rpID, rpOrigin } = getRpConfig();
        const expectedChallenge = getChallenge(userId);
        if (!expectedChallenge) {
            return { success: false, error: 'Enregistrement WebAuthn échoué' };
        }
        let verification;
        try {
            verification = await (0, server_1.verifyRegistrationResponse)({
                response,
                expectedChallenge,
                expectedOrigin: rpOrigin,
                expectedRPID: rpID,
            });
        }
        catch (err) {
            return { success: false, error: 'Enregistrement WebAuthn échoué' };
        }
        if (!verification.verified || !verification.registrationInfo) {
            return { success: false, error: 'Enregistrement WebAuthn échoué' };
        }
        const { credential } = verification.registrationInfo;
        const cred = await this.prisma.userWebAuthnCredential.create({
            data: {
                userId,
                credentialId: credential.id,
                publicKey: Buffer.from(credential.publicKey),
                counter: BigInt(credential.counter),
                transports: (credential.transports || []),
                label: label || 'Clé de sécurité',
            },
        });
        return { success: true, credentialId: cred.id };
    }
    async beginAuthentication(userId) {
        const { rpID } = getRpConfig();
        const credentials = await this.prisma.userWebAuthnCredential.findMany({
            where: { userId },
            select: { credentialId: true, transports: true },
        });
        if (credentials.length === 0) {
            return null;
        }
        const allowCredentials = credentials.map((c) => ({
            id: c.credentialId,
            transports: (c.transports || []),
        }));
        const options = await (0, server_1.generateAuthenticationOptions)({
            rpID,
            allowCredentials,
            userVerification: 'preferred',
        });
        setChallenge(userId, options.challenge);
        return options;
    }
    async finishAuthentication(userId, response) {
        const { rpID, rpOrigin } = getRpConfig();
        const expectedChallenge = getChallenge(userId);
        if (!expectedChallenge)
            return false;
        const credential = await this.prisma.userWebAuthnCredential.findFirst({
            where: { userId, credentialId: response.id },
        });
        if (!credential)
            return false;
        let verification;
        try {
            verification = await (0, server_1.verifyAuthenticationResponse)({
                response,
                expectedChallenge,
                expectedOrigin: rpOrigin,
                expectedRPID: rpID,
                credential: {
                    id: credential.credentialId,
                    publicKey: new Uint8Array(credential.publicKey),
                    counter: Number(credential.counter),
                    transports: (credential.transports || []),
                },
            });
        }
        catch {
            return false;
        }
        if (!verification.verified)
            return false;
        await this.prisma.userWebAuthnCredential.update({
            where: { id: credential.id },
            data: {
                counter: BigInt(verification.authenticationInfo.newCounter),
                lastUsedAt: new Date(),
            },
        });
        return true;
    }
    async listCredentials(userId) {
        const creds = await this.prisma.userWebAuthnCredential.findMany({
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
        return creds;
    }
    async deleteCredential(userId, credentialDbId) {
        const cred = await this.prisma.userWebAuthnCredential.findFirst({
            where: { id: credentialDbId, userId },
        });
        if (!cred)
            return false;
        await this.prisma.userWebAuthnCredential.delete({ where: { id: credentialDbId } });
        return true;
    }
    async renameCredential(userId, credentialDbId, label) {
        const cred = await this.prisma.userWebAuthnCredential.findFirst({
            where: { id: credentialDbId, userId },
        });
        if (!cred)
            return false;
        await this.prisma.userWebAuthnCredential.update({
            where: { id: credentialDbId },
            data: { label },
        });
        return true;
    }
    async hasCredentials(userId) {
        const count = await this.prisma.userWebAuthnCredential.count({ where: { userId } });
        return count > 0;
    }
    async beginPasswordlessAuthentication(email) {
        const { rpID } = getRpConfig();
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (!user || !user.isActive || user.authSource !== 'local') {
            return null;
        }
        const credentials = await this.prisma.userWebAuthnCredential.findMany({
            where: { userId: user.id },
            select: { credentialId: true, transports: true },
        });
        if (credentials.length === 0) {
            return null;
        }
        const allowCredentials = credentials.map((c) => ({
            id: c.credentialId,
            transports: (c.transports || []),
        }));
        const options = await (0, server_1.generateAuthenticationOptions)({
            rpID,
            allowCredentials,
            userVerification: 'required',
        });
        setPasswordlessChallenge(email, options.challenge);
        return { options, userId: user.id };
    }
    async finishPasswordlessAuthentication(email, response) {
        const { rpID, rpOrigin } = getRpConfig();
        const expectedChallenge = getPasswordlessChallenge(email);
        if (!expectedChallenge)
            return null;
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (!user || !user.isActive || user.authSource !== 'local') {
            return null;
        }
        const credential = await this.prisma.userWebAuthnCredential.findFirst({
            where: { userId: user.id, credentialId: response.id },
        });
        if (!credential)
            return null;
        let verification;
        try {
            verification = await (0, server_1.verifyAuthenticationResponse)({
                response,
                expectedChallenge,
                expectedOrigin: rpOrigin,
                expectedRPID: rpID,
                credential: {
                    id: credential.credentialId,
                    publicKey: new Uint8Array(credential.publicKey),
                    counter: Number(credential.counter),
                    transports: (credential.transports || []),
                },
            });
        }
        catch {
            return null;
        }
        if (!verification.verified)
            return null;
        await this.prisma.userWebAuthnCredential.update({
            where: { id: credential.id },
            data: {
                counter: BigInt(verification.authenticationInfo.newCounter),
                lastUsedAt: new Date(),
            },
        });
        return {
            id: user.id,
            email: user.email,
            displayName: user.displayName,
            role: user.role,
            authSource: user.authSource,
            externalId: user.externalId,
        };
    }
    async hasPasswordlessCapability(email) {
        const user = await this.prisma.user.findUnique({ where: { email } });
        if (!user || !user.isActive || user.authSource !== 'local') {
            return false;
        }
        const count = await this.prisma.userWebAuthnCredential.count({ where: { userId: user.id } });
        return count > 0;
    }
};
exports.WebAuthnService = WebAuthnService;
exports.WebAuthnService = WebAuthnService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], WebAuthnService);
//# sourceMappingURL=webauthn.service.js.map