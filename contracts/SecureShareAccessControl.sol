// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title SecureShareAccessControl
/// @notice Core on-chain component of SecureShare. Stores only a pointer (encrypted CID)
///         to off-chain data (IPFS) plus fine-grained, time-bound access grants.
///         The actual healthcare/finance record NEVER touches the chain — only:
///           1. a reference to where the encrypted blob lives (IPFS CID)
///           2. who is allowed to fetch/decrypt it, and until when
///           3. an immutable, queryable audit trail of every grant/revoke/access event
contract SecureShareAccessControl {
    struct Record {
        address owner;          // data owner (patient / customer)
        string encryptedCID;    // IPFS CID of the AES/ABE-encrypted record
        uint256 createdAt;
        bool exists;
    }

    struct Grant {
        bool active;
        uint256 expiresAt;      // 0 = no expiry
    }

    // recordId => Record
    mapping(bytes32 => Record) private records;

    // recordId => grantee address => Grant
    mapping(bytes32 => mapping(address => Grant)) private grants;

    // ---- Events double as the immutable audit log ----
    event RecordRegistered(bytes32 indexed recordId, address indexed owner, string encryptedCID, uint256 timestamp);
    event AccessGranted(bytes32 indexed recordId, address indexed owner, address indexed grantee, uint256 expiresAt, uint256 timestamp);
    event AccessRevoked(bytes32 indexed recordId, address indexed owner, address indexed grantee, uint256 timestamp);
    event AccessAttempted(bytes32 indexed recordId, address indexed requester, bool granted, uint256 timestamp);

    modifier onlyOwner(bytes32 recordId) {
        require(records[recordId].exists, "SecureShare: record does not exist");
        require(records[recordId].owner == msg.sender, "SecureShare: caller is not the data owner");
        _;
    }

    /// @notice Register a new record. Called after the file has been encrypted and pinned to IPFS off-chain.
    /// @param recordId Unique identifier for the record (e.g. keccak256 of a UUID generated off-chain)
    /// @param encryptedCID IPFS content identifier of the encrypted blob
    function registerRecord(bytes32 recordId, string calldata encryptedCID) external {
        require(!records[recordId].exists, "SecureShare: record already registered");
        require(bytes(encryptedCID).length > 0, "SecureShare: empty CID");

        records[recordId] = Record({
            owner: msg.sender,
            encryptedCID: encryptedCID,
            createdAt: block.timestamp,
            exists: true
        });

        emit RecordRegistered(recordId, msg.sender, encryptedCID, block.timestamp);
    }

    /// @notice Grant a requester (e.g. specialist, insurer, auditor) access to a record.
    /// @param expiresAt Unix timestamp after which access auto-expires. Pass 0 for no expiry.
    function grantAccess(bytes32 recordId, address grantee, uint256 expiresAt) external onlyOwner(recordId) {
        require(grantee != address(0), "SecureShare: invalid grantee");
        require(expiresAt == 0 || expiresAt > block.timestamp, "SecureShare: expiry must be in the future");

        grants[recordId][grantee] = Grant({ active: true, expiresAt: expiresAt });

        emit AccessGranted(recordId, msg.sender, grantee, expiresAt, block.timestamp);
    }

    /// @notice Instantly revoke a previously granted access, before natural expiry.
    function revokeAccess(bytes32 recordId, address grantee) external onlyOwner(recordId) {
        require(grants[recordId][grantee].active, "SecureShare: no active grant for this address");

        grants[recordId][grantee].active = false;

        emit AccessRevoked(recordId, msg.sender, grantee, block.timestamp);
    }

    /// @notice View-only access check (no gas, no audit event — used by the dashboard before showing the "Decrypt" button).
    function hasAccess(bytes32 recordId, address requester) public view returns (bool) {
        if (records[recordId].owner == requester) return true; // owner always has access

        Grant memory g = grants[recordId][requester];
        if (!g.active) return false;
        if (g.expiresAt != 0 && block.timestamp > g.expiresAt) return false;
        return true;
    }

    /// @notice Called by the backend or requester when fetching/decrypting a record.
    ///         Writes a permanent, tamper-proof entry to the audit trail regardless of outcome.
    /// @return granted Whether access was actually permitted at time of the attempt.
    function logAccessAttempt(bytes32 recordId) external returns (bool granted) {
        return logAccessAttemptFor(recordId, msg.sender);
    }

    /// @notice Logs an access attempt for an explicit requester address.
    function logAccessAttemptFor(bytes32 recordId, address requester) public returns (bool granted) {
        granted = hasAccess(recordId, requester);
        emit AccessAttempted(recordId, requester, granted, block.timestamp);
        return granted;
    }

    /// @notice Fetch the encrypted CID — only succeeds in the sense of returning data;
    ///         the caller (backend) MUST check hasAccess()/logAccessAttempt() before decrypting.
    function getRecord(bytes32 recordId) external view returns (address owner, string memory encryptedCID, uint256 createdAt) {
        require(records[recordId].exists, "SecureShare: record does not exist");
        Record memory r = records[recordId];
        return (r.owner, r.encryptedCID, r.createdAt);
    }

    function getGrant(bytes32 recordId, address grantee) external view returns (bool active, uint256 expiresAt) {
        Grant memory g = grants[recordId][grantee];
        return (g.active, g.expiresAt);
    }
}
