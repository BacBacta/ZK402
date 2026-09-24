// Phase 0 de S1 : coût réel (gas) du règlement d'un lot sur un fork de Base Sepolia,
// avec le vrai TaskManager CoFHE. Lancer : FORK_URL=https://sepolia.base.org npx hardhat run scripts/bench-fork.ts
import hre from "hardhat";

const TASK_MANAGER = "0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9";

async function main() {
  const code = await hre.ethers.provider.getCode(TASK_MANAGER);
  const net = await hre.ethers.provider.getNetwork();
  console.log(`chainId=${net.chainId} TaskManager code=${code.length / 2 - 1} octets`);
  const signers = await hre.ethers.getSigners();
  const operator = signers[0];
  const sizes = (process.env.SIZES || "8,16,32").split(",").map(Number);
  const STEP = Number(process.env.STEP || 4);
  for (const n of sizes) {
    const f = await hre.ethers.getContractFactory("SealedBatchPoolBench");
    const pool = await f.deploy(operator.address);
    await pool.waitForDeployment();
    let gSubmit = 0n;
    for (let i = 0; i < n; i++) {
      const s = signers[1 + i];
      await (await pool.connect(s).claimFaucet()).wait();
      const r = await (await pool.connect(s).submitOrderPlain(i % 2 === 0, BigInt(5 + i))).wait();
      gSubmit += r!.gasUsed;
    }
    const r0 = await (await pool.connect(operator).startSettlement(2500n)).wait();
    let g1 = 0n, g2 = 0n, maxTx = 0n, txs = 0, done = false;
    while (!done) {
      const ph = await pool.phase();
      done = await pool.connect(operator).settleStep.staticCall(STEP);
      const r = await (await pool.connect(operator).settleStep(STEP)).wait();
      if (ph === 1n) g1 += r!.gasUsed; else g2 += r!.gasUsed;
      if (r!.gasUsed > maxTx) maxTx = r!.gasUsed;
      txs++;
    }
    const total = r0!.gasUsed + g1 + g2;
    console.log(
      `[fork] N=${n} soumission/ordre=${gSubmit / BigInt(n)} totaux=${g1} exécutions=${g2} règlement=${total} règlement/ordre=${total / BigInt(n)} tx=${txs} (pas ${STEP}) max/tx=${maxTx}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
