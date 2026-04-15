import { Injectable, Logger } from '@nestjs/common';
import { generateSecret, generateSync, generateURI, verifySync } from 'otplib';
import * as QRCode from 'qrcode';
import { hash, compare } from 'bcryptjs';
import { randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { encryptSecret, decryptSecret, isEncryptionEnabled, isEncrypted } from './crypto.util';

const BACKUP_CODE_COUNT = 8;
const APP_NAME = 'LMPdf';

@Injectable()
export class MfaService {
  private readonly logger = new Logger('MfaService');

  constructor(private readonly prisma: PrismaService) {
    if (isEncryptionEnabled()) {
      this.logger.log('Chiffrement TOTP AES-256-GCM activé');
    } else {
      this.logger.warn('MFA_ENCRYPTION_KEY non configurée — secrets TOTP stockés en clair');
    }
  }

  /**
   * Génère un secret TOTP + otpauth URI + QR code data URL.
   * Le secret n'est PAS encore persisté : il faut confirmer avec un code valide.
   */
  async generateSetup(userId: string, email: string): Promise<{
    secret: string;
    otpauthUrl: string;
    qrCodeDataUrl: string;
  }> {
    const secret = generateSecret();
    const otpauthUrl = generateURI({
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

  /**
   * Vérifie un code TOTP contre un secret donné.
   */
  verifyToken(token: string, secret: string): boolean {
    try {
      const result = verifySync({ token, secret });
      return result?.valid === true;
    } catch {
      return false;
    }
  }

  /**
   * Confirme l'enrôlement MFA : persiste le secret et génère les backup codes.
   * Retourne les backup codes en clair (affichés une seule fois).
   */
  async confirmEnrollment(userId: string, secret: string, token: string): Promise<{
    success: boolean;
    backupCodes?: string[];
  }> {
    if (!this.verifyToken(token, secret)) {
      return { success: false };
    }

    // Générer les backup codes
    const plainCodes = this.generateBackupCodes();
    const hashedCodes = await Promise.all(plainCodes.map(async (code) => ({
      codeHash: await hash(code, 10),
    })));

    // Transaction : activer MFA + stocker backup codes
    await this.prisma.$transaction(async (tx) => {
      // Supprimer les anciens backup codes
      await tx.userBackupCode.deleteMany({ where: { userId } });

      // Sauver le secret chiffré et activer MFA
      const encryptedSecret = encryptSecret(secret);
      await tx.user.update({
        where: { id: userId },
        data: {
          mfaEnabled: true,
          mfaSecret: encryptedSecret,
        },
      });

      // Insérer les backup codes hashés
      await tx.userBackupCode.createMany({
        data: hashedCodes.map((hc) => ({
          userId,
          codeHash: hc.codeHash,
        })),
      });
    });

    return { success: true, backupCodes: plainCodes };
  }

  /**
   * Désactive le MFA pour un utilisateur.
   */
  async disableMfa(userId: string): Promise<void> {
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

  /**
   * Vérifie un code TOTP pour un utilisateur enrôlé.
   */
  async verifyUserTotp(userId: string, token: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { mfaSecret: true, mfaEnabled: true },
    });
    if (!user?.mfaEnabled || !user.mfaSecret) return false;

    // Déchiffrer le secret si nécessaire (rétrocompatible avec secrets en clair)
    let secret: string;
    try {
      secret = decryptSecret(user.mfaSecret);
    } catch (err: any) {
      this.logger.error(`Erreur déchiffrement TOTP pour user ${userId}: ${err.message}`);
      return false;
    }

    return this.verifyToken(token, secret);
  }

  /**
   * Vérifie un backup code pour un utilisateur.
   * Le code utilisé est marqué comme consommé (usedAt).
   */
  async verifyBackupCode(userId: string, code: string): Promise<boolean> {
    const codes = await this.prisma.userBackupCode.findMany({
      where: { userId, usedAt: null },
    });

    for (const entry of codes) {
      if (await compare(code, entry.codeHash)) {
        // Marquer comme utilisé
        await this.prisma.userBackupCode.update({
          where: { id: entry.id },
          data: { usedAt: new Date() },
        });
        return true;
      }
    }
    return false;
  }

  /**
   * Régénère les backup codes (invalide les anciens).
   */
  async regenerateBackupCodes(userId: string): Promise<string[]> {
    const plainCodes = this.generateBackupCodes();

    await this.prisma.$transaction(async (tx) => {
      await tx.userBackupCode.deleteMany({ where: { userId } });
      await tx.userBackupCode.createMany({
        data: await Promise.all(plainCodes.map(async (code) => ({
          userId,
          codeHash: await hash(code, 10),
        }))),
      });
    });

    return plainCodes;
  }

  /**
   * Retourne le statut MFA d'un utilisateur (nombre de backup codes restants, etc.).
   */
  async getMfaStatus(userId: string): Promise<{
    mfaEnabled: boolean;
    backupCodesRemaining: number;
    backupCodesTotal: number;
  }> {
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

  private generateBackupCodes(): string[] {
    const codes: string[] = [];
    for (let i = 0; i < BACKUP_CODE_COUNT; i++) {
      // Format : xxxx-xxxx (8 chars hex)
      const buf = randomBytes(4);
      const hex = buf.toString('hex');
      codes.push(`${hex.slice(0, 4)}-${hex.slice(4, 8)}`);
    }
    return codes;
  }
}
