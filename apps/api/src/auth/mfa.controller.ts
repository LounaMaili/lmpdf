import { Body, Controller, Get, Post, Request, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { MfaService } from './mfa.service';
import { PrismaService } from '../prisma/prisma.service';
import { compareSync } from 'bcryptjs';
import { Public } from './public.decorator';
import { loadRuntimeSettings } from '../config/runtime-settings';

@Controller('auth/mfa')
export class MfaController {
  constructor(
    private readonly mfa: MfaService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * GET /auth/mfa/status — Statut MFA de l'utilisateur connecté
   */
  @Get('status')
  async status(@Request() req: any) {
    const settings = await loadRuntimeSettings();
    const mfaStatus = await this.mfa.getMfaStatus(req.user.id);
    return {
      ...mfaStatus,
      policy: settings.mfa?.policy ?? 'optional',
    };
  }

  /**
   * POST /auth/mfa/setup — Démarre l'enrôlement MFA (génère secret + QR)
   */
  @Post('setup')
  async setup(@Request() req: any) {
    const user = await this.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) throw new UnauthorizedException();

    // On n'autorise le setup que pour les comptes locaux
    if (user.authSource !== 'local') {
      throw new ForbiddenException('MFA disponible uniquement pour les comptes locaux');
    }

    const result = await this.mfa.generateSetup(user.id, user.email);
    return result;
  }

  /**
   * POST /auth/mfa/confirm — Confirme l'enrôlement en vérifiant un code TOTP
   * Body: { secret: string, token: string }
   */
  @Post('confirm')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  async confirm(@Request() req: any, @Body() body: { secret: string; token: string }) {
    if (!body.secret || !body.token) {
      throw new UnauthorizedException('Vérification MFA échouée');
    }

    const result = await this.mfa.confirmEnrollment(req.user.id, body.secret, body.token);
    if (!result.success) {
      throw new UnauthorizedException('Vérification MFA échouée');
    }

    return {
      success: true,
      backupCodes: result.backupCodes,
      message: 'MFA activé avec succès',
    };
  }

  /**
   * POST /auth/mfa/disable — Désactive le MFA (requiert le mot de passe)
   * Body: { password: string }
   */
  @Post('disable')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async disable(@Request() req: any, @Body() body: { password: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) throw new UnauthorizedException();

    // Vérifier le mot de passe avant de désactiver — message générique
    if (!user.passwordHash || !compareSync(body.password, user.passwordHash)) {
      throw new UnauthorizedException('Vérification échouée');
    }

    await this.mfa.disableMfa(user.id);
    return { success: true, message: 'MFA désactivé' };
  }

  /**
   * POST /auth/mfa/regenerate-backup-codes — Régénère les backup codes
   * Body: { password: string }
   */
  @Post('regenerate-backup-codes')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  async regenerateBackupCodes(@Request() req: any, @Body() body: { password: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: req.user.id } });
    if (!user) throw new UnauthorizedException();

    if (!user.passwordHash || !compareSync(body.password, user.passwordHash)) {
      throw new UnauthorizedException('Vérification échouée');
    }

    const codes = await this.mfa.regenerateBackupCodes(user.id);
    return { success: true, backupCodes: codes };
  }
}
