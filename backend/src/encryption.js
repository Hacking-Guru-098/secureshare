const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";

/**
 * Encrypt a file buffer with a fresh per-record AES-256 key.
 * Returns the ciphertext plus the key/iv/authTag needed to decrypt.
 * In production the per-record key itself would be wrapped with each
 * authorized grantee's public key (this is the hook where ABE or a
 * key-management service like AWS KMS / HashiCorp Vault would plug in).
 */
function encryptBuffer(buffer) {
  const key = crypto.randomBytes(32); // 256-bit key
  const iv = crypto.randomBytes(12); // 96-bit IV, standard for GCM

  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return {
    ciphertext, // upload this to IPFS
    key: key.toString("hex"), // store/wrap this off the record itself (e.g. per-grantee, encrypted)
    iv: iv.toString("hex"),
    authTag: authTag.toString("hex"),
  };
}

function decryptBuffer(ciphertext, keyHex, ivHex, authTagHex) {
  const key = Buffer.from(keyHex, "hex");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

module.exports = { encryptBuffer, decryptBuffer };
