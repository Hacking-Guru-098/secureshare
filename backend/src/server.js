require("dotenv").config();
const express = require("express");
const cors = require("cors");
const multer = require("multer");

const fs = require("fs");
const path = require("path");

const { encryptBuffer, decryptBuffer } = require("./encryption");
const { uploadToIPFS, fetchFromIPFS } = require("./ipfs");
const { getContract, getProvider, getServerSigner, recordIdFromString } = require("./contract");

const app = express();
app.use(cors({ exposedHeaders: ["Content-Disposition", "X-Original-Filename", "X-Original-Mimetype"] }));
app.use(express.json());
const upload = multer({ storage: multer.memoryStorage() });

// In-memory key vault for prototype (per user architecture specification)
const keyVault = new Map(); // recordId => { key, iv, authTag, filename, mimeType }

app.get("/config", (req, res) => {
  res.json({
    contractAddress: process.env.CONTRACT_ADDRESS || null,
    rpcUrl: process.env.RPC_URL || "http://127.0.0.1:8545",
    ipfsApiUrl: process.env.IPFS_API_URL || "http://127.0.0.1:5001",
  });
});

// Prepares a record for client-side wallet signing:
// 1. Encrypts file with AES-256-GCM
// 2. Pins ciphertext to IPFS
// 3. Stores key material in keyVault
// 4. Returns { recordId, recordLabel, cid } so the owner's MetaMask wallet can sign contract.registerRecord() directly
app.post("/records/prepare", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const recordLabel = req.body.recordLabel || `record-${Date.now()}`;
    const recordId = recordIdFromString(recordLabel);
    const filename = req.file.originalname || "record.pdf";
    const mimeType = req.file.mimetype || "application/pdf";

    const { ciphertext, key, iv, authTag } = encryptBuffer(req.file.buffer);
    const cid = await uploadToIPFS(ciphertext);
    keyVault.set(recordId, { key, iv, authTag, filename, mimeType });

    res.json({ recordId, recordLabel, cid });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/records/upload", upload.single("file"), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const recordLabel = req.body.recordLabel || `record-${Date.now()}`;
    const recordId = recordIdFromString(recordLabel);
    const filename = req.file.originalname || "record.pdf";
    const mimeType = req.file.mimetype || "application/pdf";

    const { ciphertext, key, iv, authTag } = encryptBuffer(req.file.buffer);
    const cid = await uploadToIPFS(ciphertext);
    keyVault.set(recordId, { key, iv, authTag, filename, mimeType });

    const signer = getServerSigner();
    const contract = getContract(signer);
    const tx = await contract.registerRecord(recordId, cid);
    await tx.wait();

    res.json({ recordId, recordLabel, cid, txHash: tx.hash });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/records/:recordId/grant", async (req, res) => {
  try {
    const { recordId } = req.params;
    const { granteeAddress, expiresAt } = req.body; // expiresAt: unix seconds, 0 = never

    const signer = getServerSigner();
    const contract = getContract(signer);
    const tx = await contract.grantAccess(recordId, granteeAddress, expiresAt || 0);
    await tx.wait();

    res.json({ status: "granted", txHash: tx.hash });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/records/:recordId/revoke", async (req, res) => {
  try {
    const { recordId } = req.params;
    const { granteeAddress } = req.body;

    const signer = getServerSigner();
    const contract = getContract(signer);
    const tx = await contract.revokeAccess(recordId, granteeAddress);
    await tx.wait();

    res.json({ status: "revoked", txHash: tx.hash });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/records/:recordId/access/:address", async (req, res) => {
  try {
    const { recordId, address } = req.params;
    const contract = getContract(getServerSigner());
    const hasAccess = await contract.hasAccess(recordId, address);
    res.json({ hasAccess });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/events", async (req, res) => {
  try {
    const { recordId } = req.query;
    const provider = getProvider();
    const contract = getContract(provider);

    const regFilter = contract.filters.RecordRegistered();
    const grantFilter = contract.filters.AccessGranted();
    const revokeFilter = contract.filters.AccessRevoked();
    const attemptFilter = contract.filters.AccessAttempted();

    const [regEvents, grantEvents, revokeEvents, attemptEvents] = await Promise.all([
      contract.queryFilter(regFilter, 0, "latest"),
      contract.queryFilter(grantFilter, 0, "latest"),
      contract.queryFilter(revokeFilter, 0, "latest"),
      contract.queryFilter(attemptFilter, 0, "latest"),
    ]);

    const formatted = [];

    for (const e of regEvents) {
      formatted.push({
        type: "RecordRegistered",
        recordId: e.args[0],
        owner: e.args[1],
        cid: e.args[2],
        timestamp: Number(e.args[3]),
        blockNumber: e.blockNumber,
        txHash: e.transactionHash,
      });
    }

    for (const e of grantEvents) {
      formatted.push({
        type: "AccessGranted",
        recordId: e.args[0],
        owner: e.args[1],
        grantee: e.args[2],
        expiresAt: Number(e.args[3]),
        timestamp: Number(e.args[4]),
        blockNumber: e.blockNumber,
        txHash: e.transactionHash,
      });
    }

    for (const e of revokeEvents) {
      formatted.push({
        type: "AccessRevoked",
        recordId: e.args[0],
        owner: e.args[1],
        grantee: e.args[2],
        timestamp: Number(e.args[3]),
        blockNumber: e.blockNumber,
        txHash: e.transactionHash,
      });
    }

    for (const e of attemptEvents) {
      formatted.push({
        type: "AccessAttempted",
        recordId: e.args[0],
        requester: e.args[1],
        granted: e.args[2],
        timestamp: Number(e.args[3]),
        blockNumber: e.blockNumber,
        txHash: e.transactionHash,
      });
    }

    const result = recordId
      ? formatted.filter((ev) => ev.recordId.toLowerCase() === recordId.toLowerCase())
      : formatted;

    result.sort((a, b) => b.blockNumber - a.blockNumber || b.timestamp - a.timestamp);
    res.json({ events: result });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get("/records/:recordId/download", async (req, res) => {
  try {
    const { recordId } = req.params;
    const { requesterAddress } = req.query;
    if (!requesterAddress) return res.status(400).json({ error: "requesterAddress is required" });

    const signer = getServerSigner();
    const contract = getContract(signer);

    // Writes a permanent AccessAttempted event on-chain for the specific requester regardless of outcome.
    const tx = typeof contract.logAccessAttemptFor === "function"
      ? await contract.logAccessAttemptFor(recordId, requesterAddress)
      : await contract.logAccessAttempt(recordId);
    const receipt = await tx.wait();
    const event = receipt.logs
      .map((l) => { try { return contract.interface.parseLog(l); } catch { return null; } })
      .find((e) => e && e.name === "AccessAttempted");

    if (!event || !event.args.granted) {
      return res.status(403).json({ error: "Access denied", txHash: tx.hash });
    }

    const [, cid] = await contract.getRecord(recordId);
    const ciphertext = await fetchFromIPFS(cid);

    const { key, iv, authTag, filename, mimeType } = keyVault.get(recordId) || {};
    if (!key) return res.status(500).json({ error: "Decryption key unavailable server-side" });

    const plaintext = decryptBuffer(ciphertext, key, iv, authTag);
    const resolvedName = filename || "decrypted-record.pdf";
    const resolvedMime = mimeType || "application/pdf";
    res.set("Content-Type", resolvedMime);
    res.set("Content-Disposition", `attachment; filename="${resolvedName}"`);
    res.set("X-Original-Filename", resolvedName);
    res.set("X-Original-Mimetype", resolvedMime);
    res.send(plaintext);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => console.log(`SecureShare backend listening on port ${PORT}`));
