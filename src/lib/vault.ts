import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/**
 * Document vault encryption: AES-256-GCM, key derived from VAULT_PASSPHRASE with scrypt.
 * Format: "OAV1" | salt(16) | iv(12) | tag(16) | ciphertext. Files are encrypted BEFORE upload,
 * so Supabase Storage only ever holds ciphertext.
 */
const MAGIC = Buffer.from("OAV1");

export function encrypt(plain: Buffer, passphrase: string): Buffer {
  if (passphrase.length < 12) throw new Error("VAULT_PASSPHRASE must be at least 12 characters");
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = scryptSync(passphrase, salt, 32);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, salt, iv, c.getAuthTag(), ct]);
}

export function decrypt(blob: Buffer, passphrase: string): Buffer {
  if (!blob.subarray(0, 4).equals(MAGIC)) throw new Error("not a vault file");
  const salt = blob.subarray(4, 20);
  const iv = blob.subarray(20, 32);
  const tag = blob.subarray(32, 48);
  const key = scryptSync(passphrase, salt, 32);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(blob.subarray(48)), d.final()]);
}
