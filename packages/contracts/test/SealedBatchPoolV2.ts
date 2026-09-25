import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import hre from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import { expect } from "chai";

const TASK_COFHE_MOCKS_DEPLOY = "task:cofhe-mocks:deploy";
const PYTH_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const DURATION = 3600n;
const CL_MAX_AGE = 3600n;
const API3_MAX_AGE = 93_600n; // 26 h : heartbeat API3 de 24 h + marge
const PY_MAX_AGE = 300n;
const PY_WINDOW = 60n;
const DEV_BPS = 100n; // 1 %
const CONF_BPS = 50n; // 0,5 %
const DIVISOR = 1_000_000_000n; // 8 décimales USD/ETH → centimes par milli-ETH
const CL_PRICE = 2688n * 10n ** 8n;
const PY_PRICE = 2690n * 10n ** 8n;
const A3_PRICE = 2689n * 10n ** 18n; // API3 : 18 décimales
const MEDIAN8 = 2689n * 10n ** 8n;
const POOL_PRICE = MEDIAN8 / DIVISOR;
const FB = 1_000n;
const FQ = 5_000_000n;
const ABI = hre.ethers.AbiCoder.defaultAbiCoder();

async function deployFixture() {
  await hre.run(TASK_COFHE_MOCKS_DEPLOY);
  const signers = await hre.ethers.getSigners();
  const Agg = await hre.ethers.getContractFactory("MockAggregatorV3");
  const cl = await Agg.deploy(8, CL_PRICE, true);
  const a3 = await Agg.deploy(18, A3_PRICE, false);
  const py = await (await hre.ethers.getContractFactory("MockPyth")).deploy();
  await py.setStored(PY_PRICE, PY_PRICE / 1000n, -8, BigInt(await time.latest()));
  const cfg = {
    chainlinkFeed: await cl.getAddress(),
    api3Feed: await a3.getAddress(),
    pyth: await py.getAddress(),
    pythPriceId: PYTH_ID,
    chainlinkMaxAge: CL_MAX_AGE,
    api3MaxAge: API3_MAX_AGE,
    pythMaxAge: PY_MAX_AGE,
    pythWindow: PY_WINDOW,
    maxDeviationBps: DEV_BPS,
    maxConfBps: CONF_BPS,
  };
  const f = await hre.ethers.getContractFactory("SealedBatchPoolV2");
  const pool = await f.deploy(cfg, DIVISOR, DURATION, hre.ethers.ZeroAddress, 0n);
  return { pool, poolAddress: await pool.getAddress(), cl, a3, py, signers, cfg };
}

async function submit(pool: any, poolAddress: string, signer: any, isBuy: boolean, qty: bigint) {
  const client = await hre.cofhe.createClientWithBatteries(signer);
  const [side, proofSide] = (await client.encryptInputs([Encryptable.bool(isBuy)]).setConsumingContract(poolAddress).execute()) as any;
  const [amount, proofQty] = (await client.encryptInputs([Encryptable.uint64(qty)]).setConsumingContract(poolAddress).execute()) as any;
  return pool.connect(signer).submitOrder(side, proofSide, amount, proofQty);
}

/** Publie des prix frais sur les trois sources, juste AVANT la clôture du lot courant
 *  (observations ≤ t_k et d'âge ≤ maxAge à t_k). */
async function refreshOracles(o: any, cl = CL_PRICE, py = PY_PRICE, a3 = A3_PRICE) {
  const deadline = await o.pool.batchDeadline(await o.pool.currentBatch());
  if (BigInt(await time.latest()) < deadline - 20n) await time.increaseTo(deadline - 20n);
  const now = BigInt(await time.latest());
  await o.cl.push(cl, now);
  await o.a3.push(a3, now);
  await o.py.setStored(py, py / 1000n, -8, now);
}

/** Prix frais à l'instant présent (sans avancer le temps) : requis pour ouvrir un lot,
 *  car le plafond de séquestre est fixé à la première soumission. */
async function pricesNow(o: any) {
  const now = BigInt(await time.latest());
  await o.cl.push(CL_PRICE, now);
  await o.a3.push(A3_PRICE, now);
  await o.py.setStored(PY_PRICE, PY_PRICE / 1000n, -8, now);
}

async function closeBatch(pool: any, k: bigint) {
  const deadline = await pool.batchDeadline(k);
  const now = BigInt(await time.latest());
  if (now < deadline) await time.increaseTo(deadline);
}

/** Indice Chainlink correct : dernier round avec updatedAt ≤ t_k. */
async function hintFor(pool: any, cl: any) {
  const t = await pool.batchDeadline(await pool.nextToSettle());
  let id = await cl.latest();
  while (id > 1n && (await cl.rounds(id)).updatedAt > t) id--;
  return id;
}

async function start(pool: any, o: any, by?: any, pythUpdate: string[] = [], value = 0n) {
  const hint = await hintFor(pool, o.cl);
  return (by ? pool.connect(by) : pool).startSettlement(hint, pythUpdate, { value });
}

async function settleAll(pool: any, by: any, step = 64) {
  let done = false;
  while (!done) {
    done = await pool.connect(by).settleStep.staticCall(step);
    await pool.connect(by).settleStep(step);
  }
}

async function oneOrderClosed() {
  const o = await loadFixture(deployFixture);
  const a = o.signers[1];
  await o.pool.connect(a).claimFaucet();
  await submit(o.pool, o.poolAddress, a, true, 1n);
  return o;
}

describe("SealedBatchPoolV2 — P7 (aucun opérateur) et P2.a (règle 2 sur 3 à l'instant de clôture)", function () {
  it("n'expose aucune fonction privilégiée (pas d'owner, operator, pause, upgrade)", async function () {
    const f = await hre.ethers.getContractFactory("SealedBatchPoolV2");
    const names = f.interface.fragments.filter((x: any) => x.type === "function").map((x: any) => x.name);
    for (const bad of ["owner", "operator", "pause", "unpause", "upgradeTo", "upgradeToAndCall", "setPrice", "transferOwnership"]) {
      expect(names).to.not.include(bad);
    }
  });

  it("refuse de régler un lot avant son échéance", async function () {
    const o = await oneOrderClosed();
    await expect(start(o.pool, o, o.signers[9])).to.be.revertedWithCustomError(o.pool, "BatchNotClosed");
  });

  it("n'importe quel compte règle le lot, au prix médian des trois sources", async function () {
    const o = await loadFixture(deployFixture);
    const [a, b, stranger] = [o.signers[1], o.signers[2], o.signers[15]];
    await o.pool.connect(a).claimFaucet();
    await o.pool.connect(b).claimFaucet();
    await submit(o.pool, o.poolAddress, a, true, 10n);
    await submit(o.pool, o.poolAddress, b, false, 10n);
    await refreshOracles(o);
    await closeBatch(o.pool, 0n);
    await expect(start(o.pool, o, stranger))
      .to.emit(o.pool, "SettlementStarted")
      .withArgs(0n, POOL_PRICE, 2n, CL_PRICE, PY_PRICE, MEDIAN8);
    await settleAll(o.pool, stranger);
    await hre.cofhe.mocks.expectPlaintext(await o.pool.baseBalanceOf(a.address), FB + 10n);
    await hre.cofhe.mocks.expectPlaintext(await o.pool.quoteBalanceOf(a.address), FQ - 10n * POOL_PRICE);
    await hre.cofhe.mocks.expectPlaintext(await o.pool.baseBalanceOf(b.address), FB - 10n);
    await hre.cofhe.mocks.expectPlaintext(await o.pool.quoteBalanceOf(b.address), FQ + 10n * POOL_PRICE);
  });

  it("R5 : le prix est celui de la clôture, pas celui du déclenchement", async function () {
    const o = await oneOrderClosed();
    await o.pool.connect(o.signers[2]).claimFaucet();
    await submit(o.pool, o.poolAddress, o.signers[2], false, 1n);
    await refreshOracles(o);
    await closeBatch(o.pool, 0n);
    // Après la clôture, les oracles bougent de +50 % : le déclencheur ne doit pas en profiter.
    await time.increase(30);
    const later = BigInt(await time.latest());
    await o.cl.push(CL_PRICE * 3n / 2n, later);
    await o.a3.push(A3_PRICE * 3n / 2n, later);
    await o.py.setStored(PY_PRICE * 3n / 2n, 1n, -8, later);
    // L'indice honnête désigne le round d'avant la clôture ; le round postérieur est refusé.
    await expect(o.pool.startSettlement(await o.cl.latest(), [])).to.be.revertedWithCustomError(o.pool, "BadChainlinkHint");
    // API3 et Pyth ont été mis à jour après t_k : leur valeur « à t_k » est inconnue → invalides.
    // Il ne reste que Chainlink : < 2 sources → report (jamais le prix post-clôture).
    await expect(start(o.pool, o)).to.emit(o.pool, "BatchPostponed").withArgs(0n, 1);
  });

  it("R5 : un indice Chainlink trop ancien (round suivant ≤ t_k) est refusé", async function () {
    const o = await oneOrderClosed();
    await refreshOracles(o);
    await refreshOracles(o); // deux rounds avant la clôture
    await closeBatch(o.pool, 0n);
    const latest = await o.cl.latest();
    await expect(o.pool.startSettlement(latest - 1n, [])).to.be.revertedWithCustomError(o.pool, "BadChainlinkHint");
    await expect(o.pool.startSettlement(latest, [])).to.emit(o.pool, "SettlementStarted");
  });

  it("2 sur 3 : une source aberrante est écartée par la médiane", async function () {
    const o = await oneOrderClosed();
    await refreshOracles(o, CL_PRICE, PY_PRICE * 10n, A3_PRICE); // Pyth ×10
    await closeBatch(o.pool, 0n);
    await expect(start(o.pool, o)).to.emit(o.pool, "SettlementStarted").withArgs(0n, POOL_PRICE, 1n, CL_PRICE, PY_PRICE * 10n, MEDIAN8);
  });

  it("2 sur 3 : fonctionne avec deux sources si la troisième est indisponible", async function () {
    const o = await oneOrderClosed();
    await refreshOracles(o);
    await o.py.setStored(PY_PRICE, 1n, -8, 1n); // Pyth périmé
    await closeBatch(o.pool, 0n);
    await expect(start(o.pool, o)).to.emit(o.pool, "SettlementStarted");
    expect(await o.pool.settlementPrice()).to.equal((CL_PRICE + MEDIAN8) / 2n / DIVISOR);
  });

  const postponeCases: [string, (o: any) => Promise<void>, number][] = [
    ["deux sources périmées", async (o) => { await refreshOracles(o); await o.py.setStored(PY_PRICE, 1n, -8, 1n); await o.a3.push(A3_PRICE, 1n); }, 1],
    ["Chainlink négatif et Pyth périmé", async (o) => { await refreshOracles(o, -1n); await o.py.setStored(PY_PRICE, 1n, -8, 1n); }, 1],
    ["Chainlink round incomplet et API3 périmé", async (o) => { await refreshOracles(o); await o.cl.setAnsweredOverride(1n); await o.a3.push(A3_PRICE, 1n); }, 1],
    ["Pyth confiance trop large et API3 absent", async (o) => { await refreshOracles(o); await o.py.setStored(PY_PRICE, PY_PRICE / 10n, -8, BigInt(await time.latest())); await o.a3.push(0n, BigInt(await time.latest())); }, 1],
    ["trois sources mutuellement en désaccord (> 1 %)", async (o) => { await refreshOracles(o, CL_PRICE, CL_PRICE * 103n / 100n, A3_PRICE * 106n / 100n); }, 2],
    ["deux sources seulement, en désaccord", async (o) => { await refreshOracles(o, CL_PRICE, CL_PRICE * 103n / 100n); await o.a3.push(A3_PRICE, 1n); }, 2],
  ];
  for (const [label, setup, reason] of postponeCases) {
    it(`reporte le lot (jamais réglé à un mauvais prix) : ${label}`, async function () {
      const o = await oneOrderClosed();
      await setup(o);
      await closeBatch(o.pool, 0n);
      await expect(start(o.pool, o)).to.emit(o.pool, "BatchPostponed").withArgs(0n, reason);
      expect(await o.pool.phase()).to.equal(0n);
      expect(await o.pool.nextToSettle()).to.equal(0n);
    });
  }

  it("Pyth : la première mise à jour signée dans [t_k, t_k + fenêtre] est utilisée ; excédent remboursé", async function () {
    const o = await oneOrderClosed();
    await refreshOracles(o);
    await o.a3.push(A3_PRICE, 1n); // API3 hors jeu : Chainlink + Pyth poussé doivent suffire
    await closeBatch(o.pool, 0n);
    const t = await o.pool.batchDeadline(0n);
    const upd = ABI.encode(["int64", "uint64", "int32", "uint64", "uint64"], [PY_PRICE, PY_PRICE / 1000n, -8, t + 5n, t - 1n]);
    const trigger = o.signers[8];
    const before: bigint = await hre.ethers.provider.getBalance(trigger.address);
    const tx = await start(o.pool, o, trigger, [upd], 1000n);
    const r: any = await tx.wait();
    await expect(tx).to.emit(o.pool, "SettlementStarted").withArgs(0n, (CL_PRICE + PY_PRICE) / 2n / DIVISOR, 1n, CL_PRICE, PY_PRICE, 0n);
    const after: bigint = await hre.ethers.provider.getBalance(trigger.address);
    expect(before - after - BigInt(r.gasUsed) * BigInt(r.gasPrice)).to.equal(1n); // frais Pyth = 1 wei
  });

  it("Pyth : une mise à jour hors fenêtre est ignorée (pas de choix a posteriori)", async function () {
    const o = await oneOrderClosed();
    await refreshOracles(o);
    await o.a3.push(A3_PRICE, 1n);
    await o.py.setStored(PY_PRICE, 1n, -8, 1n);
    await closeBatch(o.pool, 0n);
    const t = await o.pool.batchDeadline(0n);
    const late = ABI.encode(["int64", "uint64", "int32", "uint64", "uint64"], [PY_PRICE, 1n, -8, t + PY_WINDOW + 1n, t + 10n]);
    await expect(start(o.pool, o, undefined, [late], 10n)).to.emit(o.pool, "BatchPostponed").withArgs(0n, 1);
  });

  it("passe un lot vide sans oracle et règle les lots strictement dans l'ordre", async function () {
    const o = await loadFixture(deployFixture);
    const a = o.signers[1];
    await o.pool.connect(a).claimFaucet();
    await closeBatch(o.pool, 0n); // lot 0 vide
    await pricesNow(o);
    await submit(o.pool, o.poolAddress, a, true, 1n); // lot 1
    expect(await o.pool.orderCount(1n)).to.equal(1n);
    await expect(o.pool.startSettlement(0, [])).to.emit(o.pool, "BatchSkippedEmpty").withArgs(0n);
    await expect(o.pool.startSettlement(0, [])).to.be.revertedWithCustomError(o.pool, "BatchNotClosed");
    await refreshOracles(o);
    await closeBatch(o.pool, 1n);
    await expect(start(o.pool, o)).to.emit(o.pool, "SettlementStarted");
  });

  it("un ordre par trader et par lot ; nouvel ordre autorisé au lot suivant", async function () {
    const o = await oneOrderClosed();
    const a = o.signers[1];
    await expect(submit(o.pool, o.poolAddress, a, true, 1n)).to.be.revertedWithCustomError(o.pool, "AlreadySubmitted");
    await closeBatch(o.pool, 0n);
    await pricesNow(o);
    await submit(o.pool, o.poolAddress, a, false, 1n);
    expect(await o.pool.orderCount(1n)).to.equal(1n);
  });

  it("attaque par rebouclage de q·prix (trouvée par Halmos) : l'ordre n'est pas exécuté", async function () {
    const o = await loadFixture(deployFixture);
    const [attacker, seller] = [o.signers[1], o.signers[2]];
    await o.pool.connect(attacker).claimFaucet();
    await o.pool.connect(seller).claimFaucet();
    // q tel que q·prix ≡ petit (mod 2^64) : sans borne, le contrôle de couverture passe.
    const q = (1n << 64n) / POOL_PRICE + 1n;
    expect((q * POOL_PRICE) % (1n << 64n) < FQ).to.equal(true); // coût rebouclé < solde QUOTE
    await submit(o.pool, o.poolAddress, attacker, true, q);
    await submit(o.pool, o.poolAddress, seller, false, 500n);
    await refreshOracles(o);
    await closeBatch(o.pool, 0n);
    await start(o.pool, o);
    await settleAll(o.pool, o.signers[3]);
    await hre.cofhe.mocks.expectPlaintext(await o.pool.lastFillOf(attacker.address), 0n);
    await hre.cofhe.mocks.expectPlaintext(await o.pool.baseBalanceOf(seller.address), FB);
    await hre.cofhe.mocks.expectPlaintext(await o.pool.quoteBalanceOf(attacker.address), FQ);
  });

  it("P3 deux vitesses : la consignation est prélevée dès la soumission (acheteur : q × plafond)", async function () {
    const o = await loadFixture(deployFixture);
    const [a, b] = [o.signers[1], o.signers[2]];
    await o.pool.connect(a).claimFaucet();
    await o.pool.connect(b).claimFaucet();
    await submit(o.pool, o.poolAddress, a, true, 10n);
    const cap = await o.pool.batchCap(0n);
    expect(cap).to.equal((POOL_PRICE * 10_300n) / 10_000n);
    await hre.cofhe.mocks.expectPlaintext(await o.pool.quoteBalanceOf(a.address), FQ - 10n * cap);
    await submit(o.pool, o.poolAddress, b, false, 4n);
    await hre.cofhe.mocks.expectPlaintext(await o.pool.baseBalanceOf(b.address), FB - 4n);
    await refreshOracles(o);
    await closeBatch(o.pool, 0n);
    await start(o.pool, o);
    await settleAll(o.pool, o.signers[3]);
    // a achète 4 au prix p : rend la consignation non utilisée ; b vend 4 entièrement.
    await hre.cofhe.mocks.expectPlaintext(await o.pool.baseBalanceOf(a.address), FB + 4n);
    await hre.cofhe.mocks.expectPlaintext(await o.pool.quoteBalanceOf(a.address), FQ - 4n * POOL_PRICE);
    await hre.cofhe.mocks.expectPlaintext(await o.pool.baseBalanceOf(b.address), FB - 4n);
    await hre.cofhe.mocks.expectPlaintext(await o.pool.quoteBalanceOf(b.address), FQ + 4n * POOL_PRICE);
  });

  it("P3 deux vitesses : prix de clôture au-dessus du plafond → aucune exécution, consignations rendues", async function () {
    const o = await loadFixture(deployFixture);
    const [a, b] = [o.signers[1], o.signers[2]];
    await o.pool.connect(a).claimFaucet();
    await o.pool.connect(b).claimFaucet();
    await submit(o.pool, o.poolAddress, a, true, 10n);
    await submit(o.pool, o.poolAddress, b, false, 10n);
    // Le marché monte de 5 % (> marge de 3 %) avant la clôture.
    await refreshOracles(o, CL_PRICE * 105n / 100n, PY_PRICE * 105n / 100n, A3_PRICE * 105n / 100n);
    await closeBatch(o.pool, 0n);
    await start(o.pool, o);
    expect(await o.pool.settlementPrice()).to.be.gt(await o.pool.batchCap(0n));
    await settleAll(o.pool, o.signers[3]);
    for (const w of [a, b]) {
      await hre.cofhe.mocks.expectPlaintext(await o.pool.lastFillOf(w.address), 0n);
      await hre.cofhe.mocks.expectPlaintext(await o.pool.baseBalanceOf(w.address), FB);
      await hre.cofhe.mocks.expectPlaintext(await o.pool.quoteBalanceOf(w.address), FQ);
    }
  });

  it("P3 : soumission à preuve unique (sens + quantité vérifiés ensemble)", async function () {
    const o = await loadFixture(deployFixture);
    const [a, b] = [o.signers[1], o.signers[2]];
    await o.pool.connect(a).claimFaucet();
    await o.pool.connect(b).claimFaucet();
    for (const [w, isBuy] of [[a, true], [b, false]] as const) {
      const c = await hre.cofhe.createClientWithBatteries(w);
      const res = (await c.encryptInputs([Encryptable.bool(isBuy), Encryptable.uint64(9n)]).setConsumingContract(o.poolAddress).execute()) as any[];
      expect(res.length).to.equal(3); // deux handles puis une signature commune
      await o.pool.connect(w).submitOrderBatched(res[0], res[1], res[2]);
    }
    await refreshOracles(o);
    await closeBatch(o.pool, 0n);
    await start(o.pool, o);
    await settleAll(o.pool, o.signers[3]);
    await hre.cofhe.mocks.expectPlaintext(await o.pool.lastFillOf(a.address), 9n);
    await hre.cofhe.mocks.expectPlaintext(await o.pool.lastFillOf(b.address), 9n);
  });

  it("rejette des paramètres de construction dangereux", async function () {
    const o = await loadFixture(deployFixture);
    const f = await hre.ethers.getContractFactory("SealedBatchPoolV2");
    await expect(f.deploy({ ...o.cfg, maxDeviationBps: 1_001n }, DIVISOR, DURATION, hre.ethers.ZeroAddress, 0n)).to.be.revertedWithCustomError(f, "BadParams");
    await expect(f.deploy({ ...o.cfg, api3Feed: hre.ethers.ZeroAddress }, DIVISOR, DURATION, hre.ethers.ZeroAddress, 0n)).to.be.revertedWithCustomError(f, "BadParams");
    await expect(f.deploy({ ...o.cfg, pythWindow: 0n }, DIVISOR, DURATION, hre.ethers.ZeroAddress, 0n)).to.be.revertedWithCustomError(f, "BadParams");
  });
});

// --------------------------------------------------------------------------------------------
// Tests de propriétés : lots aléatoires comparés à un modèle de référence en clair.
// Invariants : conservation de BASE et de QUOTE, exécutions = modèle (FIFO), aucune exécution
// au-delà de la couverture, soldes jamais « négatifs » (pas de débordement modulaire).
// --------------------------------------------------------------------------------------------
type Acc = { base: bigint; quote: bigint };

/** Modèle de référence (P3, deux vitesses) : couverture À LA SOUMISSION, acheteur au prix
 *  plafond `cap` (consignation), vendeur sur sa BASE ; si p > cap, aucune exécution. */
function referenceBatch(accs: Acc[], orders: { t: number; buy: boolean; q: bigint }[], p: bigint, cap: bigint) {
  const MAX_QTY = 10n ** 12n;
  const eff = orders.map((o) => {
    const a = accs[o.t];
    const ok = (o.buy ? a.quote >= o.q * cap : a.base >= o.q) && o.q <= MAX_QTY;
    return ok ? o.q : 0n;
  });
  const tb = orders.reduce((s, o, i) => s + (o.buy ? eff[i] : 0n), 0n);
  const ts = orders.reduce((s, o, i) => s + (o.buy ? 0n : eff[i]), 0n);
  let rb = p > cap ? 0n : tb < ts ? tb : ts;
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

  it("grand lot de 19 ordres (taille non puissance de 2), réglé par pas de 3 : conforme au modèle FIFO", async function () {
    const o = await loadFixture(deployFixture);
    const { pool, poolAddress, signers } = o;
    const r = rng(4242);
    const traders = signers.slice(1, 20);
    const accs: Acc[] = [];
    for (const t of traders) { await pool.connect(t).claimFaucet(); accs.push({ base: FB, quote: FQ }); }
    const orders = traders.map((_, i) => ({ t: i, buy: r() < 0.5, q: BigInt(1 + Math.floor(r() * (r() < 0.15 ? 20_000 : 900))) }));
    for (const x of orders) await submit(pool, poolAddress, traders[x.t], x.buy, x.q);
    await refreshOracles(o);
    await closeBatch(pool, 0n);
    await start(pool, o, signers[25]);
    await settleAll(pool, signers[26], 3);
    const fills = referenceBatch(accs, orders, POOL_PRICE, await pool.batchCap(0n));
    for (let i = 0; i < orders.length; i++) {
      await hre.cofhe.mocks.expectPlaintext(await pool.lastFillOf(traders[i].address), fills[i]);
      await hre.cofhe.mocks.expectPlaintext(await pool.baseBalanceOf(traders[i].address), accs[i].base);
      await hre.cofhe.mocks.expectPlaintext(await pool.quoteBalanceOf(traders[i].address), accs[i].quote);
    }
  });

  for (let run = 0; run < RUNS; run++) {
    const seed = 1000 + run;
    it(`scénario aléatoire n° ${run + 1} (graine ${seed}) : conservation et conformité au modèle`, async function () {
      const o = await loadFixture(deployFixture);
      const { pool, poolAddress, signers } = o;
      const r = rng(seed);
      const nTraders = 2 + Math.floor(r() * 7); // 2..8
      const traders = signers.slice(1, 1 + nTraders);
      const accs: Acc[] = [];
      for (const t of traders) {
        const claims = 1 + Math.floor(r() * 2);
        for (let c = 0; c < claims; c++) await pool.connect(t).claimFaucet();
        accs.push({ base: FB * BigInt(claims), quote: FQ * BigInt(claims) });
      }
      const p = POOL_PRICE;
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
        await refreshOracles(o);
        await closeBatch(pool, batch);
        // lots vides éventuels avant le nôtre
        while ((await pool.nextToSettle()) < batch) await pool.startSettlement(0, []);
        if (orders.length === 0) {
          await pool.startSettlement(0, []);
          continue;
        }
        await start(pool, o, signers[19]);
        await settleAll(pool, signers[18], 1 + Math.floor(r() * 4));
        const fills = referenceBatch(accs, orders, p, await pool.batchCap(batch));
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
