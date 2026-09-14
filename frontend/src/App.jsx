import React, { useState, useEffect } from "react";
import axios from "axios";
import { ethers } from "ethers";
import contractData from "./contracts/SecureShareAccessControl.json";
import {
  Shield,
  ShieldCheck,
  ShieldAlert,
  Upload,
  Key,
  Download,
  Activity,
  Copy,
  Check,
  Clock,
  UserCheck,
  UserX,
  FileText,
  AlertCircle,
  ExternalLink,
  RefreshCw,
  Lock,
  Database,
  Layers,
  ArrowRight,
  Wallet,
  Users,
  Eye,
  CheckCircle2,
  XCircle,
  HelpCircle,
  ChevronRight,
  Globe,
  Info,
  Sparkles,
  FolderOpen,
  AlertTriangle,
} from "lucide-react";

const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000";
const DEFAULT_RPC = import.meta.env.VITE_RPC_URL || "http://127.0.0.1:8545";

// Standard Hardhat Local Test Accounts
const DEMO_ROLES = [
  {
    role: "Patient (Data Owner)",
    name: "Alice (Account 0)",
    address: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
    color: "#818cf8",
    desc: "Owns the health record; signs registrations & grants/revokes access."
  },
  {
    role: "Specialist (Hospital)",
    name: "Dr. Bob (Account 1)",
    address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8",
    color: "#34d399",
    desc: "Authorised doctor who fetches & decrypts diagnostic scans."
  },
  {
    role: "Auditor / Insurer",
    name: "Carol (Account 2)",
    address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC",
    color: "#fbbf24",
    desc: "Third party requesting access; denied unless an active grant exists."
  },
];

export default function App() {
  const [activeTab, setActiveTab] = useState("upload"); // upload | records | access | decrypt | multiparty | audit

  // Configuration & Contract Info
  const [contractAddress, setContractAddress] = useState(
    import.meta.env.VITE_CONTRACT_ADDRESS || contractData.address || ""
  );
  const [rpcUrl, setRpcUrl] = useState(DEFAULT_RPC);

  // MetaMask Wallet State
  const [walletAddress, setWalletAddress] = useState("");
  const [walletChainId, setWalletChainId] = useState(null);
  const [isConnectingWallet, setIsConnectingWallet] = useState(false);
  const [useServerSignerFallback, setUseServerSignerFallback] = useState(false);
  const [dismissMetaMaskWarning, setDismissMetaMaskWarning] = useState(false);
  const [nonceModalError, setNonceModalError] = useState(null);
  const [showHowItWorksModal, setShowHowItWorksModal] = useState(false);

  // Records List State ("My Records")
  const [recordsList, setRecordsList] = useState([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);

  // Upload State
  const [file, setFile] = useState(null);
  const [recordLabel, setRecordLabel] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [uploadResult, setUploadResult] = useState(null);

  // Access Control State
  const [recordId, setRecordId] = useState("");
  const [granteeAddress, setGranteeAddress] = useState("");
  const [expiryOption, setExpiryOption] = useState("0");
  const [customExpiryMins, setCustomExpiryMins] = useState("60");
  const [isActionLoading, setIsActionLoading] = useState(false);
  const [accessStatus, setAccessStatus] = useState(null);

  // Requester Decrypt State
  const [requesterAddress, setRequesterAddress] = useState("");
  const [decryptRecordId, setDecryptRecordId] = useState("");
  const [isDecrypting, setIsDecrypting] = useState(false);
  const [decryptStatus, setDecryptStatus] = useState(null);

  // On-Chain Events & Audit State
  const [auditLogs, setAuditLogs] = useState([]);
  const [onChainEvents, setOnChainEvents] = useState([]);
  const [isLoadingEvents, setIsLoadingEvents] = useState(false);
  const [eventFilterRecordId, setEventFilterRecordId] = useState("");

  // UI state
  const [copiedKey, setCopiedKey] = useState(null);
  const [toast, setToast] = useState(null);

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 4500);
  };

  const copyToClipboard = (text, key) => {
    if (!text) return;
    navigator.clipboard.writeText(text);
    setCopiedKey(key);
    showToast("Copied to clipboard!", "info");
    setTimeout(() => setCopiedKey(null), 2000);
  };

  const addAuditLog = (type, title, details, txHash = null, status = "success") => {
    const newEntry = {
      id: Date.now() + Math.random().toString(),
      timestamp: new Date().toLocaleTimeString(),
      date: new Date().toLocaleDateString(),
      type,
      title,
      details,
      txHash,
      status,
    };
    setAuditLogs((prev) => [newEntry, ...prev]);
  };

  // Supported Networks
  const NETWORKS = {
    "0x7a69": {
      name: "Hardhat Local",
      chainId: "0x7a69",
      decChainId: 31337,
      color: "#10b981",
      rpcUrl: rpcUrl || "http://127.0.0.1:8545",
    },
    "0xaa36a7": {
      name: "Sepolia Testnet",
      chainId: "0xaa36a7",
      decChainId: 11155111,
      color: "#a855f7",
      rpcUrl: "https://rpc.sepolia.org",
      explorer: "https://sepolia.etherscan.io",
    },
  };

  // Helper for Ethereum address validation
  const isValidAddress = (addr) => {
    if (!addr) return false;
    try {
      return ethers.isAddress(addr);
    } catch {
      return false;
    }
  };

  // Human-readable MetaMask error parser
  const parseMetaMaskError = (err) => {
    const errCode = err?.code || err?.info?.error?.code;
    const msg = err?.message || "";
    const reason = err?.reason || err?.info?.error?.message || err?.shortMessage || "";

    if (errCode === 4001 || msg.includes("ACTION_REJECTED") || msg.includes("user rejected")) {
      return {
        title: "Signature Cancelled",
        message: "You cancelled the transaction request in MetaMask.",
        isNonce: false,
      };
    }

    if (
      errCode === -32000 ||
      msg.toLowerCase().includes("nonce") ||
      reason.toLowerCase().includes("nonce") ||
      msg.includes("replacement transaction underpriced")
    ) {
      return {
        title: "MetaMask Nonce Desync",
        message:
          "Hardhat node was restarted and transaction nonces reset. Please clear your MetaMask activity cache: MetaMask -> Settings -> Advanced -> Clear activity tab data.",
        isNonce: true,
      };
    }

    if (msg.includes("caller is not the data owner") || reason.includes("caller is not the data owner")) {
      return {
        title: "Unauthorized Action",
        message: "Only the record owner can grant or revoke access for this record.",
        isNonce: false,
      };
    }

    if (msg.includes("record already registered") || reason.includes("record already registered")) {
      return {
        title: "Duplicate Record",
        message: "This record label or ID is already registered on the blockchain.",
        isNonce: false,
      };
    }

    if (msg.includes("record does not exist") || reason.includes("record does not exist")) {
      return {
        title: "Record Not Found",
        message: "Record does not exist on the blockchain.",
        isNonce: false,
      };
    }

    if (msg.includes("insufficient funds") || reason.includes("insufficient funds")) {
      return {
        title: "Insufficient Gas Funds",
        message: "Connected wallet has insufficient ETH for transaction gas fees.",
        isNonce: false,
      };
    }

    return {
      title: "Transaction Error",
      message: reason || msg || "An unexpected transaction error occurred.",
      isNonce: false,
    };
  };

  // Fetch records from backend
  const fetchRecords = async () => {
    setIsLoadingRecords(true);
    try {
      const { data } = await axios.get(`${API_BASE}/records`);
      setRecordsList(data.records || []);
    } catch (err) {
      console.warn("Records fetch error:", err.message);
    } finally {
      setIsLoadingRecords(false);
    }
  };

  // Fetch contract config from backend on mount
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const { data } = await axios.get(`${API_BASE}/config`);
        if (data.contractAddress) {
          setContractAddress(data.contractAddress);
        }
        if (data.rpcUrl) {
          setRpcUrl(data.rpcUrl);
        }
      } catch (err) {
        console.warn("Backend /config fetch error:", err.message);
      }
    };
    fetchConfig();
    fetchRecords();

    // Check if MetaMask is already connected
    if (window.ethereum) {
      window.ethereum
        .request({ method: "eth_accounts" })
        .then((accounts) => {
          if (accounts.length > 0) {
            setWalletAddress(accounts[0]);
          }
        })
        .catch(() => {});

      window.ethereum
        .request({ method: "eth_chainId" })
        .then((chainId) => setWalletChainId(chainId))
        .catch(() => {});

      window.ethereum.on("accountsChanged", (accounts) => {
        setWalletAddress(accounts.length > 0 ? accounts[0] : "");
      });

      window.ethereum.on("chainChanged", (chainId) => {
        setWalletChainId(chainId);
      });
    }
  }, []);

  // Connect MetaMask
  const connectWallet = async () => {
    if (!window.ethereum) {
      showToast("MetaMask not found. Please install the extension or enable Server Signing.", "warning");
      return;
    }
    setIsConnectingWallet(true);
    try {
      const accounts = await window.ethereum.request({ method: "eth_requestAccounts" });
      const address = accounts[0];
      setWalletAddress(address);

      const chainId = await window.ethereum.request({ method: "eth_chainId" });
      setWalletChainId(chainId);

      // Check if on Hardhat (31337 / 0x7a69) or Sepolia (11155111 / 0xaa36a7)
      if (chainId !== "0x7a69" && chainId !== "0x539" && chainId !== "0xaa36a7") {
        await switchNetwork("0x7a69");
      }

      showToast(`Connected: ${address.substring(0, 6)}...${address.substring(38)}`, "success");
    } catch (err) {
      const parsed = parseMetaMaskError(err);
      showToast(`${parsed.title}: ${parsed.message}`, "error");
    } finally {
      setIsConnectingWallet(false);
    }
  };

  const switchNetwork = async (targetChainId) => {
    if (!window.ethereum) {
      showToast("MetaMask is not installed.", "warning");
      return;
    }
    try {
      await window.ethereum.request({
        method: "wallet_switchEthereumChain",
        params: [{ chainId: targetChainId }],
      });
      setWalletChainId(targetChainId);
      showToast(`Switched network to ${NETWORKS[targetChainId]?.name || targetChainId}`, "success");
    } catch (switchError) {
      if (switchError.code === 4902) {
        try {
          if (targetChainId === "0x7a69") {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: "0x7a69",
                  chainName: "Hardhat Localhost",
                  rpcUrls: [rpcUrl || "http://127.0.0.1:8545"],
                  nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
                },
              ],
            });
          } else if (targetChainId === "0xaa36a7") {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: "0xaa36a7",
                  chainName: "Ethereum Sepolia Testnet",
                  rpcUrls: ["https://rpc.sepolia.org", "https://ethereum-sepolia-rpc.publicnode.com"],
                  nativeCurrency: { name: "Sepolia ETH", symbol: "SEP", decimals: 18 },
                  blockExplorerUrls: ["https://sepolia.etherscan.io"],
                },
              ],
            });
          }
          setWalletChainId(targetChainId);
          showToast("Network added & switched!", "success");
        } catch (addError) {
          showToast(`Failed to add network: ${addError.message}`, "error");
        }
      } else {
        const parsed = parseMetaMaskError(switchError);
        showToast(`Network switch error: ${parsed.message}`, "error");
      }
    }
  };

  // Helper to get contract instance
  const getContractInstance = async (signerOrProvider) => {
    if (!contractAddress) {
      throw new Error("Contract address is not set. Ensure Hardhat node has deployed the contract.");
    }
    return new ethers.Contract(contractAddress, contractData.abi, signerOrProvider);
  };

  // 1. Upload & Register (with MetaMask direct owner signing or server fallback)
  const handleUpload = async (e) => {
    e?.preventDefault();
    if (!file) {
      showToast("Please select a file to encrypt & upload.", "error");
      return;
    }

    setIsUploading(true);
    const form = new FormData();
    form.append("file", file);
    form.append("recordLabel", recordLabel || file.name);

    try {
      // Step A: If MetaMask is connected and not using fallback, perform genuine client-side signing
      if (walletAddress && !useServerSignerFallback) {
        // Pass owner address so backend key manager wraps DEK for owner
        form.append("ownerAddress", walletAddress);

        // Prepare: Encrypt off-chain + pin to IPFS + init envelope
        const { data: prepData } = await axios.post(`${API_BASE}/records/prepare`, form);
        const { recordId: newRecordId, cid, recordLabel: label } = prepData;

        // On-chain registration via MetaMask signer
        const browserProvider = new ethers.BrowserProvider(window.ethereum);
        const signer = await browserProvider.getSigner();
        const contract = await getContractInstance(signer);

        showToast("Please confirm registration in MetaMask...", "info");
        const tx = await contract.registerRecord(newRecordId, cid);
        const receipt = await tx.wait();

        setUploadResult({
          recordId: newRecordId,
          recordLabel: label,
          cid,
          txHash: receipt.hash || tx.hash,
          signedBy: walletAddress,
          method: "MetaMask (Client-Side)",
        });

        setRecordId(newRecordId);
        setDecryptRecordId(newRecordId);
        setEventFilterRecordId(newRecordId);

        addAuditLog(
          "RECORD_REGISTERED",
          `Record Registered by Owner: ${label}`,
          `ID: ${newRecordId.substring(0, 16)}... | CID: ${cid.substring(0, 16)}... | Owner: ${walletAddress.substring(0, 8)}...`,
          receipt.hash || tx.hash,
          "success"
        );
        showToast("Record registered on-chain via MetaMask!", "success");
      } else {
        // Fallback: Backend signs using SERVER_PRIVATE_KEY
        const { data } = await axios.post(`${API_BASE}/records/upload`, form);
        setUploadResult({
          ...data,
          signedBy: "Server Signer (Fallback)",
          method: "Backend Server Key",
        });
        setRecordId(data.recordId);
        setDecryptRecordId(data.recordId);
        setEventFilterRecordId(data.recordId);

        addAuditLog(
          "RECORD_REGISTERED",
          `Record Registered (Server Signer): ${data.recordLabel}`,
          `ID: ${data.recordId.substring(0, 16)}... | CID: ${data.cid.substring(0, 16)}...`,
          data.txHash,
          "success"
        );
        showToast("Record registered via Server Signer!", "success");
      }
      fetchRecords();
    } catch (err) {
      const parsed = parseMetaMaskError(err);
      if (parsed.isNonce) {
        setNonceModalError(parsed.message);
      }
      addAuditLog("RECORD_REGISTERED", "Upload/Registration Failed", parsed.message, null, "danger");
      showToast(`${parsed.title}: ${parsed.message}`, "error");
    } finally {
      setIsUploading(false);
    }
  };

  // 2. Grant Access (with MetaMask direct owner signing or server fallback)
  const handleGrant = async () => {
    if (!recordId) return showToast("Record ID is required", "error");
    if (!granteeAddress) return showToast("Grantee Address is required", "error");
    if (!isValidAddress(granteeAddress)) return showToast("Invalid Ethereum Grantee Address", "error");

    setIsActionLoading(true);
    try {
      let expiresAt = 0;
      if (expiryOption === "custom") {
        const mins = parseInt(customExpiryMins, 10) || 60;
        expiresAt = Math.floor(Date.now() / 1000) + mins * 60;
      } else if (expiryOption !== "0") {
        expiresAt = Math.floor(Date.now() / 1000) + parseInt(expiryOption, 10);
      }

      const expiryNote =
        expiresAt === 0 ? "Permanent" : `Expires in ${Math.round((expiresAt - Date.now() / 1000) / 60)} mins`;

      let txHash = null;

      if (walletAddress && !useServerSignerFallback) {
        const browserProvider = new ethers.BrowserProvider(window.ethereum);
        const signer = await browserProvider.getSigner();
        const contract = await getContractInstance(signer);

        showToast("Please confirm grant in MetaMask...", "info");
        const tx = await contract.grantAccess(recordId, granteeAddress, expiresAt);
        const receipt = await tx.wait();
        txHash = receipt.hash || tx.hash;

        // Synchronize per-grantee key wrapping in key manager
        try {
          await axios.post(`${API_BASE}/records/${recordId}/sync-grant`, { granteeAddress });
        } catch (syncErr) {
          console.warn("Key sync notice:", syncErr.message);
        }
      } else {
        const { data } = await axios.post(`${API_BASE}/records/${recordId}/grant`, {
          granteeAddress,
          expiresAt,
        });
        txHash = data.txHash;
      }

      addAuditLog(
        "ACCESS_GRANTED",
        `Access Granted to ${granteeAddress.substring(0, 10)}...`,
        `Policy: ${expiryNote} | Record: ${recordId.substring(0, 14)}...`,
        txHash,
        "success"
      );
      setAccessStatus({ checked: true, hasAccess: true, address: granteeAddress, note: expiryNote });
      showToast("Access granted successfully!", "success");
      fetchRecords();
    } catch (err) {
      const parsed = parseMetaMaskError(err);
      if (parsed.isNonce) {
        setNonceModalError(parsed.message);
      }
      addAuditLog("ACCESS_GRANTED", "Grant Failed", parsed.message, null, "danger");
      showToast(`${parsed.title}: ${parsed.message}`, "error");
    } finally {
      setIsActionLoading(false);
    }
  };

  // 3. Revoke Access (with MetaMask direct owner signing or server fallback)
  const handleRevoke = async () => {
    if (!recordId) return showToast("Record ID is required", "error");
    if (!granteeAddress) return showToast("Grantee Address is required", "error");
    if (!isValidAddress(granteeAddress)) return showToast("Invalid Ethereum Grantee Address", "error");

    setIsActionLoading(true);
    try {
      let txHash = null;

      if (walletAddress && !useServerSignerFallback) {
        const browserProvider = new ethers.BrowserProvider(window.ethereum);
        const signer = await browserProvider.getSigner();
        const contract = await getContractInstance(signer);

        showToast("Please confirm revocation in MetaMask...", "info");
        const tx = await contract.revokeAccess(recordId, granteeAddress);
        const receipt = await tx.wait();
        txHash = receipt.hash || tx.hash;

        // Synchronize key revocation in key manager
        try {
          await axios.post(`${API_BASE}/records/${recordId}/sync-revoke`, { granteeAddress });
        } catch (syncErr) {
          console.warn("Key sync notice:", syncErr.message);
        }
      } else {
        const { data } = await axios.post(`${API_BASE}/records/${recordId}/revoke`, {
          granteeAddress,
        });
        txHash = data.txHash;
      }

      addAuditLog(
        "ACCESS_REVOKED",
        `Access Revoked for ${granteeAddress.substring(0, 10)}...`,
        `Record: ${recordId.substring(0, 14)}...`,
        txHash,
        "warning"
      );
      setAccessStatus({ checked: true, hasAccess: false, address: granteeAddress, note: "Revoked" });
      showToast("Access revoked immediately.", "warning");
      fetchRecords();
    } catch (err) {
      const parsed = parseMetaMaskError(err);
      if (parsed.isNonce) {
        setNonceModalError(parsed.message);
      }
      addAuditLog("ACCESS_REVOKED", "Revoke Failed", parsed.message, null, "danger");
      showToast(`${parsed.title}: ${parsed.message}`, "error");
    } finally {
      setIsActionLoading(false);
    }
  };

  // 4. Check Access View
  const handleCheckAccess = async () => {
    if (!recordId) return showToast("Record ID is required", "error");
    if (!granteeAddress) return showToast("Grantee Address is required", "error");

    setIsActionLoading(true);
    try {
      // Query access status via backend API (CORS-friendly, calls contract.hasAccess on-chain)
      const { data } = await axios.get(`${API_BASE}/records/${recordId}/access/${granteeAddress}`);
      const hasAccess = data.hasAccess;

      setAccessStatus({
        checked: true,
        hasAccess,
        address: granteeAddress,
      });

      addAuditLog(
        "ACCESS_CHECKED",
        `Access Check: ${hasAccess ? "AUTHORIZED" : "DENIED"}`,
        `Address: ${granteeAddress.substring(0, 10)}... | Record: ${recordId.substring(0, 14)}...`,
        null,
        hasAccess ? "success" : "danger"
      );
      showToast(`Verification: ${hasAccess ? "Authorized" : "Access Denied"}`, hasAccess ? "success" : "info");
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message;
      showToast(`Check failed: ${errMsg}`, "error");
    } finally {
      setIsActionLoading(false);
    }
  };

  // 5. Requester Download & Decrypt (Triggers On-Chain logAccessAttempt)
  const handleDownloadDecrypt = async () => {
    if (!decryptRecordId) return showToast("Record ID is required", "error");
    if (!requesterAddress) return showToast("Requester Address is required", "error");

    setIsDecrypting(true);
    setDecryptStatus(null);
    try {
      const response = await axios.get(`${API_BASE}/records/${decryptRecordId}/download`, {
        params: { requesterAddress },
        responseType: "blob",
      });

      // Extract original filename and MIME type from response headers
      const headerFilename = response.headers["x-original-filename"];
      let filename = headerFilename;
      if (!filename) {
        const disposition = response.headers["content-disposition"];
        if (disposition && disposition.includes("filename=")) {
          const match = disposition.match(/filename="?([^"]+)"?/);
          if (match && match[1]) filename = match[1];
        }
      }
      if (!filename) {
        filename = `decrypted-record-${Date.now()}.pdf`;
      }

      const mimeType = response.headers["x-original-mimetype"] || response.headers["content-type"] || "application/pdf";
      const blob = new Blob([response.data], { type: mimeType });
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.setAttribute("download", filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);

      setDecryptStatus({
        success: true,
        message: "Authorization confirmed on-chain! Decrypted file downloaded.",
      });

      addAuditLog(
        "ACCESS_ATTEMPT",
        `File Decrypted by ${requesterAddress.substring(0, 10)}...`,
        "On-chain AccessAttempted event logged: GRANTED",
        null,
        "success"
      );
      showToast("Access granted! File decrypted from IPFS.", "success");
    } catch (err) {
      let errMsg = "Access denied or decryption error";
      if (err.response?.data instanceof Blob) {
        try {
          const text = await err.response.data.text();
          const parsed = JSON.parse(text);
          errMsg = parsed.error || errMsg;
        } catch {
          // ignore
        }
      } else if (err.response?.data?.error) {
        errMsg = err.response.data.error;
      } else {
        errMsg = err.message;
      }

      setDecryptStatus({
        success: false,
        message: errMsg,
      });

      addAuditLog(
        "ACCESS_ATTEMPT",
        `Access Denied for ${requesterAddress.substring(0, 10)}...`,
        `Permanent on-chain audit logged: DENIED (${errMsg})`,
        null,
        "danger"
      );
      showToast(`Access Denied: ${errMsg}`, "error");
    } finally {
      setIsDecrypting(false);
    }
  };

  // 6. Fetch On-Chain Events directly from Contract / Backend
  const fetchOnChainEvents = async () => {
    setIsLoadingEvents(true);
    try {
      const { data } = await axios.get(`${API_BASE}/events`);
      setOnChainEvents(data.events || []);
      showToast(`Loaded ${data.events?.length || 0} on-chain audit events!`, "info");
    } catch (err) {
      const errMsg = err.response?.data?.error || err.message;
      showToast(`Failed to fetch on-chain events: ${errMsg}`, "error");
    } finally {
      setIsLoadingEvents(false);
    }
  };

  useEffect(() => {
    if (activeTab === "audit") {
      fetchOnChainEvents();
    }
  }, [activeTab]);

  return (
    <div style={{ minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* Top Header */}
      <header
        style={{
          borderBottom: "1px solid var(--border-color)",
          backgroundColor: "rgba(11, 15, 25, 0.9)",
          backdropFilter: "blur(12px)",
          position: "sticky",
          top: 0,
          zIndex: 40,
        }}
      >
        <div
          style={{
            maxWidth: 1240,
            margin: "0 auto",
            padding: "16px 24px",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 16,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 10,
                background: "linear-gradient(135deg, #6366f1 0%, #06b6d4 100%)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                boxShadow: "0 0 20px rgba(99, 102, 241, 0.4)",
              }}
            >
              <ShieldCheck size={26} color="#fff" />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <h1 style={{ fontSize: 20, fontWeight: 700, letterSpacing: "-0.02em" }}>
                  SecureShare
                </h1>
                <span
                  style={{
                    fontSize: 11,
                    padding: "2px 8px",
                    borderRadius: 9999,
                    backgroundColor: "rgba(99, 102, 241, 0.15)",
                    color: "#818cf8",
                    border: "1px solid rgba(99, 102, 241, 0.3)",
                    fontWeight: 600,
                  }}
                >
                  CSE 8th Sem • Web3
                </span>
              </div>
              <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                Decentralized Access Control & Audit Framework (Off-Chain IPFS + On-Chain Solidity)
              </p>
            </div>
          </div>

          {/* Wallet & Status Controls */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            {/* How It Works Modal Trigger */}
            <button
              onClick={() => setShowHowItWorksModal(true)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "8px 12px",
                borderRadius: 8,
                backgroundColor: "rgba(99, 102, 241, 0.12)",
                border: "1px solid rgba(99, 102, 241, 0.25)",
                color: "#a5b4fc",
                fontSize: 12,
                fontWeight: 600,
                cursor: "pointer",
              }}
            >
              <HelpCircle size={15} color="#818cf8" />
              How It Works
            </button>

            {/* Network Switcher Dropdown */}
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <select
                value={walletChainId === "0xaa36a7" ? "0xaa36a7" : "0x7a69"}
                onChange={(e) => switchNetwork(e.target.value)}
                style={{
                  backgroundColor: "rgba(17, 24, 39, 0.8)",
                  border:
                    walletChainId &&
                    walletChainId !== "0x7a69" &&
                    walletChainId !== "0xaa36a7" &&
                    walletChainId !== "0x539"
                      ? "1px solid #f59e0b"
                      : "1px solid var(--border-color)",
                  color: walletChainId === "0xaa36a7" ? "#c084fc" : "#34d399",
                  fontSize: 12,
                  padding: "7px 10px",
                  borderRadius: 8,
                  cursor: "pointer",
                  outline: "none",
                }}
              >
                <option value="0x7a69">🟢 Hardhat (31337)</option>
                <option value="0xaa36a7">🟣 Sepolia (11155111)</option>
              </select>
            </div>

            {/* MetaMask Wallet Connection Button */}
            {walletAddress ? (
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "6px 12px",
                  borderRadius: 10,
                  backgroundColor: "rgba(99, 102, 241, 0.15)",
                  border: "1px solid rgba(99, 102, 241, 0.35)",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    backgroundColor: "#10b981",
                    display: "inline-block",
                  }}
                />
                <div style={{ display: "flex", flexDirection: "column" }}>
                  <span style={{ fontSize: 11, color: "#818cf8", fontWeight: 600 }}>
                    MetaMask Connected
                  </span>
                  <span style={{ fontSize: 12, fontFamily: "var(--font-mono)", color: "var(--text-primary)" }}>
                    {walletAddress.substring(0, 6)}...{walletAddress.substring(38)}
                  </span>
                </div>
              </div>
            ) : (
              <button
                onClick={connectWallet}
                disabled={isConnectingWallet}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 14px",
                  borderRadius: 10,
                  border: "none",
                  background: "linear-gradient(135deg, #f59e0b 0%, #d97706 100%)",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                  boxShadow: "0 2px 10px rgba(245, 158, 11, 0.3)",
                }}
              >
                <Wallet size={16} />
                {isConnectingWallet ? "Connecting..." : "Connect MetaMask"}
              </button>
            )}

            {/* IPFS Node Status Pill */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "6px 10px",
                borderRadius: 8,
                backgroundColor: "rgba(6, 182, 212, 0.1)",
                border: "1px solid rgba(6, 182, 212, 0.2)",
                fontSize: 12,
                color: "#22d3ee",
              }}
            >
              <Database size={13} />
              IPFS Node
            </div>
          </div>
        </div>
      </header>

      {/* MetaMask Missing Alert Banner */}
      {!window.ethereum && !dismissMetaMaskWarning && (
        <div
          style={{
            backgroundColor: "rgba(245, 158, 11, 0.12)",
            borderBottom: "1px solid rgba(245, 158, 11, 0.3)",
            padding: "10px 24px",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            gap: 12,
            fontSize: 13,
            color: "#fbbf24",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <AlertTriangle size={18} />
            <span>
              <strong>MetaMask Not Detected:</strong> Please install the{" "}
              <a
                href="https://metamask.io/download/"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#fef08a", textDecoration: "underline", fontWeight: 600 }}
              >
                MetaMask browser extension
              </a>{" "}
              to enable Web3 signing, or test using <strong>Server Signer Fallback</strong> below.
            </span>
          </div>
          <button
            onClick={() => setDismissMetaMaskWarning(true)}
            style={{
              background: "none",
              border: "none",
              color: "#fbbf24",
              cursor: "pointer",
              fontSize: 18,
              lineHeight: 1,
            }}
          >
            &times;
          </button>
        </div>
      )}

      {/* Contract Notification Bar */}
      {contractAddress && (
        <div
          style={{
            backgroundColor: "rgba(17, 24, 39, 0.8)",
            borderBottom: "1px solid var(--border-color)",
            padding: "6px 24px",
            fontSize: 12,
            color: "var(--text-secondary)",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 8,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ color: "var(--text-muted)" }}>Active Contract:</span>
            <code style={{ color: "#a5b4fc", fontSize: 11 }}>{contractAddress}</code>
            <button
              onClick={() => copyToClipboard(contractAddress, "activeContract")}
              style={{ background: "none", border: "none", cursor: "pointer", color: "#9ca3af" }}
            >
              {copiedKey === "activeContract" ? <Check size={12} /> : <Copy size={12} />}
            </button>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 6, cursor: "pointer", fontSize: 11 }}>
              <input
                type="checkbox"
                checked={useServerSignerFallback}
                onChange={(e) => setUseServerSignerFallback(e.target.checked)}
              />
              Use Server Signer Fallback (Demo without MetaMask)
            </label>
          </div>
        </div>
      )}

      {/* Main Container */}
      <main style={{ maxWidth: 1240, margin: "0 auto", padding: "24px", width: "100%", flex: 1 }}>
        {/* Navigation Tabs */}
        <div
          style={{
            display: "flex",
            gap: 8,
            borderBottom: "1px solid var(--border-color)",
            marginBottom: 24,
            overflowX: "auto",
            paddingBottom: 4,
          }}
        >
          {[
            { id: "upload", label: "Upload & Encrypt", icon: Upload },
            { id: "records", label: `My Records (${recordsList.length})`, icon: FolderOpen },
            { id: "access", label: "Access Control", icon: Key },
            { id: "decrypt", label: "Requester Portal & Decrypt", icon: Download },
            { id: "multiparty", label: "Multi-Party Demo Simulator", icon: Users },
            { id: "audit", label: `On-Chain Audit Trail (${onChainEvents.length || auditLogs.length})`, icon: Activity },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "10px 18px",
                  borderRadius: "8px 8px 0 0",
                  border: "none",
                  backgroundColor: isActive ? "rgba(99, 102, 241, 0.15)" : "transparent",
                  color: isActive ? "#818cf8" : "var(--text-secondary)",
                  borderBottom: isActive ? "2px solid #6366f1" : "2px solid transparent",
                  fontWeight: isActive ? 600 : 500,
                  fontSize: 14,
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                  whiteSpace: "nowrap",
                }}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* TAB 1: UPLOAD & ENCRYPT */}
        {activeTab === "upload" && (
          <div className="animate-fade-in" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 24 }}>
            {/* Form Card */}
            <div
              style={{
                backgroundColor: "var(--bg-card)",
                border: "1px solid var(--border-color)",
                borderRadius: 16,
                padding: 24,
                boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div
                  style={{
                    padding: 8,
                    borderRadius: 8,
                    backgroundColor: "rgba(99, 102, 241, 0.15)",
                    color: "#818cf8",
                  }}
                >
                  <Upload size={20} />
                </div>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 600 }}>1. Register Confidential Record</h2>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    File is AES-256-GCM encrypted, uploaded to IPFS, and registered on-chain.
                  </p>
                </div>
              </div>

              {walletAddress && !useServerSignerFallback && (
                <div
                  style={{
                    padding: "8px 12px",
                    borderRadius: 8,
                    backgroundColor: "rgba(16, 185, 129, 0.1)",
                    border: "1px solid rgba(16, 185, 129, 0.25)",
                    fontSize: 12,
                    color: "#34d399",
                    marginBottom: 16,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  <CheckCircle2 size={15} />
                  MetaMask active: Record will be signed directly by your wallet (true owner)!
                </div>
              )}

              <form onSubmit={handleUpload}>
                <div style={{ marginBottom: 18 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6, color: "var(--text-secondary)" }}>
                    Record Label / Name (Optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g. Brain MRI Scan - Patient A01"
                    value={recordLabel}
                    onChange={(e) => setRecordLabel(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: 8,
                      border: "1px solid var(--border-color)",
                      backgroundColor: "var(--bg-secondary)",
                      color: "var(--text-primary)",
                      fontSize: 14,
                      outline: "none",
                    }}
                  />
                </div>

                <div style={{ marginBottom: 20 }}>
                  <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6, color: "var(--text-secondary)" }}>
                    Select File to Protect
                  </label>
                  <div
                    style={{
                      border: "2px dashed rgba(255, 255, 255, 0.15)",
                      borderRadius: 12,
                      padding: "24px 16px",
                      textAlign: "center",
                      backgroundColor: "rgba(17, 24, 39, 0.4)",
                      cursor: "pointer",
                      transition: "border-color 0.2s ease",
                    }}
                    onClick={() => document.getElementById("file-input").click()}
                  >
                    <input
                      id="file-input"
                      type="file"
                      style={{ display: "none" }}
                      onChange={(e) => setFile(e.target.files[0])}
                    />
                    <FileText size={32} color={file ? "#818cf8" : "var(--text-muted)"} style={{ margin: "0 auto 8px" }} />
                    {file ? (
                      <div>
                        <p style={{ fontWeight: 600, fontSize: 14, color: "var(--text-primary)" }}>{file.name}</p>
                        <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                          {(file.size / 1024).toFixed(1)} KB • {file.type || "binary payload"}
                        </p>
                        <span style={{ display: "inline-block", marginTop: 8, fontSize: 11, color: "#818cf8", textDecoration: "underline" }}>
                          Click to change file
                        </span>
                      </div>
                    ) : (
                      <div>
                        <p style={{ fontWeight: 500, fontSize: 14, color: "var(--text-primary)" }}>
                          Click or drag confidential file here
                        </p>
                        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
                          PDF, DICOM, images, spreadsheets, or JSON records
                        </p>
                      </div>
                    )}
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={isUploading || !file}
                  style={{
                    width: "100%",
                    padding: "12px 20px",
                    borderRadius: 10,
                    border: "none",
                    background: isUploading
                      ? "#4b5563"
                      : "linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)",
                    color: "#ffffff",
                    fontWeight: 600,
                    fontSize: 14,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 8,
                    cursor: isUploading || !file ? "not-allowed" : "pointer",
                    boxShadow: isUploading ? "none" : "0 4px 14px rgba(99, 102, 241, 0.4)",
                    transition: "all 0.2s ease",
                  }}
                >
                  {isUploading ? (
                    <>
                      <RefreshCw size={16} className="animate-spin" /> Processing & Signing...
                    </>
                  ) : (
                    <>
                      <Shield size={16} />
                      {walletAddress && !useServerSignerFallback
                        ? "Encrypt & Register via MetaMask"
                        : "Encrypt & Register On-Chain"}
                    </>
                  )}
                </button>
              </form>
            </div>

            {/* Cryptographic Pipeline & Upload Result */}
            <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
              <div
                style={{
                  backgroundColor: "rgba(17, 24, 39, 0.5)",
                  border: "1px solid var(--border-color)",
                  borderRadius: 16,
                  padding: 20,
                }}
              >
                <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  <Layers size={16} color="#818cf8" /> Cryptographic Flow
                </h3>
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ backgroundColor: "rgba(99, 102, 241, 0.2)", color: "#818cf8", width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                      1
                    </span>
                    <div>
                      <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>AES-256-GCM Encryption</strong>
                      <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                        Unique 256-bit key & 96-bit IV generated per file. Plaintext never leaves client unencrypted.
                      </p>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ backgroundColor: "rgba(6, 182, 212, 0.2)", color: "#22d3ee", width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                      2
                    </span>
                    <div>
                      <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>IPFS Pinning</strong>
                      <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                        Only the ciphertext blob is pinned to IPFS, generating an immutable Content Identifier (CID).
                      </p>
                    </div>
                  </div>

                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
                    <span style={{ backgroundColor: "rgba(16, 185, 129, 0.2)", color: "#34d399", width: 22, height: 22, borderRadius: "50%", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                      3
                    </span>
                    <div>
                      <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>Solidity Smart Contract</strong>
                      <p style={{ fontSize: 12, color: "var(--text-secondary)", marginTop: 2 }}>
                        `registerRecord(recordId, CID)` maps the CID to the owner wallet address on Ethereum.
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {uploadResult && (
                <div
                  style={{
                    backgroundColor: "rgba(16, 185, 129, 0.06)",
                    border: "1px solid rgba(16, 185, 129, 0.25)",
                    borderRadius: 16,
                    padding: 20,
                  }}
                >
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Check size={18} color="#34d399" />
                      <span style={{ fontWeight: 600, fontSize: 14, color: "#34d399" }}>
                        Registered On-Chain ({uploadResult.method})
                      </span>
                    </div>
                    <button
                      onClick={() => {
                        setRecordId(uploadResult.recordId);
                        setActiveTab("access");
                      }}
                      style={{
                        background: "rgba(99, 102, 241, 0.2)",
                        border: "1px solid rgba(99, 102, 241, 0.3)",
                        color: "#a5b4fc",
                        borderRadius: 6,
                        padding: "4px 10px",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        gap: 4,
                      }}
                    >
                      Manage Access <ArrowRight size={12} />
                    </button>
                  </div>

                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    <div>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", display: "block" }}>RECORD ID</span>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(0,0,0,0.3)", padding: "6px 10px", borderRadius: 6 }}>
                        <code style={{ fontSize: 12, color: "#f9fafb" }}>{uploadResult.recordId}</code>
                        <button
                          onClick={() => copyToClipboard(uploadResult.recordId, "recordId")}
                          style={{ background: "none", border: "none", cursor: "pointer", color: copiedKey === "recordId" ? "#34d399" : "#9ca3af" }}
                        >
                          {copiedKey === "recordId" ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", display: "block" }}>IPFS CID</span>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(0,0,0,0.3)", padding: "6px 10px", borderRadius: 6 }}>
                        <code style={{ fontSize: 12, color: "#22d3ee" }}>{uploadResult.cid}</code>
                        <button
                          onClick={() => copyToClipboard(uploadResult.cid, "cid")}
                          style={{ background: "none", border: "none", cursor: "pointer", color: copiedKey === "cid" ? "#34d399" : "#9ca3af" }}
                        >
                          {copiedKey === "cid" ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>

                    <div>
                      <span style={{ fontSize: 11, color: "var(--text-muted)", display: "block" }}>TRANSACTION HASH</span>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", background: "rgba(0,0,0,0.3)", padding: "6px 10px", borderRadius: 6 }}>
                        <code style={{ fontSize: 12, color: "#a5b4fc" }}>{uploadResult.txHash}</code>
                        <button
                          onClick={() => copyToClipboard(uploadResult.txHash, "txHash")}
                          style={{ background: "none", border: "none", cursor: "pointer", color: copiedKey === "txHash" ? "#34d399" : "#9ca3af" }}
                        >
                          {copiedKey === "txHash" ? <Check size={14} /> : <Copy size={14} />}
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB: MY RECORDS */}
        {activeTab === "records" && (
          <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 20 }}>
            <div
              style={{
                backgroundColor: "var(--bg-card)",
                border: "1px solid var(--border-color)",
                borderRadius: 16,
                padding: 24,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16, flexWrap: "wrap", gap: 12 }}>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                    <FolderOpen size={20} color="#818cf8" /> Registered Encrypted Records
                  </h2>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
                    View records secured in the decentralized framework. Each record is encrypted with AES-256-GCM and envelope-wrapped per grantee.
                  </p>
                </div>
                <button
                  onClick={fetchRecords}
                  disabled={isLoadingRecords}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    padding: "8px 14px",
                    borderRadius: 8,
                    backgroundColor: "rgba(99, 102, 241, 0.15)",
                    border: "1px solid rgba(99, 102, 241, 0.3)",
                    color: "#818cf8",
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  <RefreshCw size={14} className={isLoadingRecords ? "animate-spin" : ""} />
                  {isLoadingRecords ? "Loading..." : "Refresh Records"}
                </button>
              </div>

              {recordsList.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 16px", color: "var(--text-muted)" }}>
                  <FolderOpen size={48} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
                  <p style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>No records found in storage</p>
                  <p style={{ fontSize: 13, marginTop: 4 }}>Upload and encrypt your first confidential file in the Upload tab.</p>
                  <button
                    onClick={() => setActiveTab("upload")}
                    style={{
                      marginTop: 16,
                      padding: "8px 16px",
                      borderRadius: 8,
                      backgroundColor: "#6366f1",
                      border: "none",
                      color: "#fff",
                      fontWeight: 600,
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    Go to Upload Tab
                  </button>
                </div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(340px, 1fr))", gap: 16 }}>
                  {recordsList.map((rec, i) => (
                    <div
                      key={rec.recordId || i}
                      style={{
                        backgroundColor: "rgba(17, 24, 39, 0.6)",
                        border: "1px solid var(--border-color)",
                        borderRadius: 12,
                        padding: 18,
                        display: "flex",
                        flexDirection: "column",
                        gap: 12,
                      }}
                    >
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div>
                          <h4 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)" }}>
                            {rec.recordLabel || rec.filename}
                          </h4>
                          <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                            File: {rec.filename} • {rec.mimeType}
                          </span>
                        </div>
                        <span
                          style={{
                            fontSize: 11,
                            padding: "2px 8px",
                            borderRadius: 9999,
                            backgroundColor: "rgba(52, 211, 153, 0.15)",
                            color: "#34d399",
                            border: "1px solid rgba(52, 211, 153, 0.3)",
                            fontWeight: 600,
                          }}
                        >
                          {rec.authorizedCount || 1} Grantee{rec.authorizedCount === 1 ? "" : "s"}
                        </span>
                      </div>

                      <div style={{ backgroundColor: "rgba(0,0,0,0.3)", padding: "8px 10px", borderRadius: 8, fontSize: 11 }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
                          <span style={{ color: "var(--text-muted)" }}>Record ID:</span>
                          <button
                            onClick={() => copyToClipboard(rec.recordId, `rec-${i}`)}
                            style={{ background: "none", border: "none", cursor: "pointer", color: copiedKey === `rec-${i}` ? "#34d399" : "#9ca3af" }}
                          >
                            {copiedKey === `rec-${i}` ? <Check size={12} /> : <Copy size={12} />}
                          </button>
                        </div>
                        <code style={{ color: "#a5b4fc", display: "block", wordBreak: "break-all" }}>
                          {rec.recordId}
                        </code>
                      </div>

                      {rec.cid && (
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", fontSize: 11, color: "var(--text-secondary)" }}>
                          <span>IPFS CID: <code>{rec.cid.substring(0, 10)}...{rec.cid.substring(rec.cid.length - 6)}</code></span>
                          <a
                            href={`https://ipfs.io/ipfs/${rec.cid}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{ color: "#818cf8", display: "flex", alignItems: "center", gap: 3, textDecoration: "none" }}
                          >
                            Gateway <ExternalLink size={11} />
                          </a>
                        </div>
                      )}

                      {rec.ownerAddress && (
                        <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
                          Owner: <code>{rec.ownerAddress.substring(0, 8)}...{rec.ownerAddress.substring(36)}</code>
                        </div>
                      )}

                      <div style={{ display: "flex", gap: 8, marginTop: 4, paddingTop: 10, borderTop: "1px solid var(--border-color)" }}>
                        <button
                          onClick={() => {
                            setRecordId(rec.recordId);
                            setActiveTab("access");
                          }}
                          style={{
                            flex: 1,
                            padding: "6px 10px",
                            borderRadius: 6,
                            backgroundColor: "rgba(99, 102, 241, 0.15)",
                            border: "1px solid rgba(99, 102, 241, 0.3)",
                            color: "#818cf8",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Manage Access
                        </button>
                        <button
                          onClick={() => {
                            setDecryptRecordId(rec.recordId);
                            setActiveTab("decrypt");
                          }}
                          style={{
                            flex: 1,
                            padding: "6px 10px",
                            borderRadius: 6,
                            backgroundColor: "rgba(6, 182, 212, 0.15)",
                            border: "1px solid rgba(6, 182, 212, 0.3)",
                            color: "#22d3ee",
                            fontSize: 12,
                            fontWeight: 600,
                            cursor: "pointer",
                          }}
                        >
                          Decrypt
                        </button>
                        <button
                          onClick={() => {
                            setEventFilterRecordId(rec.recordId);
                            setActiveTab("audit");
                          }}
                          style={{
                            padding: "6px 10px",
                            borderRadius: 6,
                            backgroundColor: "rgba(255, 255, 255, 0.05)",
                            border: "1px solid var(--border-color)",
                            color: "var(--text-secondary)",
                            fontSize: 12,
                            cursor: "pointer",
                          }}
                        >
                          Audit
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* TAB 2: ACCESS MANAGEMENT */}
        {activeTab === "access" && (
          <div className="animate-fade-in" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 24 }}>
            <div
              style={{
                backgroundColor: "var(--bg-card)",
                border: "1px solid var(--border-color)",
                borderRadius: 16,
                padding: 24,
                boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div
                  style={{
                    padding: 8,
                    borderRadius: 8,
                    backgroundColor: "rgba(99, 102, 241, 0.15)",
                    color: "#818cf8",
                  }}
                >
                  <Key size={20} />
                </div>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 600 }}>2. Fine-Grained Access Control</h2>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    Grant, revoke, or inspect time-bound access policies on the smart contract.
                  </p>
                </div>
              </div>

              {/* Record ID Field */}
              <div style={{ marginBottom: 16 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6, color: "var(--text-secondary)" }}>
                  Target Record ID (bytes32)
                </label>
                <input
                  type="text"
                  placeholder="0x..."
                  value={recordId}
                  onChange={(e) => setRecordId(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--border-color)",
                    backgroundColor: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                    outline: "none",
                  }}
                />
              </div>

              {/* Grantee Address Field */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>
                    Grantee Wallet Address (0x...)
                  </label>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Quick role select:</span>
                </div>

                <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                  {DEMO_ROLES.map((acc, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setGranteeAddress(acc.address)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: "1px solid var(--border-color)",
                        backgroundColor: granteeAddress === acc.address ? "rgba(99, 102, 241, 0.25)" : "rgba(255, 255, 255, 0.05)",
                        color: granteeAddress === acc.address ? "#818cf8" : "var(--text-secondary)",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      {acc.name}
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  placeholder="0x..."
                  value={granteeAddress}
                  onChange={(e) => setGranteeAddress(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 8,
                    border:
                      granteeAddress && !isValidAddress(granteeAddress)
                        ? "1px solid #ef4444"
                        : "1px solid var(--border-color)",
                    backgroundColor: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                    outline: "none",
                  }}
                />
                {granteeAddress && (
                  <div style={{ marginTop: 4 }}>
                    {isValidAddress(granteeAddress) ? (
                      <span style={{ fontSize: 11, color: "#34d399", display: "flex", alignItems: "center", gap: 4 }}>
                        <Check size={12} /> Valid Ethereum Address
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: "#f87171", display: "flex", alignItems: "center", gap: 4 }}>
                        <AlertCircle size={12} /> Invalid Address format (0x followed by 40 hex chars)
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Expiration Policy */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6, color: "var(--text-secondary)" }}>
                  <Clock size={14} style={{ display: "inline", verticalAlign: "text-bottom", marginRight: 4 }} />
                  Access Expiration Policy
                </label>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 8 }}>
                  {[
                    { id: "0", label: "Permanent" },
                    { id: "3600", label: "1 Hour" },
                    { id: "86400", label: "24 Hours" },
                    { id: "604800", label: "7 Days" },
                    { id: "2592000", label: "30 Days" },
                    { id: "custom", label: "Custom" },
                  ].map((opt) => (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() => setExpiryOption(opt.id)}
                      style={{
                        padding: "8px",
                        borderRadius: 6,
                        border: expiryOption === opt.id ? "1px solid #6366f1" : "1px solid var(--border-color)",
                        backgroundColor: expiryOption === opt.id ? "rgba(99, 102, 241, 0.2)" : "var(--bg-secondary)",
                        color: expiryOption === opt.id ? "#ffffff" : "var(--text-secondary)",
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>

                {expiryOption === "custom" && (
                  <div style={{ marginTop: 8, display: "flex", alignItems: "center", gap: 8 }}>
                    <input
                      type="number"
                      min="1"
                      value={customExpiryMins}
                      onChange={(e) => setCustomExpiryMins(e.target.value)}
                      style={{
                        width: 100,
                        padding: "6px 10px",
                        borderRadius: 6,
                        border: "1px solid var(--border-color)",
                        backgroundColor: "var(--bg-secondary)",
                        color: "var(--text-primary)",
                        fontSize: 13,
                      }}
                    />
                    <span style={{ fontSize: 12, color: "var(--text-secondary)" }}>minutes from now</span>
                  </div>
                )}
              </div>

              {/* Action Buttons */}
              <div style={{ display: "flex", gap: 10 }}>
                <button
                  type="button"
                  onClick={handleGrant}
                  disabled={isActionLoading}
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "none",
                    backgroundColor: "#10b981",
                    color: "#ffffff",
                    fontWeight: 600,
                    fontSize: 13,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    cursor: isActionLoading ? "not-allowed" : "pointer",
                    boxShadow: "0 4px 12px rgba(16, 185, 129, 0.25)",
                  }}
                >
                  <UserCheck size={16} /> Grant Access
                </button>

                <button
                  type="button"
                  onClick={handleRevoke}
                  disabled={isActionLoading}
                  style={{
                    flex: 1,
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "none",
                    backgroundColor: "#ef4444",
                    color: "#ffffff",
                    fontWeight: 600,
                    fontSize: 13,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    gap: 6,
                    cursor: isActionLoading ? "not-allowed" : "pointer",
                    boxShadow: "0 4px 12px rgba(239, 68, 68, 0.25)",
                  }}
                >
                  <UserX size={16} /> Revoke Access
                </button>

                <button
                  type="button"
                  onClick={handleCheckAccess}
                  disabled={isActionLoading}
                  style={{
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--border-color)",
                    backgroundColor: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    fontWeight: 500,
                    fontSize: 13,
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    cursor: isActionLoading ? "not-allowed" : "pointer",
                  }}
                >
                  <RefreshCw size={14} /> Check Status
                </button>
              </div>
            </div>

            {/* Status Inspection Card */}
            <div
              style={{
                backgroundColor: "var(--bg-card)",
                border: "1px solid var(--border-color)",
                borderRadius: 16,
                padding: 24,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12 }}>
                  Policy State Inspector
                </h3>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", marginBottom: 16 }}>
                  Direct on-chain status from contract mapping:
                  <br />
                  <code>grants[recordId][grantee]</code>
                </p>

                {accessStatus ? (
                  <div
                    style={{
                      padding: 16,
                      borderRadius: 12,
                      backgroundColor: accessStatus.hasAccess ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
                      border: accessStatus.hasAccess ? "1px solid rgba(16, 185, 129, 0.3)" : "1px solid rgba(239, 68, 68, 0.3)",
                      marginBottom: 16,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                      {accessStatus.hasAccess ? (
                        <ShieldCheck size={24} color="#10b981" />
                      ) : (
                        <ShieldAlert size={24} color="#ef4444" />
                      )}
                      <div>
                        <h4 style={{ fontSize: 14, fontWeight: 600, color: accessStatus.hasAccess ? "#34d399" : "#f87171" }}>
                          {accessStatus.hasAccess ? "ACCESS GRANTED (ACTIVE)" : "ACCESS DENIED / REVOKED"}
                        </h4>
                        <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                          {accessStatus.hasAccess
                            ? `Authorized. ${accessStatus.note || ""}`
                            : "Caller is prohibited from decrypting."}
                        </p>
                      </div>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--text-muted)" }}>
                      Grantee: <code style={{ color: "var(--text-primary)" }}>{accessStatus.address}</code>
                    </div>
                  </div>
                ) : (
                  <div
                    style={{
                      padding: 24,
                      borderRadius: 12,
                      border: "1px dashed var(--border-color)",
                      textAlign: "center",
                      color: "var(--text-muted)",
                      fontSize: 13,
                    }}
                  >
                    Enter a recordId & grantee address and click <strong>Check Status</strong> or perform a grant/revoke action to inspect.
                  </div>
                )}
              </div>

              <div
                style={{
                  marginTop: 20,
                  padding: 12,
                  borderRadius: 8,
                  backgroundColor: "rgba(0, 0, 0, 0.25)",
                  fontSize: 12,
                  color: "var(--text-secondary)",
                }}
              >
                💡 <strong>Ownership Rule:</strong> The data owner's wallet always has full access (<code>hasAccess = true</code>) without needing a grant.
              </div>
            </div>
          </div>
        )}

        {/* TAB 3: REQUESTER PORTAL & DECRYPT */}
        {activeTab === "decrypt" && (
          <div className="animate-fade-in" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(360px, 1fr))", gap: 24 }}>
            <div
              style={{
                backgroundColor: "var(--bg-card)",
                border: "1px solid var(--border-color)",
                borderRadius: 16,
                padding: 24,
                boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                <div
                  style={{
                    padding: 8,
                    borderRadius: 8,
                    backgroundColor: "rgba(6, 182, 212, 0.15)",
                    color: "#06b6d4",
                  }}
                >
                  <Download size={20} />
                </div>
                <div>
                  <h2 style={{ fontSize: 17, fontWeight: 600 }}>3. Requester Portal (Doctor / Specialist)</h2>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    Download & decrypt authorized records. Logs an immutable audit attempt on-chain.
                  </p>
                </div>
              </div>

              {/* Requester Identity */}
              <div style={{ marginBottom: 16 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                  <label style={{ fontSize: 13, fontWeight: 500, color: "var(--text-secondary)" }}>
                    Requester Identity Address
                  </label>
                  <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Simulate role:</span>
                </div>

                <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
                  {DEMO_ROLES.map((acc, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => setRequesterAddress(acc.address)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 6,
                        border: "1px solid var(--border-color)",
                        backgroundColor: requesterAddress === acc.address ? "rgba(6, 182, 212, 0.25)" : "rgba(255, 255, 255, 0.05)",
                        color: requesterAddress === acc.address ? "#22d3ee" : "var(--text-secondary)",
                        fontSize: 11,
                        cursor: "pointer",
                      }}
                    >
                      {acc.name}
                    </button>
                  ))}
                </div>

                <input
                  type="text"
                  placeholder="0x..."
                  value={requesterAddress}
                  onChange={(e) => setRequesterAddress(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 8,
                    border:
                      requesterAddress && !isValidAddress(requesterAddress)
                        ? "1px solid #ef4444"
                        : "1px solid var(--border-color)",
                    backgroundColor: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                    outline: "none",
                  }}
                />
                {requesterAddress && (
                  <div style={{ marginTop: 4 }}>
                    {isValidAddress(requesterAddress) ? (
                      <span style={{ fontSize: 11, color: "#34d399", display: "flex", alignItems: "center", gap: 4 }}>
                        <Check size={12} /> Valid Ethereum Address
                      </span>
                    ) : (
                      <span style={{ fontSize: 11, color: "#f87171", display: "flex", alignItems: "center", gap: 4 }}>
                        <AlertCircle size={12} /> Invalid Address format (0x followed by 40 hex chars)
                      </span>
                    )}
                  </div>
                )}
              </div>

              {/* Record ID to fetch */}
              <div style={{ marginBottom: 20 }}>
                <label style={{ display: "block", fontSize: 13, fontWeight: 500, marginBottom: 6, color: "var(--text-secondary)" }}>
                  Record ID to Retrieve
                </label>
                <input
                  type="text"
                  placeholder="0x..."
                  value={decryptRecordId}
                  onChange={(e) => setDecryptRecordId(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: 8,
                    border: "1px solid var(--border-color)",
                    backgroundColor: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    fontFamily: "var(--font-mono)",
                    fontSize: 13,
                    outline: "none",
                  }}
                />
              </div>

              <button
                type="button"
                onClick={handleDownloadDecrypt}
                disabled={isDecrypting || !decryptRecordId || !requesterAddress}
                style={{
                  width: "100%",
                  padding: "12px 20px",
                  borderRadius: 10,
                  border: "none",
                  background: isDecrypting
                    ? "#4b5563"
                    : "linear-gradient(135deg, #06b6d4 0%, #0284c7 100%)",
                  color: "#ffffff",
                  fontWeight: 600,
                  fontSize: 14,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: 8,
                  cursor: isDecrypting || !decryptRecordId || !requesterAddress ? "not-allowed" : "pointer",
                  boxShadow: "0 4px 14px rgba(6, 182, 212, 0.3)",
                }}
              >
                {isDecrypting ? (
                  <>
                    <RefreshCw size={16} className="animate-spin" /> Verifying On-Chain & Decrypting...
                  </>
                ) : (
                  <>
                    <Download size={16} /> Verify Authorization & Download Decrypted File
                  </>
                )}
              </button>
            </div>

            {/* Audit Attempt Guarantee Info */}
            <div
              style={{
                backgroundColor: "var(--bg-card)",
                border: "1px solid var(--border-color)",
                borderRadius: 16,
                padding: 24,
                display: "flex",
                flexDirection: "column",
                justifyContent: "space-between",
              }}
            >
              <div>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 12, display: "flex", alignItems: "center", gap: 8 }}>
                  <Shield size={18} color="#06b6d4" /> Tamper-Proof Audit Guarantee
                </h3>
                <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, marginBottom: 16 }}>
                  Before decrypting, the system triggers the smart contract's <code>logAccessAttempt(recordId)</code> function.
                  Whether authorized or denied, an immutable event is permanently recorded on the blockchain:
                </p>

                <div
                  style={{
                    backgroundColor: "rgba(0, 0, 0, 0.3)",
                    border: "1px solid var(--border-color)",
                    borderRadius: 8,
                    padding: 12,
                    fontFamily: "var(--font-mono)",
                    fontSize: 12,
                    color: "#93c5fd",
                    marginBottom: 16,
                  }}
                >
                  event AccessAttempted(<br />
                  &nbsp;&nbsp;bytes32 indexed recordId,<br />
                  &nbsp;&nbsp;address indexed requester,<br />
                  &nbsp;&nbsp;bool granted,<br />
                  &nbsp;&nbsp;uint256 timestamp<br />
                  );
                </div>

                {decryptStatus && (
                  <div
                    style={{
                      padding: 14,
                      borderRadius: 8,
                      backgroundColor: decryptStatus.success ? "rgba(16, 185, 129, 0.1)" : "rgba(239, 68, 68, 0.1)",
                      border: decryptStatus.success ? "1px solid rgba(16, 185, 129, 0.3)" : "1px solid rgba(239, 68, 68, 0.3)",
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                    }}
                  >
                    {decryptStatus.success ? <Check size={20} color="#10b981" /> : <AlertCircle size={20} color="#ef4444" />}
                    <span style={{ fontSize: 13, color: decryptStatus.success ? "#34d399" : "#f87171" }}>
                      {decryptStatus.message}
                    </span>
                  </div>
                )}
              </div>

              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 16 }}>
                Security: Even if an adversary intercepts the IPFS ciphertext, without on-chain grant rights the key cannot be accessed.
              </div>
            </div>
          </div>
        )}

        {/* TAB 4: MULTI-PARTY DEMO SIMULATOR */}
        {activeTab === "multiparty" && (
          <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div
              style={{
                backgroundColor: "var(--bg-card)",
                border: "1px solid var(--border-color)",
                borderRadius: 16,
                padding: 24,
              }}
            >
              <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8, display: "flex", alignItems: "center", gap: 10 }}>
                <Users size={22} color="#818cf8" /> Multi-Party Access & Consent Simulation
              </h2>
              <p style={{ fontSize: 13, color: "var(--text-secondary)", lineHeight: 1.6, maxWidth: 850 }}>
                This simulation demonstrates how three distinct stakeholders (Patient, Specialist, Insurer) interact with the same record.
                Observe how fine-grained permissions and revocations instantly reflect in access checks and the immutable audit trail.
              </p>

              {/* Stakeholders Cards */}
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16, marginTop: 20 }}>
                {DEMO_ROLES.map((role, i) => (
                  <div
                    key={i}
                    style={{
                      backgroundColor: "rgba(17, 24, 39, 0.5)",
                      border: `1px solid ${role.color}33`,
                      borderRadius: 12,
                      padding: 18,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: role.color, textTransform: "uppercase" }}>
                        Role {i + 1}
                      </span>
                      <span style={{ fontSize: 11, padding: "2px 6px", borderRadius: 4, backgroundColor: `${role.color}22`, color: role.color }}>
                        {role.name.split(" ")[0]}
                      </span>
                    </div>
                    <h4 style={{ fontSize: 15, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
                      {role.role}
                    </h4>
                    <p style={{ fontSize: 12, color: "var(--text-secondary)", marginBottom: 12 }}>
                      {role.desc}
                    </p>
                    <div style={{ background: "rgba(0,0,0,0.3)", padding: "6px 8px", borderRadius: 6, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                      <code style={{ fontSize: 11, color: "var(--text-muted)" }}>{role.address.substring(0, 10)}...{role.address.substring(36)}</code>
                      <button
                        onClick={() => copyToClipboard(role.address, `role-${i}`)}
                        style={{ background: "none", border: "none", cursor: "pointer", color: copiedKey === `role-${i}` ? "#34d399" : "#6b7280" }}
                      >
                        {copiedKey === `role-${i}` ? <Check size={12} /> : <Copy size={12} />}
                      </button>
                    </div>
                  </div>
                ))}
              </div>

              {/* Guided Step-by-Step Scenario Runner */}
              <div style={{ marginTop: 28 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600, marginBottom: 14 }}>
                  Guided Demonstration Walkthrough
                </h3>

                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {/* Step 1 */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid var(--border-color)", flexWrap: "wrap", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ width: 26, height: 26, borderRadius: "50%", backgroundColor: "rgba(99,102,241,0.2)", color: "#818cf8", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>1</span>
                      <div>
                        <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>Patient registers record on-chain</strong>
                        <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                          Current active record: <code>{recordId ? `${recordId.substring(0, 16)}...` : "None (Upload a record in Tab 1 first)"}</code>
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => setActiveTab("upload")}
                      style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border-color)", backgroundColor: "rgba(99,102,241,0.2)", color: "#818cf8", fontSize: 12, cursor: "pointer" }}
                    >
                      Go to Upload Tab
                    </button>
                  </div>

                  {/* Step 2 */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid var(--border-color)", flexWrap: "wrap", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ width: 26, height: 26, borderRadius: "50%", backgroundColor: "rgba(52,211,153,0.2)", color: "#34d399", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>2</span>
                      <div>
                        <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>Patient grants 1-Hour access to Specialist (Dr. Bob)</strong>
                        <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                          Auto-sets Dr. Bob's address and 1-hour expiration.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setGranteeAddress(DEMO_ROLES[1].address);
                        setExpiryOption("3600");
                        setActiveTab("access");
                      }}
                      style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border-color)", backgroundColor: "rgba(52,211,153,0.2)", color: "#34d399", fontSize: 12, cursor: "pointer" }}
                    >
                      Pre-fill Grant for Dr. Bob
                    </button>
                  </div>

                  {/* Step 3 */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid var(--border-color)", flexWrap: "wrap", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ width: 26, height: 26, borderRadius: "50%", backgroundColor: "rgba(6,182,212,0.2)", color: "#22d3ee", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>3</span>
                      <div>
                        <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>Dr. Bob decrypts the medical record</strong>
                        <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                          On-chain check succeeds $\rightarrow$ IPFS blob is fetched and decrypted.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setRequesterAddress(DEMO_ROLES[1].address);
                        setDecryptRecordId(recordId);
                        setActiveTab("decrypt");
                      }}
                      style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border-color)", backgroundColor: "rgba(6,182,212,0.2)", color: "#22d3ee", fontSize: 12, cursor: "pointer" }}
                    >
                      Pre-fill Decrypt as Dr. Bob
                    </button>
                  </div>

                  {/* Step 4 */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid var(--border-color)", flexWrap: "wrap", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ width: 26, height: 26, borderRadius: "50%", backgroundColor: "rgba(251,191,36,0.2)", color: "#fbbf24", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>4</span>
                      <div>
                        <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>Insurer (Carol) attempts unauthorized access</strong>
                        <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                          Denied on-chain $\rightarrow$ Tamper-proof <code>AccessAttempted(granted: false)</code> event is permanently recorded.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setRequesterAddress(DEMO_ROLES[2].address);
                        setDecryptRecordId(recordId);
                        setActiveTab("decrypt");
                      }}
                      style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border-color)", backgroundColor: "rgba(251,191,36,0.2)", color: "#fbbf24", fontSize: 12, cursor: "pointer" }}
                    >
                      Simulate Insurer Attempt
                    </button>
                  </div>

                  {/* Step 5 */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: 14, borderRadius: 10, backgroundColor: "rgba(255,255,255,0.03)", border: "1px solid var(--border-color)", flexWrap: "wrap", gap: 12 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                      <span style={{ width: 26, height: 26, borderRadius: "50%", backgroundColor: "rgba(239,68,68,0.2)", color: "#ef4444", display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 700, fontSize: 12 }}>5</span>
                      <div>
                        <strong style={{ fontSize: 13, color: "var(--text-primary)" }}>Patient revokes access from Dr. Bob</strong>
                        <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                          Subsequent retrieval attempts by Dr. Bob will immediately fail.
                        </p>
                      </div>
                    </div>
                    <button
                      onClick={() => {
                        setGranteeAddress(DEMO_ROLES[1].address);
                        setActiveTab("access");
                      }}
                      style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border-color)", backgroundColor: "rgba(239,68,68,0.2)", color: "#ef4444", fontSize: 12, cursor: "pointer" }}
                    >
                      Revoke Dr. Bob in Access Tab
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: ON-CHAIN AUDIT TRAIL */}
        {activeTab === "audit" && (
          <div className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 24 }}>
            <div
              style={{
                backgroundColor: "var(--bg-card)",
                border: "1px solid var(--border-color)",
                borderRadius: 16,
                padding: 24,
                boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)",
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20, flexWrap: "wrap", gap: 12 }}>
                <div>
                  <h2 style={{ fontSize: 18, fontWeight: 700, display: "flex", alignItems: "center", gap: 8 }}>
                    <Activity size={20} color="#818cf8" /> Immutable On-Chain Audit Trail
                  </h2>
                  <p style={{ fontSize: 13, color: "var(--text-secondary)" }}>
                    Events mined into blockchain blocks from <code>SecureShareAccessControl.sol</code>.
                  </p>
                </div>

                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button
                    onClick={fetchOnChainEvents}
                    disabled={isLoadingEvents}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "8px 14px",
                      borderRadius: 8,
                      border: "1px solid var(--border-color)",
                      backgroundColor: "var(--bg-secondary)",
                      color: "var(--text-primary)",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: isLoadingEvents ? "not-allowed" : "pointer",
                    }}
                  >
                    <RefreshCw size={14} className={isLoadingEvents ? "animate-spin" : ""} />
                    {isLoadingEvents ? "Querying Chain..." : "Refresh On-Chain Events"}
                  </button>
                </div>
              </div>

              {/* Filter by Record ID */}
              <div style={{ marginBottom: 18, display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Filter by Record ID:</span>
                <input
                  type="text"
                  placeholder="0x... (leave empty to show all events)"
                  value={eventFilterRecordId}
                  onChange={(e) => setEventFilterRecordId(e.target.value)}
                  style={{
                    flex: 1,
                    minWidth: 260,
                    padding: "6px 12px",
                    borderRadius: 6,
                    border: "1px solid var(--border-color)",
                    backgroundColor: "var(--bg-secondary)",
                    color: "var(--text-primary)",
                    fontSize: 12,
                    fontFamily: "var(--font-mono)",
                  }}
                />
                {eventFilterRecordId && (
                  <button
                    onClick={() => setEventFilterRecordId("")}
                    style={{ background: "none", border: "none", color: "#818cf8", fontSize: 12, cursor: "pointer" }}
                  >
                    Clear Filter
                  </button>
                )}
              </div>

              {/* On-Chain Events Timeline */}
              {onChainEvents.length === 0 ? (
                <div
                  style={{
                    padding: "48px 24px",
                    textAlign: "center",
                    border: "1px dashed var(--border-color)",
                    borderRadius: 12,
                    color: "var(--text-muted)",
                  }}
                >
                  <Activity size={36} style={{ margin: "0 auto 12px", opacity: 0.4 }} />
                  <p style={{ fontWeight: 500, fontSize: 14 }}>No on-chain events found yet</p>
                  <p style={{ fontSize: 12, marginTop: 4 }}>
                    Register records or execute grant/revoke/download actions to populate on-chain events.
                  </p>
                </div>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                  {onChainEvents
                    .filter((e) => !eventFilterRecordId || e.recordId.toLowerCase() === eventFilterRecordId.toLowerCase())
                    .map((ev, idx) => {
                      const badgeMap = {
                        RecordRegistered: { bg: "rgba(99, 102, 241, 0.15)", text: "#818cf8", label: "RECORD REGISTERED" },
                        AccessGranted: { bg: "rgba(16, 185, 129, 0.15)", text: "#34d399", label: "ACCESS GRANTED" },
                        AccessRevoked: { bg: "rgba(239, 68, 68, 0.15)", text: "#f87171", label: "ACCESS REVOKED" },
                        AccessAttempted: {
                          bg: ev.granted ? "rgba(16, 185, 129, 0.15)" : "rgba(239, 68, 68, 0.15)",
                          text: ev.granted ? "#34d399" : "#f87171",
                          label: ev.granted ? "ATTEMPT: GRANTED" : "ATTEMPT: DENIED",
                        },
                      };
                      const badge = badgeMap[ev.type] || { bg: "rgba(255,255,255,0.1)", text: "#fff", label: ev.type };

                      return (
                        <div
                          key={idx}
                          style={{
                            backgroundColor: "rgba(17, 24, 39, 0.6)",
                            border: "1px solid var(--border-color)",
                            borderRadius: 12,
                            padding: "16px 20px",
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "flex-start",
                            flexWrap: "wrap",
                            gap: 14,
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                            <span
                              style={{
                                fontSize: 10,
                                fontWeight: 700,
                                padding: "4px 8px",
                                borderRadius: 6,
                                backgroundColor: badge.bg,
                                color: badge.text,
                                letterSpacing: "0.05em",
                                marginTop: 2,
                              }}
                            >
                              {badge.label}
                            </span>
                            <div>
                              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                                {ev.type === "RecordRegistered" && `Owner ${ev.owner.substring(0, 10)}... registered CID: ${ev.cid.substring(0, 18)}...`}
                                {ev.type === "AccessGranted" && `Owner granted access to ${ev.grantee.substring(0, 10)}... (${ev.expiresAt === 0 ? "Permanent" : `Expires: ${new Date(ev.expiresAt * 1000).toLocaleTimeString()}`})`}
                                {ev.type === "AccessRevoked" && `Access terminated for ${ev.grantee.substring(0, 10)}...`}
                                {ev.type === "AccessAttempted" && `Requester ${ev.requester.substring(0, 10)}... executed access attempt: ${ev.granted ? "AUTHORIZED" : "ACCESS DENIED"}`}
                              </div>

                              <div style={{ fontSize: 11, color: "var(--text-secondary)", marginTop: 4, fontFamily: "var(--font-mono)" }}>
                                Record ID: {ev.recordId}
                              </div>
                            </div>
                          </div>

                          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4 }}>
                            <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>Block #{ev.blockNumber}</span>
                              <span style={{ color: "var(--border-color)" }}>•</span>
                              <code style={{ fontSize: 11, color: "#818cf8" }}>
                                {ev.txHash.substring(0, 8)}...{ev.txHash.substring(58)}
                              </code>
                              <button
                                onClick={() => copyToClipboard(ev.txHash, `onchain-${idx}`)}
                                style={{ background: "none", border: "none", cursor: "pointer", color: copiedKey === `onchain-${idx}` ? "#34d399" : "#6b7280" }}
                              >
                                {copiedKey === `onchain-${idx}` ? <Check size={12} /> : <Copy size={12} />}
                              </button>
                            </div>
                            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
                              {new Date(ev.timestamp * 1000).toLocaleString()}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                </div>
              )}
            </div>
          </div>
        )}
      </main>

      {/* How It Works Modal */}
      {showHowItWorksModal && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(6px)",
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setShowHowItWorksModal(false)}
        >
          <div
            style={{
              backgroundColor: "#111827",
              border: "1px solid var(--border-color)",
              borderRadius: 16,
              maxWidth: 720,
              width: "100%",
              maxHeight: "90vh",
              overflowY: "auto",
              padding: 28,
              boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div
                  style={{
                    padding: 8,
                    borderRadius: 8,
                    backgroundColor: "rgba(99, 102, 241, 0.15)",
                    color: "#818cf8",
                  }}
                >
                  <ShieldCheck size={22} />
                </div>
                <div>
                  <h3 style={{ fontSize: 18, fontWeight: 700, color: "var(--text-primary)" }}>
                    How SecureShare Works
                  </h3>
                  <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                    Zero-Knowledge Privacy, Dual-Layer Security & Tamper-Proof Audit
                  </p>
                </div>
              </div>
              <button
                onClick={() => setShowHowItWorksModal(false)}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  fontSize: 24,
                  cursor: "pointer",
                  lineHeight: 1,
                }}
              >
                &times;
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {[
                {
                  step: "1",
                  color: "#818cf8",
                  title: "Off-Chain AES-256-GCM Encryption",
                  desc: "Confidential files (PDF, health scans, banking records) are encrypted off-chain using fresh 256-bit symmetric Data Encryption Keys (DEK). Plaintext data never touches IPFS or the blockchain.",
                },
                {
                  step: "2",
                  color: "#06b6d4",
                  title: "Decentralized IPFS Storage",
                  desc: "Only the encrypted ciphertext blob is uploaded and pinned to IPFS, generating a content identifier (CID). Anyone who views the CID on IPFS sees only encrypted bytes.",
                },
                {
                  step: "3",
                  color: "#10b981",
                  title: "Smart Contract Access Control",
                  desc: "The data owner registers recordId and CID on Ethereum. The smart contract enforces who can view the record and records policy grants with optional time-based auto-expiry.",
                },
                {
                  step: "4",
                  color: "#f59e0b",
                  title: "Per-Grantee Key Wrapping (Envelope Encryption)",
                  desc: "The file's DEK is envelope-wrapped specifically per authorized grantee address using HKDF-SHA256 and AES-256-GCM. An unauthorized party cannot unwrap the DEK even if they obtain the ciphertext.",
                },
                {
                  step: "5",
                  color: "#ec4899",
                  title: "Zero-Trust Retrieval & Immutable Audit Trail",
                  desc: "When a requester queries the record, access is verified on-chain. An immutable AccessAttempted event is mined to the blockchain. If authorized, the requester's key is unwrapped and the file decrypted.",
                },
              ].map((item) => (
                <div
                  key={item.step}
                  style={{
                    display: "flex",
                    gap: 14,
                    padding: 14,
                    borderRadius: 10,
                    backgroundColor: "rgba(255, 255, 255, 0.03)",
                    border: `1px solid ${item.color}33`,
                  }}
                >
                  <span
                    style={{
                      width: 28,
                      height: 28,
                      borderRadius: "50%",
                      backgroundColor: `${item.color}22`,
                      color: item.color,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      fontSize: 13,
                      flexShrink: 0,
                    }}
                  >
                    {item.step}
                  </span>
                  <div>
                    <h4 style={{ fontSize: 14, fontWeight: 600, color: "var(--text-primary)", marginBottom: 4 }}>
                      {item.title}
                    </h4>
                    <p style={{ fontSize: 12, color: "var(--text-secondary)", lineHeight: 1.5 }}>
                      {item.desc}
                    </p>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 24, textAlign: "right" }}>
              <button
                onClick={() => setShowHowItWorksModal(false)}
                style={{
                  padding: "8px 18px",
                  borderRadius: 8,
                  backgroundColor: "#6366f1",
                  border: "none",
                  color: "#fff",
                  fontWeight: 600,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Got It, Let's Start
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MetaMask Nonce Desync Modal */}
      {nonceModalError && (
        <div
          style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.75)",
            backdropFilter: "blur(6px)",
            zIndex: 200,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 16,
          }}
          onClick={() => setNonceModalError(null)}
        >
          <div
            style={{
              backgroundColor: "#111827",
              border: "1px solid rgba(245, 158, 11, 0.4)",
              borderRadius: 16,
              maxWidth: 580,
              width: "100%",
              padding: 24,
              boxShadow: "0 20px 50px rgba(0,0,0,0.5)",
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
              <div
                style={{
                  padding: 10,
                  borderRadius: 10,
                  backgroundColor: "rgba(245, 158, 11, 0.15)",
                  color: "#fbbf24",
                }}
              >
                <AlertTriangle size={24} />
              </div>
              <div>
                <h3 style={{ fontSize: 17, fontWeight: 700, color: "#fbbf24" }}>
                  MetaMask Nonce Desynchronization
                </h3>
                <p style={{ fontSize: 12, color: "var(--text-secondary)" }}>
                  Local Hardhat blockchain was restarted, resetting transaction counters.
                </p>
              </div>
            </div>

            <div
              style={{
                backgroundColor: "rgba(0, 0, 0, 0.3)",
                border: "1px solid var(--border-color)",
                borderRadius: 8,
                padding: 14,
                fontSize: 13,
                lineHeight: 1.6,
                color: "var(--text-secondary)",
                marginBottom: 18,
              }}
            >
              <p style={{ fontWeight: 600, color: "var(--text-primary)", marginBottom: 8 }}>
                How to fix in 5 seconds:
              </p>
              <ol style={{ paddingLeft: 20, margin: 0, display: "flex", flexDirection: "column", gap: 4 }}>
                <li>Open your <strong>MetaMask browser extension</strong>.</li>
                <li>Click the <strong>Account Icon</strong> or <strong>3 dots menu</strong> &rarr; <strong>Settings</strong>.</li>
                <li>Select <strong>Advanced</strong>.</li>
                <li>Click <strong>Clear activity tab data</strong> (or <em>Reset account</em>).</li>
                <li>Retry your transaction!</li>
              </ol>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 12 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, cursor: "pointer", color: "var(--text-muted)" }}>
                <input
                  type="checkbox"
                  checked={useServerSignerFallback}
                  onChange={(e) => {
                    setUseServerSignerFallback(e.target.checked);
                    setNonceModalError(null);
                  }}
                />
                Switch to Server Signer (Bypass MetaMask)
              </label>
              <button
                onClick={() => setNonceModalError(null)}
                style={{
                  padding: "8px 16px",
                  borderRadius: 8,
                  backgroundColor: "#f59e0b",
                  border: "none",
                  color: "#000",
                  fontWeight: 700,
                  fontSize: 13,
                  cursor: "pointer",
                }}
              >
                Done / Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Toast Notification */}
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 24,
            right: 24,
            backgroundColor: toast.type === "error" ? "#ef4444" : toast.type === "warning" ? "#f59e0b" : "#10b981",
            color: "#ffffff",
            padding: "12px 18px",
            borderRadius: 10,
            boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontSize: 13,
            fontWeight: 500,
            zIndex: 100,
            animation: "fadeIn 0.2s ease",
          }}
        >
          {toast.type === "error" ? <AlertCircle size={16} /> : <Check size={16} />}
          {toast.message}
        </div>
      )}

      {/* Footer */}
      <footer
        style={{
          borderTop: "1px solid var(--border-color)",
          padding: "16px 24px",
          textAlign: "center",
          fontSize: 12,
          color: "var(--text-muted)",
        }}
      >
        SecureShare Research Framework • Final Year CSE Project (7th/8th Semester) • IPFS + AES-256-GCM + Ethereum Access Control
      </footer>
    </div>
  );
}
