// Portefeuille privé d'un agent pour le pool JOIN-SPLIT (notes v2 avec propriétaire).
//
// Clés : sk (dépense, secrète) et pk = H(sk, 0) ; paire X25519 pour recevoir des notes chiffrées.
// Adresse privée : "zk402:" + hex(pk) + hex(clé publique X25519).
// Note : C = H(H(pk, blinding), montant) ; nullificateur = H(sk, C).
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

// --- Chiffrement des notes : X25519 éphémère + HKDF-SHA256 + ChaCha20-Poly1305.
// Le blinding de la note n'est PAS transmis : émetteur et destinataire le dérivent du secret
// partagé (HKDF). Seul le montant est chiffré.
// Message = clé publique éphémère (32) || montant chiffré (8) || tag (16) = 56 octets.
const SPKI_X25519 = Buffer.from("302a300506032b656e032100", "hex");
const rawPub = (k) => k.export({ format: "der", type: "spki" }).subarray(-32);
const pubFromRaw = (raw) => crypto.createPublicKey({ key: Buffer.concat([SPKI_X25519, raw]), format: "der", type: "spki" });
function derive(shared, eph) {
  const okm = Buffer.from(crypto.hkdfSync("sha256", shared, eph, "zk402-note-v2", 63));
  return { key: okm.subarray(0, 32), blinding: toBig(okm.subarray(32, 63)) }; // 31 o < module du corps
}
/** Chiffre le montant pour `recipientEncPub` ; renvoie le message et le blinding dérivé. */
function encryptNote(recipientEncPub, amount) {
  const eph = crypto.generateKeyPairSync("x25519");
  const ephRaw = rawPub(eph.publicKey);
  const { key, blinding } = derive(crypto.diffieHellman({ privateKey: eph.privateKey, publicKey: pubFromRaw(recipientEncPub) }), ephRaw);
  const c = crypto.createCipheriv("chacha20-poly1305", key, Buffer.alloc(12), { authTagLength: 16 });
  const ct = Buffer.concat([c.update(be32(amount).subarray(24)), c.final()]);
  return { memo: Buffer.concat([ephRaw, ct, c.getAuthTag()]), blinding };
}
function decryptNote(encPriv, memo) {
  if (memo.length !== 56) return null;
  try {
    const eph = memo.subarray(0, 32);
    const { key, blinding } = derive(crypto.diffieHellman({ privateKey: encPriv, publicKey: pubFromRaw(eph) }), eph);
    const d = crypto.createDecipheriv("chacha20-poly1305", key, Buffer.alloc(12), { authTagLength: 16 });
    d.setAuthTag(memo.subarray(40, 56));
    const pt = Buffer.concat([d.update(memo.subarray(32, 40)), d.final()]);
    return { amount: toBig(pt), blinding };
  } catch { return null; }
}

const noteFor = (pk, amount, blinding = rand()) => { const inner = H([pk, blinding]); return { pk, blinding, amount: BigInt(amount), inner, c: H([inner, BigInt(amount)]) }; };
function parseAddress(a) {
  if (!a.startsWith("zk402:") || a.length !== 6 + 128) throw new Error("adresse privée invalide");
  return { pk: toBig(Buffer.from(a.slice(6, 70), "hex")), enc: Buffer.from(a.slice(70), "hex") };
}

class ShieldedWallet {
  constructor({ rpc, programId, pool, vault, mint, circuitDir, nargo, sunspot, name }) {
    Object.assign(this, { rpc, programId, pool, vault, mint, circuitDir, nargo, sunspot, name: name || "wallet" });
    this.sk = rand(); this.pk = H([this.sk, 0n]);
    this.enc = crypto.generateKeyPairSync("x25519");
    this.notes = []; this.leaves = []; this.proofs = 0; this.received = [];
  }
  address() { return "zk402:" + be32(this.pk).toString("hex") + rawPub(this.enc.publicKey).toString("hex"); }
  own(n) { return { ...n, nullifier: H([this.sk, n.c]), index: null, spent: false }; }

  depositIx(depositor, depositorToken, amount, toAddress) {
    const to = toAddress ? parseAddress(toAddress) : { pk: this.pk };
    const n = noteFor(to.pk, amount);
    if (!toAddress) this.notes.push(this.own(n));
    return new web3.TransactionInstruction({ programId: this.programId, data: Buffer.concat([disc("global", "deposit"), be32(n.inner), u64le(amount)]), keys: [
      { pubkey: depositor, isSigner: true, isWritable: false }, { pubkey: this.pool, isSigner: false, isWritable: true },
      { pubkey: this.vault, isSigner: false, isWritable: true }, { pubkey: depositorToken, isSigner: false, isWritable: true },
      { pubkey: spl.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }] });
  }

  async sync() {
    let sigs = [], before;
    for (;;) {
      const page = await this.rpc.getSignaturesForAddress(this.pool, { before, limit: 1000 }, "confirmed");
      sigs = sigs.concat(page); if (page.length < 1000) break; before = page[page.length - 1].signature;
    }
    const leaves = new Map(), nullifiers = new Set(), memos = [];
    for (const s of sigs.reverse()) {
      if (s.err) continue;
      const tx = await this.rpc.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      const stack = [];
      for (const l of tx?.meta?.logMessages ?? []) {
        let m;
        if ((m = l.match(/^Program (\w+) invoke/))) { stack.push(m[1]); continue; }
        if (/^Program (\w+) (success|failed)/.test(l)) { stack.pop(); continue; }
        if (!l.startsWith("Program data: ") || stack[stack.length - 1] !== this.programId.toBase58()) continue;
        const d = Buffer.from(l.slice(14), "base64");
        if (d.subarray(0, 8).equals(EV_DEP)) leaves.set(d.readUInt32LE(40), toBig(d.subarray(8, 40)));
        else if (d.subarray(0, 8).equals(EV_TX)) {
          nullifiers.add(toBig(d.subarray(8, 40))); nullifiers.add(toBig(d.subarray(40, 72)));
          const first = d.readUInt32LE(136), outs = [toBig(d.subarray(72, 104)), toBig(d.subarray(104, 136))];
          leaves.set(first, outs[0]); leaves.set(first + 1, outs[1]);
          const len = d.readUInt32LE(156);
          if (len) memos.push({ memo: d.subarray(160, 160 + len), outs, first, sig: s.signature });
        }
      }
    }
    this.leaves = [...leaves.keys()].sort((a, b) => a - b).map((i, k) => { if (i !== k) throw new Error(`feuille ${k} manquante`); return leaves.get(i); });
    const d = (await this.rpc.getAccountInfo(this.pool)).data; const ri = d.readUInt32LE(8 + 64 + 4);
    const onchain = toBig(d.subarray(8 + 64 + 8 + ri * 32, 8 + 64 + 8 + (ri + 1) * 32));
    if (this.root() !== onchain) throw new Error("racine reconstruite ≠ racine on-chain");
    // Notes reçues : déchiffrement, puis vérification que l'engagement est bien celui publié.
    this.scanned = memos.length; this.rejectedMemos = 0;
    for (const m of memos) {
      const p = decryptNote(this.enc.privateKey, m.memo);
      if (!p) continue;
      const n = noteFor(this.pk, p.amount, p.blinding);
      const k = m.outs.findIndex((c) => c === n.c);
      if (k < 0) { this.rejectedMemos++; continue; } // message déchiffrable mais faux : ignoré
      if (!this.notes.some((x) => x.c === n.c)) { this.notes.push(this.own(n)); this.received.push({ amount: n.amount, sig: m.sig }); }
    }
    for (const n of this.notes) {
      const i = this.leaves.findIndex((c) => c === n.c);
      n.index = i >= 0 ? i : null; n.spent = nullifiers.has(n.nullifier);
    }
    return { leaves: this.leaves.length, root: onchain, memos: memos.length };
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

  /** Construit et prouve une transaction join-split. outs = 2 notes (déjà construites). */
  build(ins, outs, withdraw, fee, recipientToken, relayerToken) {
    const dummySk = rand();
    const inputs = ins.length === 2 ? ins : [ins[0], { ...noteFor(H([dummySk, 0n]), 0n), sk: dummySk, dummy: true }];
    const sks = inputs.map((n) => (n.dummy ? n.sk : this.sk));
    const nulls = inputs.map((n, k) => H([sks[k], n.c]));
    const paths = inputs.map((n) => (n.dummy ? { path: Array(DEPTH).fill(0n), bits: Array(DEPTH).fill(false) } : this.path(n.index)));
    return this.prove({
      in_sk: sks, in_blinding: inputs.map((n) => n.blinding), in_amount: inputs.map((n) => n.amount),
      in_path: paths.map((p) => p.path), in_bits: paths.map((p) => p.bits),
      out_inner: outs.map((n) => n.inner), out_amount: outs.map((n) => n.amount),
      root: this.root(), nullifiers: nulls, out_commitments: outs.map((n) => n.c),
      withdraw, fee, recipient: pkField(recipientToken), relayer: pkField(relayerToken),
    });
  }

  /** Paiement x402 : withdraw = prix exact vers payTo ; monnaie rendue à soi. */
  pay(req) {
    const price = BigInt(req.amount), fee = BigInt(req.extra.fee);
    const ins = this.selectInputs(price + fee);
    const change = this.own(noteFor(this.pk, ins.reduce((s, n) => s + n.amount, 0n) - price - fee));
    const t0 = Date.now();
    const recipientToken = spl.getAssociatedTokenAddressSync(new web3.PublicKey(req.asset), new web3.PublicKey(req.payTo));
    const { proof, pw } = this.build(ins, [change, noteFor(this.pk, 0n)], price, fee, recipientToken, new web3.PublicKey(req.extra.feeRecipient));
    this.notes.push(change);
    return { payload: { proof: proof.toString("base64"), publicWitness: pw.toString("base64"), recipientOwner: req.payTo },
      spent: ins.map((n) => n.amount), change: change.amount, proveMs: Date.now() - t0 };
  }

  /** Paiement PRIVÉ en note vers une adresse zk402 : aucun montant public. La note est
   *  chiffrée pour le destinataire et jointe à la transaction (memo, 56 o). */
  transfer(toAddress, amount, fee, relayer /* { owner, token } */) {
    const to = parseAddress(toAddress);
    const ins = this.selectInputs(BigInt(amount) + BigInt(fee));
    const { memo, blinding } = encryptNote(to.enc, amount);
    const out = noteFor(to.pk, amount, blinding);
    const change = this.own(noteFor(this.pk, ins.reduce((s, n) => s + n.amount, 0n) - BigInt(amount) - BigInt(fee)));
    const t0 = Date.now();
    // Aucun retrait public : le « destinataire » public est un compte existant du bon mint
    // (ici celui du relayeur), qui reçoit 0.
    const { proof, pw } = this.build(ins, [out, change], 0n, BigInt(fee), relayer.token, relayer.token);
    this.notes.push(change);
    return { payload: { proof: proof.toString("base64"), publicWitness: pw.toString("base64"), recipientOwner: relayer.owner.toBase58(),
      memo: memo.toString("base64") }, change: change.amount, proveMs: Date.now() - t0, commitment: out.c, out };
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
