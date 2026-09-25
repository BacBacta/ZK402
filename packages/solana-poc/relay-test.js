// Test de bout en bout du relayeur : le destinataire est une adresse NEUVE sans SOL ni compte ;
// le déposant ne signe rien au retrait ; le relayeur paie tout et récupère ses frais en jetons.
// Refus testés : frais trop bas, mauvais relayeur, preuve altérée, double dépense — le relayeur
// ne doit rien payer quand il refuse (simulation préalable).
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const cp = require("child_process");
const web3 = require("@solana/web3.js");
const spl = require("@solana/spl-token");
const L = require("@lightprotocol/stateless.js");
const { poseidon2 } = require("../contracts/node_modules/poseidon-lite");
const { createRelayer } = require("./relayer");

const SCRATCH = process.env.SCRATCH || "/tmp/claude-0/-home-user-ZK402/43d32747-df7e-5df0-afc3-9fd3ed17f379/scratchpad";
const NARGO = process.env.NARGO || `${SCRATCH}/nargo22/nargo`;
const SUNSPOT = process.env.SUNSPOT || `${SCRATCH}/sunspot-bin`;
const RPC = process.env.RPC || "http://127.0.0.1:8899";
const LOCAL = RPC.includes("127.0.0.1");
const rpc = LOCAL
  ? L.createRpc(RPC, "http://127.0.0.1:8784", "http://127.0.0.1:3001", { commitment: "confirmed" })
  : L.createRpc(RPC, RPC, RPC, { commitment: "confirmed" });
const funder = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.KEYPAIR || path.join(os.homedir(), ".config/solana/devnet.json"), "utf8"))));
const PROGRAM_ID = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(__dirname, "pool/target/deploy/pool-keypair.json"), "utf8")))).publicKey;
const DEPTH = 20, DENOM = 1_000_000n, MIN_FEE = 20_000n, PORT = 8787;
const disc = (n) => crypto.createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const be32 = (x) => Buffer.from(BigInt(x).toString(16).padStart(64, "0"), "hex");
const toBig = (b) => BigInt("0x" + Buffer.from(b).toString("hex"));
const pkField = (pk) => { const b = Buffer.from(pk.toBytes()); b[0] = 0; return toBig(b); };
const rand = () => toBig(crypto.randomBytes(31));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function sendTx(ixs, signers) {
  const tx = new web3.Transaction().add(...ixs);
  return web3.sendAndConfirmTransaction(rpc, tx, signers, { commitment: "confirmed" });
}
function prove(tag, inputs) {
  const toml = Object.entries(inputs).map(([k, v]) => Array.isArray(v)
    ? `${k} = [${v.map((x) => (typeof x === "boolean" ? x : `"${x}"`)).join(", ")}]` : `${k} = "${v}"`).join("\n") + "\n";
  const circuit = path.join(__dirname, "claim"), t = path.join(circuit, "target"), dir = path.join(t, "relay");
  fs.writeFileSync(path.join(circuit, `Prover_${tag}.toml`), toml);
  cp.execFileSync(NARGO, ["execute", `w_${tag}`, "-p", `Prover_${tag}`], { cwd: circuit, stdio: "pipe" });
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(path.join(t, "claim.ccs"), path.join(dir, `${tag}.ccs`));
  cp.execFileSync(SUNSPOT, ["prove", path.join(t, "claim.json"), path.join(t, `w_${tag}.gz`), path.join(dir, `${tag}.ccs`), path.join(t, "claim.pk")], { stdio: "pipe" });
  return { proof: fs.readFileSync(path.join(dir, `${tag}.proof`)).toString("base64"), publicWitness: fs.readFileSync(path.join(dir, `${tag}.pw`)).toString("base64") };
}
async function post(body) {
  const r = await fetch(`http://127.0.0.1:${PORT}/relay`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { http: r.status, ...(await r.json()) };
}

(async () => {
  const out = { date: new Date().toISOString(), rpc: RPC.replace(/api-key=[^&]+/, "api-key=…"), program: PROGRAM_ID.toBase58() };

  // --- Acteurs : déposant, relayeur, destinataire neuf (jamais financé)
  const depositor = web3.Keypair.generate(), relayerKp = web3.Keypair.generate();
  const recipientOwner = web3.Keypair.generate().publicKey;
  await sendTx([web3.SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: depositor.publicKey, lamports: 20_000_000 }),
    web3.SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: relayerKp.publicKey, lamports: 60_000_000 })], [funder]);

  // --- Pool neuf (jeton de test 6 décimales)
  const mint = await spl.createMint(rpc, funder, funder.publicKey, null, 6);
  const [pool] = web3.PublicKey.findProgramAddressSync([Buffer.from("pool"), mint.toBuffer()], PROGRAM_ID);
  const vault = await spl.createAccount(rpc, funder, mint, pool, web3.Keypair.generate());
  await sendTx([new web3.TransactionInstruction({ programId: PROGRAM_ID, data: Buffer.concat([disc("initialize"), u64(DENOM)]), keys: [
    { pubkey: funder.publicKey, isSigner: true, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: pool, isSigner: false, isWritable: true }, { pubkey: vault, isSigner: false, isWritable: false },
    { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false }] })], [funder]);
  const funderAta = await spl.createAssociatedTokenAccount(rpc, funder, mint, funder.publicKey);
  const depAta = await spl.createAssociatedTokenAccount(rpc, funder, mint, depositor.publicKey);
  await spl.mintTo(rpc, funder, mint, funderAta, funder, 5n * DENOM);
  await spl.mintTo(rpc, funder, mint, depAta, funder, DENOM);
  const depositIx = (who, ata, c) => new web3.TransactionInstruction({ programId: PROGRAM_ID, data: Buffer.concat([disc("deposit"), be32(c)]), keys: [
    { pubkey: who.publicKey, isSigner: true, isWritable: false }, { pubkey: pool, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true }, { pubkey: ata, isSigner: false, isWritable: true },
    { pubkey: spl.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }] });
  const nk = rand(), secret = rand();
  const leaves = [poseidon2([rand(), rand()]), poseidon2([nk, secret]), poseidon2([rand(), rand()])];
  await sendTx([depositIx(funder, funderAta, leaves[0])], [funder]);          // autre utilisateur
  await sendTx([depositIx(depositor, depAta, leaves[1])], [depositor]);       // NOTRE dépôt
  await sendTx([depositIx(funder, funderAta, leaves[2])], [funder]);          // autre utilisateur

  // --- Relayeur (service HTTP local)
  const relayer = createRelayer({ rpc, local: LOCAL, keypair: relayerKp, programId: PROGRAM_ID, mint, pool, vault, minFee: MIN_FEE });
  await relayer.init();
  const server = await relayer.listen(PORT);
  const info = await (await fetch(`http://127.0.0.1:${PORT}/info`)).json();
  out.relayerInfo = info;
  const relayerToken = new web3.PublicKey(info.relayerToken);
  const recipientToken = spl.getAssociatedTokenAddressSync(mint, recipientOwner);

  // --- Preuve côté utilisateur (hors chaîne, sans signature)
  const zeros = [0n]; for (let i = 0; i < DEPTH; i++) zeros.push(poseidon2([zeros[i], zeros[i]]));
  let level = leaves.slice(); const pathEls = [], bits = []; let idx = 1;
  for (let i = 0; i < DEPTH; i++) {
    pathEls.push(idx % 2 ? level[idx - 1] : (level[idx + 1] ?? zeros[i])); bits.push(idx % 2 === 1);
    const next = []; for (let j = 0; j < level.length; j += 2) next.push(poseidon2([level[j], level[j + 1] ?? zeros[i]]));
    level = next; idx = Math.floor(idx / 2);
  }
  const base = { nk, secret, path: pathEls, index_bits: bits, root: level[0], nullifier: poseidon2([nk, nk]), recipient: pkField(recipientToken) };
  const good = prove("good", { ...base, relayer: pkField(relayerToken), fee: MIN_FEE });
  const cheap = prove("cheap", { ...base, relayer: pkField(relayerToken), fee: MIN_FEE - 1n });
  const otherRel = prove("other", { ...base, relayer: pkField(web3.Keypair.generate().publicKey), fee: MIN_FEE });
  const tampered = { ...good, proof: (() => { const b = Buffer.from(good.proof, "base64"); b[40] ^= 1; return b.toString("base64"); })() };

  const lam = () => rpc.getBalance(relayerKp.publicKey);
  const check = async (label, body) => {
    const before = await lam(); const r = await post({ ...body, recipientOwner: recipientOwner.toBase58() }); await sleep(1500);
    const cost = before - (await lam());
    console.log(`${label}: HTTP ${r.http} ${r.error || r.sig}  (coût relayeur ${cost} lamports)`);
    return { http: r.http, error: r.error ?? null, sig: r.sig ?? null, relayerLamportsSpent: cost, simulatedComputeUnits: r.simulatedComputeUnits ?? null, txBytes: r.txBytes ?? null };
  };
  out.feeTooLow = await check("frais trop bas", cheap);
  out.wrongRelayer = await check("autre relayeur", otherRel);
  out.tamperedProof = await check("preuve altérée", tampered);
  out.valid = await check("retrait valide", good);
  out.doubleSpend = await check("double dépense", good);

  // --- Vérifications
  const tx = await rpc.getTransaction(out.valid.sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
  const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses }).keySegments().flat().map((k) => k.toBase58());
  out.valid.computeUnits = tx.meta.computeUnitsConsumed;
  out.valid.feePayer = keys[0];
  out.valid.depositorAppearsInWithdrawal = keys.includes(depositor.publicKey.toBase58()) || keys.includes(depAta.toBase58());
  out.valid.recipientBalance = String((await spl.getAccount(rpc, recipientToken)).amount);
  out.valid.relayerTokenBalance = String((await spl.getAccount(rpc, relayerToken)).amount);
  out.valid.recipientOwnerSol = await rpc.getBalance(recipientOwner);
  console.log(JSON.stringify(out, null, 2));
  fs.writeFileSync(path.join(__dirname, `results-relay-${LOCAL ? "local" : "devnet"}.json`), JSON.stringify(out, null, 2) + "\n");
  server.close();
})();
