// Portefeuille privé d'un agent pour le pool JOIN-SPLIT.
// - sync() : reconstruit l'arbre à partir des ÉVÉNEMENTS on-chain (Deposited, Transacted) du
//   programme, vérifie que la racine obtenue est celle du compte Pool, localise ses notes et
//   repère celles déjà dépensées (nullificateurs publiés) ;
// - depositIx(amount) : nouvelle note, instruction de dépôt (signée par le déposant) ;
// - pay(req) : paie EXACTEMENT req.amount à req.payTo + les frais du facilitateur, en
//   dépensant 1 ou 2 notes ; la monnaie revient dans une nouvelle note privée.
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
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const pkField = (pk) => { const b = Buffer.from(pk.toBytes()); b[0] = 0; return toBig(b); };
const rand = () => toBig(crypto.randomBytes(31));
const EV_DEP = disc("event", "Deposited"), EV_TX = disc("event", "Transacted");

function newNote(amount) {
  const nk = rand(), secret = rand(), inner = H([nk, secret]), c = H([inner, BigInt(amount)]);
  return { nk, secret, amount: BigInt(amount), inner, c, nullifier: H([nk, c]), index: null, spent: false };
}

class ShieldedWallet {
  constructor({ rpc, programId, pool, vault, mint, circuitDir, nargo, sunspot, name }) {
    Object.assign(this, { rpc, programId, pool, vault, mint, circuitDir, nargo, sunspot, name: name || "wallet" });
    this.notes = []; this.leaves = []; this.proofs = 0;
  }

  depositIx(depositor, depositorToken, amount) {
    const n = newNote(amount); this.notes.push(n);
    return new web3.TransactionInstruction({ programId: this.programId, data: Buffer.concat([disc("global", "deposit"), be32(n.inner), u64(amount)]), keys: [
      { pubkey: depositor, isSigner: true, isWritable: false }, { pubkey: this.pool, isSigner: false, isWritable: true },
      { pubkey: this.vault, isSigner: false, isWritable: true }, { pubkey: depositorToken, isSigner: false, isWritable: true },
      { pubkey: spl.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }] });
  }

  async sync() {
    // 1. Toutes les transactions touchant le pool, de la plus ancienne à la plus récente.
    let sigs = [], before;
    for (;;) {
      const page = await this.rpc.getSignaturesForAddress(this.pool, { before, limit: 1000 }, "confirmed");
      sigs = sigs.concat(page); if (page.length < 1000) break; before = page[page.length - 1].signature;
    }
    const leaves = new Map(), nullifiers = new Set();
    for (const s of sigs.reverse()) {
      if (s.err) continue;
      const tx = await this.rpc.getTransaction(s.signature, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
      // Événements émis par NOTRE programme uniquement (on suit la pile d'appels des journaux).
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
          const first = d.readUInt32LE(136);
          leaves.set(first, toBig(d.subarray(72, 104))); leaves.set(first + 1, toBig(d.subarray(104, 136)));
        }
      }
    }
    this.leaves = [...leaves.keys()].sort((a, b) => a - b).map((i, k) => { if (i !== k) throw new Error(`feuille ${k} manquante`); return leaves.get(i); });
    // 2. La racine reconstruite doit être la racine courante du compte Pool.
    const d = (await this.rpc.getAccountInfo(this.pool)).data; const ri = d.readUInt32LE(8 + 64 + 4);
    const onchain = toBig(d.subarray(8 + 64 + 8 + ri * 32, 8 + 64 + 8 + (ri + 1) * 32));
    if (this.root() !== onchain) throw new Error("racine reconstruite ≠ racine on-chain");
    // 3. Mes notes : position dans l'arbre, dépensée ou non.
    for (const n of this.notes) {
      const i = this.leaves.findIndex((c) => c === n.c);
      n.index = i >= 0 ? i : null; n.spent = nullifiers.has(n.nullifier);
    }
    this.notes = this.notes.filter((n) => n.index !== null || !n.spent);
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

  /** Construit le paiement x402 : withdraw = prix exact vers payTo, fee au facilitateur. */
  pay(req) {
    const price = BigInt(req.amount), fee = BigInt(req.extra.fee), need = price + fee;
    const notes = this.spendable().sort((a, b) => (a.amount < b.amount ? -1 : 1));
    let ins = notes.find((n) => n.amount >= need) ? [notes.find((n) => n.amount >= need)] : null;
    if (!ins) for (let i = 0; i < notes.length && !ins; i++) for (let j = i + 1; j < notes.length && !ins; j++) if (notes[i].amount + notes[j].amount >= need) ins = [notes[i], notes[j]];
    if (!ins) throw new Error(`solde privé insuffisant (${this.balance()} < ${need})`);
    const inputs = ins.length === 2 ? ins : [ins[0], { ...newNote(0n), dummy: true }];
    const change = newNote(inputs[0].amount + (inputs[1].amount ?? 0n) - need), empty = newNote(0n);
    const paths = inputs.map((n) => (n.dummy ? { path: Array(DEPTH).fill(0n), bits: Array(DEPTH).fill(false) } : this.path(n.index)));
    const recipientToken = spl.getAssociatedTokenAddressSync(new web3.PublicKey(req.asset), new web3.PublicKey(req.payTo));
    const inp = {
      in_nk: inputs.map((n) => n.nk), in_secret: inputs.map((n) => n.secret), in_amount: inputs.map((n) => n.amount),
      in_path: paths.map((p) => p.path), in_bits: paths.map((p) => p.bits),
      out_inner: [change.inner, empty.inner], out_amount: [change.amount, 0n],
      root: this.root(), nullifiers: inputs.map((n) => n.nullifier), out_commitments: [change.c, empty.c],
      withdraw: price, fee, recipient: pkField(recipientToken), relayer: pkField(new web3.PublicKey(req.extra.feeRecipient)),
    };
    const t0 = Date.now();
    const { proof, pw } = this.prove(inp);
    this.notes.push(change); // la monnaie sera localisée au prochain sync()
    return { payload: { proof: proof.toString("base64"), publicWitness: pw.toString("base64"), recipientOwner: req.payTo },
      spent: ins.map((n) => n.amount), change: change.amount, proveMs: Date.now() - t0 };
  }

  prove(inp) {
    const arr = (a) => `[${a.map((x) => (typeof x === "boolean" ? x : `"${x}"`)).join(", ")}]`;
    const arr2 = (a) => `[${a.map(arr).join(", ")}]`;
    const toml = [`in_nk = ${arr(inp.in_nk)}`, `in_secret = ${arr(inp.in_secret)}`, `in_amount = ${arr(inp.in_amount)}`,
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

module.exports = { ShieldedWallet, newNote };
