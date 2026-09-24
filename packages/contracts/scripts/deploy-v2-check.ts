// Déploie SealedBatchPoolV2 sur Base Sepolia avec les VRAIS oracles et évalue la règle de prix.
import hre from "hardhat";
async function main() {
  const f = await hre.ethers.getContractFactory("SealedBatchPoolV2");
  const pool = await f.deploy(
    "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1", // Chainlink ETH/USD (Base Sepolia)
    "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729", // Pyth (Base Sepolia)
    "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", // ETH/USD
    3600n, // ancienneté max (s) : Chainlink ETH/USD a un heartbeat ≤ 1 h
    100n, // écart max 1 %
    50n, // confiance Pyth max 0,5 %
    1_000_000_000n, // 8 déc. USD/ETH → centimes par milli-ETH
    120n, // lots de 2 minutes
    { gasLimit: 3_000_000n },
  );
  await pool.waitForDeployment();
  console.log("SealedBatchPoolV2 :", await pool.getAddress());
  const r = await pool.evaluatePrice();
  console.log("evaluatePrice :", { ok: r[0], reason: Number(r[1]), poolPrice: r[2].toString(), chainlink8: r[3].toString(), pyth8: r[4].toString() });
}
main().catch((e) => { console.error(e); process.exit(1); });
