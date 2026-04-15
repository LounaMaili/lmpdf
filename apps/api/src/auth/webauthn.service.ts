import { Injectable, Logger } from '@nestjs/common';
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
  type VerifiedRegistrationResponse,
  type VerifiedAuthenticationResponse,
  type RegistrationResponseJSON,
  type AuthenticationResponseJSON,
  type AuthenticatorTransportFuture,
} from '@simplewebauthn/server';
import { PrismaService } from '../prisma/prisma.service';

/**
 * RP (Relying Party) config.
 * rpID = hostname sans port, rpOrigin = origin complète.
 * En prod, à configurer via env.
 */
function getRpConfig() {
  const rpID = process.env.WEBAUTHN_RP_ID || process.env.RP_ID || 'localhost';
  const rpName = process.env.WEBAUTHN_RP_NAME || 'LMPdf';
  const rpOrigin = process.env.WEBAUTHN_RP_ORIGIN || `http://${rpID}:4173`;
  return { rpID, rpName, rpOrigin };
}

// ─── Challenge Store durci ──────────────────────────────────────────────
// TTL réduit : 2 minutes (au lieu de 5), nettoyage périodique, limite de taille

const CHALLENGE_TTL_MS = 2 * 60 * 1000; // 2 minutes
const CHALLENGE_STORE_MAX_SIZE = 10_000; // protection contre DoS mémoire
const CLEANUP_INTERVAL_MS = 60 * 1000; // nettoyage chaque minute

const challengeStore = new Map<string, { challenge: string; expiresAt: number }>();
const passwordlessChallengeStore = new Map<string, { challenge: string; expiresAt: number }>();

function cleanupStore(store: Map<string, { challenge: string; expiresAt: number }>) {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) {
      store.delete(key);
    }
  }
}

// Nettoyage périodique des challenges expirés (évite les fuites mémoire)
setInterval(() => {
  cleanupStore(challengeStore);
  cleanupStore(passwordlessChallengeStore);
}, CLEANUP_INTERVAL_MS).unref();

function setChallenge(userId: string, challenge: string) {
  // Protection contre l'explosion mémoire : purger les expirés + limiter la taille
  if (challengeStore.size >= CHALLENGE_STORE_MAX_SIZE) {
    cleanupStore(challengeStore);
  }
  if (challengeStore.size >= CHALLENGE_STORE_MAX_SIZE) {
    // Encore trop gros après cleanup → supprimer le plus ancien
    const firstKey = challengeStore.keys().next().value;
    if (firstKey) challengeStore.delete(firstKey);
  }
  challengeStore.set(userId, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
}

function getChallenge(userId: string): string | null {
  const entry = challengeStore.get(userId);
  if (!entry) return null;
  challengeStore.delete(userId); // usage unique
  if (Date.now() > entry.expiresAt) return null;
  return entry.challenge;
}

function setPasswordlessChallenge(email: string, challenge: string) {
  const key = email.toLowerCase();
  if (passwordlessChallengeStore.size >= CHALLENGE_STORE_MAX_SIZE) {
    cleanupStore(passwordlessChallengeStore);
  }
  if (passwordlessChallengeStore.size >= CHALLENGE_STORE_MAX_SIZE) {
    const firstKey = passwordlessChallengeStore.keys().next().value;
    if (firstKey) passwordlessChallengeStore.delete(firstKey);
  }
  passwordlessChallengeStore.set(key, { challenge, expiresAt: Date.now() + CHALLENGE_TTL_MS });
}

function getPasswordlessChallenge(email: string): string | null {
  const key = email.toLowerCase();
  const entry = passwordlessChallengeStore.get(key);
  if (!entry) return null;
  passwordlessChallengeStore.delete(key); // usage unique
  if (Date.now() > entry.expiresAt) return null;
  return entry.challenge;
}

@Injectable()
export class WebAuthnService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Étape 1 registration : génère les options pour navigator.credentials.create()
   */
  async beginRegistration(userId: string, userEmail: string) {
    const { rpID, rpName } = getRpConfig();

    // Récupérer les credentials existants pour exclure les doublons
    const existingCreds = await this.prisma.userWebAuthnCredential.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    });

    const excludeCredentials = existingCreds.map((c) => ({
      id: c.credentialId,
      transports: (c.transports || []) as AuthenticatorTransportFuture[],
    }));

    const options = await generateRegistrationOptions({
      rpName,
      rpID,
      userName: userEmail,
      userDisplayName: userEmail,
      // Empêcher le re-enrôlement de la même clé
      excludeCredentials,
      // Demander un authenticator roaming ou platform
      authenticatorSelection: {
        residentKey: 'preferred',
        userVerification: 'preferred',
      },
      attestationType: 'none',
    });

    // Stocker le challenge pour vérification
    setChallenge(userId, options.challenge);

    return options;
  }

  /**
   * Étape 2 registration : vérifie la réponse du navigateur et persiste le credential
   */
  async finishRegistration(
    userId: string,
    response: RegistrationResponseJSON,
    label?: string,
  ): Promise<{ success: boolean; credentialId?: string; error?: string }> {
    const { rpID, rpOrigin } = getRpConfig();
    const expectedChallenge = getChallenge(userId);
    if (!expectedChallenge) {
      return { success: false, error: 'Enregistrement WebAuthn échoué' };
    }

    let verification: VerifiedRegistrationResponse;
    try {
      verification = await verifyRegistrationResponse({
        response,
        expectedChallenge,
        expectedOrigin: rpOrigin,
        expectedRPID: rpID,
      });
    } catch (err: any) {
      // Ne pas exposer les détails internes de l'erreur WebAuthn
      return { success: false, error: 'Enregistrement WebAuthn échoué' };
    }

    if (!verification.verified || !verification.registrationInfo) {
      return { success: false, error: 'Enregistrement WebAuthn échoué' };
    }

    const { credential } = verification.registrationInfo;

    // Sauvegarder en DB
    const cred = await this.prisma.userWebAuthnCredential.create({
      data: {
        userId,
        credentialId: credential.id,
        publicKey: Buffer.from(credential.publicKey),
        counter: BigInt(credential.counter),
        transports: (credential.transports || []) as string[],
        label: label || 'Clé de sécurité',
      },
    });

    return { success: true, credentialId: cred.id };
  }

  /**
   * Étape 1 authentication : génère les options pour navigator.credentials.get()
   */
  async beginAuthentication(userId: string) {
    const { rpID } = getRpConfig();

    const credentials = await this.prisma.userWebAuthnCredential.findMany({
      where: { userId },
      select: { credentialId: true, transports: true },
    });

    if (credentials.length === 0) {
      return null; // pas de credentials WebAuthn
    }

    const allowCredentials = credentials.map((c) => ({
      id: c.credentialId,
      transports: (c.transports || []) as AuthenticatorTransportFuture[],
    }));

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: 'preferred',
    });

    setChallenge(userId, options.challenge);

    return options;
  }

  /**
   * Étape 2 authentication : vérifie la réponse WebAuthn du navigateur
   */
  async finishAuthentication(
    userId: string,
    response: AuthenticationResponseJSON,
  ): Promise<boolean> {
    const { rpID, rpOrigin } = getRpConfig();
    const expectedChallenge = getChallenge(userId);
    if (!expectedChallenge) return false;

    // Trouver le credential correspondant
    const credential = await this.prisma.userWebAuthnCredential.findFirst({
      where: { userId, credentialId: response.id },
    });

    if (!credential) return false;

    let verification: VerifiedAuthenticationResponse;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: rpOrigin,
        expectedRPID: rpID,
        credential: {
          id: credential.credentialId,
          publicKey: new Uint8Array(credential.publicKey),
          counter: Number(credential.counter),
          transports: (credential.transports || []) as AuthenticatorTransportFuture[],
        },
      });
    } catch {
      return false;
    }

    if (!verification.verified) return false;

    // Mettre à jour le counter + lastUsedAt
    await this.prisma.userWebAuthnCredential.update({
      where: { id: credential.id },
      data: {
        counter: BigInt(verification.authenticationInfo.newCounter),
        lastUsedAt: new Date(),
      },
    });

    return true;
  }

  /**
   * Liste les credentials WebAuthn d'un utilisateur
   */
  async listCredentials(userId: string) {
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

  /**
   * Supprime un credential WebAuthn
   */
  async deleteCredential(userId: string, credentialDbId: string): Promise<boolean> {
    const cred = await this.prisma.userWebAuthnCredential.findFirst({
      where: { id: credentialDbId, userId },
    });
    if (!cred) return false;

    await this.prisma.userWebAuthnCredential.delete({ where: { id: credentialDbId } });
    return true;
  }

  /**
   * Renomme un credential WebAuthn
   */
  async renameCredential(userId: string, credentialDbId: string, label: string): Promise<boolean> {
    const cred = await this.prisma.userWebAuthnCredential.findFirst({
      where: { id: credentialDbId, userId },
    });
    if (!cred) return false;

    await this.prisma.userWebAuthnCredential.update({
      where: { id: credentialDbId },
      data: { label },
    });
    return true;
  }

  /**
   * Vérifie si un utilisateur a des credentials WebAuthn enregistrés
   */
  async hasCredentials(userId: string): Promise<boolean> {
    const count = await this.prisma.userWebAuthnCredential.count({ where: { userId } });
    return count > 0;
  }

  // ─── V3 Passwordless ───────────────────────────────────────────────────────

  /**
   * Passwordless étape 1 : à partir de l'email, retrouve les credentials et génère un challenge.
   * Retourne null si l'utilisateur n'existe pas, n'est pas local, ou n'a pas de credentials.
   * Ne révèle pas si l'email existe (retourne null uniformément).
   */
  async beginPasswordlessAuthentication(email: string): Promise<{
    options: any;
    userId: string;
  } | null> {
    const { rpID } = getRpConfig();

    // Chercher l'utilisateur local actif
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
      transports: (c.transports || []) as AuthenticatorTransportFuture[],
    }));

    const options = await generateAuthenticationOptions({
      rpID,
      allowCredentials,
      userVerification: 'required', // passwordless exige UV
    });

    // Stocker le challenge indexé par email (pré-auth)
    setPasswordlessChallenge(email, options.challenge);

    return { options, userId: user.id };
  }

  /**
   * Passwordless étape 2 : vérifie la réponse WebAuthn et retourne le user authentifié.
   * Retourne null si la vérification échoue.
   */
  async finishPasswordlessAuthentication(
    email: string,
    response: AuthenticationResponseJSON,
  ): Promise<{ id: string; email: string; displayName: string; role: string; authSource: string; externalId: string | null } | null> {
    const { rpID, rpOrigin } = getRpConfig();
    const expectedChallenge = getPasswordlessChallenge(email);
    if (!expectedChallenge) return null;

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive || user.authSource !== 'local') {
      return null;
    }

    // Trouver le credential correspondant à la réponse
    const credential = await this.prisma.userWebAuthnCredential.findFirst({
      where: { userId: user.id, credentialId: response.id },
    });

    if (!credential) return null;

    let verification: VerifiedAuthenticationResponse;
    try {
      verification = await verifyAuthenticationResponse({
        response,
        expectedChallenge,
        expectedOrigin: rpOrigin,
        expectedRPID: rpID,
        credential: {
          id: credential.credentialId,
          publicKey: new Uint8Array(credential.publicKey),
          counter: Number(credential.counter),
          transports: (credential.transports || []) as AuthenticatorTransportFuture[],
        },
      });
    } catch {
      return null;
    }

    if (!verification.verified) return null;

    // Mettre à jour le counter + lastUsedAt
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

  /**
   * Vérifie si un email correspond à un utilisateur local avec des credentials WebAuthn.
   * Utilisé côté frontend pour savoir s'il faut proposer le passwordless.
   * Volontairement minimal pour ne pas révéler d'information sensible.
   */
  async hasPasswordlessCapability(email: string): Promise<boolean> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || !user.isActive || user.authSource !== 'local') {
      return false;
    }
    const count = await this.prisma.userWebAuthnCredential.count({ where: { userId: user.id } });
    return count > 0;
  }
}

