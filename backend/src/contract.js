const { ethers } = require("ethers");
const artifact = require("../../artifacts/contracts/SecureShareAccessControl.sol/SecureShareAccessControl.json");

function getContract(signerOrProvider) {
  const address = process.env.CONTRACT_ADDRESS;
  if (!address) throw new Error("CONTRACT_ADDRESS not set in backend/.env");
  return new ethers.Contract(address, artifact.abi, signerOrProvider);
}

function getProvider() {
  return new ethers.JsonRpcProvider(process.env.RPC_URL || "http://127.0.0.1:8545");
}

function getServerSigner() {
  const provider = getProvider();
  if (!process.env.SERVER_PRIVATE_KEY) {
    throw new Error("SERVER_PRIVATE_KEY not set in backend/.env");
  }
  return new ethers.Wallet(process.env.SERVER_PRIVATE_KEY, provider);
}

function recordIdFromString(str) {
  return ethers.keccak256(ethers.toUtf8Bytes(str));
}

module.exports = { getContract, getProvider, getServerSigner, recordIdFromString };
