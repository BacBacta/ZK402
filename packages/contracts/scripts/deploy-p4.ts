// Déploie le système complet (Poseidon, vérifieur UltraHonk, pool v2, entrée blindée avec
// sorties et disjoncteur) sur Base Sepolia et enregistre les adresses.
// Lancer : set -a && . ../../.env && set +a && npx hardhat run scripts/deploy-p4.ts --network base-sepolia
import hre from "hardhat";
import fs from "fs";
import path from "path";
import { BASE_SEPOLIA_ORACLES } from "./oracles-base-sepolia";

export const P4 = {
  stipend: hre.ethers.parseEther("0.0002"),
  stipendUnits: 2n, // unité BASE = 0,0001 ETH
  baseClass: { isBase: true, depositAmount: hre.ethers.parseEther("0.001"), poolAmount: 10n },
  maxOutflowBps: 2_000n,
  batchDuration: 120n,
};

async function main() {
  const e = hre.ethers;
  const [op] = await e.getSigners();
  let nonce = await e.provider.getTransactionCount(op.address, "pending");
  const o = () => ({ gasLimit: 8_000_000n, nonce: nonce++ });
  const poseidon = await (await e.getContractFactory("PoseidonT3")).deploy(o());
  const lib = await (await e.getContractFactory("ZKTranscriptLib")).deploy(o());
  const verifier = await (await e.getContractFactory("HonkVerifier", { libraries: { ZKTranscriptLib: await lib.getAddress() } })).deploy(o());
  const entryAddr = e.getCreateAddress({ from: op.address, nonce: nonce + 1 });
  const pool = await (await e.getContractFactory("SealedBatchPoolV2")).deploy(
    BASE_SEPOLIA_ORACLES, 1_000_000_000n, P4.batchDuration, entryAddr, 0n, o(),
  );
  const Entry = await e.getContractFactory("ShieldedEntry", { libraries: { PoseidonT3: await poseidon.getAddress() } });
  const entry = await Entry.deploy(
    await pool.getAddress(), await verifier.getAddress(), e.ZeroAddress, P4.stipend, P4.maxOutflowBps, P4.stipendUnits, [P4.baseClass], o(),
  );
  await entry.waitForDeployment();
  const addrs = {
    date: new Date().toISOString(),
    poseidonT3: await poseidon.getAddress(), zkTranscriptLib: await lib.getAddress(), honkVerifier: await verifier.getAddress(),
    pool: await pool.getAddress(), entry: await entry.getAddress(),
  };
  if (addrs.entry !== entryAddr) throw new Error("adresse d'entrée inattendue");
  console.log(addrs);
  fs.writeFileSync(path.join(__dirname, "../deployments/p4-base-sepolia.json"), JSON.stringify(addrs, null, 2) + "\n");
}
main().catch((err) => { console.error(err); process.exit(1); });
