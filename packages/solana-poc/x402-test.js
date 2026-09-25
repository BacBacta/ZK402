// Test de bout en bout x402 « shielded-note » sur Solana : un agent paie deux API (vendeurs A
// et B) avec des notes du pool blindé, via un facilitateur (le relayeur).
// Tests : paiement → 200 ; rejeu du même paiement → 402 ; paiement fait pour B présenté à A →
// 402 (et la note n'est pas brûlée) ; puis ce paiement accepté par B ; soldes ; l'agent
// n'apparaît dans aucune transaction de paiement.
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
const x402 = require("./x402");

const SCRATCH = process.env.SCRATCH || "/tmp/claude-0/-home-user-ZK402/43d32747-df7e-5df0-afc3-9fd3ed17f379/scratchpad";
const NARGO = process.env.NARGO || `${SCRATCH}/nargo22/nargo`;
const SUNSPOT = process.env.SUNSPOT || `${SCRATCH}/sunspot-bin`;
const RPC = process.env.RPC || "http://127.0.0.1:8899";
const LOCAL = RPC.includes("127.0.0.1");
const NETWORK = LOCAL ? "solana-localnet" : "solana-devnet";
const rpc = LOCAL
  ? L.createRpc(RPC, "http://127.0.0.1:8784", "http://127.0.0.1:3001", { commitment: "confirmed" })
  : L.createRpc(RPC, RPC, RPC, { commitment: "confirmed" });
const funder = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.KEYPAIR || path.join(os.homedir(), ".config/solana/devnet.json"), "utf8"))));
const PROGRAM_ID = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(__dirname, "pool/target/deploy/pool-keypair.json"), "utf8")))).publicKey;
const DEPTH = 20, DENOM = 1_000_000n, FEE = 20_000n, PRICE = DENOM - FEE;
const PORTS = { fac: 8788, a: 8789, b: 8790 };
const disc = (n) => crypto.createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);
const u64 = (n) => { const b = Buffer.alloc(8); b.writeBigUInt64LE(BigInt(n)); return b; };
const be32 = (x) => Buffer.from(BigInt(x).toString(16).padStart(64, "0"), "hex");
const toBig = (b) => BigInt("0x" + Buffer.from(b).toString("hex"));
const pkField = (pk) => { const b = Buffer.from(pk.toBytes()); b[0] = 0; return toBig(b); };
const rand = () => toBig(crypto.randomBytes(31));
const sendTx = (ixs, signers) => web3.sendAndConfirmTransaction(rpc, new web3.Transaction().add(...ixs), signers, { commitment: "confirmed" });

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
function merklePath(leaves, index) {
  const zeros = [0n]; for (let i = 0; i < DEPTH; i++) zeros.push(poseidon2([zeros[i], zeros[i]]));
  let level = leaves.slice(); const p = [], bits = []; let idx = index;
  for (let i = 0; i < DEPTH; i++) {
    p.push(idx % 2 ? level[idx - 1] : (level[idx + 1] ?? zeros[i])); bits.push(idx % 2 === 1);
    const next = []; for (let j = 0; j < level.length; j += 2) next.push(poseidon2([level[j], level[j + 1] ?? zeros[i]]));
    level = next; idx = Math.floor(idx / 2);
  }
  return { path: p, index_bits: bits, root: level[0] };
}

(async () => {
  const out = { date: new Date().toISOString(), rpc: RPC.replace(/api-key=[^&]+/, "api-key=…"), network: NETWORK, program: PROGRAM_ID.toBase58(), scheme: x402.SCHEME };

  // --- Acteurs
  const agent = web3.Keypair.generate(), facKp = web3.Keypair.generate();
  const sellerA = web3.Keypair.generate().publicKey, sellerB = web3.Keypair.generate().publicKey; // jamais financés
  await sendTx([web3.SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: agent.publicKey, lamports: 20_000_000 }),
    web3.SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: facKp.publicKey, lamports: 80_000_000 })], [funder]);

  // --- Pool neuf, dépôts : leurre, NOTE 1 de l'agent, leurre, NOTE 2 de l'agent
  const mint = await spl.createMint(rpc, funder, funder.publicKey, null, 6);
  const [pool] = web3.PublicKey.findProgramAddressSync([Buffer.from("pool"), mint.toBuffer()], PROGRAM_ID);
  const vault = await spl.createAccount(rpc, funder, mint, pool, web3.Keypair.generate());
  await sendTx([new web3.TransactionInstruction({ programId: PROGRAM_ID, data: Buffer.concat([disc("initialize"), u64(DENOM)]), keys: [
    { pubkey: funder.publicKey, isSigner: true, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: pool, isSigner: false, isWritable: true }, { pubkey: vault, isSigner: false, isWritable: false },
    { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false }] })], [funder]);
  const funderAta = await spl.createAssociatedTokenAccount(rpc, funder, mint, funder.publicKey);
  const agentAta = await spl.createAssociatedTokenAccount(rpc, funder, mint, agent.publicKey);
  await spl.mintTo(rpc, funder, mint, funderAta, funder, 5n * DENOM);
  await spl.mintTo(rpc, funder, mint, agentAta, funder, 2n * DENOM);
  const depositIx = (who, ata, c) => new web3.TransactionInstruction({ programId: PROGRAM_ID, data: Buffer.concat([disc("deposit"), be32(c)]), keys: [
    { pubkey: who.publicKey, isSigner: true, isWritable: false }, { pubkey: pool, isSigner: false, isWritable: true },
    { pubkey: vault, isSigner: false, isWritable: true }, { pubkey: ata, isSigner: false, isWritable: true },
    { pubkey: spl.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false }] });
  const notes = [{ nk: rand(), secret: rand(), index: 1 }, { nk: rand(), secret: rand(), index: 3 }];
  const leaves = [poseidon2([rand(), rand()]), poseidon2([notes[0].nk, notes[0].secret]), poseidon2([rand(), rand()]), poseidon2([notes[1].nk, notes[1].secret])];
  await sendTx([depositIx(funder, funderAta, leaves[0])], [funder]);
  await sendTx([depositIx(agent, agentAta, leaves[1])], [agent]);
  await sendTx([depositIx(funder, funderAta, leaves[2])], [funder]);
  await sendTx([depositIx(agent, agentAta, leaves[3])], [agent]);

  // --- Facilitateur (relayeur) + deux vendeurs
  const relayer = createRelayer({ rpc, local: LOCAL, keypair: facKp, programId: PROGRAM_ID, mint, pool, vault, minFee: FEE, denomination: DENOM });
  await relayer.init();
  const fac = x402.facilitatorServer(relayer, { network: NETWORK });
  await new Promise((r) => fac.listen(PORTS.fac, "127.0.0.1", r));
  const reqFor = (payTo, resource) => ({ scheme: x402.SCHEME, network: NETWORK, asset: mint.toBase58(), payTo: payTo.toBase58(), amount: String(PRICE),
    resource, description: "donnée payante", maxTimeoutSeconds: 60,
    extra: { program: PROGRAM_ID.toBase58(), pool: pool.toBase58(), denomination: String(DENOM), fee: String(FEE), feeRecipient: relayer.relayerToken.toBase58() } });
  const sA = x402.sellerServer({ facilitatorUrl: `http://127.0.0.1:${PORTS.fac}`, requirements: reqFor(sellerA, "/weather"), resource: () => ({ city: "Paris", tempC: 17 }) });
  const sB = x402.sellerServer({ facilitatorUrl: `http://127.0.0.1:${PORTS.fac}`, requirements: reqFor(sellerB, "/price"), resource: () => ({ pair: "SOL/USD", price: 116 }) });
  await new Promise((r) => sA.listen(PORTS.a, "127.0.0.1", r));
  await new Promise((r) => sB.listen(PORTS.b, "127.0.0.1", r));

  // --- L'agent paie à partir de ses exigences : preuve liée au vendeur (payTo) et au facilitateur
  const payWith = (note, tag) => async (req) => {
    const t0 = Date.now();
    const recipientToken = spl.getAssociatedTokenAddressSync(new web3.PublicKey(req.asset), new web3.PublicKey(req.payTo));
    const m = merklePath(leaves, note.index);
    const p = prove(tag, { nk: note.nk, secret: note.secret, ...m, nullifier: poseidon2([note.nk, note.nk]),
      recipient: pkField(recipientToken), relayer: pkField(new web3.PublicKey(req.extra.feeRecipient)), fee: BigInt(req.extra.fee) });
    console.log(`  preuve ${tag} générée en ${Date.now() - t0} ms`);
    return { ...p, recipientOwner: req.payTo };
  };
  const log = (label, r) => {
    console.log(`${label}: HTTP ${r.status} ${r.status === 200 ? JSON.stringify(r.body) + " tx=" + r.paymentResponse?.transaction : r.body.error}`);
    return { status: r.status, body: r.body, paymentResponse: r.paymentResponse ?? null };
  };
  const t0 = Date.now();
  const r1 = await x402.fetchWithPayment(`http://127.0.0.1:${PORTS.a}/weather`, payWith(notes[0], "n1"));
  out.payA = { ...log("agent → A (note 1)", r1), totalMs: Date.now() - t0 };
  out.replayA = log("rejeu du même paiement → A", await x402.retryWith(`http://127.0.0.1:${PORTS.a}/weather`, r1.paymentPayload, r1.requirements));
  // paiement construit pour B, présenté à A
  const reqB = (await (await fetch(`http://127.0.0.1:${PORTS.b}/price`)).json()).accepts[0];
  const payloadB = { x402Version: 2, scheme: x402.SCHEME, network: NETWORK, payload: await payWith(notes[1], "n2")(reqB) };
  out.wrongSeller = log("paiement fait pour B, présenté à A", await x402.retryWith(`http://127.0.0.1:${PORTS.a}/weather`, payloadB, reqB));
  out.payB = log("le même paiement → B", await x402.retryWith(`http://127.0.0.1:${PORTS.b}/price`, payloadB, reqB));

  // --- Vérifications on-chain
  const bal = async (owner) => { try { return String((await spl.getAccount(rpc, spl.getAssociatedTokenAddressSync(mint, owner))).amount); } catch { return "0"; } };
  out.balances = { sellerA: await bal(sellerA), sellerB: await bal(sellerB), facilitator: String((await spl.getAccount(rpc, relayer.relayerToken)).amount) };
  out.agentInPaymentTxs = false;
  for (const sig of [out.payA.paymentResponse?.transaction, out.payB.paymentResponse?.transaction].filter(Boolean)) {
    const tx = await rpc.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses }).keySegments().flat().map((k) => k.toBase58());
    if (keys.includes(agent.publicKey.toBase58()) || keys.includes(agentAta.toBase58())) out.agentInPaymentTxs = true;
  }
  console.log(JSON.stringify({ balances: out.balances, agentInPaymentTxs: out.agentInPaymentTxs }));
  fs.writeFileSync(path.join(__dirname, `results-x402-${LOCAL ? "local" : "devnet"}.json`), JSON.stringify(out, null, 2) + "\n");
  for (const s of [fac, sA, sB]) s.close();
})();
