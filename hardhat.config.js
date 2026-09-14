require("@nomicfoundation/hardhat-toolbox");
try {
  require("dotenv").config();
} catch (_) {
  try {
    require("./backend/node_modules/dotenv").config({ path: "./backend/.env" });
  } catch (__) {}
}

const SEPOLIA_ACCOUNTS = process.env.PRIVATE_KEY
  ? [process.env.PRIVATE_KEY]
  : process.env.SEPOLIA_PRIVATE_KEY
  ? [process.env.SEPOLIA_PRIVATE_KEY]
  : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
    },
  },
  networks: {
    hardhat: {},
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },
    sepolia: {
      url: process.env.SEPOLIA_RPC_URL || "https://rpc.sepolia.org",
      accounts: SEPOLIA_ACCOUNTS,
      chainId: 11155111,
    },
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};
