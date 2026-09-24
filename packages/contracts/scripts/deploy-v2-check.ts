// Déploie SealedBatchPoolV2 sur Base Sepolia avec les VRAIS oracles (Chainlink, Pyth, API3)
// et évalue la règle « 2 sur 3 » à l'instant présent.
// Lancer : set -a && . ../../.env && set +a && npx hardhat run scripts/deploy-v2-check.ts --network base-sepolia
import hre from "hardhat";

export const BASE_SEPOLIA_ORACLES = {
  chainlinkFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1", // Chainlink ETH/USD
  api3Feed: "0x5b0cf2b36a65a6BB085D501B971e4c102B9Cd473", // API3 ETH/USD (Api3ReaderProxyV1 communal)
  pyth: "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729", // Pyth
  pythPriceId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", // ETH/USD
  chainlinkMaxAge: 3_600n, // heartbeat Chainlink ETH/USD ≤ 1 h
  api3MaxAge: 93_600n, // heartbeat API3 24 h + marge (mises à jour sur déviation entre-temps)
  pythMaxAge: 300n,
  pythWindow: 60n,
  maxDeviationBps: 100n, // 1 %
  maxConfBps: 50n, // 0,5 %
};

async function main() {
  const f = await hre.ethers.getContractFactory("SealedBatchPoolV2");
  const pool = process.env.POOL
    ? f.attach(process.env.POOL)
    : await f.deploy(BASE_SEPOLIA_ORACLES, 1_000_000_000n, 120n, { gasLimit: 4_000_000n });
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
