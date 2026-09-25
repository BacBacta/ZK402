// Portefeuille privé d'un agent pour le pool JOIN-SPLIT (notes v2 avec propriétaire).
//
// Clés : sk (dépense, secrète), pk = H(sk, 0), nk = H(sk, 1) (clé de nullificateur), paire
// X25519 de réception. Adresse privée : "zk402:" + hex(pk) + hex(clé publique X25519).
// CLÉ DE CONSULTATION : "zk402view:" + hex(pk) + hex(nk) + hex(clé privée X25519) — permet à un
// auditeur de reconstituer TOUT l'historique (dépôts, notes reçues, dépenses, monnaie, solde)
// sans pouvoir dépenser (il lui manque sk).
// Note : C = H(H(pk, blinding), montant) ; nullificateur = H(nk, C).
// Blindings déterministes (retrouvables avec la clé de consultation) :
//  - dépôt n° i : HKDF(nk, "deposit" || i) ;
//  - monnaie rendue (toujours la sortie n° 1) : HKDF(nk, nullificateur d'entrée n° 0), et son
//    montant est chiffré dans les 8 derniers octets du message joint ;
//  - note pour autrui : dérivée du secret X25519 partagé (40 premiers octets du message).
//
// - sync() : reconstruit l'arbre depuis les ÉVÉNEMENTS on-chain (Deposited, Transacted),
//   vérifie la racine, DÉCHIFFRE les messages joints aux transactions pour trouver les notes
//   reçues (et les vérifie : l'engagement recalculé doit être dans l'arbre), repère les notes
//   dépensées ;
// - depositIx(...) : dépôt vers soi ou vers une adresse privée ;
// - pay(req) : paiement public au prix exact (x402), monnaie rendue en note privée ;
// - transfer(adresse, montant, ...) : paiement PRIVÉ en note, chiffrée pour le destinataire.
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cp = require("child_process");
const web3 = require("@solana/web3.js");
const spl = require("@solana/spl-token");
const { poseidon2: H } = require("../contracts/node_modules/poseidon-lite");

const DEPTH = 20;
const disc = (p, n) => crypto.createHash("sha256").update(`${p}:${n}`).digest().subarray(0, 8);
const be32 = (x) => Buffer.from(BigInt(x).toString(16).padStart(64, "0"), "hex");
const toBig = (b) => BigInt("0x" + Buffer.from(b).toString("hex"));
const u64le = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const pkField = (pk) => { const b = Buffer.from(pk.toBytes()); b[0] = 0; return toBig(b); };
const rand = () => toBig(crypto.randomBytes(31));
const EV_DEP = disc("event", "Deposited"), EV_TX = disc("event", "Transacted");

// --- Chiffrement (sans étiquette d'authentification : l'intégrité est assurée par le
// recalcul de l'engagement, qui doit être celui publié dans la même transaction).
// Message joint à `transact` : [part destinataire 40 o : clé éphémère X25519 32 + montant 8]
// (paiement privé seulement) + [part monnaie 8 o : montant]. 48 o (transfert) ou 8 o (paiement).
const SPKI_X25519 = Buffer.from("302a300506032b656e032100", "hex");
const PKCS8_X25519 = Buffer.from("302e020100300506032b656e04220420", "hex");
const rawPub = (k) => k.export({ format: "der", type: "spki" }).subarray(-32);
const rawPriv = (k) => k.export({ format: "der", type: "pkcs8" }).subarray(-32);
const pubFromRaw = (raw) => crypto.createPublicKey({ key: Buffer.concat([SPKI_X25519, raw]), format: "der", type: "spki" });
const privFromRaw = (raw) => crypto.createPrivateKey({ key: Buffer.concat([PKCS8_X25519, raw]), format: "der", type: "pkcs8" });
function kdf(ikm, salt, info) {
  const okm = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, info, 39));
  return { blinding: toBig(okm.subarray(0, 31)), ks: okm.subarray(31, 39) };
}
const xor8 = (a, b) => Buffer.from(a.map((x, i) => x ^ b[i]));
const amt8 = (a) => be32(a).subarray(24);
/** Part destinataire : renvoie { part (40 o), blinding }. */
function encryptNote(recipientEncPub, amount) {
  const eph = crypto.generateKeyPairSync("x25519"), ephRaw = rawPub(eph.publicKey);
  const { blinding, ks } = kdf(crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: pubFromRaw(recipientEncPub) }), ephRaw, "zk402-note-v3");
  return { part: Buffer.concat([ephRaw, xor8(amt8(amount), ks)]), blinding };
}
function decryptNote(encPriv, part) {
  try {
    const eph = part.subarray(0, 32);
    const { blinding, ks } = kdf(crypto.diffieHellman({ privateKey: encPriv, publicKey: pubFromRaw(eph) }), eph, "zk402-note-v3");
    return { amount: toBig(xor8(part.subarray(32, 40), ks)), blinding };
  } catch { return null; }
}
const changeKdf = (nk, nul0) => kdf(be32(nk), be32(nul0), "zk402-change-v3");
const depositKdf = (nk, i) => kdf(be32(nk), Buffer.from(`deposit:${i}`), "zk402-deposit-v3");

const noteFor = (pk, amount, blinding = rand()) => { const inner = H([pk, blinding]); return { pk, blinding, amount: BigInt(amount), inner, c: H([inner, BigInt(amount)]) }; };
function parseAddress(a) {
  if (!a.startsWith("zk402:") || a.length !== 6 + 128) throw new Error("adresse privée invalide");
  return { pk: toBig(Buffer.from(a.slice(6, 70), "hex")), enc: Buffer.from(a.slice(70), "hex") };
}

class ShieldedWallet {
  /** `viewingKey` (optionnel) : mode AUDITEUR, lecture seule, sans clé de dépense. */
  constructor({ rpc, programId, pool, vault, mint, circuitDir, nargo, sunspot, name, viewingKey }) {
    Object.assign(this, { rpc, programId, pool, vault, mint, circuitDir, nargo, sunspot, name: name || "wallet" });
    if (viewingKey) {
      if (!viewingKey.startsWith("zk402view:") || viewingKey.length !== 10 + 192) throw new Error("clé de consultation invalide");
      this.sk = null; this.pk = toBig(Buffer.from(viewingKey.slice(10, 74), "hex")); this.nk = toBig(Buffer.from(viewingKey.slice(74, 138), "hex"));
      const priv = privFromRaw(Buffer.from(viewingKey.slice(138), "hex"));
      this.enc = { privateKey: priv, publicKey: crypto.createPublicKey(priv) };
    } else {
      this.sk = rand(); this.pk = H([this.sk, 0n]); this.nk = H([this.sk, 1n]);
      this.enc = crypto.generateKeyPairSync("x25519");
    }
    this.notes = []; this.leaves = []; this.proofs = 0; this.received = []; this.deposits = 0; this.history = [];
  }
  address() { return "zk402:" + be32(this.pk).toString("hex") + rawPub(this.enc.publicKey).toString("hex"); }
  viewingKey() { return "zk402view:" + be32(this.pk).toString("hex") + be32(this.nk).toString("hex") + rawPriv(this.enc.privateKey).toString("hex"); }
  own(n) { return { ...n, nullifier: H([this.nk, n.c]), index: null, spent: false }; }

  depositIx(depositor, screener, depositorToken, amount) {
    const { blinding } = depositKdf(this.nk, this.deposits++);
    const n = this.own(noteFor(this.pk, amount, blinding));
    this.notes.push(n);
    return new web3.TransactionInstruction({ programId: this.programId, data: Buffer.concat([disc("global", "deposit"), be32(n.inner), u64le(amount)]), keys: [
      { pubkey: depositor, isSigner: true, isWritable: false }, { pubkey: screener, isSigner: true, isWritable: false },
      { pubkey: this.pool, isSigner: false, isWritable: true }, { pubkey: this.vault, isSigner: false, isWritable: true },
      { pubkey: depositorToken, isSigner: false, isWritable: true }, { pubkey: spl.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }] });
  }

  async sync() {
    let sigs = [], before;
    for (;;) {
      const page = await this.rpc.getSignaturesForAddress(this.pool, { before, limit: 1000 }, "confirmed");
      sigs = sigs.concat(page); if (page.length < 1000) break; before = page[page.length - 1].signature;
    }
    const leaves = new Map(), nullifiers = new Set(), events = [];
    this.rejectedMemos = 0;
    for (const s of sigs.reverse()) {
      if (s.err) continue;
      const tx = await this.rpc.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
      const stack = [];
      for (const l of tx?.meta?.logMessages ?? []) {
        let m;
        if ((m = l.match(/^Program (\w+) invoke/))) { stack.push(m[1]); continue; }
        if (/^Program (\w+) (success|failed)/.test(l)) { stack.pop(); continue; }
        if (!l.startsWith("Program data: ") || stack[stack.length - 1] !== this.programId.toBase58()) continue;
        const d = Buffer.from(l.slice(14), "base64");
        if (d.subarray(0, 8).equals(EV_DEP)) {
          const c = toBig(d.subarray(8, 40)), index = d.readUInt32LE(40), amount = d.readBigUInt64LE(44);
          leaves.set(index, c); events.push({ kind: "deposit", c, index, amount, sig: s.signature, time: s.blockTime });
        } else if (d.subarray(0, 8).equals(EV_TX)) {
          const nuls = [toBig(d.subarray(8, 40)), toBig(d.subarray(40, 72))];
          nuls.forEach((x) => nullifiers.add(x));
          const first = d.readUInt32LE(136), outs = [toBig(d.subarray(72, 104)), toBig(d.subarray(104, 136))];
          leaves.set(first, outs[0]); leaves.set(first + 1, outs[1]);
          const withdraw = d.readBigUInt64LE(140), fee = d.readBigUInt64LE(148), len = d.readUInt32LE(156);
          // compte payé publiquement : 4e compte de l'instruction `transact`
          const ix = tx.transaction.message.compiledInstructions.find((i) => keys.get(i.programIdIndex).equals(this.programId));
          const recipientToken = ix ? keys.get(ix.accountKeyIndexes[3]).toBase58() : null;
          events.push({ kind: "transact", nuls, outs, first, withdraw, fee, memo: d.subarray(160, 160 + len), recipientToken, sig: s.signature, time: s.blockTime });
        }
      }
    }
    this.leaves = [...leaves.keys()].sort((a, b) => a - b).map((i, k) => { if (i !== k) throw new Error(`feuille ${k} manquante`); return leaves.get(i); });
    const d = (await this.rpc.getAccountInfo(this.pool)).data; const ri = d.readUInt32LE(8 + 96 + 4);
    const onchain = toBig(d.subarray(8 + 96 + 8 + ri * 32, 8 + 96 + 8 + (ri + 1) * 32));
    if (this.root() !== onchain) throw new Error("racine reconstruite ≠ racine on-chain");

    // Reconnaissance de MES notes (avec pk, nk et la clé X25519 : fonctionne aussi pour l'auditeur).
    const mine = new Map(this.notes.map((n) => [n.c, n]));
    const add = (n) => { if (!mine.has(n.c)) { const o = this.own(n); mine.set(n.c, o); this.notes.push(o); } return mine.get(n.c); };
    const history = []; let maxDeposit = -1;
    for (const e of events) {
      if (e.kind === "deposit") {
        for (let i = 0; i < 64; i++) {
          const n = noteFor(this.pk, e.amount, depositKdf(this.nk, i).blinding);
          if (n.c === e.c) { add(n); maxDeposit = Math.max(maxDeposit, i); history.push({ type: "dépôt", amount: e.amount, sig: e.sig }); break; }
        }
        continue;
      }
      const spentMine = e.nuls.map((x) => [...mine.values()].find((n) => n.nullifier === x)).filter(Boolean);
      // part destinataire (48 o) → note reçue en sortie n° 0
      if (e.memo.length === 48) {
        const p = decryptNote(this.enc.privateKey, e.memo.subarray(0, 40));
        const n = p && noteFor(this.pk, p.amount, p.blinding);
        if (n && n.c === e.outs[0] && spentMine.length === 0) { add(n); this.received.push({ amount: n.amount, sig: e.sig }); history.push({ type: "note reçue", amount: n.amount, sig: e.sig }); }
        else if (p && spentMine.length === 0 && n && n.c !== e.outs[0]) this.rejectedMemos++;
      }
      if (spentMine.length) {
        const inSum = spentMine.reduce((a, n) => a + n.amount, 0n);
        let change = 0n;
        if (e.memo.length >= 8) {
          const k = changeKdf(this.nk, e.nuls[0]);
          const amount = toBig(xor8(e.memo.subarray(e.memo.length - 8), k.ks));
          const n = noteFor(this.pk, amount, k.blinding);
          if (n.c === e.outs[1]) { add(n); change = amount; }
        }
        const sentPrivately = inSum - change - e.withdraw - e.fee;
        history.push({ type: "dépense", spent: inSum, publicPayment: e.withdraw, paidTo: e.withdraw > 0n ? e.recipientToken : null,
          privateNoteSent: sentPrivately, fee: e.fee, change, sig: e.sig });
      }
    }
    this.deposits = Math.max(this.deposits, maxDeposit + 1);
    for (const n of this.notes) { const i = this.leaves.findIndex((c) => c === n.c); n.index = i >= 0 ? i : null; n.spent = nullifiers.has(n.nullifier); }
    this.history = history;
    return { leaves: this.leaves.length, root: onchain };
  }

  path(index) {
    const zeros = [0n]; for (let i = 0; i < DEPTH; i++) zeros.push(H([zeros[i], zeros[i]]));
    let level = this.leaves.slice(); const p = [], bits = []; let idx = index;
    for (let i = 0; i < DEPTH; i++) {
      p.push(idx % 2 ? level[idx - 1] : (level[idx + 1] ?? zeros[i])); bits.push(idx % 2 === 1);
      const next = []; for (let j = 0; j < level.length; j += 2) next.push(H([level[j], level[j + 1] ?? zeros[i]]));
      level = next; idx = Math.floor(idx / 2);
    }
    return { path: p, bits, root: level[0] };
  }
  root() { return this.path(0).root; }
  spendable() { return this.notes.filter((n) => n.index !== null && !n.spent && n.amount > 0n); }
  balance() { return this.spendable().reduce((s, n) => s + n.amount, 0n); }

  selectInputs(need) {
    const notes = this.spendable().sort((a, b) => (a.amount < b.amount ? -1 : 1));
    const one = notes.find((n) => n.amount >= need);
    if (one) return [one];
    for (let i = 0; i < notes.length; i++) for (let j = i + 1; j < notes.length; j++) if (notes[i].amount + notes[j].amount >= need) return [notes[i], notes[j]];
    throw new Error(`solde privé insuffisant (${this.balance()} < ${need})`);
  }

  /** Construit et prouve une transaction join-split. `makeOuts(nul0)` renvoie les 2 notes de
   *  sortie (la monnaie dépend du nullificateur d'entrée n° 0). */
  build(ins, makeOuts, withdraw, fee, recipientToken, relayerToken) {
    if (!this.sk) throw new Error("mode auditeur : clé de dépense absente");
    const dummySk = rand();
    const inputs = ins.length === 2 ? ins : [ins[0], { ...noteFor(H([dummySk, 0n]), 0n), sk: dummySk, dummy: true }];
    const sks = inputs.map((n) => (n.dummy ? n.sk : this.sk));
    const nulls = inputs.map((n, k) => H([H([sks[k], 1n]), n.c]));
    const outs = makeOuts(nulls[0]);
    const paths = inputs.map((n) => (n.dummy ? { path: Array(DEPTH).fill(0n), bits: Array(DEPTH).fill(false) } : this.path(n.index)));
    return { outs, ...this.prove({
      in_sk: sks, in_blinding: inputs.map((n) => n.blinding), in_amount: inputs.map((n) => n.amount),
      in_path: paths.map((p) => p.path), in_bits: paths.map((p) => p.bits),
      out_inner: outs.map((n) => n.inner), out_amount: outs.map((n) => n.amount),
      root: this.root(), nullifiers: nulls, out_commitments: outs.map((n) => n.c),
      withdraw, fee, recipient: pkField(recipientToken), relayer: pkField(relayerToken),
    }) };
  }
  change(nul0, amount) { const k = changeKdf(this.nk, nul0); return { note: this.own(noteFor(this.pk, amount, k.blinding)), part: xor8(amt8(amount), k.ks) }; }

  /** Paiement x402 : withdraw = prix exact vers payTo ; monnaie (sortie n° 1) rendue à soi. */
  pay(req) {
    const price = BigInt(req.amount), fee = BigInt(req.extra.fee);
    const ins = this.selectInputs(price + fee), rest = ins.reduce((s, n) => s + n.amount, 0n) - price - fee;
    let ch;
    const t0 = Date.now();
    const recipientToken = spl.getAssociatedTokenAddressSync(new web3.PublicKey(req.asset), new web3.PublicKey(req.payTo));
    const { proof, pw } = this.build(ins, (nul0) => { ch = this.change(nul0, rest); return [noteFor(this.pk, 0n), ch.note]; },
      price, fee, recipientToken, new web3.PublicKey(req.extra.feeRecipient));
    this.notes.push(ch.note);
    return { payload: { proof: proof.toString("base64"), publicWitness: pw.toString("base64"), recipientOwner: req.payTo, memo: ch.part.toString("base64") },
      spent: ins.map((n) => n.amount), change: rest, proveMs: Date.now() - t0 };
  }

  /** Paiement PRIVÉ en note vers une adresse zk402 (aucun montant public). */
  transfer(toAddress, amount, fee, relayer /* { owner, token } */) {
    const to = parseAddress(toAddress);
    const ins = this.selectInputs(BigInt(amount) + BigInt(fee)), rest = ins.reduce((s, n) => s + n.amount, 0n) - BigInt(amount) - BigInt(fee);
    const enc = encryptNote(to.enc, amount), out = noteFor(to.pk, amount, enc.blinding);
    let ch;
    const t0 = Date.now();
    const { proof, pw } = this.build(ins, (nul0) => { ch = this.change(nul0, rest); return [out, ch.note]; }, 0n, BigInt(fee), relayer.token, relayer.token);
    this.notes.push(ch.note);
    return { payload: { proof: proof.toString("base64"), publicWitness: pw.toString("base64"), recipientOwner: relayer.owner.toBase58(),
      memo: Buffer.concat([enc.part, ch.part]).toString("base64") }, change: rest, proveMs: Date.now() - t0, commitment: out.c, out };
  }

  prove(inp) {
    const arr = (a) => `[${a.map((x) => (typeof x === "boolean" ? x : `"${x}"`)).join(", ")}]`;
    const arr2 = (a) => `[${a.map(arr).join(", ")}]`;
    const toml = [`in_sk = ${arr(inp.in_sk)}`, `in_blinding = ${arr(inp.in_blinding)}`, `in_amount = ${arr(inp.in_amount)}`,
      `in_path = ${arr2(inp.in_path)}`, `in_bits = ${arr2(inp.in_bits)}`, `out_inner = ${arr(inp.out_inner)}`, `out_amount = ${arr(inp.out_amount)}`,
      `root = "${inp.root}"`, `nullifiers = ${arr(inp.nullifiers)}`, `out_commitments = ${arr(inp.out_commitments)}`,
      `withdraw = "${inp.withdraw}"`, `fee = "${inp.fee}"`, `recipient = "${inp.recipient}"`, `relayer = "${inp.relayer}"`].join("\n") + "\n";
    const tag = `${this.name}_${++this.proofs}`, t = path.join(this.circuitDir, "target"), dir = path.join(t, "runs");
    fs.writeFileSync(path.join(this.circuitDir, `Prover_${tag}.toml`), toml);
    cp.execFileSync(this.nargo, ["execute", `w_${tag}`, "-p", `Prover_${tag}`], { cwd: this.circuitDir, stdio: "pipe" });
    fs.mkdirSync(dir, { recursive: true });
    fs.copyFileSync(path.join(t, "joinsplit.ccs"), path.join(dir, `${tag}.ccs`));
    cp.execFileSync(this.sunspot, ["prove", path.join(t, "joinsplit.json"), path.join(t, `w_${tag}.gz`), path.join(dir, `${tag}.ccs`), path.join(t, "joinsplit.pk")], { stdio: "pipe" });
    return { proof: fs.readFileSync(path.join(dir, `${tag}.proof`)), pw: fs.readFileSync(path.join(dir, `${tag}.pw`)) };
  }
}

module.exports = { ShieldedWallet, encryptNote, decryptNote, parseAddress, noteFor };
