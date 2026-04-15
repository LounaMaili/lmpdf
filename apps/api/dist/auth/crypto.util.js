"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.encryptSecret = encryptSecret;
exports.decryptSecret = decryptSecret;
exports.isEncryptionEnabled = isEncryptionEnabled;
exports.isEncrypted = isEncrypted;
const crypto_1 = require("crypto");
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const PREFIX = 'enc:v1:';
function getEncryptionKey() {
    const keyHex = process.env.MFA_ENCRYPTION_KEY;
    if (!keyHex)
        return null;
    if (keyHex.length !== 64) {
        console.error('[crypto] MFA_ENCRYPTION_KEY doit être exactement 64 caractères hex (32 octets). Chiffrement TOTP désactivé.');
        return null;
    }
    try {
        return Buffer.from(keyHex, 'hex');
    }
    catch {
        console.error('[crypto] MFA_ENCRYPTION_KEY invalide (pas du hex valide). Chiffrement TOTP désactivé.');
        return null;
    }
}
function encryptSecret(plaintext) {
    const key = getEncryptionKey();
    if (!key)
        return plaintext;
    const iv = (0, crypto_1.randomBytes)(IV_LENGTH);
    const cipher = (0, crypto_1.createCipheriv)(ALGORITHM, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    return `${PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
}
function decryptSecret(stored) {
    if (!stored.startsWith(PREFIX)) {
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
    const decipher = (0, crypto_1.createDecipheriv)(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
}
function isEncryptionEnabled() {
    return getEncryptionKey() !== null;
}
function isEncrypted(stored) {
    return stored.startsWith(PREFIX);
}
//# sourceMappingURL=crypto.util.js.map