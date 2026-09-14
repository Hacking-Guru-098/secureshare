const hre = require("hardhat");

async function main() {
  const Factory = await hre.ethers.getContractFactory("SecureShareAccessControl");
  const contract = await Factory.deploy();
  await contract.waitForDeployment();

  const address = await contract.getAddress();
  console.log("SecureShareAccessControl deployed to:", address);

  const fs = require("fs");
  const path = require("path");

  // Auto-update backend/.env
  const backendEnvPath = path.join(__dirname, "..", "backend", ".env");
  const defaultPk = "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
  let backendEnv = fs.existsSync(backendEnvPath)
    ? fs.readFileSync(backendEnvPath, "utf8")
    : "PORT=4000\nRPC_URL=http://127.0.0.1:8545\nIPFS_API_URL=http://127.0.0.1:5001\n";

  if (/^CONTRACT_ADDRESS=.*/m.test(backendEnv)) {
    backendEnv = backendEnv.replace(/^CONTRACT_ADDRESS=.*/m, `CONTRACT_ADDRESS=${address}`);
  } else {
    backendEnv += `\nCONTRACT_ADDRESS=${address}`;
  }

  if (!backendEnv.includes("SERVER_PRIVATE_KEY=") || /^SERVER_PRIVATE_KEY=\s*$/m.test(backendEnv)) {
    backendEnv = backendEnv.replace(/^SERVER_PRIVATE_KEY=.*$/m, `SERVER_PRIVATE_KEY=${defaultPk}`);
    if (!backendEnv.includes("SERVER_PRIVATE_KEY=")) {
      backendEnv += `\nSERVER_PRIVATE_KEY=${defaultPk}`;
    }
  }
  fs.writeFileSync(backendEnvPath, backendEnv.trim() + "\n");
  console.log("✓ Updated backend/.env with CONTRACT_ADDRESS and SERVER_PRIVATE_KEY");

  // Auto-update frontend/.env
  const frontendEnvPath = path.join(__dirname, "..", "frontend", ".env");
  let frontendEnv = fs.existsSync(frontendEnvPath)
    ? fs.readFileSync(frontendEnvPath, "utf8")
    : "VITE_API_BASE=http://localhost:4000\nVITE_RPC_URL=http://127.0.0.1:8545\n";

  if (/^VITE_CONTRACT_ADDRESS=.*/m.test(frontendEnv)) {
    frontendEnv = frontendEnv.replace(/^VITE_CONTRACT_ADDRESS=.*/m, `VITE_CONTRACT_ADDRESS=${address}`);
  } else {
    frontendEnv += `\nVITE_CONTRACT_ADDRESS=${address}`;
  }
  fs.writeFileSync(frontendEnvPath, frontendEnv.trim() + "\n");
  console.log("✓ Updated frontend/.env with VITE_CONTRACT_ADDRESS");

  // Copy ABI artifact to frontend/src/contracts/
  const frontendContractsDir = path.join(__dirname, "..", "frontend", "src", "contracts");
  if (!fs.existsSync(frontendContractsDir)) {
    fs.mkdirSync(frontendContractsDir, { recursive: true });
  }
  const artifactPath = path.join(
    __dirname,
    "..",
    "artifacts",
    "contracts",
    "SecureShareAccessControl.sol",
    "SecureShareAccessControl.json"
  );
  if (fs.existsSync(artifactPath)) {
    const artifactData = JSON.parse(fs.readFileSync(artifactPath, "utf8"));
    fs.writeFileSync(
      path.join(frontendContractsDir, "SecureShareAccessControl.json"),
      JSON.stringify({ address, abi: artifactData.abi }, null, 2)
    );
    console.log("✓ Exported contract artifact & ABI to frontend/src/contracts/SecureShareAccessControl.json");
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
