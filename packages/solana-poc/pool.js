// Pool blindé complet sur Solana : dépôt SPL (jeton de test 6 décimales, comme l'USDC), arbre
// de notes on-chain, preuve générée pour la racine on-chain, dépense avec paiement.
// Tests : racine on-chain = racine hors chaîne ; racine inconnue refusée ; destinataire
// substitué refusé ; dépense valide (soldes) ; double dépense refusée.
// Local : light test-validator ; RPC=http://127.0.0.1:8899. Devnet : RPC=<Helius devnet>.
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const cp = require("child_process");
const web3 = require("@solana/web3.js");
const spl = require("@solana/spl-token");
const L = require("@lightprotocol/stateless.js");
const { poseidon2 } = require("../contracts/node_modules/poseidon-lite");

const SCRATCH = process.env.SCRATCH || "/tmp/claude-0/-home-user-ZK402/43d32747-df7e-5df0-afc3-9fd3ed17f379/scratchpad";
const NARGO = process.env.NARGO || `${SCRATCH}/nargo22/nargo`;
const SUNSPOT = process.env.SUNSPOT || `${SCRATCH}/sunspot-bin`;
const RPC = process.env.RPC || "http://127.0.0.1:8899";
const LOCAL = RPC.includes("127.0.0.1");
const rpc = LOCAL
  ? L.createRpc(RPC, "http://127.0.0.1:8784", "http://127.0.0.1:3001", { commitment: "confirmed" })
  : L.createRpc(RPC, RPC, RPC, { commitment: "confirmed" });
const payer = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.KEYPAIR || path.join(os.homedir(), ".config/solana/devnet.json"), "utf8"))));
const PROGRAM_ID = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(__dirname, "pool/target/deploy/pool-keypair.json"), "utf8")))).publicKey;
const DEPTH = 20, ROOTS = 30, DENOM = 1_000_000n, FEE = 10_000n;
const disc = (n) => crypto.createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const be32 = (x) => Buffer.from(BigInt(x).toString(16).padStart(64, "0"), "hex");
const toBig = (b) => BigInt("0x" + Buffer.from(b).toString("hex"));
const pkField = (pk) => { const b = Buffer.from(pk.toBytes()); b[0] = 0; return toBig(b); };
const rand = () => toBig(crypto.randomBytes(31));

async function lightData(nullifier) {
  L.featureFlags.version = L.VERSION.V2;
  const addressTree = new web3.PublicKey(L.batchAddressTree);
  let outputStateTree;
  if (LOCAL) outputStateTree = L.defaultTestStateTreeAccounts().merkleTree;
  else outputStateTree = L.selectStateTreeInfo((await rpc.getStateTreeInfos()).filter((i) => i.treeType === L.TreeType.StateV2)).queue;
  const seed = L.deriveAddressSeedV2([Buffer.from("nullifier"), nullifier]);
  const address = L.deriveAddressV2(seed, addressTree, PROGRAM_ID);
  const proof = await rpc.getValidityProofV0([], [{ tree: addressTree, queue: addressTree, address: L.bn(address.toBytes()) }]);
  const pa = new L.PackedAccounts();
  pa.addSystemAccountsV2(L.SystemAccountMetaConfig.new(PROGRAM_ID));
  const addrIdx = pa.insertOrGet(addressTree);
  const outIdx = pa.insertOrGet(outputStateTree);
  const { remainingAccounts, systemStart } = pa.toAccountMetas();
  const c = proof.compressedProof;
  const vp = c ? Buffer.concat([Buffer.from([1]), Buffer.from(c.a), Buffer.from(c.b), Buffer.from(c.c)]) : Buffer.from([0]);
  return { data: Buffer.concat([vp, Buffer.from([addrIdx, addrIdx]), u16(proof.rootIndices[0]), Buffer.from([outIdx, systemStart])]), remainingAccounts };
}

let lut = null;
async function send(ixs, label, signers = [payer]) {
  const budget = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
  const all = [budget, ...ixs];
  const { blockhash } = await rpc.getLatestBlockhash();
  let raw, usedLut = false;
  try {
    const tx = new web3.Transaction().add(...all);
    tx.feePayer = payer.publicKey; tx.recentBlockhash = blockhash; tx.sign(...signers);
    raw = tx.serialize();
  } catch {
    if (!lut) {
      const keys = [...new Set(ixs.flatMap((ix) => [ix.programId, ...ix.keys.map((k) => k.pubkey)]).map((k) => k.toBase58()))]
        .filter((k) => k !== payer.publicKey.toBase58()).map((k) => new web3.PublicKey(k)).concat([web3.ComputeBudgetProgram.programId]);
      const slot = await rpc.getSlot("finalized");
      const [create, addr] = web3.AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey, payer: payer.publicKey, recentSlot: slot });
      const extend = web3.AddressLookupTableProgram.extendLookupTable({ payer: payer.publicKey, authority: payer.publicKey, lookupTable: addr, addresses: keys });
      await web3.sendAndConfirmTransaction(rpc, new web3.Transaction().add(create, extend), [payer], { commitment: "confirmed" });
      await new Promise((r) => setTimeout(r, LOCAL ? 3000 : 6000));
      lut = (await rpc.getAddressLookupTable(addr)).value;
    }
    const msg = new web3.TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: all }).compileToV0Message([lut]);
    const vtx = new web3.VersionedTransaction(msg); vtx.sign(signers);
    raw = Buffer.from(vtx.serialize()); usedLut = true;
  }
  let sig, err = null;
  try { sig = await rpc.sendRawTransaction(raw, { skipPreflight: true }); err = (await rpc.confirmTransaction(sig, "confirmed")).value.err; }
  catch (e) { err = e.message; }
  let info = null;
  for (let i = 0; i < 15 && !info && sig; i++) {
    info = await rpc.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!info) await new Promise((r) => setTimeout(r, 1000));
  }
  const logs = info?.meta?.logMessages ?? [];
  const r = { label, sig, ok: err === null, txBytes: raw.length, usedLookupTable: usedLut, computeUnits: info?.meta?.computeUnitsConsumed ?? null, feeLamports: info?.meta?.fee ?? null,
    error: err === null ? null : (logs.find((l) => l.includes("Error Message")) || logs.filter((l) => /failed/.test(l)).pop() || String(err)).slice(0, 200) };
  console.log(`${label}: ok=${r.ok} CU=${r.computeUnits} tx=${r.txBytes} o (LUT=${usedLut})${r.error ? "  → " + r.error : ""}`);
  return r;
}

function prove(dir, inputs) {
  const toml = Object.entries(inputs).map(([k, v]) => Array.isArray(v)
    ? `${k} = [${v.map((x) => (typeof x === "boolean" ? x : `"${x}"`)).join(", ")}]` : `${k} = "${v}"`).join("\n") + "\n";
  const circuit = path.join(__dirname, "claim");
  fs.writeFileSync(path.join(circuit, "Prover_pool.toml"), toml);
  cp.execFileSync(NARGO, ["execute", "pool_witness", "-p", "Prover_pool"], { cwd: circuit, stdio: "pipe" });
  fs.mkdirSync(dir, { recursive: true });
  const t = path.join(circuit, "target");
  fs.copyFileSync(path.join(t, "claim.ccs"), path.join(dir, "pool.ccs"));
  const t0 = Date.now();
  cp.execFileSync(SUNSPOT, ["prove", path.join(t, "claim.json"), path.join(t, "pool_witness.gz"), path.join(dir, "pool.ccs"), path.join(t, "claim.pk")], { stdio: "pipe" });
  return { proof: fs.readFileSync(path.join(dir, "pool.proof")), pw: fs.readFileSync(path.join(dir, "pool.pw")), ms: Date.now() - t0 };
}

(async () => {
  const out = { date: new Date().toISOString(), rpc: RPC.replace(/api-key=[^&]+/, "api-key=…"), program: PROGRAM_ID.toBase58() };
  const lam0 = await rpc.getBalance(payer.publicKey);

  // 1. Jeton de test (6 décimales), comptes, coffre, pool
  const mint = await spl.createMint(rpc, payer, payer.publicKey, null, 6);
  const [poolPda] = web3.PublicKey.findProgramAddressSync([Buffer.from("pool"), mint.toBuffer()], PROGRAM_ID);
  const vaultKp = web3.Keypair.generate();
  const vault = await spl.createAccount(rpc, payer, mint, poolPda, vaultKp);
  const payerAta = await spl.createAssociatedTokenAccount(rpc, payer, mint, payer.publicKey);
  await spl.mintTo(rpc, payer, mint, payerAta, payer, 10n * DENOM);
  const recipientOwner = web3.Keypair.generate().publicKey; // adresse neuve, sans lien avec le déposant
  const recipientAta = await spl.createAssociatedTokenAccount(rpc, payer, mint, recipientOwner);
  const relayerAta = payerAta; // le relayeur (ici le payeur) reçoit les frais
  const other = await spl.createAccount(rpc, payer, mint, web3.Keypair.generate().publicKey, web3.Keypair.generate());
  out.mint = mint.toBase58(); out.pool = poolPda.toBase58(); out.vault = vault.toBase58();

  const r0 = await send([new web3.TransactionInstruction({ programId: PROGRAM_ID, data: Buffer.concat([disc("initialize"), u64(DENOM)]), keys: [
    { pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: poolPda, isSigner: false, isWritable: true }, { pubkey: vault, isSigner: false, isWritable: false },
    { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false }] })], "initialize");
  out.initialize = { ok: r0.ok, computeUnits: r0.computeUnits };

  // 2. Deux dépôts : un leurre, puis notre note
  const nk = rand(), secret = rand();
  const leaves = [poseidon2([rand(), rand()]), poseidon2([nk, secret])];
  const depositIx = (c) => new web3.TransactionInstruction({ programId: PROGRAM_ID, data: Buffer.concat([disc("deposit"), be32(c)]), keys: [
    { pubkey: payer.publicKey, isSigner: true, isWritable: false }, { pubkey: poolPda, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true }, { pubkey: payerAta, isSigner: false, isWritable: true },
    { pubkey: spl.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }] });
  out.deposits = [];
  for (const c of leaves) { const r = await send([depositIx(c)], "dépôt"); out.deposits.push({ sig: r.sig, ok: r.ok, computeUnits: r.computeUnits }); }

  // 3. Racine on-chain vs racine recalculée hors chaîne
  const zeros = [0n]; for (let i = 0; i < DEPTH; i++) zeros.push(poseidon2([zeros[i], zeros[i]]));
  let level = leaves.slice(); const pathEls = []; const bits = []; let idx = 1;
  for (let i = 0; i < DEPTH; i++) {
    const sib = idx % 2 ? level[idx - 1] : (level[idx + 1] ?? zeros[i]);
    pathEls.push(sib); bits.push(idx % 2 === 1);
    const next = []; for (let j = 0; j < level.length; j += 2) next.push(poseidon2([level[j], level[j + 1] ?? zeros[i]]));
    level = next; idx = Math.floor(idx / 2);
  }
  const root = level[0];
  const acc = (await rpc.getAccountInfo(poolPda)).data;
  const rootIndex = acc.readUInt32LE(8 + 32 + 32 + 8 + 4);
  const onchainRoot = toBig(acc.subarray(8 + 32 + 32 + 8 + 8 + rootIndex * 32, 8 + 32 + 32 + 8 + 8 + (rootIndex + 1) * 32));
  out.rootMatches = onchainRoot === root; out.vaultAfterDeposits = String((await spl.getAccount(rpc, vault)).amount);
  console.log("racine on-chain = racine hors chaîne :", out.rootMatches, " coffre :", out.vaultAfterDeposits);

  // 4. Preuve pour la racine on-chain, liée au destinataire, au relayeur et aux frais
  const nullifier = poseidon2([nk, nk]);
  const pr = prove(path.join(__dirname, "claim/target/pool"), {
    nk, secret, path: pathEls, index_bits: bits, root, nullifier,
    recipient: pkField(recipientAta), relayer: pkField(relayerAta), fee: FEE,
  });
  out.proveMs = pr.ms;
  const spendIx = (proof, pw, light, recipient) => new web3.TransactionInstruction({ programId: PROGRAM_ID,
    data: Buffer.concat([disc("spend"), u32(proof.length), proof, u32(pw.length), pw, light.data]), keys: [
      { pubkey: payer.publicKey, isSigner: true, isWritable: true }, { pubkey: poolPda, isSigner: false, isWritable: false },
      { pubkey: vault, isSigner: false, isWritable: true }, { pubkey: recipient, isSigner: false, isWritable: true },
      { pubkey: relayerAta, isSigner: false, isWritable: true }, { pubkey: spl.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ...light.remainingAccounts] });
  const nullBytes = be32(nullifier);

  // 5a. Preuve valide mais pour une AUTRE racine (ancien test) → refus
  const oldProof = fs.readFileSync(path.join(__dirname, "claim/target/claim.proof"));
  const oldPw = fs.readFileSync(path.join(__dirname, "claim/target/claim.pw"));
  const ra = await send([spendIx(oldProof, oldPw, await lightData(oldPw.subarray(44, 76)), recipientAta)], "racine inconnue");
  out.unknownRoot = { rejected: !ra.ok, error: ra.error };
  // 5b. Bonne preuve, mais on paie un autre compte que le destinataire prouvé → refus
  const rb = await send([spendIx(pr.proof, pr.pw, await lightData(nullBytes), other)], "destinataire substitué");
  out.recipientSwap = { rejected: !rb.ok, error: rb.error };
  // 5c. Dépense valide
  const l = await lightData(nullBytes);
  const rc = await send([spendIx(pr.proof, pr.pw, l, recipientAta)], "dépense valide");
  const bal = async (a) => String((await spl.getAccount(rpc, a)).amount);
  out.validSpend = { sig: rc.sig, ok: rc.ok, computeUnits: rc.computeUnits, txBytes: rc.txBytes, usedLookupTable: rc.usedLookupTable, feeLamports: rc.feeLamports,
    recipientBalance: await bal(recipientAta), vaultBalance: await bal(vault), relayerBalance: await bal(relayerAta) };
  // 5d. Double dépense (rejeu)
  const rd = await send([spendIx(pr.proof, pr.pw, l, recipientAta)], "double dépense");
  out.doubleSpend = { rejected: !rd.ok, error: rd.error };

  out.totalLamportsSpentByScript = lam0 - (await rpc.getBalance(payer.publicKey));
  fs.writeFileSync(path.join(__dirname, `results-pool-${LOCAL ? "local" : "devnet"}.json`), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
})();
