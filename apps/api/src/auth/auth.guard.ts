import { ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { AuthGuard as PassportAuthGuard } from '@nestjs/passport';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY } from './public.decorator';
import { ALLOW_MFA_ENROLLMENT } from './mfa-enrollment';

/**
 * JWT auth guard. Routes decorated with @Public() skip auth.
 */
@Injectable()
export class JwtAuthGuard extends PassportAuthGuard('jwt') {
  constructor(private reflector: Reflector) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;
    return super.canActivate(context);
  }

  handleRequest<TUser = any>(err: any, user: TUser, _info: any, context: ExecutionContext): TUser {
    if (err || !user) {
      throw err || new UnauthorizedException('Authentification requise');
    }
    if ((user as any).mfaSetupRequired && !this.reflector.get<boolean>(ALLOW_MFA_ENROLLMENT, context.getHandler())) {
      throw new ForbiddenException({ code: 'MFA_ENROLLMENT_REQUIRED', message: 'Enrôlement MFA obligatoire' });
    }
    return user;
  }
}
