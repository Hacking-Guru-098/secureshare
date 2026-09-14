const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

// Resolve master secret from env or persist a random local secret
const SECRET_FILE = path.join(__dirname, "..", ".master_secret");
let MASTER_SECRET = process.env.MASTER_KEY_SECRET;
if (!MASTER_SECRET) {
  if (fs.existsSync(SECRET_FILE)) {
    MASTER_SECRET = fs.readFileSync(SECRET_FILE, "utf-8").trim();
  } else {
    MASTER_SECRET = crypto.randomBytes(32).toString("hex");
    try {
      fs.writeFileSync(SECRET_FILE, MASTER_SECRET, { mode: 0o600 });
    } catch (e) {
      // If filesystem write fails, keep in memory
    }
  }
}

/**
 * Derives a 256-bit Key Encryption Key (KEK) specific to an address and record.
 * Uses HKDF (RFC 5869) with SHA-256.
 */
function deriveKek(recordId, address) {
  const normAddress = (address || "").toLowerCase();
  const info = Buffer.from(`SecureShare-KEK-${recordId}`, "utf-8");
  const salt = Buffer.from(normAddress, "utf-8");
  return crypto.hkdfSync("sha256", Buffer.from(MASTER_SECRET, "utf-8"), salt, info, 32);
}

/**
 * Derives the system Master KEK used to safely store the underlying DEK
 * so subsequent grants can re-wrap it for new grantees.
 */
function deriveMasterKek(recordId) {
  const info = Buffer.from(`SecureShare-MasterKEK-${recordId}`, "utf-8");
  const salt = Buffer.from("SecureShare-System-Salt", "utf-8");
  return crypto.hkdfSync("sha256", Buffer.from(MASTER_SECRET, "utf-8"), salt, info, 32);
}

/**
 * Encrypt a buffer with a given KEK using AES-256-GCM.
 */
function wrapBuffer(buffer, kek) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", kek, iv);
  const wrapped = Buffer.concat([cipher.update(buffer), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    wrappedKey: wrapped.toString("hex"),
    wrapIv: iv.toString("hex"),
    wrapTag: tag.toString("hex"),
  };
}

/**
 * Decrypt a wrapped buffer with a given KEK using AES-256-GCM.
 */
function unwrapBuffer(wrappedObj, kek) {
  const { wrappedKey, wrapIv, wrapTag } = wrappedObj;
  const iv = Buffer.from(wrapIv, "hex");
  const tag = Buffer.from(wrapTag, "hex");
  const ciphertext = Buffer.from(wrappedKey, "hex");

  const decipher = crypto.createDecipheriv("aes-256-gcm", kek, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

class KeyManager {
  constructor() {
    // Map: recordId => { metadata, masterWrappedDek, granteeWrappedKeys: Map() }
    this.records = new Map();
  }

  /**
   * Initializes key envelope for a newly encrypted record.
   * @param {string} recordId
   * @param {Buffer|string} dek - The raw Data Encryption Key (Buffer or hex string)
   * @param {Object} metadata - { filename, mimeType, iv, authTag, cid, recordLabel }
   * @param {string} [ownerAddress] - Address of the record owner
   */
  initRecord(recordId, dek, metadata, ownerAddress = null) {
    const dekBuffer = Buffer.isBuffer(dek) ? dek : Buffer.from(dek, "hex");
    const masterKek = deriveMasterKek(recordId);
    const masterWrappedDek = wrapBuffer(dekBuffer, masterKek);

    const recordEntry = {
      recordId,
      metadata: {
        filename: metadata.filename || "record.pdf",
        mimeType: metadata.mimeType || "application/pdf",
        iv: metadata.iv,
        authTag: metadata.authTag,
        cid: metadata.cid,
        recordLabel: metadata.recordLabel || "SecureShare Record",
        ownerAddress: ownerAddress ? ownerAddress.toLowerCase() : null,
        createdAt: Date.now(),
      },
      masterWrappedDek,
      granteeWrappedKeys: new Map(),
    };

    this.records.set(recordId, recordEntry);

    // If an owner address was provided, immediately wrap DEK for the owner
    if (ownerAddress) {
      this.grantKeyToGrantee(recordId, ownerAddress);
    }

    return recordEntry;
  }

  /**
   * Unwraps the record DEK using Master KEK.
   * Internal helper used when granting access to new grantees.
   */
  _getMasterDek(recordId) {
    const record = this.records.get(recordId);
    if (!record || !record.masterWrappedDek) {
      throw new Error(`Record ${recordId} not found in key manager`);
    }
    const masterKek = deriveMasterKek(recordId);
    return unwrapBuffer(record.masterWrappedDek, masterKek);
  }

  /**
   * Wraps and stores the record DEK specifically for a grantee address.
   */
  grantKeyToGrantee(recordId, granteeAddress) {
    const record = this.records.get(recordId);
    if (!record) {
      throw new Error(`Record ${recordId} not found in key manager`);
    }
    const normAddress = granteeAddress.toLowerCase();
    const dek = this._getMasterDek(recordId);
    const kek = deriveKek(recordId, normAddress);
    const wrapped = wrapBuffer(dek, kek);

    record.granteeWrappedKeys.set(normAddress, {
      ...wrapped,
      granteeAddress: normAddress,
      grantedAt: Date.now(),
    });

    return record.granteeWrappedKeys.get(normAddress);
  }

  /**
   * Revokes the wrapped key for a grantee address immediately.
   */
  revokeKeyForGrantee(recordId, granteeAddress) {
    const record = this.records.get(recordId);
    if (!record) return false;
    const normAddress = granteeAddress.toLowerCase();
    return record.granteeWrappedKeys.delete(normAddress);
  }

  /**
   * Checks whether a wrapped key exists for a grantee.
   */
  hasWrappedKey(recordId, granteeAddress) {
    const record = this.records.get(recordId);
    if (!record) return false;
    const normAddress = granteeAddress.toLowerCase();
    return record.granteeWrappedKeys.has(normAddress);
  }

  /**
   * Unwraps the DEK specifically for the requester address.
   * If the requester is not an authorized grantee, or was revoked, this throws.
   */
  unwrapKeyForRequester(recordId, requesterAddress) {
    const record = this.records.get(recordId);
    if (!record) {
      throw new Error(`Record ${recordId} not found in key manager`);
    }

    const normAddress = requesterAddress.toLowerCase();
    const wrappedEntry = record.granteeWrappedKeys.get(normAddress);
    if (!wrappedEntry) {
      throw new Error(`No wrapped key found for grantee ${requesterAddress}. Access not granted or revoked.`);
    }

    const kek = deriveKek(recordId, normAddress);
    const dekBuffer = unwrapBuffer(wrappedEntry, kek);
    return dekBuffer.toString("hex");
  }

  /**
   * Returns record metadata (IV, authTag, filename, etc.).
   */
  getRecordMetadata(recordId) {
    const record = this.records.get(recordId);
    if (!record) return null;
    return record.metadata;
  }

  /**
   * Sets or updates owner address for a record.
   */
  setOwner(recordId, ownerAddress) {
    const record = this.records.get(recordId);
    if (!record) return;
    record.metadata.ownerAddress = ownerAddress.toLowerCase();
    this.grantKeyToGrantee(recordId, ownerAddress);
  }

  /**
   * Returns list of authorized grantee addresses for a record.
   */
  listGranteeAddresses(recordId) {
    const record = this.records.get(recordId);
    if (!record) return [];
    return Array.from(record.granteeWrappedKeys.keys());
  }

  /**
   * Lists all registered records with high-level info (for "My Records" or dashboard).
   */
  listRecords(ownerAddress = null) {
    const results = [];
    for (const [recordId, record] of this.records.entries()) {
      if (
        !ownerAddress ||
        (record.metadata.ownerAddress &&
          record.metadata.ownerAddress.toLowerCase() === ownerAddress.toLowerCase())
      ) {
        results.push({
          recordId,
          ...record.metadata,
          authorizedCount: record.granteeWrappedKeys.size,
          authorizedGrantees: Array.from(record.granteeWrappedKeys.keys()),
        });
      }
    }
    return results;
  }
}

const keyManagerInstance = new KeyManager();
module.exports = {
  KeyManager,
  keyManager: keyManagerInstance,
  deriveKek,
  deriveMasterKek,
  wrapBuffer,
  unwrapBuffer,
};
