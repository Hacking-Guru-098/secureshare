const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SecureShareAccessControl", function () {
  let contract, owner, grantee, stranger;
  const recordId = ethers.keccak256(ethers.toUtf8Bytes("patient-record-001"));
  const cid = "Qm" + "a".repeat(44); // fake IPFS CID for testing

  beforeEach(async function () {
    [owner, grantee, stranger] = await ethers.getSigners();
    const Factory = await ethers.getContractFactory("SecureShareAccessControl");
    contract = await Factory.deploy();
    await contract.waitForDeployment();
  });

  it("registers a record with the caller as owner", async function () {
    await expect(contract.connect(owner).registerRecord(recordId, cid))
      .to.emit(contract, "RecordRegistered");

    const [recOwner, recCid] = await contract.getRecord(recordId);
    expect(recOwner).to.equal(owner.address);
    expect(recCid).to.equal(cid);
  });

  it("prevents registering the same recordId twice", async function () {
    await contract.registerRecord(recordId, cid);
    await expect(contract.registerRecord(recordId, cid)).to.be.revertedWith(
      "SecureShare: record already registered"
    );
  });

  it("owner always has access; strangers do not by default", async function () {
    await contract.connect(owner).registerRecord(recordId, cid);
    expect(await contract.hasAccess(recordId, owner.address)).to.equal(true);
    expect(await contract.hasAccess(recordId, stranger.address)).to.equal(false);
  });

  it("lets the owner grant and the grantee gain access", async function () {
    await contract.connect(owner).registerRecord(recordId, cid);
    await expect(contract.connect(owner).grantAccess(recordId, grantee.address, 0))
      .to.emit(contract, "AccessGranted");

    expect(await contract.hasAccess(recordId, grantee.address)).to.equal(true);
  });

  it("prevents a non-owner from granting access", async function () {
    await contract.connect(owner).registerRecord(recordId, cid);
    await expect(
      contract.connect(stranger).grantAccess(recordId, grantee.address, 0)
    ).to.be.revertedWith("SecureShare: caller is not the data owner");
  });

  it("lets the owner revoke access instantly", async function () {
    await contract.connect(owner).registerRecord(recordId, cid);
    await contract.connect(owner).grantAccess(recordId, grantee.address, 0);
    expect(await contract.hasAccess(recordId, grantee.address)).to.equal(true);

    await expect(contract.connect(owner).revokeAccess(recordId, grantee.address))
      .to.emit(contract, "AccessRevoked");

    expect(await contract.hasAccess(recordId, grantee.address)).to.equal(false);
  });

  it("expires time-bound access automatically", async function () {
    await contract.connect(owner).registerRecord(recordId, cid);
    const latestBlock = await ethers.provider.getBlock("latest");
    const soon = latestBlock.timestamp + 5; // 5 seconds from now

    await contract.connect(owner).grantAccess(recordId, grantee.address, soon);
    expect(await contract.hasAccess(recordId, grantee.address)).to.equal(true);

    await ethers.provider.send("evm_increaseTime", [10]);
    await ethers.provider.send("evm_mine");

    expect(await contract.hasAccess(recordId, grantee.address)).to.equal(false);
  });

  it("logs every access attempt (granted or denied) for the audit trail", async function () {
    await contract.connect(owner).registerRecord(recordId, cid);

    // Denied attempt (no grant yet) still gets logged
    const deniedTx = await contract.connect(stranger).logAccessAttempt(recordId);
    const deniedReceipt = await deniedTx.wait();
    const deniedEvent = deniedReceipt.logs.find((l) => l.fragment && l.fragment.name === "AccessAttempted");
    expect(deniedEvent.args.granted).to.equal(false);

    // Granted attempt after owner grants access
    await contract.connect(owner).grantAccess(recordId, grantee.address, 0);
    const grantedTx = await contract.connect(grantee).logAccessAttempt(recordId);
    const grantedReceipt = await grantedTx.wait();
    const grantedEvent = grantedReceipt.logs.find((l) => l.fragment && l.fragment.name === "AccessAttempted");
    expect(grantedEvent.args.granted).to.equal(true);
  });
});
