import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Chiffrement AES-256-GCM pour les secrets TOTP au repos.
 *
 * Clé serveur : variable d'environnement MFA_ENCRYPTION_KEY (64 caractères hex = 32 octets).
 * Si la clé n'est pas définie, les secrets sont stockés en clair (rétrocompatibilité).
 *
 * Format chiffré : "enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>"
 */

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12; // 96 bits recommandés pour GCM
const PREFIX = 'enc:v1:';

function getEncryptionKey(): Buffer | null {
  const keyHex = process.env.MFA_ENCRYPTION_KEY;
  if (!keyHex) return null;
  if (keyHex.length !== 64) {
    console.error('[crypto] MFA_ENCRYPTION_KEY doit être exactement 64 caractères hex (32 octets). Chiffrement TOTP désactivé.');
    return null;
  }
  try {
    return Buffer.from(keyHex, 'hex');
  } catch {
    console.error('[crypto] MFA_ENCRYPTION_KEY invalide (pas du hex valide). Chiffrement TOTP désactivé.');
    return null;
  }
}

/**
 * Chiffre un secret TOTP. Retourne la valeur chiffrée préfixée,
 * ou le secret en clair si la clé n'est pas configurée.
 */
export function encryptSecret(plaintext: string): string {
  const key = getEncryptionKey();
  if (!key) return plaintext;

  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}

/**
 * Déchiffre un secret TOTP. Gère la rétrocompatibilité :
 * si la valeur n'est pas préfixée, elle est retournée telle quelle (secret en clair legacy).
 */
export function decryptSecret(stored: string): string {
  if (!stored.startsWith(PREFIX)) {
    // Legacy : secret en clair, pas encore chiffré
    return stored;
  }

  const key = getEncryptionKey();
  if (!key) {
    throw new Error('MFA_ENCRYPTION_KEY requise pour déchiffrer un secret TOTP chiffré');
  }

  const parts = stored.slice(PREFIX.length).split(':');
  if (parts.length !== 3) {
    throw new Error('Format de secret chiffré invalide');
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  const ciphertext = Buffer.from(ciphertextHex, 'hex');

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);

  return decrypted.toString('utf8');
}

/**
 * Indique si le chiffrement TOTP est activé (clé configurée et valide).
 */
export function isEncryptionEnabled(): boolean {
  return getEncryptionKey() !== null;
}

/**
 * Vérifie si un secret stocké est déjà chiffré.
 */
export function isEncrypted(stored: string): boolean {
  return stored.startsWith(PREFIX);
}
