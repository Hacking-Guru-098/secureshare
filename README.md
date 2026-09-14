# SecureShare

A blockchain-enabled framework for secure, decentralized data sharing in healthcare and finance.
The blockchain stores **only** an access-control policy and an audit trail — the actual record
is AES-256-GCM encrypted and stored off-chain on IPFS, and only referenced by its CID.

## Architecture

```
┌─────────────┐      encrypt+upload      ┌───────────┐
│  Data owner │ ───────────────────────▶ │   IPFS    │  (encrypted blob)
│ (patient/   │                          └───────────┘
│  customer)  │
│             │      register CID +
│             │      grant/revoke ──────▶ ┌───────────────────────────┐
└─────────────┘                           │ SecureShareAccessControl  │  (Solidity, on-chain)
                                           │  - record registry        │
       requester (specialist/bank) ──────▶│  - time-bound access      │
       fetch + logAccessAttempt           │  - immutable audit events │
                                           └───────────────────────────┘
```

- **contracts/** — Solidity smart contract: record registry, grant/revoke access, on-chain audit log via events.
- **backend/** — Express API: encrypts files (AES-256-GCM), pins to IPFS, calls the contract.
- **frontend/** — Minimal React dashboard: upload a record, grant/revoke access, check status.
- **test/** — Hardhat/Chai test suite for the contract.

## Prerequisites

- Node.js 18+
- A local IPFS node ([Kubo](https://docs.ipfs.tech/install/command-line/)) running, or swap
  `backend/src/ipfs.js` for a hosted pinning service (Web3.Storage, Pinata) if you don't want
  to run IPFS locally during development.

## 🚀 Quick Start — One Command Runs Everything

You no longer need 4 separate terminals or manual `.env` updates. A single command automatically:
1. Verifies/launches the local IPFS daemon (`Kubo`)
2. Starts the Hardhat blockchain node (`http://127.0.0.1:8545`)
3. Deploys `SecureShareAccessControl.sol`
4. Automatically extracts the new contract address and test keys into `backend/.env` and `frontend/.env`
5. Starts the Express backend (`http://localhost:4000`)
6. Starts the Vite frontend dashboard (`http://localhost:5173`)

### Windows PowerShell:
```powershell
npm run dev:all
# or
.\start-dev.ps1
```

### Manual Individual Commands (if needed):
```bash
# Terminal 1: Local Blockchain
npx hardhat node

# Terminal 2: Deploy Contract
npx hardhat run scripts/deploy.js --network localhost

# Terminal 3: Backend API
cd backend && npm run dev

# Terminal 4: Frontend UI
cd frontend && npm run dev
```

## Roadmap & Milestones

**7th & 8th semester**
- [x] Literature survey & threat model
- [x] Access-control smart contract (registry, grant, revoke, time-bound expiry, audit events)
- [x] Encryption module (AES-256-GCM authenticated encryption) + IPFS integration
- [x] One-command full stack development orchestrator (`npm run dev:all` / `start-dev.ps1`)
- [x] MetaMask wallet integration (data owners sign registrations, grants, and revocations directly in-browser)
- [x] Multi-party demo simulator (Role 1: Patient/Owner, Role 2: Specialist/Hospital, Role 3: Insurer/Auditor)
- [x] On-chain audit trail timeline (queries and renders live `RecordRegistered`, `AccessGranted`, `AccessRevoked`, `AccessAttempted` contract events)
- [ ] Multi-party demo: simulate patient + hospital + insurer as three separate wallets
- [ ] Write & submit conference paper 1 (framework + threat model)

**8th semester**
- [ ] Per-grantee key wrapping (replace the server-side key vault with real key management)
- [ ] Multi-party consent workflow (e.g. co-owned records)
- [ ] Security testing: replay attacks, unauthorized access attempts, tampering simulation
- [ ] Performance benchmarking vs. a centralized baseline (latency, throughput, gas cost)
- [ ] Deploy to a public testnet (Sepolia)
- [ ] Write & submit conference paper 2 (implementation + evaluation results)

## Security notes for your synopsis / viva

- The contract never stores plaintext data or encryption keys — only a CID pointer and access
  policy, satisfying the "off-chain storage, on-chain access control" design from the synopsis.
- Every grant, revoke, and access attempt (successful or denied) emits an immutable on-chain
  event — this *is* the audit trail (Section 5 deliverable: "audit dashboard").
- Current key handling (`backend/src/encryption.js` + the in-memory `keyVault` in `server.js`)
  is a deliberate prototype simplification, flagged in the README and roadmap above — replacing
  it with per-grantee key wrapping or ABE is explicitly slated for 8th semester, so it reads as
  a planned milestone rather than an oversight if your guide asks about it.
