#!/usr/bin/env node
/**
 * SecureShare Full-Stack Development Orchestrator
 * Automatically starts:
 *   1. IPFS daemon (if not already running)
 *   2. Hardhat node (local blockchain)
 *   3. Deploys SecureShareAccessControl.sol
 *   4. Updates backend/.env and frontend/.env with the fresh contract address
 *   5. Backend Express server
 *   6. Frontend Vite dev server
 * With unified color-coded logs and clean Windows-friendly shutdown.
 */

const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

const ROOT_DIR = path.resolve(__dirname, "..");
const BACKEND_DIR = path.join(ROOT_DIR, "backend");
const FRONTEND_DIR = path.join(ROOT_DIR, "frontend");

// Terminal Colors
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  magenta: "\x1b[35m",
  blue: "\x1b[34m",
  red: "\x1b[31m",
  gray: "\x1b[90m",
};

const prefixes = {
  system: `${C.bold}${C.magenta}[system]${C.reset} `,
  hardhat: `${C.cyan}[hardhat]${C.reset} `,
  ipfs: `${C.yellow}[ipfs]${C.reset} `,
  deploy: `${C.magenta}[deploy]${C.reset} `,
  backend: `${C.green}[backend]${C.reset} `,
  frontend: `${C.blue}[frontend]${C.reset} `,
};

const runningProcesses = [];
let isShuttingDown = false;

function log(service, msg) {
  const p = prefixes[service] || prefixes.system;
  console.log(`${p}${msg}`);
}

function pipeOutput(child, service) {
  const p = prefixes[service] || prefixes.system;

  child.stdout?.on("data", (data) => {
    const lines = data.toString().split(/\r?\n/).filter((l) => l.trim().length > 0);
    lines.forEach((l) => console.log(`${p}${l}`));
  });

  child.stderr?.on("data", (data) => {
    const lines = data.toString().split(/\r?\n/).filter((l) => l.trim().length > 0);
    lines.forEach((l) => console.log(`${p}${C.dim}${l}${C.reset}`));
  });
}

function killProcessTree(pid) {
  if (!pid) return;
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /pid ${pid} /T /F`, { stdio: "ignore" });
    } else {
      process.kill(-pid, "SIGKILL");
    }
  } catch {
    // Process might already be dead
  }
}

function cleanExit() {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log(`\n${prefixes.system}${C.yellow}Shutting down all SecureShare development services...${C.reset}`);

  for (const p of runningProcesses) {
    killProcessTree(p.pid);
  }

  log("system", `${C.green}All services stopped cleanly.${C.reset}`);
  process.exit(0);
}

process.on("SIGINT", cleanExit);
process.on("SIGTERM", cleanExit);
process.on("exit", cleanExit);

async function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// 1. IPFS check & start
async function ensureIPFS() {
  log("ipfs", "Checking if IPFS daemon is running on http://127.0.0.1:5001...");
  try {
    const res = await fetch("http://127.0.0.1:5001/api/v0/version", { method: "POST" });
    if (res.ok) {
      const data = await res.json();
      log("ipfs", `${C.green}IPFS daemon is already running (v${data.Version || "Kubo"}). Skipping launch.${C.reset}`);
      return;
    }
  } catch {
    // Not running, attempt to start
  }

  // Check if ipfs CLI exists
  try {
    execSync("ipfs --version", { stdio: "ignore" });
  } catch {
    log("ipfs", `${C.red}Warning: 'ipfs' executable not found in PATH.${C.reset}`);
    log("ipfs", "Please install Kubo (https://docs.ipfs.tech/install/command-line/) or run a hosted gateway.");
    return;
  }

  log("ipfs", "Starting local IPFS daemon...");
  const ipfsProc = spawn("ipfs", ["daemon"], {
    shell: true,
    detached: process.platform !== "win32",
  });
  runningProcesses.push(ipfsProc);
  pipeOutput(ipfsProc, "ipfs");

  // Wait for IPFS to answer
  for (let i = 0; i < 30; i++) {
    await delay(1000);
    try {
      const res = await fetch("http://127.0.0.1:5001/api/v0/version", { method: "POST" });
      if (res.ok) {
        log("ipfs", `${C.green}IPFS daemon is ready on http://127.0.0.1:5001.${C.reset}`);
        return;
      }
    } catch {
      // Keep waiting
    }
  }
  log("ipfs", `${C.yellow}IPFS daemon started but taking longer to respond. Continuing...${C.reset}`);
}

// 2. Start Hardhat Node
async function startHardhatNode() {
  log("hardhat", "Launching Hardhat local blockchain node...");
  const hardhatProc = spawn("npx", ["hardhat", "node"], {
    cwd: ROOT_DIR,
    shell: true,
    detached: process.platform !== "win32",
  });
  runningProcesses.push(hardhatProc);
  pipeOutput(hardhatProc, "hardhat");

  log("hardhat", "Waiting for Hardhat JSON-RPC node on http://127.0.0.1:8545...");
  for (let i = 0; i < 30; i++) {
    await delay(1000);
    try {
      const res = await fetch("http://127.0.0.1:8545", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", method: "eth_blockNumber", params: [], id: 1 }),
      });
      if (res.ok) {
        log("hardhat", `${C.green}Hardhat local node is ready!${C.reset}`);
        return;
      }
    } catch {
      // Keep waiting
    }
  }
  throw new Error("Hardhat node failed to respond on http://127.0.0.1:8545 within 30 seconds.");
}

// 3. Deploy Contract & Update Envs
async function deployContract() {
  log("deploy", "Deploying SecureShareAccessControl.sol to local node...");
  return new Promise((resolve, reject) => {
    const deployProc = spawn("npx", ["hardhat", "run", "scripts/deploy.js", "--network", "localhost"], {
      cwd: ROOT_DIR,
      shell: true,
    });

    let contractAddress = null;

    deployProc.stdout?.on("data", (data) => {
      const str = data.toString();
      const lines = str.split(/\r?\n/).filter((l) => l.trim().length > 0);
      lines.forEach((l) => log("deploy", l));

      const match = str.match(/SecureShareAccessControl deployed to:\s*(0x[a-fA-F0-9]{40})/);
      if (match) {
        contractAddress = match[1];
      }
    });

    deployProc.stderr?.on("data", (data) => {
      log("deploy", `${C.red}${data.toString()}${C.reset}`);
    });

    deployProc.on("close", (code) => {
      if (code === 0) {
        log("deploy", `${C.green}${C.bold}Contract successfully deployed!${C.reset} (${contractAddress || "verified"})`);
        resolve(contractAddress);
      } else {
        reject(new Error(`Contract deployment failed with exit code ${code}`));
      }
    });
  });
}

// 4. Start Backend
function startBackend() {
  log("backend", "Starting backend Express API...");
  const backendProc = spawn("npm", ["run", "dev"], {
    cwd: BACKEND_DIR,
    shell: true,
    detached: process.platform !== "win32",
  });
  runningProcesses.push(backendProc);
  pipeOutput(backendProc, "backend");
}

// 5. Start Frontend
function startFrontend() {
  log("frontend", "Starting frontend Vite server...");
  const frontendProc = spawn("npm", ["run", "dev"], {
    cwd: FRONTEND_DIR,
    shell: true,
    detached: process.platform !== "win32",
  });
  runningProcesses.push(frontendProc);
  pipeOutput(frontendProc, "frontend");
}

async function main() {
  console.log(`\n${C.bold}${C.cyan}======================================================${C.reset}`);
  console.log(`${C.bold}${C.cyan}   SecureShare — Full Development Environment Startup ${C.reset}`);
  console.log(`${C.bold}${C.cyan}======================================================${C.reset}\n`);

  try {
    await ensureIPFS();
    await startHardhatNode();
    await deployContract();
    startBackend();
    startFrontend();

    console.log(`\n${C.bold}${C.green}======================================================${C.reset}`);
    console.log(`${C.bold}${C.green}   All SecureShare Services Are Running!             ${C.reset}`);
    console.log(`${C.bold}${C.green}======================================================${C.reset}`);
    console.log(` • ${C.bold}Frontend Dashboard:${C.reset}   http://localhost:5173`);
    console.log(` • ${C.bold}Backend API:${C.reset}          http://localhost:4000`);
    console.log(` • ${C.bold}Hardhat RPC:${C.reset}          http://127.0.0.1:8545`);
    console.log(` • ${C.bold}IPFS RPC API:${C.reset}         http://127.0.0.1:5001`);
    console.log(` • ${C.dim}Press Ctrl+C to stop all services cleanly.${C.reset}\n`);
  } catch (err) {
    log("system", `${C.red}Startup Error: ${err.message}${C.reset}`);
    cleanExit();
  }
}

main();
