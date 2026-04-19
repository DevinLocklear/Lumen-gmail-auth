"use strict";

/**
 * crypto.js
 * AES-256-GCM symmetric encryption for Yahoo app passwords.
 *
 * Requires env var: ENCRYPTION_KEY
 * Must be exactly 64 hex characters (32 bytes).
 *
 * Generate a key with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
 *
 * The encrypted format stored in Supabase is:
 *   <iv_hex>:<authTag_hex>:<ciphertext_hex>
 *
 * All three parts are required for decryption. Losing the ENCRYPTION_KEY
 * means all stored passwords are permanently unreadable — users would need
 * to run /save-yahoo again.
 */

const crypto = require("crypto");
const { createLogger } = require("./logger");

const log = createLogger("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12; // 96-bit IV recommended for GCM
const KEY_LENGTH = 32; // 256-bit key

function getKey() {
  const raw = process.env.ENCRYPTION_KEY;

  if (!raw) {
    throw new Error(
      "Missing env var: ENCRYPTION_KEY. " +
      "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }

  if (raw.length !== KEY_LENGTH * 2) {
    throw new Error(
      `ENCRYPTION_KEY must be exactly ${KEY_LENGTH * 2} hex characters (${KEY_LENGTH} bytes). ` +
      `Got ${raw.length} characters.`
    );
  }

  return Buffer.from(raw, "hex");
}

/**
 * Encrypt a plaintext string.
 * Returns a string in the format: iv:authTag:ciphertext (all hex encoded).
 */
function encrypt(plaintext) {
  if (!plaintext) return plaintext;

  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  const encrypted = Buffer.concat([
    cipher.update(String(plaintext), "utf8"),
    cipher.final(),
  ]);

  const authTag = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

/**
 * Decrypt a string produced by encrypt().
 * Returns the original plaintext, or null if decryption fails.
 */
function decrypt(encryptedString) {
  if (!encryptedString) return encryptedString;

  // If the value doesn't look like our format, it may be a legacy
  // plaintext password — return it as-is so existing connections
  // keep working during the migration window.
  if (!encryptedString.includes(":")) {
    log.warn("Decrypting value that looks like plaintext — may be a legacy password");
    return encryptedString;
  }

  try {
    const key = getKey();
    const parts = encryptedString.split(":");

    if (parts.length !== 3) {
      throw new Error("Invalid encrypted format — expected iv:authTag:ciphertext");
    }

    const [ivHex, authTagHex, ciphertextHex] = parts;
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const ciphertext = Buffer.from(ciphertextHex, "hex");

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);

    const decrypted = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  } catch (err) {
    log.error("Decryption failed", { error: err.message });
    return null;
  }
}

/**
 * Returns true if a string looks like an encrypted value (iv:authTag:ciphertext).
 * Used during migration to avoid double-encrypting already-encrypted passwords.
 */
function isEncrypted(value) {
  if (!value || typeof value !== "string") return false;
  const parts = value.split(":");
  return parts.length === 3 && parts.every((p) => /^[0-9a-f]+$/i.test(p));
}

module.exports = { encrypt, decrypt, isEncrypted };
