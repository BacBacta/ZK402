// Déploie SealedBatchPoolV2 sur Base Sepolia avec les VRAIS oracles (Chainlink, Pyth, API3)
// et évalue la règle « 2 sur 3 » à l'instant présent.
// Lancer : set -a && . ../../.env && set +a && npx hardhat run scripts/deploy-v2-check.ts --network base-sepolia
import hre from "hardhat";

import { BASE_SEPOLIA_ORACLES } from "./oracles-base-sepolia";

async function main() {
  const f = await hre.ethers.getContractFactory("SealedBatchPoolV2");
  const pool = process.env.POOL
    ? f.attach(process.env.POOL)
    : await f.deploy(BASE_SEPOLIA_ORACLES, 1_000_000_000n, 120n, hre.ethers.ZeroAddress, 0n, { gasLimit: 4_000_000n });
  await pool.waitForDeployment();
  const addr = await pool.getAddress();
  console.log("SealedBatchPoolV2 :", addr);
  await new Promise((r) => setTimeout(r, 4000)); // laisser le nœud RPC voir le contrat
  const p = pool as any;
  const now = BigInt((await hre.ethers.provider.getBlock("latest"))!.timestamp);
  const cl = new hre.ethers.Contract(BASE_SEPOLIA_ORACLES.chainlinkFeed, ["function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)"], hre.ethers.provider);
  const [roundId] = await cl.latestRoundData();
  const cl8 = await p.chainlinkAt(now, roundId);
  const a8 = await p.api3At(now);
  const agg = await p.aggregate(cl8, 0n, a8);
  console.log({ now: now.toString(), chainlink8: cl8.toString(), api38: a8.toString(), pyth8: "non poussé", aggregate: { ok: agg[0], reason: Number(agg[1]), poolPrice: agg[2].toString() } });
}
main().catch((e) => { console.error(e); process.exit(1); });
