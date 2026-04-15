"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AuthModule = void 0;
const common_1 = require("@nestjs/common");
const jwt_1 = require("@nestjs/jwt");
const passport_1 = require("@nestjs/passport");
const jwt_strategy_1 = require("./jwt.strategy");
const auth_controller_1 = require("./auth.controller");
const mfa_controller_1 = require("./mfa.controller");
const webauthn_controller_1 = require("./webauthn.controller");
const admin_mfa_controller_1 = require("./admin-mfa.controller");
const ldap_service_1 = require("./ldap.service");
const mfa_service_1 = require("./mfa.service");
const webauthn_service_1 = require("./webauthn.service");
const prisma_module_1 = require("../prisma/prisma.module");
function getJwtSecret() {
    const secret = (process.env.JWT_SECRET || '').trim();
    if (!secret) {
        throw new Error('JWT_SECRET requis (configurez-le dans .env)');
    }
    if (secret.length < 32) {
        throw new Error('JWT_SECRET trop court (min 32 caractères)');
    }
    return secret;
}
let AuthModule = class AuthModule {
};
exports.AuthModule = AuthModule;
exports.AuthModule = AuthModule = __decorate([
    (0, common_1.Module)({
        imports: [
            prisma_module_1.PrismaModule,
            passport_1.PassportModule.register({ defaultStrategy: 'jwt' }),
            jwt_1.JwtModule.register({
                secret: getJwtSecret(),
                signOptions: { expiresIn: '7d' },
            }),
        ],
        controllers: [auth_controller_1.AuthController, mfa_controller_1.MfaController, webauthn_controller_1.WebAuthnController, admin_mfa_controller_1.AdminMfaController],
        providers: [jwt_strategy_1.JwtStrategy, ldap_service_1.LdapService, mfa_service_1.MfaService, webauthn_service_1.WebAuthnService],
        exports: [passport_1.PassportModule, jwt_1.JwtModule, ldap_service_1.LdapService, mfa_service_1.MfaService, webauthn_service_1.WebAuthnService],
    })
], AuthModule);
//# sourceMappingURL=auth.module.js.map