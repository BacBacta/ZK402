// Test du pool JOIN-SPLIT sur Solana : montants libres et rendu de monnaie.
// Tx1 : note A (1,00) → paiement 0,23 au vendeur + frais 0,02 + monnaie 0,75 (note C).
// Tx2 : fusion B (0,50) + C (0,75) → paiement 0,03 + frais 0,02 + notes D (1,00) et E (0,20).
// Attaques : double dépense de A (rejeu), montant retiré gonflé (preuve altérée).
// Après chaque opération : racine on-chain = racine hors chaîne.
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const cp = require("child_process");
const web3 = require("@solana/web3.js");
const spl = require("@solana/spl-token");
const L = require("@lightprotocol/stateless.js");
const { poseidon2: H } = require("../contracts/node_modules/poseidon-lite");

const SCRATCH = process.env.SCRATCH || "/tmp/claude-0/-home-user-ZK402/43d32747-df7e-5df0-afc3-9fd3ed17f379/scratchpad";
const NARGO = process.env.NARGO || `${SCRATCH}/nargo22/nargo`;
const SUNSPOT = process.env.SUNSPOT || `${SCRATCH}/sunspot-bin`;
const RPC = process.env.RPC || "http://127.0.0.1:8899";
const LOCAL = RPC.includes("127.0.0.1");
const rpc = LOCAL
  ? L.createRpc(RPC, "http://127.0.0.1:8784", "http://127.0.0.1:3001", { commitment: "confirmed" })
  : L.createRpc(RPC, RPC, RPC, { commitment: "confirmed" });
const funder = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.KEYPAIR || path.join(os.homedir(), ".config/solana/devnet.json"), "utf8"))));
const PROGRAM_ID = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(__dirname, "jspool/target/deploy/jspool-keypair.json"), "utf8")))).publicKey;
const DEPTH = 20, UNIT = 1_000_000n;
const disc = (n) => crypto.createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const be32 = (x) => Buffer.from(BigInt(x).toString(16).padStart(64, "0"), "hex");
const toBig = (b) => BigInt("0x" + Buffer.from(b).toString("hex"));
const pkField = (pk) => { const b = Buffer.from(pk.toBytes()); b[0] = 0; return toBig(b); };
const rand = () => toBig(crypto.randomBytes(31));
const sendTx = (ixs, signers) => web3.sendAndConfirmTransaction(rpc, new web3.Transaction().add(...ixs), signers, { commitment: "confirmed" });

// --- Notes
const newNote = (amount) => { const nk = rand(), secret = rand(); const inner = H([nk, secret]); const c = H([inner, amount]); return { nk, secret, amount, inner, c, nullifier: H([nk, c]) }; };
const leaves = [];
function merklePath(index) {
  const zeros = [0n]; for (let i = 0; i < DEPTH; i++) zeros.push(H([zeros[i], zeros[i]]));
  let level = leaves.slice(); const p = [], bits = []; let idx = index;
  for (let i = 0; i < DEPTH; i++) {
    p.push(idx % 2 ? level[idx - 1] : (level[idx + 1] ?? zeros[i])); bits.push(idx % 2 === 1);
    const next = []; for (let j = 0; j < level.length; j += 2) next.push(H([level[j], level[j + 1] ?? zeros[i]]));
    level = next; idx = Math.floor(idx / 2);
  }
  return { path: p, bits, root: level[0] };
}
const zeroPath = () => ({ path: Array(DEPTH).fill(0n), bits: Array(DEPTH).fill(false) });

function prove(tag, inp) {
  const arr = (a) => `[${a.map((x) => (typeof x === "boolean" ? x : `"${x}"`)).join(", ")}]`;
  const arr2 = (a) => `[${a.map(arr).join(", ")}]`;
  const toml = [
    `in_nk = ${arr(inp.in_nk)}`, `in_secret = ${arr(inp.in_secret)}`, `in_amount = ${arr(inp.in_amount)}`,
    `in_path = ${arr2(inp.in_path)}`, `in_bits = ${arr2(inp.in_bits)}`, `out_inner = ${arr(inp.out_inner)}`, `out_amount = ${arr(inp.out_amount)}`,
    `root = "${inp.root}"`, `nullifiers = ${arr(inp.nullifiers)}`, `out_commitments = ${arr(inp.out_commitments)}`,
    `withdraw = "${inp.withdraw}"`, `fee = "${inp.fee}"`, `recipient = "${inp.recipient}"`, `relayer = "${inp.relayer}"`,
  ].join("\n") + "\n";
  const circuit = path.join(__dirname, "joinsplit"), t = path.join(circuit, "target"), dir = path.join(t, "runs");
  fs.writeFileSync(path.join(circuit, `Prover_${tag}.toml`), toml);
  const t0 = Date.now();
  cp.execFileSync(NARGO, ["execute", `w_${tag}`, "-p", `Prover_${tag}`], { cwd: circuit, stdio: "pipe" });
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(t, "joinsplit.ccs"), path.join(dir, `${tag}.ccs`));
  cp.execFileSync(SUNSPOT, ["prove", path.join(t, "joinsplit.json"), path.join(t, `w_${tag}.gz`), path.join(dir, `${tag}.ccs`), path.join(t, "joinsplit.pk")], { stdio: "pipe" });
  return { proof: fs.readFileSync(path.join(dir, `${tag}.proof`)), pw: fs.readFileSync(path.join(dir, `${tag}.pw`)), ms: Date.now() - t0 };
}

(async () => {
  const out = { date: new Date().toISOString(), rpc: RPC.replace(/api-key=[^&]+/, "api-key=…"), program: PROGRAM_ID.toBase58() };
  const agent = web3.Keypair.generate(), relayerKp = web3.Keypair.generate();
  const seller = web3.Keypair.generate().publicKey;
  await sendTx([web3.SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: agent.publicKey, lamports: 20_000_000 }),
    web3.SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: relayerKp.publicKey, lamports: 80_000_000 })], [funder]);

  const mint = await spl.createMint(rpc, funder, funder.publicKey, null, 6);
  const [pool] = web3.PublicKey.findProgramAddressSync([Buffer.from("pool"), mint.toBuffer()], PROGRAM_ID);
  const vault = await spl.createAccount(rpc, funder, mint, pool, web3.Keypair.generate());
  await sendTx([new web3.TransactionInstruction({ programId: PROGRAM_ID, data: disc("initialize"), keys: [
    { pubkey: funder.publicKey, isSigner: true, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: pool, isSigner: false, isWritable: true }, { pubkey: vault, isSigner: false, isWritable: false },
    { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false }] })], [funder]);
  const funderAta = await spl.createAssociatedTokenAccount(rpc, funder, mint, funder.publicKey);
  const agentAta = await spl.createAssociatedTokenAccount(rpc, funder, mint, agent.publicKey);
  const sellerAta = await spl.createAssociatedTokenAccount(rpc, funder, mint, seller);
  const relayerAta = await spl.createAssociatedTokenAccount(rpc, funder, mint, relayerKp.publicKey);
  await spl.mintTo(rpc, funder, mint, funderAta, funder, 5n * UNIT);
  await spl.mintTo(rpc, funder, mint, agentAta, funder, 2n * UNIT);

  const onchainRoot = async () => {
    const d = (await rpc.getAccountInfo(pool)).data; const ri = d.readUInt32LE(8 + 64 + 4);
    return toBig(d.subarray(8 + 64 + 8 + ri * 32, 8 + 64 + 8 + (ri + 1) * 32));
  };
  const deposit = async (who, ata, note) => {
    await sendTx([new web3.TransactionInstruction({ programId: PROGRAM_ID, data: Buffer.concat([disc("deposit"), be32(note.inner), u64(note.amount)]), keys: [
      { pubkey: who.publicKey, isSigner: true, isWritable: false }, { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true }, { pubkey: ata, isSigner: false, isWritable: true },
      { pubkey: spl.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }] })], [who]);
    note.index = leaves.length; leaves.push(note.c);
  };
  const A = newNote(UNIT), B = newNote(UNIT / 2n);
  await deposit(funder, funderAta, newNote(UNIT));
  await deposit(agent, agentAta, A);
  await deposit(agent, agentAta, B);
  await deposit(funder, funderAta, newNote(2n * UNIT));
  out.rootAfterDeposits = (await onchainRoot()) === merklePath(0).root;
  console.log("dépôts : racine on-chain = hors chaîne :", out.rootAfterDeposits);

  // --- transaction join-split
  let lut = null;
  async function transact(label, ins, outs, withdraw, fee, mutate) {
    const root = merklePath(0).root;
    const inputs = ins.map((n) => n ?? { ...newNote(0n), dummy: true });
    const paths = inputs.map((n) => (n.dummy ? zeroPath() : merklePath(n.index)));
    const pr = prove(label.replace(/\W/g, ""), {
      in_nk: inputs.map((n) => n.nk), in_secret: inputs.map((n) => n.secret), in_amount: inputs.map((n) => n.amount),
      in_path: paths.map((p) => p.path), in_bits: paths.map((p) => p.bits),
      out_inner: outs.map((n) => n.inner), out_amount: outs.map((n) => n.amount),
      root, nullifiers: inputs.map((n) => n.nullifier), out_commitments: outs.map((n) => n.c),
      withdraw, fee, recipient: pkField(sellerAta), relayer: pkField(relayerAta),
    });
    let pw = pr.pw; if (mutate) pw = mutate(Buffer.from(pw));
    return submit(label, pr, pw, inputs, outs);
  }
  async function submit(label, pr, pw, inputs, outs) {
    // Preuve de non-existence des 2 nullificateurs (Light)
    L.featureFlags.version = L.VERSION.V2;
    const addressTree = new web3.PublicKey(L.batchAddressTree);
    const outputStateTree = LOCAL ? L.defaultTestStateTreeAccounts().merkleTree
      : L.selectStateTreeInfo((await rpc.getStateTreeInfos()).filter((i) => i.treeType === L.TreeType.StateV2)).queue;
    const addrs = inputs.map((n) => L.deriveAddressV2(L.deriveAddressSeedV2([Buffer.from("nullifier"), be32(n.nullifier)]), addressTree, PROGRAM_ID));
    let vproof;
    try { vproof = await rpc.getValidityProofV0([], addrs.map((a) => ({ tree: addressTree, queue: addressTree, address: L.bn(a.toBytes()) }))); }
    catch (e) { console.log(`${label}: preuve de non-existence refusée par l'indexeur (${e.message.slice(0, 80)})`); return { ok: false, indexerRefused: true, lightData: null }; }
    const pa = new L.PackedAccounts();
    pa.addSystemAccountsV2(L.SystemAccountMetaConfig.new(PROGRAM_ID));
    const ai = pa.insertOrGet(addressTree), oi = pa.insertOrGet(outputStateTree);
    const { remainingAccounts, systemStart } = pa.toAccountMetas();
    const c = vproof.compressedProof;
    const light = Buffer.concat([c ? Buffer.concat([Buffer.from([1]), Buffer.from(c.a), Buffer.from(c.b), Buffer.from(c.c)]) : Buffer.from([0]), Buffer.from([ai, ai]), u16(vproof.rootIndices[0]), Buffer.from([oi, systemStart])]);
    const ix = new web3.TransactionInstruction({ programId: PROGRAM_ID, data: Buffer.concat([disc("transact"), u32(pr.proof.length), pr.proof, u32(pw.length), pw, light]), keys: [
      { pubkey: relayerKp.publicKey, isSigner: true, isWritable: true }, { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true }, { pubkey: sellerAta, isSigner: false, isWritable: true },
      { pubkey: relayerAta, isSigner: false, isWritable: true }, { pubkey: spl.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ...remainingAccounts] });
    return sendIx(label, ix);
  }
  async function sendIx(label, ix) {
    const ixs = [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }), ix];
    if (!lut) {
      const keys = [...new Map([ix.programId, web3.ComputeBudgetProgram.programId, ...ix.keys.map((k) => k.pubkey)].filter((k) => !k.equals(relayerKp.publicKey)).map((k) => [k.toBase58(), k])).values()];
      const [create, addr] = web3.AddressLookupTableProgram.createLookupTable({ authority: relayerKp.publicKey, payer: relayerKp.publicKey, recentSlot: await rpc.getSlot("finalized") });
      await sendTx([create, web3.AddressLookupTableProgram.extendLookupTable({ payer: relayerKp.publicKey, authority: relayerKp.publicKey, lookupTable: addr, addresses: keys })], [relayerKp]);
      await new Promise((r) => setTimeout(r, LOCAL ? 3000 : 6000));
      lut = (await rpc.getAddressLookupTable(addr)).value;
    }
    const { blockhash } = await rpc.getLatestBlockhash();
    const vtx = new web3.VersionedTransaction(new web3.TransactionMessage({ payerKey: relayerKp.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message([lut]));
    vtx.sign([relayerKp]);
    const raw = Buffer.from(vtx.serialize());
    let sig, err = null;
    try { sig = await rpc.sendRawTransaction(raw, { skipPreflight: true }); err = (await rpc.confirmTransaction(sig, "confirmed")).value.err; } catch (e) { err = e.message; }
    let info = null;
    for (let i = 0; i < 15 && !info && sig; i++) { info = await rpc.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }); if (!info) await new Promise((r) => setTimeout(r, 1000)); }
    const logs = info?.meta?.logMessages ?? [];
    const error = err === null ? null : (logs.find((l) => l.includes("Error Message")) || logs.filter((l) => /failed/.test(l)).pop() || String(err)).slice(0, 180);
    console.log(`${label}: ok=${err === null} CU=${info?.meta?.computeUnitsConsumed} tx=${raw.length} o${error ? "  → " + error : ""}`);
    return { ok: err === null, sig, computeUnits: info?.meta?.computeUnitsConsumed ?? null, txBytes: raw.length, error, ix };
  }

  // Tx1 : A (1,00) → vendeur 0,23 + frais 0,02 + monnaie C 0,75
  const C = newNote(750_000n), Z = newNote(0n);
  const t1 = await transact("paiement avec monnaie", [A, null], [C, Z], 230_000n, 20_000n);
  C.index = leaves.length; leaves.push(C.c); leaves.push(Z.c);
  out.tx1 = { sig: t1.sig, ok: t1.ok, computeUnits: t1.computeUnits, txBytes: t1.txBytes };
  out.rootAfterTx1 = (await onchainRoot()) === merklePath(0).root;

  // Attaque : rejeu exact de Tx1 (double dépense de A)
  const r = await sendIx("rejeu de Tx1 (double dépense)", t1.ix);
  out.replayTx1 = { rejected: !r.ok, error: r.error };
  // Attaque : nouvelle preuve qui re-dépense A → l'indexeur refuse la non-existence
  const again = await transact("re-dépense de A", [A, null], [newNote(980_000n), newNote(0n)], 0n, 20_000n);
  out.respendA = { rejected: !again.ok, indexerRefused: !!again.indexerRefused };
  // Attaque : montant retiré gonflé (entrée publique « withdraw » modifiée)
  const D0 = newNote(1_000_000n), E0 = newNote(200_000n);
  const bad = await transact("retrait gonflé", [B, C], [D0, E0], 30_000n, 20_000n, (pw) => { pw[12 + 5 * 32 + 31] ^= 0x40; return pw; });
  out.inflatedWithdraw = { rejected: !bad.ok, error: bad.error };

  // Tx2 : fusion B (0,50) + C (0,75) → vendeur 0,03 + frais 0,02 + D 1,00 + E 0,20
  const D = newNote(1_000_000n), E = newNote(200_000n);
  const t2 = await transact("fusion + paiement", [B, C], [D, E], 30_000n, 20_000n);
  leaves.push(D.c); leaves.push(E.c);
  out.tx2 = { sig: t2.sig, ok: t2.ok, computeUnits: t2.computeUnits, txBytes: t2.txBytes };
  out.rootAfterTx2 = (await onchainRoot()) === merklePath(0).root;

  const bal = async (a) => String((await spl.getAccount(rpc, a)).amount);
  out.balances = { seller: await bal(sellerAta), relayer: await bal(relayerAta), vault: await bal(vault) };
  out.expected = { seller: "260000", relayer: "40000", vault: String(4_500_000n - 300_000n) };
  console.log(JSON.stringify({ roots: [out.rootAfterDeposits, out.rootAfterTx1, out.rootAfterTx2], balances: out.balances, expected: out.expected }));
  fs.writeFileSync(path.join(__dirname, `results-joinsplit-${LOCAL ? "local" : "devnet"}.json`), JSON.stringify(out, null, 2) + "\n");
})();
