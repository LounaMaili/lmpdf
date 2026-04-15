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
exports.AuthController = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const throttler_1 = require("@nestjs/throttler");
const bcryptjs_1 = require("bcryptjs");
const prisma_service_1 = require("../prisma/prisma.service");
const ldap_service_1 = require("./ldap.service");
const mfa_service_1 = require("./mfa.service");
const webauthn_service_1 = require("./webauthn.service");
const register_dto_1 = require("./dto/register.dto");
const login_dto_1 = require("./dto/login.dto");
const public_decorator_1 = require("./public.decorator");
const permission_matrix_1 = require("../config/permission-matrix");
const runtime_settings_1 = require("../config/runtime-settings");
const AUTH_FAIL = 'Identifiants invalides';
const PASSWORDLESS_FAIL = 'Connexion par passkey non disponible';
let AuthController = class AuthController {
    constructor(prisma, jwtService, ldap, mfa, webauthn) {
        this.prisma = prisma;
        this.jwtService = jwtService;
        this.ldap = ldap;
        this.mfa = mfa;
        this.webauthn = webauthn;
    }
    async register(body) {
        const settings = await (0, runtime_settings_1.loadRuntimeSettings)();
        const allowSelfRegister = (process.env.ALLOW_SELF_REGISTER || 'false') === 'true';
        if (settings.auth.mode === 'ldap')
            throw new common_1.ForbiddenException('Inscription locale désactivée en mode LDAP');
        if (!allowSelfRegister)
            throw new common_1.ForbiddenException('Inscription désactivée');
        const exists = await this.prisma.user.findUnique({ where: { email: body.email } });
        if (exists)
            throw new common_1.ConflictException('Email déjà utilisé');
        const userCount = await this.prisma.user.count();
        const role = userCount === 0 ? 'admin' : 'editor';
        const user = await this.prisma.user.create({
            data: {
                email: body.email,
                passwordHash: (0, bcryptjs_1.hashSync)(body.password, 10),
                displayName: body.displayName,
                role: role,
                authSource: 'local',
            },
        });
        const token = this.signToken(user);
        return {
            token,
            user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, authSource: user.authSource, externalId: user.externalId },
        };
    }
    async login(body) {
        const settings = await (0, runtime_settings_1.loadRuntimeSettings)();
        const useLdap = settings.auth.mode === 'ldap' || settings.auth.mode === 'hybrid';
        const allowLocal = settings.auth.mode === 'local' || (settings.auth.mode === 'hybrid' && settings.auth.allowLocalAdminFallback);
        if (useLdap && this.ldap.enabled) {
            const ldapResult = await this.tryLdapLogin(body.email, body.password);
            if (ldapResult)
                return ldapResult;
            if (settings.auth.mode === 'ldap')
                throw new common_1.UnauthorizedException('Identifiants invalides');
        }
        if (!allowLocal)
            throw new common_1.UnauthorizedException('Authentification locale désactivée');
        const user = await this.prisma.user.findUnique({ where: { email: body.email } });
        if (!user || !user.isActive)
            throw new common_1.UnauthorizedException('Identifiants invalides');
        if (!user.passwordHash) {
            throw new common_1.UnauthorizedException('Identifiants invalides');
        }
        try {
            if (!(0, bcryptjs_1.compareSync)(body.password, user.passwordHash)) {
                throw new common_1.UnauthorizedException('Identifiants invalides');
            }
        }
        catch {
            throw new common_1.UnauthorizedException('Identifiants invalides');
        }
        const hasWebauthn = await this.webauthn.hasCredentials(user.id);
        if ((user.mfaEnabled && user.mfaSecret) || hasWebauthn) {
            const mfaChallengeToken = this.jwtService.sign({ sub: user.id, email: user.email, role: user.role, mfaChallenge: true }, { expiresIn: '2m' });
            let webauthnOptions = null;
            if (hasWebauthn) {
                webauthnOptions = await this.webauthn.beginAuthentication(user.id);
            }
            return {
                mfaRequired: true,
                mfaChallengeToken,
                webauthnOptions,
                user: { id: user.id, email: user.email, displayName: user.displayName },
            };
        }
        const mfaPolicy = settings.mfa?.policy ?? 'optional';
        const mfaSetupRequired = mfaPolicy === 'required' && !user.mfaEnabled && !hasWebauthn && user.authSource === 'local';
        const token = this.signToken(user);
        return {
            token,
            user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, authSource: user.authSource, externalId: user.externalId },
            mfaSetupRequired,
        };
    }
    async loginMfaVerify(body) {
        const MFA_FAIL = 'Vérification MFA échouée';
        if (!body.mfaChallengeToken || !body.code) {
            throw new common_1.UnauthorizedException(MFA_FAIL);
        }
        let payload;
        try {
            payload = this.jwtService.verify(body.mfaChallengeToken);
        }
        catch {
            throw new common_1.UnauthorizedException(MFA_FAIL);
        }
        if (!payload.mfaChallenge) {
            throw new common_1.UnauthorizedException(MFA_FAIL);
        }
        const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user || !user.isActive || !user.mfaEnabled) {
            throw new common_1.UnauthorizedException(MFA_FAIL);
        }
        const code = body.code.trim();
        let valid = await this.mfa.verifyUserTotp(user.id, code);
        if (!valid) {
            valid = await this.mfa.verifyBackupCode(user.id, code);
        }
        if (!valid) {
            throw new common_1.UnauthorizedException(MFA_FAIL);
        }
        const token = this.signToken(user);
        return {
            token,
            user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, authSource: user.authSource, externalId: user.externalId },
        };
    }
    async loginWebauthnVerify(body) {
        const WEBAUTHN_FAIL = 'Vérification WebAuthn échouée';
        if (!body.mfaChallengeToken || !body.response) {
            throw new common_1.UnauthorizedException(WEBAUTHN_FAIL);
        }
        let payload;
        try {
            payload = this.jwtService.verify(body.mfaChallengeToken);
        }
        catch {
            throw new common_1.UnauthorizedException(WEBAUTHN_FAIL);
        }
        if (!payload.mfaChallenge) {
            throw new common_1.UnauthorizedException(WEBAUTHN_FAIL);
        }
        const user = await this.prisma.user.findUnique({ where: { id: payload.sub } });
        if (!user || !user.isActive) {
            throw new common_1.UnauthorizedException(WEBAUTHN_FAIL);
        }
        const valid = await this.webauthn.finishAuthentication(user.id, body.response);
        if (!valid) {
            throw new common_1.UnauthorizedException(WEBAUTHN_FAIL);
        }
        const token = this.signToken(user);
        return {
            token,
            user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, authSource: user.authSource, externalId: user.externalId },
        };
    }
    async passwordlessBegin(body) {
        if (!body.email?.trim()) {
            throw new common_1.UnauthorizedException(PASSWORDLESS_FAIL);
        }
        const settings = await (0, runtime_settings_1.loadRuntimeSettings)();
        const allowLocal = settings.auth.mode === 'local' || (settings.auth.mode === 'hybrid' && settings.auth.allowLocalAdminFallback);
        if (!allowLocal) {
            throw new common_1.UnauthorizedException(PASSWORDLESS_FAIL);
        }
        const result = await this.webauthn.beginPasswordlessAuthentication(body.email.trim());
        if (!result) {
            throw new common_1.UnauthorizedException(PASSWORDLESS_FAIL);
        }
        return { options: result.options };
    }
    async passwordlessFinish(body) {
        if (!body.email?.trim() || !body.response) {
            throw new common_1.UnauthorizedException(PASSWORDLESS_FAIL);
        }
        const user = await this.webauthn.finishPasswordlessAuthentication(body.email.trim(), body.response);
        if (!user) {
            throw new common_1.UnauthorizedException(PASSWORDLESS_FAIL);
        }
        const token = this.signToken(user);
        return {
            token,
            user: {
                id: user.id,
                email: user.email,
                displayName: user.displayName,
                role: user.role,
                authSource: user.authSource,
                externalId: user.externalId,
            },
        };
    }
    async me(req) {
        const user = await this.prisma.user.findUnique({ where: { id: req.user.id } });
        if (!user)
            throw new common_1.UnauthorizedException();
        const settings = await (0, runtime_settings_1.loadRuntimeSettings)();
        const mfaPolicy = settings.mfa?.policy ?? 'optional';
        const hasWebauthn = await this.webauthn.hasCredentials(user.id);
        return {
            id: user.id, email: user.email, displayName: user.displayName, role: user.role,
            authSource: user.authSource, externalId: user.externalId,
            mfaEnabled: user.mfaEnabled,
            hasWebauthn,
            mfaPolicy,
        };
    }
    async permissions(req) {
        return (0, permission_matrix_1.resolveRolePermissions)(req.user?.role);
    }
    async authMethods() {
        const settings = await (0, runtime_settings_1.loadRuntimeSettings)();
        return {
            mode: settings.auth.mode,
            local: settings.auth.mode !== 'ldap',
            ldap: this.ldap.enabled && settings.auth.mode !== 'local',
            allowLocalAdminFallback: settings.auth.allowLocalAdminFallback,
            autoProvisionUsers: settings.auth.autoProvisionUsers,
        };
    }
    async tryLdapLogin(emailOrUsername, password) {
        const username = emailOrUsername.includes('@')
            ? emailOrUsername.split('@')[0]
            : emailOrUsername;
        const ldapUser = await this.ldap.authenticate(username, password);
        if (!ldapUser)
            return null;
        const role = await this.ldap.resolveRole(ldapUser.memberOf);
        const settings = await (0, runtime_settings_1.loadRuntimeSettings)();
        let user = await this.prisma.user.findUnique({ where: { email: ldapUser.email } });
        if (!user && !settings.auth.autoProvisionUsers) {
            return null;
        }
        if (!user) {
            user = await this.prisma.user.create({
                data: {
                    email: ldapUser.email,
                    passwordHash: '',
                    displayName: ldapUser.displayName,
                    role: role,
                    authSource: 'ldap',
                    externalId: ldapUser.email || username,
                    externalDn: ldapUser.dn,
                },
            });
        }
        else {
            user = await this.prisma.user.update({
                where: { id: user.id },
                data: {
                    displayName: ldapUser.displayName,
                    role: role,
                    isActive: true,
                    authSource: 'ldap',
                    externalId: ldapUser.email || username,
                    externalDn: ldapUser.dn,
                },
            });
        }
        await this.syncGroupMemberships(user.id, ldapUser.memberOf);
        const token = this.signToken(user);
        return {
            token,
            user: { id: user.id, email: user.email, displayName: user.displayName, role: user.role, authSource: user.authSource, externalId: user.externalId },
            authMethod: 'ldap',
        };
    }
    async syncGroupMemberships(userId, memberOf) {
        try {
            const syncEnabled = await this.ldap.isSyncGroupMembershipEnabled();
            if (!syncEnabled)
                return;
            const mappedGroupNames = await this.ldap.resolveGroupMappings(memberOf);
            if (mappedGroupNames.length === 0) {
                const settings = await (0, runtime_settings_1.loadRuntimeSettings)();
                const allMappedNames = (settings.ldap.groupMappings || []).map((m) => m.internalGroupName);
                if (allMappedNames.length > 0) {
                    const toRemove = await this.prisma.groupMember.findMany({
                        where: {
                            userId,
                            group: { name: { in: allMappedNames } },
                        },
                    });
                    if (toRemove.length > 0) {
                        await this.prisma.groupMember.deleteMany({
                            where: { id: { in: toRemove.map((m) => m.id) } },
                        });
                    }
                }
                return;
            }
            for (const groupName of mappedGroupNames) {
                const existing = await this.prisma.group.findUnique({ where: { name: groupName } });
                if (!existing) {
                    await this.prisma.group.create({
                        data: { name: groupName, description: `Groupe synchronisé depuis AD`, createdById: null },
                    });
                }
            }
            const mappedGroups = await this.prisma.group.findMany({
                where: { name: { in: mappedGroupNames } },
            });
            const mappedGroupIds = mappedGroups.map((g) => g.id);
            const settings = await (0, runtime_settings_1.loadRuntimeSettings)();
            const allMappedNames = (settings.ldap.groupMappings || []).map((m) => m.internalGroupName);
            const allMappedGroups = await this.prisma.group.findMany({
                where: { name: { in: allMappedNames } },
            });
            const allMappedGroupIds = allMappedGroups.map((g) => g.id);
            const currentMemberships = await this.prisma.groupMember.findMany({
                where: { userId, groupId: { in: allMappedGroupIds } },
            });
            const currentGroupIds = currentMemberships.map((m) => m.groupId);
            const toAdd = mappedGroupIds.filter((gid) => !currentGroupIds.includes(gid));
            for (const groupId of toAdd) {
                await this.prisma.groupMember.create({
                    data: { userId, groupId, role: 'editor' },
                }).catch(() => { });
            }
            const toRemove = currentGroupIds.filter((gid) => !mappedGroupIds.includes(gid));
            if (toRemove.length > 0) {
                await this.prisma.groupMember.deleteMany({
                    where: { userId, groupId: { in: toRemove } },
                });
            }
        }
        catch (err) {
            console.error(`[syncGroupMemberships] Error: ${err.message}`);
        }
    }
    signToken(user) {
        return this.jwtService.sign({ sub: user.id, email: user.email, role: user.role });
    }
};
exports.AuthController = AuthController;
__decorate([
    (0, public_decorator_1.Public)(),
    (0, throttler_1.Throttle)({ default: { limit: 3, ttl: 60_000 } }),
    (0, common_1.Post)('register'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [register_dto_1.RegisterDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "register", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, throttler_1.Throttle)({ default: { limit: 5, ttl: 60_000 } }),
    (0, common_1.Post)('login'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [login_dto_1.LoginDto]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "login", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, throttler_1.Throttle)({ default: { limit: 5, ttl: 60_000 } }),
    (0, common_1.Post)('login/mfa-verify'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "loginMfaVerify", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, throttler_1.Throttle)({ default: { limit: 5, ttl: 60_000 } }),
    (0, common_1.Post)('login/webauthn-verify'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "loginWebauthnVerify", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, throttler_1.Throttle)({ default: { limit: 5, ttl: 60_000 } }),
    (0, common_1.Post)('login/passwordless-begin'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "passwordlessBegin", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, throttler_1.Throttle)({ default: { limit: 5, ttl: 60_000 } }),
    (0, common_1.Post)('login/passwordless-finish'),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "passwordlessFinish", null);
__decorate([
    (0, common_1.Get)('me'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "me", null);
__decorate([
    (0, common_1.Get)('permissions'),
    __param(0, (0, common_1.Request)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "permissions", null);
__decorate([
    (0, public_decorator_1.Public)(),
    (0, common_1.Get)('auth-methods'),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", Promise)
], AuthController.prototype, "authMethods", null);
exports.AuthController = AuthController = __decorate([
    (0, common_1.Controller)('auth'),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService,
        jwt_1.JwtService,
        ldap_service_1.LdapService,
        mfa_service_1.MfaService,
        webauthn_service_1.WebAuthnService])
], AuthController);
//# sourceMappingURL=auth.controller.js.map