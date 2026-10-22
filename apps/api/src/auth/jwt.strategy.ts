import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, ExtractJwt } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';
import { isAccessTokenPayload, isMfaEnrollmentPayload } from './jwt-purpose';
import { hasTotp, localMfaRequired } from './mfa-enrollment';
import { loadRuntimeSettings } from '../config/runtime-settings';

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

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy, 'jwt') {
  constructor(private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: getJwtSecret(),
    });
  }

  async validate(payload: unknown) {
    const enrollment = isMfaEnrollmentPayload(payload);
    if (!isAccessTokenPayload(payload) && !enrollment) {
      throw new UnauthorizedException('Jeton d’accès requis');
    }
    const claims = payload as { sub: string; mfaVerified?: unknown };
    const user = await this.prisma.user.findUnique({ where: { id: claims.sub } });
    if (!user || !user.isActive) {
      throw new UnauthorizedException('Utilisateur inactif ou introuvable');
    }
    const required = localMfaRequired(await loadRuntimeSettings(), user);
    let mfaSetupRequired = false;
    if (required) {
      const hasFactor = hasTotp(user) || await this.prisma.userWebAuthnCredential.count({ where: { userId: user.id } }) > 0;
      mfaSetupRequired = !hasFactor;
      // An old pre-enrollment access must not become usable merely because a factor was added.
      if (hasFactor && (enrollment || claims.mfaVerified !== true)) {
        throw new UnauthorizedException('Nouvelle connexion avec second facteur requise');
      }
    } else if (enrollment) {
      throw new UnauthorizedException('Session d’enrôlement non applicable');
    }
    return { id: user.id, email: user.email, role: user.role, displayName: user.displayName, mfaSetupRequired };
  }
}
