# SecureShare: End-User & Deployment Guide

Welcome to **SecureShare** — a decentralized, zero-trust framework for confidential data sharing in healthcare and finance. SecureShare combines **AES-256-GCM symmetric encryption**, **IPFS decentralized storage**, and an **Ethereum Solidity Smart Contract** for fine-grained role-based access control and immutable audit trails.

---

## 1. Architecture Summary

| Component | Responsibility | Technology |
|---|---|---|
| **Smart Contract** | Access Control Layer & Audit Logging (`registerRecord`, `grantAccess`, `revokeAccess`, `hasAccess`, `logAccessAttemptFor`) | Solidity `0.8.24`, Hardhat |
| **Off-Chain Storage** | Encrypted blob pinning and decentralized retrieval (never stores plaintext) | IPFS (Kubo) HTTP API |
| **Confidentiality** | Off-chain authenticated symmetric encryption (AES-256-GCM, 128-bit tag) | Node.js Crypto / Web Cryptography API |
| **Key Envelope** | Per-grantee Key Encryption Key (KEK) derivation & wrapping | HKDF (RFC 5869) + AES-256-GCM |
| **API Backend** | Orchestrates encryption, IPFS pinning, envelope management, and contract queries | Node.js, Express |
| **Frontend UI** | Web3 dashboard with MetaMask signer, network switcher, and audit explorer | React 18, Vite, Ethers.js v6 |

---

## 2. Quickstart: Starting the Full Environment

SecureShare features a one-command orchestrator that automatically boots the IPFS daemon, local Hardhat EVM, compiles & deploys the smart contract, and launches both the backend and frontend:

```bash
# In the project root:
npm run dev:all
```

Once running:
- **Frontend UI:** [http://localhost:5173](http://localhost:5173)
- **Backend REST API:** [http://localhost:4000](http://localhost:4000)
- **Hardhat EVM Node:** [http://127.0.0.1:8545](http://127.0.0.1:8545) (Chain ID `31337` / `0x7a69`)
- **IPFS Kubo API:** [http://127.0.0.1:5001](http://127.0.0.1:5001)

---

## 3. Connecting MetaMask to SecureShare

### Option A: Hardhat Localhost (Default Development)
1. **Install MetaMask:** Install the extension from [metamask.io](https://metamask.io/download/).
2. **Add Hardhat Localhost Network:**
   - **Network Name:** `Hardhat Localhost`
   - **RPC URL:** `http://127.0.0.1:8545`
   - **Chain ID:** `31337`
   - **Currency Symbol:** `ETH`
   *(Or simply click **Connect MetaMask** in SecureShare — the app will automatically prompt you to add and switch to this network).*
3. **Import a Pre-Funded Test Account:**
   - In MetaMask: Click Account Selector $\rightarrow$ **Add account or hardware wallet** $\rightarrow$ **Import account**.
   - Paste Account 0 Private Key:
     ```
     0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
     ```
   - Address: `0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266` (Pre-funded with 10,000 test ETH).

> [!IMPORTANT]
> **Resolving Nonce Desynchronization After Node Restart:**
> Whenever you restart the Hardhat node, block counts and account nonces reset to 0, but MetaMask retains cached transactions. This triggers error `-32000` ("Nonce too high").
> **Fix in 5 seconds:**
> 1. Open MetaMask $\rightarrow$ Click Settings (via account circle or 3 dots).
> 2. Click **Advanced**.
> 3. Click **Clear activity tab data** (or *Reset account*).
> 4. Retry your transaction.

---

### Option B: Deploying to Ethereum Sepolia Testnet

1. **Obtain Sepolia Test ETH:**
   - Faucets: [Google Cloud Web3 Faucet](https://cloud.google.com/application/web3/faucet/ethereum/sepolia) or [Sepolia PoW Faucet](https://sepolia-faucet.pk910.de/).
2. **Configure Environment Variables:**
   In `backend/.env` (or root `.env`):
   ```env
   SEPOLIA_RPC_URL=https://rpc.sepolia.org
   SEPOLIA_PRIVATE_KEY=your_funded_testnet_private_key_here
   ```
3. **Deploy the Smart Contract:**
   ```bash
   npx hardhat run scripts/deploy.js --network sepolia
   ```
4. **Switch Network in the UI:**
   In the SecureShare header, open the network switcher dropdown and select **🟣 Sepolia (11155111)**. MetaMask will automatically prompt you to approve the switch.

---

## 4. Feature Walkthrough

### 1. Upload & Encrypt
- Drag and drop or browse for any file (PDF diagnostic reports, financial spreadsheets, DICOM images).
- Enter an optional **Record Label** (e.g. `Brain-MRI-Patient-101`).
- Click **Encrypt & Register on Blockchain**:
  - Off-chain: Encrypts file with AES-256-GCM.
  - Off-chain: Pins ciphertext to IPFS $\rightarrow$ receives CID.
  - On-chain: Prompts MetaMask to execute `registerRecord(recordId, CID)` signing as the record owner.

### 2. My Records Dashboard
- Switch to the **My Records** tab to view all encrypted records you have created.
- Review original filenames, IPFS CIDs, and active grantee counts.
- 1-click shortcut buttons to **Manage Access**, **Decrypt**, or view the **Audit Trail**.

### 3. Fine-Grained Access Control
- Enter or select a **Grantee Address** (e.g., Dr. Bob / Hospital Specialist).
- Real-time input validation verifies valid `0x...` 40-hex Ethereum addresses.
- Select an **Expiration Policy**:
  - Permanent access ($expiresAt = 0$)
  - 1 Hour, 24 Hours, 7 Days, or Custom Duration
- Click **Grant Access**: Executes `grantAccess()` on the blockchain and synchronizes the grantee's wrapped key in the cryptographic envelope.
- Click **Revoke Access**: Instantly revokes authorization on-chain and destroys the grantee's wrapped key.

### 4. Requester Portal & Decrypt
- An authorized requester provides their wallet address and the `recordId`.
- Clicks **Verify & Decrypt Record**:
  - The backend calls `contract.logAccessAttemptFor(recordId, requester)` on-chain.
  - An immutable `AccessAttempted(granted: true/false)` event is permanently mined to Ethereum.
  - If authorized, the requester's key is derived, the DEK unwrapped, and the ciphertext decrypted.
  - The original file downloads in the browser preserving its original filename and extension (e.g. `.pdf`).

### 5. Multi-Party Simulation
- Demonstrates three stakeholders (**Alice the Patient**, **Dr. Bob the Specialist**, and **Carol the Insurer**).
- Walk through the interactive scenario runner to see unauthorized attempts denied and logged in real time.

### 6. Immutable On-Chain Audit Trail
- Real-time feed of all contract events (`RecordRegistered`, `AccessGranted`, `AccessRevoked`, `AccessAttempted`).
- Filterable by `recordId`.
- Displays block numbers, transaction hashes, timestamps, and authorization outcomes.

---

## 5. Security Testing & Benchmarks

Run the automated test suites anytime:

```bash
# Run Solidity Unit Tests (100% Pass)
npm test

# Run Security Testing & Threat Simulation Suite
npx hardhat run scripts/security-tests.js

# Run Performance & Gas Benchmarks
npx hardhat run scripts/benchmark.js
```

Detailed reports generated:
- [`SECURITY_TESTING.md`](./SECURITY_TESTING.md) — Penetration testing, replay prevention, and AEAD verification.
- [`BENCHMARKS.md`](./BENCHMARKS.md) — Gas usage, cryptographic throughput, and centralized vs. decentralized comparison.
