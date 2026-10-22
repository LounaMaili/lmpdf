import { SetMetadata, UnauthorizedException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { RuntimeAdminSettings } from '../config/runtime-settings';

export const ALLOW_MFA_ENROLLMENT = 'allowMfaEnrollment';
export const AllowMfaEnrollment = () => SetMetadata(ALLOW_MFA_ENROLLMENT, true);

export function localMfaRequired(settings: RuntimeAdminSettings, user: { authSource: string }): boolean {
  // LDAP and hybrid policy require a separate decision; keep them unchanged.
  return settings.auth.mode === 'local' && settings.mfa.policy === 'required' && user.authSource === 'local';
}

export function hasTotp(user: { mfaEnabled: boolean; mfaSecret: string | null }): boolean {
  return user.mfaEnabled && !!user.mfaSecret;
}

/** Serialize initial factor activation across processes, without a schema change. */
export async function completeFirstEnrollment<T>(prisma: PrismaService, userId: string,
  activate: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
  return prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: userId } });
    if (!user || !user.isActive || user.authSource !== 'local' || hasTotp(user)
      || await tx.userWebAuthnCredential.count({ where: { userId } }) > 0) {
      throw new UnauthorizedException('Session d’enrôlement terminée ou invalide');
    }
    return activate(tx);
  });
}
