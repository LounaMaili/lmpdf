import {
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Post,
  Request,
  NotFoundException,
  BadRequestException,
  UseGuards,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { RolesGuard } from './roles.guard';
import { Roles } from './roles.decorator';

/**
 * V4 Auth — Admin MFA Recovery / Management
 *
 * Routes admin uniquement pour consulter et gérer l'état MFA
 * d'un utilisateur (TOTP, backup codes, WebAuthn).
 *
 * Toutes les actions sont loguées côté serveur (audit minimal).
 */
@Controller('admin/users/:userId/mfa')
@UseGuards(RolesGuard)
@Roles('admin')
export class AdminMfaController {
  private readonly logger = new Logger('AdminMfa');

  constructor(private readonly prisma: PrismaService) {}

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async findUserOrThrow(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, displayName: true, authSource: true },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');
    return user;
  }

  private audit(adminEmail: string, action: string, targetEmail: string, details?: string) {
    const msg = `[ADMIN-MFA] ${adminEmail} → ${action} pour ${targetEmail}${details ? ` (${details})` : ''}`;
    this.logger.warn(msg);
  }

  // ─── GET état MFA complet d'un utilisateur ────────────────────────────────

  @Get()
  async getMfaStatus(@Param('userId') userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        displayName: true,
        role: true,
        authSource: true,
        mfaEnabled: true,
        mfaSecret: false, // jamais exposer le secret
      },
    });
    if (!user) throw new NotFoundException('Utilisateur introuvable');

    // Backup codes stats
    const backupCodesTotal = await this.prisma.userBackupCode.count({
      where: { userId },
    });
    const backupCodesRemaining = await this.prisma.userBackupCode.count({
      where: { userId, usedAt: null },
    });
    const backupCodesUsed = backupCodesTotal - backupCodesRemaining;

    // WebAuthn credentials
    const webauthnCredentials = await this.prisma.userWebAuthnCredential.findMany({
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

    // Déterminer si TOTP est configuré (mfaSecret non null)
    const hasMfaSecret = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true },
    });

    return {
      userId: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      authSource: user.authSource,
      mfaEnabled: user.mfaEnabled,
      totpConfigured: !!hasMfaSecret?.mfaSecret,
      backupCodes: {
        total: backupCodesTotal,
        remaining: backupCodesRemaining,
        used: backupCodesUsed,
      },
      webauthnCredentials,
      webauthnCount: webauthnCredentials.length,
    };
  }

  // ─── Reset TOTP ───────────────────────────────────────────────────────────

  @Post('reset-totp')
  async resetTotp(
    @Param('userId') userId: string,
    @Request() req: any,
  ) {
    const target = await this.findUserOrThrow(userId);
    const adminEmail = req.user?.email || 'unknown-admin';

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        mfaEnabled: false,
        mfaSecret: null,
      },
    });

    this.audit(adminEmail, 'RESET_TOTP', target.email);
    return { success: true, message: `TOTP désactivé pour ${target.email}` };
  }

  // ─── Supprimer tous les backup codes ──────────────────────────────────────

  @Delete('backup-codes')
  async deleteAllBackupCodes(
    @Param('userId') userId: string,
    @Request() req: any,
  ) {
    const target = await this.findUserOrThrow(userId);
    const adminEmail = req.user?.email || 'unknown-admin';

    const { count } = await this.prisma.userBackupCode.deleteMany({
      where: { userId },
    });

    this.audit(adminEmail, 'DELETE_ALL_BACKUP_CODES', target.email, `${count} codes supprimés`);
    return { success: true, deleted: count, message: `${count} backup codes supprimés pour ${target.email}` };
  }

  // ─── Supprimer une clé WebAuthn précise ───────────────────────────────────

  @Delete('webauthn/:credentialId')
  async deleteWebauthnCredential(
    @Param('userId') userId: string,
    @Param('credentialId') credentialId: string,
    @Request() req: any,
  ) {
    const target = await this.findUserOrThrow(userId);
    const adminEmail = req.user?.email || 'unknown-admin';

    const cred = await this.prisma.userWebAuthnCredential.findFirst({
      where: { id: credentialId, userId },
    });
    if (!cred) throw new BadRequestException('Clé WebAuthn introuvable pour cet utilisateur');

    await this.prisma.userWebAuthnCredential.delete({
      where: { id: credentialId },
    });

    this.audit(adminEmail, 'DELETE_WEBAUTHN_KEY', target.email, `clé "${cred.label}" (${credentialId})`);
    return { success: true, message: `Clé WebAuthn "${cred.label}" supprimée pour ${target.email}` };
  }

  // ─── Supprimer toutes les clés WebAuthn ───────────────────────────────────

  @Delete('webauthn')
  async deleteAllWebauthnCredentials(
    @Param('userId') userId: string,
    @Request() req: any,
  ) {
    const target = await this.findUserOrThrow(userId);
    const adminEmail = req.user?.email || 'unknown-admin';

    const { count } = await this.prisma.userWebAuthnCredential.deleteMany({
      where: { userId },
    });

    this.audit(adminEmail, 'DELETE_ALL_WEBAUTHN_KEYS', target.email, `${count} clés supprimées`);
    return { success: true, deleted: count, message: `${count} clés WebAuthn supprimées pour ${target.email}` };
  }

  // ─── Reset MFA complet (TOTP + backup codes + WebAuthn) ───────────────────

  @Post('reset-all')
  async resetAllMfa(
    @Param('userId') userId: string,
    @Request() req: any,
  ) {
    const target = await this.findUserOrThrow(userId);
    const adminEmail = req.user?.email || 'unknown-admin';

    const result = await this.prisma.$transaction(async (tx) => {
      // Désactiver TOTP
      await tx.user.update({
        where: { id: userId },
        data: {
          mfaEnabled: false,
          mfaSecret: null,
        },
      });

      // Supprimer tous les backup codes
      const backupResult = await tx.userBackupCode.deleteMany({
        where: { userId },
      });

      // Supprimer toutes les clés WebAuthn
      const webauthnResult = await tx.userWebAuthnCredential.deleteMany({
        where: { userId },
      });

      return {
        backupCodesDeleted: backupResult.count,
        webauthnKeysDeleted: webauthnResult.count,
      };
    });

    this.audit(
      adminEmail,
      'RESET_ALL_MFA',
      target.email,
      `TOTP reset, ${result.backupCodesDeleted} backup codes, ${result.webauthnKeysDeleted} clés WebAuthn supprimés`,
    );

    return {
      success: true,
      message: `MFA complètement réinitialisé pour ${target.email}`,
      details: result,
    };
  }
}
