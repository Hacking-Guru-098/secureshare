// Points at a local IPFS node (Kubo) by default. For a hosted option during
// development, swap this for a pinning service like Web3.Storage or Pinata.
// Talks to a local Kubo (IPFS) node's HTTP RPC API directly using the
// built-in fetch/FormData/Blob globals (Node 18+), avoiding the
// kubo-rpc-client package which ships ESM-only and breaks under require().

const IPFS_API_URL = process.env.IPFS_API_URL || "http://127.0.0.1:5001";

async function uploadToIPFS(buffer) {
  const form = new FormData();
  form.append("file", new Blob([buffer]), "record.bin");

  const res = await fetch(`${IPFS_API_URL}/api/v0/add`, {
    method: "POST",
    body: form,
  });

  if (!res.ok) {
    throw new Error(`IPFS add failed: ${res.status} ${await res.text()}`);
  }

  const data = await res.json(); // { Name, Hash, Size }
  return data.Hash;
}

async function fetchFromIPFS(cidString) {
  const res = await fetch(`${IPFS_API_URL}/api/v0/cat?arg=${encodeURIComponent(cidString)}`, {
    method: "POST",
  });

  if (!res.ok) {
    throw new Error(`IPFS cat failed: ${res.status} ${await res.text()}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

module.exports = { uploadToIPFS, fetchFromIPFS };