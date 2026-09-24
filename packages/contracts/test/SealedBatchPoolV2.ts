import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import hre from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import { expect } from "chai";

const TASK_COFHE_MOCKS_DEPLOY = "task:cofhe-mocks:deploy";
const PYTH_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const DURATION = 3600n;
const STALENESS = 300n;
const DEV_BPS = 100n; // 1 %
const CONF_BPS = 50n; // 0,5 %
const DIVISOR = 1_000_000_000n; // 8 décimales USD/ETH → centimes par milli-ETH
const CL_PRICE = 2688n * 10n ** 8n;
const PY_PRICE = 2690n * 10n ** 8n;
const FB = 1_000n;
const FQ = 5_000_000n;
const ABI = hre.ethers.AbiCoder.defaultAbiCoder();

async function deployFixture() {
  await hre.run(TASK_COFHE_MOCKS_DEPLOY);
  const signers = await hre.ethers.getSigners();
  const cl = await (await hre.ethers.getContractFactory("MockAggregatorV3")).deploy(8, CL_PRICE);
  const py = await (await hre.ethers.getContractFactory("MockPyth")).deploy();
  const now = BigInt(await time.latest());
  await py.set(PY_PRICE, PY_PRICE / 1000n, -8, now);
  const f = await hre.ethers.getContractFactory("SealedBatchPoolV2");
  const pool = await f.deploy(
    await cl.getAddress(),
    await py.getAddress(),
    PYTH_ID,
    STALENESS,
    DEV_BPS,
    CONF_BPS,
    DIVISOR,
    DURATION,
  );
  return { pool, poolAddress: await pool.getAddress(), cl, py, signers };
}

async function submit(pool: any, poolAddress: string, signer: any, isBuy: boolean, qty: bigint) {
  const client = await hre.cofhe.createClientWithBatteries(signer);
  const [side, proofSide] = (await client.encryptInputs([Encryptable.bool(isBuy)]).setConsumingContract(poolAddress).execute()) as any;
  const [amount, proofQty] = (await client.encryptInputs([Encryptable.uint64(qty)]).setConsumingContract(poolAddress).execute()) as any;
  return pool.connect(signer).submitOrder(side, proofSide, amount, proofQty);
}

async function refreshOracles(cl: any, py: any, clPrice = CL_PRICE, pyPrice = PY_PRICE) {
  const now = BigInt(await time.latest());
  await cl.set(clPrice, now);
  await py.set(pyPrice, pyPrice / 1000n, -8, now);
}

async function closeBatch(pool: any, k: bigint) {
  const deadline = await pool.batchDeadline(k);
  const now = BigInt(await time.latest());
  if (now < deadline) await time.increaseTo(deadline);
}

async function settleAll(pool: any, by: any, step = 64) {
  let done = false;
  while (!done) {
    done = await pool.connect(by).settleStep.staticCall(step);
    await pool.connect(by).settleStep(step);
  }
}

describe("SealedBatchPoolV2 — P7 (aucun opérateur) et P2.a (règle d'oracle)", function () {
  it("n'expose aucune fonction privilégiée (pas d'owner, operator, pause, upgrade)", async function () {
    const f = await hre.ethers.getContractFactory("SealedBatchPoolV2");
    const names = f.interface.fragments.filter((x: any) => x.type === "function").map((x: any) => x.name);
    for (const bad of ["owner", "operator", "pause", "unpause", "upgradeTo", "upgradeToAndCall", "setPrice", "transferOwnership"]) {
      expect(names).to.not.include(bad);
    }
  });

  it("refuse de régler un lot avant son échéance", async function () {
    const { pool, poolAddress, signers } = await loadFixture(deployFixture);
    const a = signers[1];
    await pool.connect(a).claimFaucet();
    await submit(pool, poolAddress, a, true, 1n);
    await expect(pool.connect(signers[9]).startSettlement([])).to.be.revertedWithCustomError(pool, "BatchNotClosed");
  });

  it("n'importe quel compte règle le lot, au prix moyen des deux oracles", async function () {
    const { pool, poolAddress, cl, py, signers } = await loadFixture(deployFixture);
    const [a, b, stranger] = [signers[1], signers[2], signers[15]];
    await pool.connect(a).claimFaucet();
    await pool.connect(b).claimFaucet();
    await submit(pool, poolAddress, a, true, 10n);
    await submit(pool, poolAddress, b, false, 10n);
    await closeBatch(pool, 0n);
    await refreshOracles(cl, py);
    await expect(pool.connect(stranger).startSettlement([]))
      .to.emit(pool, "SettlementStarted")
      .withArgs(0n, (CL_PRICE + PY_PRICE) / 2n / DIVISOR, 2n, CL_PRICE, PY_PRICE);
    await settleAll(pool, stranger);
    const p = (CL_PRICE + PY_PRICE) / 2n / DIVISOR;
    await hre.cofhe.mocks.expectPlaintext(await pool.baseBalanceOf(a.address), FB + 10n);
    await hre.cofhe.mocks.expectPlaintext(await pool.quoteBalanceOf(a.address), FQ - 10n * p);
    await hre.cofhe.mocks.expectPlaintext(await pool.baseBalanceOf(b.address), FB - 10n);
    await hre.cofhe.mocks.expectPlaintext(await pool.quoteBalanceOf(b.address), FQ + 10n * p);
    expect(await pool.nextToSettle()).to.equal(1n);
  });

  const postponeCases: [string, (cl: any, py: any) => Promise<void>, number][] = [
    ["Chainlink périmé", async (cl, py) => { await refreshOracles(cl, py); await cl.set(CL_PRICE, BigInt(await time.latest()) - STALENESS - 10n); }, 2],
    ["Chainlink négatif", async (cl, py) => { await refreshOracles(cl, py, -1n); }, 1],
    ["Chainlink round incomplet", async (cl, py) => { await refreshOracles(cl, py); await cl.setAnsweredInRound(0); }, 1],
    ["Pyth périmé", async (cl, py) => { await refreshOracles(cl, py); await py.set(PY_PRICE, 1n, -8, BigInt(await time.latest()) - STALENESS - 10n); }, 3],
    ["Pyth confiance trop large", async (cl, py) => { await refreshOracles(cl, py); await py.set(PY_PRICE, PY_PRICE / 10n, -8, BigInt(await time.latest())); }, 4],
    ["écart > 1 % entre oracles", async (cl, py) => { await refreshOracles(cl, py, CL_PRICE, (CL_PRICE * 102n) / 100n); }, 5],
  ];
  for (const [label, setup, reason] of postponeCases) {
    it(`reporte le lot (jamais réglé à un mauvais prix) : ${label}`, async function () {
      const { pool, poolAddress, cl, py, signers } = await loadFixture(deployFixture);
      const a = signers[1];
      await pool.connect(a).claimFaucet();
      await submit(pool, poolAddress, a, true, 1n);
      await closeBatch(pool, 0n);
      await setup(cl, py);
      await expect(pool.startSettlement([])).to.emit(pool, "BatchPostponed").withArgs(0n, reason);
      expect(await pool.phase()).to.equal(0n);
      expect(await pool.nextToSettle()).to.equal(0n);
      // Dès que les oracles redeviennent valides, n'importe qui peut régler.
      await refreshOracles(cl, py);
      await expect(pool.connect(signers[7]).startSettlement([])).to.emit(pool, "SettlementStarted");
    });
  }

  it("accepte une mise à jour Pyth poussée par le déclencheur et rembourse l'excédent", async function () {
    const { pool, poolAddress, cl, py, signers } = await loadFixture(deployFixture);
    const a = signers[1];
    await pool.connect(a).claimFaucet();
    await submit(pool, poolAddress, a, true, 1n);
    await closeBatch(pool, 0n);
    await cl.set(CL_PRICE, BigInt(await time.latest()));
    await py.set(PY_PRICE, 1n, -8, 1n); // Pyth périmé…
    const upd = ABI.encode(["int64", "uint64", "int32"], [PY_PRICE, PY_PRICE / 1000n, -8]);
    const trigger = signers[8];
    const before = await hre.ethers.provider.getBalance(trigger.address);
    const tx = await pool.connect(trigger).startSettlement([upd], { value: 1000n });
    const r = await tx.wait();
    await expect(tx).to.emit(pool, "SettlementStarted");
    const after = await hre.ethers.provider.getBalance(trigger.address);
    expect(before - after - r!.gasUsed * r!.gasPrice).to.equal(1n); // frais Pyth = 1 wei
  });

  it("passe un lot vide sans oracle et règle les lots strictement dans l'ordre", async function () {
    const { pool, poolAddress, cl, py, signers } = await loadFixture(deployFixture);
    const a = signers[1];
    await pool.connect(a).claimFaucet();
    await closeBatch(pool, 0n); // lot 0 vide
    await submit(pool, poolAddress, a, true, 1n); // va dans le lot 1
    expect(await pool.orderCount(1n)).to.equal(1n);
    await expect(pool.startSettlement([])).to.emit(pool, "BatchSkippedEmpty").withArgs(0n);
    await expect(pool.startSettlement([])).to.be.revertedWithCustomError(pool, "BatchNotClosed");
    await closeBatch(pool, 1n);
    await refreshOracles(cl, py);
    await expect(pool.startSettlement([])).to.emit(pool, "SettlementStarted");
  });

  it("un ordre par trader et par lot ; nouvel ordre autorisé au lot suivant", async function () {
    const { pool, poolAddress, signers } = await loadFixture(deployFixture);
    const a = signers[1];
    await pool.connect(a).claimFaucet();
    await submit(pool, poolAddress, a, true, 1n);
    await expect(submit(pool, poolAddress, a, true, 1n)).to.be.revertedWithCustomError(pool, "AlreadySubmitted");
    await closeBatch(pool, 0n);
    await submit(pool, poolAddress, a, false, 1n);
    expect(await pool.orderCount(1n)).to.equal(1n);
  });

  it("rejette des paramètres de construction dangereux", async function () {
    const { cl, py } = await loadFixture(deployFixture);
    const f = await hre.ethers.getContractFactory("SealedBatchPoolV2");
    const c = await cl.getAddress();
    const p = await py.getAddress();
    await expect(f.deploy(c, p, PYTH_ID, STALENESS, 1_001n, CONF_BPS, DIVISOR, DURATION)).to.be.revertedWithCustomError(f, "BadParams");
    await expect(f.deploy(hre.ethers.ZeroAddress, p, PYTH_ID, STALENESS, DEV_BPS, CONF_BPS, DIVISOR, DURATION)).to.be.revertedWithCustomError(f, "BadParams");
    await expect(f.deploy(c, p, PYTH_ID, 0n, DEV_BPS, CONF_BPS, DIVISOR, DURATION)).to.be.revertedWithCustomError(f, "BadParams");
  });
});

// --------------------------------------------------------------------------------------------
// Tests de propriétés : lots aléatoires comparés à un modèle de référence en clair.
// Invariants : conservation de BASE et de QUOTE, exécutions = modèle (FIFO), aucune exécution
// au-delà de la couverture, soldes jamais « négatifs » (pas de débordement modulaire).
// --------------------------------------------------------------------------------------------
type Acc = { base: bigint; quote: bigint };

function referenceBatch(accs: Acc[], orders: { t: number; buy: boolean; q: bigint }[], p: bigint) {
  const eff = orders.map((o) => {
    const a = accs[o.t];
    const ok = o.buy ? a.quote >= o.q * p : a.base >= o.q;
    return ok ? o.q : 0n;
  });
  const tb = orders.reduce((s, o, i) => s + (o.buy ? eff[i] : 0n), 0n);
  const ts = orders.reduce((s, o, i) => s + (o.buy ? 0n : eff[i]), 0n);
  let rb = tb < ts ? tb : ts;
  let rs = rb;
  const fills: bigint[] = [];
  orders.forEach((o, i) => {
    const rem = o.buy ? rb : rs;
    const f = eff[i] < rem ? eff[i] : rem;
    fills.push(f);
    if (o.buy) {
      rb -= f;
      accs[o.t].base += f;
      accs[o.t].quote -= f * p;
    } else {
      rs -= f;
      accs[o.t].base -= f;
      accs[o.t].quote += f * p;
    }
  });
  return fills;
}

describe("SealedBatchPoolV2 — propriétés (lots aléatoires vs modèle de référence)", function () {
  const RUNS = Number(process.env.PROPERTY_RUNS || 12);
  // Générateur pseudo-aléatoire déterministe (reproductible : graine affichée en cas d'échec).
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 2 ** 32;
    };
  }

  for (let run = 0; run < RUNS; run++) {
    const seed = 1000 + run;
    it(`scénario aléatoire n° ${run + 1} (graine ${seed}) : conservation et conformité au modèle`, async function () {
      const { pool, poolAddress, cl, py, signers } = await loadFixture(deployFixture);
      const r = rng(seed);
      const nTraders = 2 + Math.floor(r() * 7); // 2..8
      const traders = signers.slice(1, 1 + nTraders);
      const accs: Acc[] = [];
      for (const t of traders) {
        const claims = 1 + Math.floor(r() * 2);
        for (let c = 0; c < claims; c++) await pool.connect(t).claimFaucet();
        accs.push({ base: FB * BigInt(claims), quote: FQ * BigInt(claims) });
      }
      const p = (CL_PRICE + PY_PRICE) / 2n / DIVISOR;
      const totalBase0 = accs.reduce((s, a) => s + a.base, 0n);
      const totalQuote0 = accs.reduce((s, a) => s + a.quote, 0n);

      const nBatches = 1 + Math.floor(r() * 2);
      for (let k = 0; k < nBatches; k++) {
        const orders: { t: number; buy: boolean; q: bigint }[] = [];
        for (let i = 0; i < nTraders; i++) {
          if (r() < 0.25) continue; // certains ne tradent pas
          // quantités parfois non couvertes (vente > base, achat > quote/p)
          const q = BigInt(1 + Math.floor(r() * (r() < 0.2 ? 20_000 : 400)));
          orders.push({ t: i, buy: r() < 0.5, q });
        }
        const batch = await pool.currentBatch();
        for (const o of orders) await submit(pool, poolAddress, traders[o.t], o.buy, o.q);
        expect(await pool.orderCount(batch), "tous les ordres doivent être dans le même lot").to.equal(BigInt(orders.length));
        await closeBatch(pool, batch);
        await refreshOracles(cl, py);
        // lots vides éventuels avant le nôtre
        while ((await pool.nextToSettle()) < batch) await pool.startSettlement([]);
        if (orders.length === 0) {
          await pool.startSettlement([]);
          continue;
        }
        await pool.connect(signers[19]).startSettlement([]);
        await settleAll(pool, signers[18], 1 + Math.floor(r() * 4));
        const fills = referenceBatch(accs, orders, p);
        for (let i = 0; i < orders.length; i++) {
          await hre.cofhe.mocks.expectPlaintext(await pool.lastFillOf(traders[orders[i].t].address), fills[i]);
        }
      }
      let sumB = 0n;
      let sumQ = 0n;
      for (let i = 0; i < nTraders; i++) {
        await hre.cofhe.mocks.expectPlaintext(await pool.baseBalanceOf(traders[i].address), accs[i].base);
        await hre.cofhe.mocks.expectPlaintext(await pool.quoteBalanceOf(traders[i].address), accs[i].quote);
        expect(accs[i].base >= 0n && accs[i].quote >= 0n, "solde négatif dans le modèle").to.equal(true);
        sumB += accs[i].base;
        sumQ += accs[i].quote;
      }
      expect(sumB).to.equal(totalBase0); // conservation BASE
      expect(sumQ).to.equal(totalQuote0); // conservation QUOTE
    });
  }
});
