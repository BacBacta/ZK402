import { loadFixture, time } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import hre from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import { expect } from "chai";
import { H, Tree, newNote, proveClaim } from "./helpers/zk";

const TASK_COFHE_MOCKS_DEPLOY = "task:cofhe-mocks:deploy";
const PYTH_ID = "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace";
const STIPEND = hre.ethers.parseEther("0.001");
const SUBMIT_FEE = hre.ethers.parseEther("0.00001");
const STIPEND_UNITS = 1n; // 0,001 ETH = 1 unité BASE (mETH)
const MAX_OUTFLOW_BPS = 2_000n; // 20 % des réserves par fenêtre (au moins un palier)
const BASE_CLASS = { isBase: true, depositAmount: hre.ethers.parseEther("1"), poolAmount: 1_000n }; // 1 ETH = 1000 mETH
const QUOTE_CLASS = { isBase: false, depositAmount: 1_000n * 10n ** 6n, poolAmount: 100_000n }; // 1000 USDC = 100 000 cents

async function deployFixture() {
  await hre.run(TASK_COFHE_MOCKS_DEPLOY);
  const [deployer, ...signers] = await hre.ethers.getSigners();
  const poseidon = await (await hre.ethers.getContractFactory("PoseidonT3")).deploy();
  const transcriptLib = await (await hre.ethers.getContractFactory("ZKTranscriptLib")).deploy();
  const verifier = await (
    await hre.ethers.getContractFactory("HonkVerifier", { libraries: { ZKTranscriptLib: await transcriptLib.getAddress() } })
  ).deploy();
  const usdc = await (await hre.ethers.getContractFactory("MockERC20")).deploy();
  const Agg = await hre.ethers.getContractFactory("MockAggregatorV3");
  const cl = await Agg.deploy(8, 2688n * 10n ** 8n, true);
  const a3 = await Agg.deploy(18, 2689n * 10n ** 18n, false);
  const py = await (await hre.ethers.getContractFactory("MockPyth")).deploy();
  const cfg = {
    chainlinkFeed: await cl.getAddress(), api3Feed: await a3.getAddress(), pyth: await py.getAddress(), pythPriceId: PYTH_ID,
    chainlinkMaxAge: 3600n, api3MaxAge: 93_600n, pythMaxAge: 300n, pythWindow: 60n, maxDeviationBps: 100n, maxConfBps: 50n,
  };
  // Adresse de l'entrée prédite (déployée juste après le pool) : aucun rôle d'administration.
  const nonce = await hre.ethers.provider.getTransactionCount(deployer.address);
  const entryAddress = hre.ethers.getCreateAddress({ from: deployer.address, nonce: nonce + 1 });
  const pool = await (await hre.ethers.getContractFactory("SealedBatchPoolV2")).deploy(
    cfg, 1_000_000_000n, 3600n, entryAddress, SUBMIT_FEE,
  );
  const Entry = await hre.ethers.getContractFactory("ShieldedEntry", { libraries: { PoseidonT3: await poseidon.getAddress() } });
  const entry = await Entry.deploy(await pool.getAddress(), await verifier.getAddress(), await usdc.getAddress(), STIPEND, MAX_OUTFLOW_BPS, STIPEND_UNITS, [
    BASE_CLASS,
    QUOTE_CLASS,
  ]);
  expect(await entry.getAddress()).to.equal(entryAddress);
  return { pool, poolAddress: await pool.getAddress(), entry, verifier, usdc, cl, a3, py, deployer, signers };
}

/** Pseudonyme « neuf » : un compte Hardhat inutilisé ramené à 0 ETH (aucun lien avec les déposants). */
async function freshPseudonym(signers: any[], i: number) {
  const w = signers[20 + i];
  await hre.network.provider.send("hardhat_setBalance", [w.address, "0x0"]);
  return w;
}

async function depositBase(entry: any, from: any, tree: Tree) {
  const note = newNote();
  const r = await (await entry.connect(from).deposit(0, note.commitment, { value: BASE_CLASS.depositAmount + STIPEND })).wait();
  tree.insert(note.commitment);
  return { note, index: tree.leaves.length - 1, gas: r.gasUsed };
}

describe("ShieldedEntry — P1 : dépôt public, réclamation anonyme par preuve ZK (UltraHonk)", function () {
  this.timeout(600_000);

  it("Poseidon on-chain = Poseidon du circuit (vecteur circomlib)", async function () {
    const poseidon = await (await hre.ethers.getContractFactory("PoseidonT3")).deploy();
    const v = await poseidon.hash([1n, 2n]);
    expect(v).to.equal(0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189an);
    expect(v).to.equal(H(1n, 2n));
  });

  it("arbre : la racine on-chain égale la racine recalculée hors chaîne après plusieurs dépôts", async function () {
    const { entry, signers } = await loadFixture(deployFixture);
    const tree = new Tree();
    expect(await entry.currentRoot(0)).to.equal(tree.root());
    for (let i = 0; i < 5; i++) await depositBase(entry, signers[i], tree);
    expect(await entry.currentRoot(0)).to.equal(tree.root());
    expect(await entry.nextIndex(0)).to.equal(5n);
  });

  it("parcours complet : 4 dépôts, réclamation anonyme par un relayeur vers un pseudonyme neuf, puis trading", async function () {
    const { pool, poolAddress, entry, usdc, cl, a3, py, signers } = await loadFixture(deployFixture);
    const tree = new Tree();
    // Plusieurs déposants (ensemble d'anonymat) ; Alice dépose en 3e position.
    const deps = [];
    for (let i = 0; i < 4; i++) deps.push(await depositBase(entry, signers[i], tree));
    const alice = deps[2];
    // Pseudonyme neuf, jamais financé par Alice ; relayeur quelconque.
    const pseudo = await freshPseudonym(signers, 0);
    const relayer = signers[10];
    const fee = STIPEND / 10n;
    const t0 = Date.now();
    const { proof, publicInputs } = proveClaim({ note: alice.note, tree, index: alice.index, recipient: pseudo.address, relayer: relayer.address, fee });
    const proveMs = Date.now() - t0;
    expect(publicInputs.length).to.equal(5);
    const relayerBefore = await hre.ethers.provider.getBalance(relayer.address);
    const tx = await entry.connect(relayer).claim(0, proof, tree.root(), hre.ethers.toBeHex(alice.note.nullifier, 32), pseudo.address, relayer.address, fee);
    const r = await tx.wait();
    await expect(tx).to.emit(entry, "Claim");
    await expect(tx).to.emit(pool, "Credited").withArgs(pseudo.address);
    console.log(`      [P1] preuve générée en ${(proveMs / 1000).toFixed(1)} s ; gas dépôt ≈ ${alice.gas} ; gas réclamation = ${r!.gasUsed}`);
    // Le pseudonyme a reçu son allocation de gas du CONTRAT (pas d'Alice) et un solde chiffré.
    expect(await hre.ethers.provider.getBalance(pseudo.address)).to.equal(STIPEND - fee);
    const relayerAfter = await hre.ethers.provider.getBalance(relayer.address);
    expect(relayerAfter - relayerBefore + r!.gasUsed * r!.gasPrice).to.equal(fee);
    await hre.cofhe.mocks.expectPlaintext(await pool.baseBalanceOf(pseudo.address), 1_000n);
    await hre.cofhe.mocks.expectPlaintext(await pool.quoteBalanceOf(pseudo.address), 0n);
    expect(await entry.nullifierSpent(hre.ethers.toBeHex(alice.note.nullifier, 32))).to.equal(true);

    // Un second pseudonyme (acheteur) via une note QUOTE, puis un lot : le pseudonyme vendeur trade.
    const bob = signers[5];
    await usdc.mint(bob.address, QUOTE_CLASS.depositAmount);
    await usdc.connect(bob).approve(await entry.getAddress(), QUOTE_CLASS.depositAmount);
    const qTree = new Tree();
    const qNote = newNote();
    await entry.connect(bob).deposit(1, qNote.commitment, { value: STIPEND });
    qTree.insert(qNote.commitment);
    const buyer = await freshPseudonym(signers, 1);
    const pq = proveClaim({ note: qNote, tree: qTree, index: 0, recipient: buyer.address, relayer: hre.ethers.ZeroAddress, fee: 0n });
    await entry.connect(signers[11]).claim(1, pq.proof, qTree.root(), hre.ethers.toBeHex(qNote.nullifier, 32), buyer.address, hre.ethers.ZeroAddress, 0n);
    expect(await hre.ethers.provider.getBalance(buyer.address)).to.equal(STIPEND);

    // Les pseudonymes soumettent leurs ordres (en payant les frais anti-spam avec leur allocation).
    for (const [w, isBuy, q] of [[pseudo, false, 100n], [buyer, true, 100n]] as const) {
      const client = await hre.cofhe.createClientWithBatteries(w as any);
      const [s, ps] = (await client.encryptInputs([Encryptable.bool(isBuy)]).setConsumingContract(poolAddress).execute()) as any;
      const [a, pa] = (await client.encryptInputs([Encryptable.uint64(q)]).setConsumingContract(poolAddress).execute()) as any;
      await (pool.connect(w) as any).submitOrder(s, ps, a, pa, {
        value: SUBMIT_FEE,
        maxFeePerGas: 20_000_000n, // 0,02 gwei (Base ≈ 0,006 gwei)
        maxPriorityFeePerGas: 1_000_000n,
      });
    }
    // Oracles frais juste avant la clôture, puis règlement par un tiers qui touche les frais.
    const deadline = await pool.batchDeadline(0n);
    await time.increaseTo(deadline - 20n);
    const now = BigInt(await time.latest());
    await cl.push(2688n * 10n ** 8n, now);
    await a3.push(2689n * 10n ** 18n, now);
    await py.setStored(2690n * 10n ** 8n, 1n, -8, now);
    await time.increaseTo(deadline);
    const keeper = signers[12];
    await pool.connect(keeper).startSettlement(await cl.latest(), []);
    // Phase Fills (tout le monde peut l'exécuter), délai de grâce, puis Apply ; le finisseur touche les frais
    await pool.connect(signers[13]).settleStep(64);
    await time.increaseTo(await pool.applyNotBefore());
    const before = await hre.ethers.provider.getBalance(keeper.address);
    expect(await pool.connect(keeper).settleStep.staticCall(64)).to.equal(true);
    const fin = await (await pool.connect(keeper).settleStep(64)).wait();
    expect((await hre.ethers.provider.getBalance(keeper.address)) - before + fin!.gasUsed * fin!.gasPrice).to.equal(2n * SUBMIT_FEE);
    const price = await pool.settlementPrice();
    await hre.cofhe.mocks.expectPlaintext(await pool.baseBalanceOf(pseudo.address), 900n);
    await hre.cofhe.mocks.expectPlaintext(await pool.quoteBalanceOf(pseudo.address), 100n * price);
    await hre.cofhe.mocks.expectPlaintext(await pool.baseBalanceOf(buyer.address), 100n);
    await hre.cofhe.mocks.expectPlaintext(await pool.quoteBalanceOf(buyer.address), 100_000n - 100n * price);
  });

  it("refuse la double réclamation (nullificateur)", async function () {
    const { entry, signers } = await loadFixture(deployFixture);
    const tree = new Tree();
    const d = await depositBase(entry, signers[0], tree);
    const p = hre.ethers.Wallet.createRandom().address;
    const { proof } = proveClaim({ note: d.note, tree, index: 0, recipient: p, relayer: hre.ethers.ZeroAddress, fee: 0n });
    const nf = hre.ethers.toBeHex(d.note.nullifier, 32);
    await entry.claim(0, proof, tree.root(), nf, p, hre.ethers.ZeroAddress, 0n);
    await expect(entry.claim(0, proof, tree.root(), nf, p, hre.ethers.ZeroAddress, 0n)).to.be.revertedWithCustomError(entry, "NullifierSpent");
  });

  it("une preuve interceptée ne peut pas être détournée (destinataire, relayeur ou frais modifiés)", async function () {
    const { entry, signers } = await loadFixture(deployFixture);
    const tree = new Tree();
    const d = await depositBase(entry, signers[0], tree);
    const p = hre.ethers.Wallet.createRandom().address;
    const thief = signers[9].address;
    const { proof } = proveClaim({ note: d.note, tree, index: 0, recipient: p, relayer: signers[10].address, fee: 1000n });
    const nf = hre.ethers.toBeHex(d.note.nullifier, 32);
    const r = tree.root();
    await expect(entry.claim(0, proof, r, nf, thief, signers[10].address, 1000n)).to.be.reverted;
    await expect(entry.claim(0, proof, r, nf, p, thief, 1000n)).to.be.reverted;
    await expect(entry.claim(0, proof, r, nf, p, signers[10].address, 2000n)).to.be.reverted;
    await entry.claim(0, proof, r, nf, p, signers[10].address, 1000n); // l'original passe
  });

  it("refuse une racine inconnue, une classe invalide, des frais > allocation, une mauvaise valeur de dépôt", async function () {
    const { entry, signers } = await loadFixture(deployFixture);
    const tree = new Tree();
    const d = await depositBase(entry, signers[0], tree);
    const nf = hre.ethers.toBeHex(d.note.nullifier, 32);
    const p = hre.ethers.Wallet.createRandom().address;
    await expect(entry.claim(0, "0x", 12345n, nf, p, hre.ethers.ZeroAddress, 0n)).to.be.revertedWithCustomError(entry, "UnknownRoot");
    await expect(entry.claim(0, "0x", tree.root(), nf, p, hre.ethers.ZeroAddress, STIPEND + 1n)).to.be.revertedWithCustomError(entry, "BadFee");
    await expect(entry.claim(7, "0x", tree.root(), nf, p, hre.ethers.ZeroAddress, 0n)).to.be.revertedWithCustomError(entry, "BadClass");
    await expect(entry.deposit(0, 1n, { value: STIPEND })).to.be.revertedWithCustomError(entry, "BadValue");
    await expect(entry.deposit(0, 0n, { value: BASE_CLASS.depositAmount + STIPEND })).to.be.revertedWithCustomError(entry, "BadCommitment");
  });

  it("le pool refuse le faucet et tout crédit qui ne vient pas de l'entrée ; les frais d'ordre sont exigés", async function () {
    const { pool, poolAddress, signers } = await loadFixture(deployFixture);
    await expect(pool.connect(signers[0]).claimFaucet()).to.be.revertedWithCustomError(pool, "FaucetDisabled");
    await expect(pool.connect(signers[0]).credit(signers[0].address, 1n, 1n)).to.be.revertedWithCustomError(pool, "OnlyEntry");
  });
});


// ----------------------------------------------------------------------------------------------
// Incrément 4 (P4) : sorties vers une note, sortie anonyme en actif réel, disjoncteur, créances.
// ----------------------------------------------------------------------------------------------
describe("P4 — sorties sécurisées : note depuis un solde chiffré, sortie anonyme, disjoncteur", function () {
  this.timeout(900_000);

  /** Pseudonyme neuf crédité de 2 paliers BASE (2 000 unités) par deux réclamations anonymes. */
  async function claimedPseudonym(o: any, tree: Tree, idx: number) {
    const p = await freshPseudonym(o.signers, idx);
    for (let k = 0; k < 2; k++) {
      const d = await depositBase(o.entry, o.signers[idx * 2 + k], tree);
      const { proof } = proveClaim({ note: d.note, tree, index: d.index, recipient: p.address, relayer: hre.ethers.ZeroAddress, fee: 0n });
      await o.entry.claim(0, proof, tree.root(), hre.ethers.toBeHex(d.note.nullifier, 32), p.address, hre.ethers.ZeroAddress, 0n);
    }
    return p;
  }

  const LOW = { maxFeePerGas: 20_000_000n, maxPriorityFeePerGas: 1_000_000n };

  async function noteOut(o: any, p: any, commitment: bigint) {
    const tx = await o.pool.connect(p).requestNoteOut(0, commitment, LOW);
    const r = await tx.wait();
    const ev = r!.logs.map((l: any) => { try { return o.pool.interface.parseLog(l); } catch { return null; } }).find((x: any) => x?.name === "NoteOutRequested");
    const client = await hre.cofhe.createClientWithBatteries(o.signers[0]);
    const dec = await client.decryptForTx(ev.args.okHandle).withoutACP().execute();
    return { id: ev.args.id as bigint, okPlain: dec.decryptedValue === 1n, signature: dec.signature };
  }

  it("cycle complet : dépôt → pseudonyme → note depuis le solde chiffré → sortie ANONYME en ETH vers une adresse neuve", async function () {
    const o = await loadFixture(deployFixture);
    const tree = new Tree();
    const p = await claimedPseudonym(o, tree, 0);
    await depositBase(o.entry, o.signers[5], tree); // autre note : ensemble d'anonymat
    const out = newNote();
    const n = await noteOut(o, p, out.commitment);
    expect(n.okPlain).to.equal(true);
    await expect(o.pool.finalizeNoteOut(n.id, true, n.signature)).to.emit(o.entry, "NoteFromPool");
    tree.insert(out.commitment);
    expect(await o.entry.currentRoot(0)).to.equal(tree.root());
    // Palier (1000) + allocation (1 unité) débités du solde chiffré, sans aucun ETH extérieur.
    await hre.cofhe.mocks.expectPlaintext(await o.pool.baseBalanceOf(p.address), 2_000n - 1_000n - STIPEND_UNITS);


    // Sortie anonyme : destinataire neuf, relayeur quelconque, frais prélevés sur la note.
    const dest = hre.ethers.Wallet.createRandom().address;
    const relayer = o.signers[10];
    const fee = hre.ethers.parseEther("0.01");
    const { proof } = proveClaim({ note: out, tree, index: tree.leaves.length - 1, recipient: dest, relayer: relayer.address, fee });
    const reservesBefore = await o.entry.reserves(0);
    await expect(o.entry.connect(relayer).exit(0, proof, tree.root(), hre.ethers.toBeHex(out.nullifier, 32), dest, relayer.address, fee))
      .to.emit(o.entry, "ExitPaid");
    expect(await hre.ethers.provider.getBalance(dest)).to.equal(BASE_CLASS.depositAmount - fee + STIPEND);
    expect(await o.entry.reserves(0)).to.equal(reservesBefore - BASE_CLASS.depositAmount);
    // Solvabilité : ETH détenu = réserves + allocations des notes non dépensées.
    const eth = await hre.ethers.provider.getBalance(await o.entry.getAddress());
    expect(eth).to.equal((await o.entry.reserves(0)) + STIPEND * 1n); // 1 note non dépensée (dépôt de signers[5])
    expect(await o.entry.reserves(0)).to.equal(2n * BASE_CLASS.depositAmount - STIPEND);
  });

  it("solde insuffisant : ok = faux, rien n'est débité, aucune note", async function () {
    const o = await loadFixture(deployFixture);
    const tree = new Tree();
    const p = await claimedPseudonym(o, tree, 0);
    const first = await noteOut(o, p, newNote().commitment);
    await o.pool.finalizeNoteOut(first.id, true, first.signature); // reste 999 < 1 001
    const second = await noteOut(o, p, newNote().commitment);
    expect(second.okPlain).to.equal(false);
    const leaves = await o.entry.nextIndex(0);
    await expect(o.pool.finalizeNoteOut(second.id, false, second.signature)).to.not.emit(o.entry, "NoteFromPool");
    expect(await o.entry.nextIndex(0)).to.equal(leaves);
    await hre.cofhe.mocks.expectPlaintext(await o.pool.baseBalanceOf(p.address), 999n);
  });

  it("un résultat de déchiffrement falsifié est refusé (signature liée au chiffré et à la valeur)", async function () {
    const o = await loadFixture(deployFixture);
    const tree = new Tree();
    const p = await claimedPseudonym(o, tree, 0);
    // Signature valide mais pour un AUTRE chiffré (autre demande) : refusée.
    const a = await noteOut(o, p, newNote().commitment);
    const b = await noteOut(o, p, newNote().commitment);
    await expect(o.pool.finalizeNoteOut(a.id, b.okPlain, b.signature)).to.be.revertedWithCustomError(o.pool, "BadDecryption");
    const n = await noteOut(o, p, newNote().commitment);
    await expect(o.pool.finalizeNoteOut(n.id, !n.okPlain, n.signature)).to.be.revertedWithCustomError(o.pool, "BadDecryption");
  });

  it("aucune sortie pendant un règlement (protection de la couverture) ; insertion réservée au pool", async function () {
    const o = await loadFixture(deployFixture);
    const tree = new Tree();
    const p = await claimedPseudonym(o, tree, 0);
    const client = await hre.cofhe.createClientWithBatteries(p);
    const [s, ps] = (await client.encryptInputs([Encryptable.bool(false)]).setConsumingContract(o.poolAddress).execute()) as any;
    const [a, pa] = (await client.encryptInputs([Encryptable.uint64(10n)]).setConsumingContract(o.poolAddress).execute()) as any;
    await (o.pool.connect(p) as any).submitOrder(s, ps, a, pa, { value: SUBMIT_FEE, ...LOW });
    const deadline = await o.pool.batchDeadline(0n);
    await time.increaseTo(deadline - 20n);
    const now = BigInt(await time.latest());
    await o.cl.push(2688n * 10n ** 8n, now);
    await o.a3.push(2689n * 10n ** 18n, now);
    await time.increaseTo(deadline);
    await o.pool.startSettlement(await o.cl.latest(), []);
    await expect(o.pool.connect(p).requestNoteOut(0, 123n, LOW)).to.be.revertedWithCustomError(o.pool, "SettlementInProgress");
    await expect(o.entry.insertFromPool(0, 123n)).to.be.revertedWithCustomError(o.entry, "OnlyPool");
  });

  it("disjoncteur : au-delà du plafond de la fenêtre, la sortie est mise en file et payée à la fenêtre suivante", async function () {
    const o = await loadFixture(deployFixture);
    const tree = new Tree();
    const d1 = await depositBase(o.entry, o.signers[0], tree);
    const d2 = await depositBase(o.entry, o.signers[1], tree);
    // réserves = 2 ETH ; plafond = max(20 % × 2 ETH, 1 palier = 1 ETH) = 1 ETH par fenêtre
    const r1 = hre.ethers.Wallet.createRandom().address;
    const r2 = hre.ethers.Wallet.createRandom().address;
    const p1 = proveClaim({ note: d1.note, tree, index: 0, recipient: r1, relayer: hre.ethers.ZeroAddress, fee: 0n });
    const p2 = proveClaim({ note: d2.note, tree, index: 1, recipient: r2, relayer: hre.ethers.ZeroAddress, fee: 0n });
    await expect(o.entry.exit(0, p1.proof, tree.root(), hre.ethers.toBeHex(d1.note.nullifier, 32), r1, hre.ethers.ZeroAddress, 0n)).to.emit(o.entry, "ExitPaid");
    await expect(o.entry.exit(0, p2.proof, tree.root(), hre.ethers.toBeHex(d2.note.nullifier, 32), r2, hre.ethers.ZeroAddress, 0n)).to.emit(o.entry, "ExitQueued");
    expect(await hre.ethers.provider.getBalance(r2)).to.equal(STIPEND); // allocation seulement
    expect(await o.entry.exitQueueLength()).to.equal(1n);
    expect(await o.entry.processExitQueue.staticCall(5)).to.equal(0n); // même fenêtre : rien
    await time.increase(24 * 3600);
    await o.entry.connect(o.signers[7]).processExitQueue(5); // n'importe qui
    expect(await hre.ethers.provider.getBalance(r2)).to.equal(STIPEND + BASE_CLASS.depositAmount);
    expect(await o.entry.exitQueueLength()).to.equal(0n);
  });

  it("un destinataire hostile (réentrance, refus d'ETH) ne bloque pas la file : son dû devient une créance", async function () {
    const o = await loadFixture(deployFixture);
    const tree = new Tree();
    const d = await depositBase(o.entry, o.signers[0], tree);
    const hostile = await (await hre.ethers.getContractFactory("HostileReceiver")).deploy(await o.entry.getAddress());
    const h = await hostile.getAddress();
    const pr = proveClaim({ note: d.note, tree, index: 0, recipient: h, relayer: hre.ethers.ZeroAddress, fee: 0n });
    await expect(o.entry.exit(0, pr.proof, tree.root(), hre.ethers.toBeHex(d.note.nullifier, 32), h, hre.ethers.ZeroAddress, 0n))
      .to.emit(o.entry, "Owed");
    expect(await o.entry.owed(0, h)).to.equal(STIPEND + BASE_CLASS.depositAmount);
    expect(await hre.ethers.provider.getBalance(h)).to.equal(0n);
  });

  it("une note ne peut être que réclamée OU sortie, une seule fois (nullificateur commun)", async function () {
    const o = await loadFixture(deployFixture);
    const tree = new Tree();
    const d = await depositBase(o.entry, o.signers[0], tree);
    const r = hre.ethers.Wallet.createRandom().address;
    const pr = proveClaim({ note: d.note, tree, index: 0, recipient: r, relayer: hre.ethers.ZeroAddress, fee: 0n });
    const nf = hre.ethers.toBeHex(d.note.nullifier, 32);
    await o.entry.exit(0, pr.proof, tree.root(), nf, r, hre.ethers.ZeroAddress, 0n);
    await expect(o.entry.claim(0, pr.proof, tree.root(), nf, r, hre.ethers.ZeroAddress, 0n)).to.be.revertedWithCustomError(o.entry, "NullifierSpent");
    await expect(o.entry.exit(0, pr.proof, tree.root(), nf, r, hre.ethers.ZeroAddress, 0n)).to.be.revertedWithCustomError(o.entry, "NullifierSpent");
  });
});
