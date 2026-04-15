import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { JwtStrategy } from './jwt.strategy';
import { AuthController } from './auth.controller';
import { MfaController } from './mfa.controller';
import { WebAuthnController } from './webauthn.controller';
import { AdminMfaController } from './admin-mfa.controller';
import { LdapService } from './ldap.service';
import { MfaService } from './mfa.service';
import { WebAuthnService } from './webauthn.service';
import { PrismaModule } from '../prisma/prisma.module';

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

@Module({
  imports: [
    PrismaModule,
    PassportModule.register({ defaultStrategy: 'jwt' }),
    JwtModule.register({
      secret: getJwtSecret(),
      signOptions: { expiresIn: '7d' },
    }),
  ],
  controllers: [AuthController, MfaController, WebAuthnController, AdminMfaController],
  providers: [JwtStrategy, LdapService, MfaService, WebAuthnService],
  exports: [PassportModule, JwtModule, LdapService, MfaService, WebAuthnService],
})
export class AuthModule {}
