import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import hre from "hardhat";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { expect } from "chai";
import { SealedBatchPool, SealedBatchPoolBench } from "../typechain-types";

const TASK_COFHE_MOCKS_DEPLOY = "task:cofhe-mocks:deploy";
const PRICE = 2_500n; // QUOTE par unité de BASE

describe("SealedBatchPool", function () {
  async function deployFixture() {
    await hre.run(TASK_COFHE_MOCKS_DEPLOY);
    const signers = await hre.ethers.getSigners();
    const operator = signers[0];
    const factory = await hre.ethers.getContractFactory("SealedBatchPool");
    const pool = (await factory.deploy(operator.address)) as unknown as SealedBatchPool;
    return { pool, poolAddress: await pool.getAddress(), operator, signers };
  }

  async function submit(pool: SealedBatchPool, poolAddress: string, signer: any, isBuy: boolean, qty: bigint) {
    const client = await hre.cofhe.createClientWithBatteries(signer);
    const [[side, proofSide], [amount, proofQty]] = await Promise.all([
      client.encryptInputs([Encryptable.bool(isBuy)]).setConsumingContract(poolAddress).execute(),
      client.encryptInputs([Encryptable.uint64(qty)]).setConsumingContract(poolAddress).execute(),
    ]).then((r: any[]) => r.map((x) => x as any));
    return pool.connect(signer).submitOrder(side, proofSide, amount, proofQty);
  }

  async function settleAll(pool: SealedBatchPool, operator: any, step = 64) {
    await pool.connect(operator).startSettlement(PRICE);
    let done = false;
    while (!done) {
      done = await pool.connect(operator).settleStep.staticCall(step);
      await pool.connect(operator).settleStep(step);
    }
  }

  it("croise au prix médian en FIFO et met à jour les soldes chiffrés", async function () {
    const { pool, poolAddress, operator, signers } = await loadFixture(deployFixture);
    const [a, b, c, d] = signers.slice(1, 5);
    for (const s of [a, b, c, d]) await pool.connect(s).claimFaucet();

    // Acheteurs : a=30, c=50 (total 80). Vendeurs : b=40, d=10 (total 50). Croisé = 50.
    await submit(pool, poolAddress, a, true, 30n);
    await submit(pool, poolAddress, b, false, 40n);
    await submit(pool, poolAddress, c, true, 50n);
    await submit(pool, poolAddress, d, false, 10n);
    await settleAll(pool, operator, 3); // en plusieurs transactions

    const FB = 1_000n;
    const FQ = 5_000_000n;
    const expectBal = async (s: any, base: bigint, quote: bigint) => {
      await hre.cofhe.mocks.expectPlaintext(await pool.baseBalanceOf(s.address), base);
      await hre.cofhe.mocks.expectPlaintext(await pool.quoteBalanceOf(s.address), quote);
    };
    // FIFO acheteurs : a reçoit 30, c reçoit 20 (reste 30 non exécuté).
    await expectBal(a, FB + 30n, FQ - 30n * PRICE);
    await expectBal(c, FB + 20n, FQ - 20n * PRICE);
    // Vendeurs entièrement exécutés.
    await expectBal(b, FB - 40n, FQ + 40n * PRICE);
    await expectBal(d, FB - 10n, FQ + 10n * PRICE);
    // Conservation.
    expect(await pool.batchId()).to.equal(1n);
    expect(await pool.orderCount()).to.equal(0n);
  });

  it("un ordre non couvert par le solde n'est pas exécuté, sans revert", async function () {
    const { pool, poolAddress, operator, signers } = await loadFixture(deployFixture);
    const [a, b] = signers.slice(1, 3);
    await pool.connect(a).claimFaucet();
    await pool.connect(b).claimFaucet();
    await submit(pool, poolAddress, a, true, 10_000n); // 10 000 × 2 500 > 5 000 000
    await submit(pool, poolAddress, b, false, 5n);
    await settleAll(pool, operator);
    await hre.cofhe.mocks.expectPlaintext(await pool.baseBalanceOf(a.address), 1_000n);
    await hre.cofhe.mocks.expectPlaintext(await pool.baseBalanceOf(b.address), 1_000n);
  });

  it("chaque trader déchiffre sa propre exécution, pas celle des autres", async function () {
    const { pool, poolAddress, operator, signers } = await loadFixture(deployFixture);
    const [a, b] = signers.slice(1, 3);
    await pool.connect(a).claimFaucet();
    await pool.connect(b).claimFaucet();
    await submit(pool, poolAddress, a, true, 7n);
    await submit(pool, poolAddress, b, false, 7n);
    await settleAll(pool, operator);

    const aClient = await hre.cofhe.createClientWithBatteries(a);
    expect(await aClient.decryptForView(await pool.lastFillOf(a.address), FheTypes.Uint64).execute()).to.equal(7n);
    let denied = false;
    try {
      await aClient.decryptForView(await pool.lastFillOf(b.address), FheTypes.Uint64).execute();
    } catch {
      denied = true;
    }
    expect(denied).to.equal(true);
  });

  it("refuse un deuxième ordre du même trader dans le lot", async function () {
    const { pool, poolAddress, signers } = await loadFixture(deployFixture);
    const a = signers[1];
    await pool.connect(a).claimFaucet();
    await submit(pool, poolAddress, a, true, 1n);
    await expect(submit(pool, poolAddress, a, true, 1n)).to.be.revertedWithCustomError(pool, "AlreadySubmitted");
  });

  it("VULNÉRABILITÉ CONNUE de la v1 (corrigée en v2) : rebouclage de q·prix → solde QUOTE rebouclé", async function () {
    const { pool, poolAddress, operator, signers } = await loadFixture(deployFixture);
    const [attacker, seller] = [signers[1], signers[2]];
    await pool.connect(attacker).claimFaucet(); // 5 000 000 QUOTE
    for (let i = 0; i < 3; i++) await pool.connect(seller).claimFaucet(); // 3 000 BASE
    const q = (1n << 64n) / PRICE + 1n; // q·PRICE ≡ petit (mod 2^64)
    await submit(pool, poolAddress, attacker, true, q);
    await submit(pool, poolAddress, seller, false, 3_000n); // coût réel 7 500 000 > 5 000 000
    await settleAll(pool, operator);
    // L'attaquant est exécuté au-delà de ses moyens : 5 000 000 − 7 500 000 reboucle vers ~2^64.
    await hre.cofhe.mocks.expectPlaintext(await pool.baseBalanceOf(attacker.address), 1_000n + 3_000n);
    await hre.cofhe.mocks.expectPlaintext(
      await pool.quoteBalanceOf(attacker.address),
      (5_000_000n - 3_000n * PRICE + (1n << 64n)) % (1n << 64n),
    );
  });

  it("seul l'opérateur règle", async function () {
    const { pool, signers } = await loadFixture(deployFixture);
    await expect(pool.connect(signers[1]).startSettlement(PRICE)).to.be.revertedWithCustomError(pool, "NotOperator");
  });

  describe("Mesure de gas (mocks)", function () {
    for (const n of [8, 16, 32]) {
      it(`lot de ${n} ordres`, async function () {
        await hre.run(TASK_COFHE_MOCKS_DEPLOY);
        const signers = await hre.ethers.getSigners();
        const operator = signers[0];
        const f = await hre.ethers.getContractFactory("SealedBatchPoolBench");
        const pool = (await f.deploy(operator.address)) as unknown as SealedBatchPoolBench;
        for (let i = 0; i < n; i++) {
          const s = signers[1 + i];
          await pool.connect(s).claimFaucet();
          await pool.connect(s).submitOrderPlain(i % 2 === 0, BigInt(5 + i));
        }
        const r0 = await (await pool.connect(operator).startSettlement(PRICE)).wait();
        let g1 = 0n, g2 = 0n, maxTx = 0n, txs = 0;
        const STEP = 4;
        let done = false;
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
          `      [mocks] N=${n} totaux=${g1} exécutions=${g2} total=${total} par ordre=${total / BigInt(n)} tx=${txs} (pas de ${STEP}) max/tx=${maxTx}`,
        );
      });
    }
  });
});
