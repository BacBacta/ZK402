// x402 au PRIX EXACT avec le pool join-split (schéma « shielded-joinsplit »).
// L'agent dépose 1,00 une seule fois, puis paie deux API à des prix arbitraires ; la monnaie
// reste privée dans le pool. Le portefeuille resynchronise l'arbre depuis les événements.
// Tests : paiement A (0,137) ; paiement B (0,042) avec la monnaie de A ; rejeu → 402 ;
// sous-paiement → 402 ; paiement fait pour B présenté à A → 402 ; soldes ; agent absent.
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const web3 = require("@solana/web3.js");
const spl = require("@solana/spl-token");
const L = require("@lightprotocol/stateless.js");
const { createJoinSplitRelayer } = require("./relayer-js");
const { ShieldedWallet } = require("./shielded-wallet");
const x402 = require("./x402");

const SCRATCH = process.env.SCRATCH || "/tmp/claude-0/-home-user-ZK402/43d32747-df7e-5df0-afc3-9fd3ed17f379/scratchpad";
const RPC = process.env.RPC || "http://127.0.0.1:8899";
const LOCAL = RPC.includes("127.0.0.1");
const NETWORK = LOCAL ? "solana-localnet" : "solana-devnet", SCHEME = "shielded-joinsplit";
const rpc = LOCAL ? L.createRpc(RPC, "http://127.0.0.1:8784", "http://127.0.0.1:3001", { commitment: "confirmed" }) : L.createRpc(RPC, RPC, RPC, { commitment: "confirmed" });
const funder = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.KEYPAIR || path.join(os.homedir(), ".config/solana/devnet.json"), "utf8"))));
const PROGRAM_ID = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(__dirname, "jspool/target/deploy/jspool-keypair.json"), "utf8")))).publicKey;
const UNIT = 1_000_000n, FEE = 5_000n, PORTS = { fac: 8791, a: 8792, b: 8793 };
const disc = (n) => crypto.createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);
const sendTx = (ixs, signers) => web3.sendAndConfirmTransaction(rpc, new web3.Transaction().add(...ixs), signers, { commitment: "confirmed" });

(async () => {
  const out = { date: new Date().toISOString(), rpc: RPC.replace(/api-key=[^&]+/, "api-key=…"), network: NETWORK, scheme: SCHEME, program: PROGRAM_ID.toBase58() };
  const agent = web3.Keypair.generate(), facKp = web3.Keypair.generate();
  const sellerA = web3.Keypair.generate().publicKey, sellerB = web3.Keypair.generate().publicKey;
  await sendTx([web3.SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: agent.publicKey, lamports: 10_000_000 }),
    web3.SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: facKp.publicKey, lamports: 80_000_000 })], [funder]);

  // Pool neuf (jeton de test 6 décimales)
  const mint = await spl.createMint(rpc, funder, funder.publicKey, null, 6);
  const [pool] = web3.PublicKey.findProgramAddressSync([Buffer.from("pool"), mint.toBuffer()], PROGRAM_ID);
  const vault = await spl.createAccount(rpc, funder, mint, pool, web3.Keypair.generate());
  await sendTx([new web3.TransactionInstruction({ programId: PROGRAM_ID, data: disc("initialize"), keys: [
    { pubkey: funder.publicKey, isSigner: true, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: pool, isSigner: false, isWritable: true }, { pubkey: vault, isSigner: false, isWritable: false },
    { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false }] })], [funder]);
  const funderAta = await spl.createAssociatedTokenAccount(rpc, funder, mint, funder.publicKey);
  const agentAta = await spl.createAssociatedTokenAccount(rpc, funder, mint, agent.publicKey);
  // Chaque vendeur crée une fois son compte de jetons de réception (comme un compte bancaire).
  const sellerC = web3.Keypair.generate().publicKey; // vendeur SANS compte de jetons
  for (const s of [sellerA, sellerB]) await spl.createAssociatedTokenAccount(rpc, funder, mint, s);
  await spl.mintTo(rpc, funder, mint, funderAta, funder, 5n * UNIT);
  await spl.mintTo(rpc, funder, mint, agentAta, funder, UNIT);

  const opts = { rpc, programId: PROGRAM_ID, pool, vault, mint, circuitDir: path.join(__dirname, "joinsplit"),
    nargo: process.env.NARGO || `${SCRATCH}/nargo22/nargo`, sunspot: process.env.SUNSPOT || `${SCRATCH}/sunspot-bin` };
  const others = new ShieldedWallet({ ...opts, name: "autres" }), wallet = new ShieldedWallet({ ...opts, name: "agent" });
  await sendTx([others.depositIx(funder.publicKey, funderAta, 2n * UNIT)], [funder]);
  await sendTx([wallet.depositIx(agent.publicKey, agentAta, UNIT)], [agent]); // l'agent dépose 1,00 une fois
  await sendTx([others.depositIx(funder.publicKey, funderAta, 700_000n)], [funder]);
  const s0 = await wallet.sync();
  out.afterDeposits = { leaves: s0.leaves, agentPrivateBalance: String(wallet.balance()) };
  console.log(`dépôts synchronisés depuis les événements : ${s0.leaves} feuilles, racine OK ; solde privé agent ${wallet.balance()}`);

  // Facilitateur + vendeurs (prix arbitraires)
  const relayer = createJoinSplitRelayer({ rpc, local: LOCAL, keypair: facKp, programId: PROGRAM_ID, mint, pool, vault, minFee: FEE });
  await relayer.init();
  const fac = x402.facilitatorServer(relayer, { network: NETWORK, scheme: SCHEME });
  await new Promise((r) => fac.listen(PORTS.fac, "127.0.0.1", r));
  const reqFor = (payTo, resource, price) => ({ scheme: SCHEME, network: NETWORK, asset: mint.toBase58(), payTo: payTo.toBase58(), amount: String(price),
    resource, description: "donnée payante", maxTimeoutSeconds: 60,
    extra: { program: PROGRAM_ID.toBase58(), pool: pool.toBase58(), fee: String(FEE), feeRecipient: relayer.relayerToken.toBase58(), decimals: 6 } });
  const seller = (payTo, resource, price, body) => x402.sellerServer({ facilitatorUrl: `http://127.0.0.1:${PORTS.fac}`, requirements: reqFor(payTo, resource, price), resource: () => body });
  const sA = seller(sellerA, "/weather", 137_000n, { city: "Paris", tempC: 17 });
  const sB = seller(sellerB, "/price", 42_000n, { pair: "SOL/USD", price: 116 });
  await new Promise((r) => sA.listen(PORTS.a, "127.0.0.1", r));
  await new Promise((r) => sB.listen(PORTS.b, "127.0.0.1", r));

  const log = (label, r, extra = {}) => {
    console.log(`${label}: HTTP ${r.status} ${r.status === 200 ? JSON.stringify(r.body) + " tx=" + r.paymentResponse?.transaction : r.body.error}`);
    return { status: r.status, body: r.body, paymentResponse: r.paymentResponse ?? null, ...extra };
  };
  const urlA = `http://127.0.0.1:${PORTS.a}/weather`, urlB = `http://127.0.0.1:${PORTS.b}/price`;
  let info = {};
  const payFn = (req) => { const p = wallet.pay(req); info = p; console.log(`  preuve en ${p.proveMs} ms ; notes dépensées ${p.spent}, monnaie ${p.change}`); return p.payload; };

  // 1. Paiement A au prix exact (0,137) → monnaie 0,858
  const t0 = Date.now();
  const r1 = await x402.fetchWithPayment(urlA, payFn, SCHEME);
  out.payA = log("agent → A (0,137)", r1, { totalMs: Date.now() - t0, change: String(info.change), proveMs: info.proveMs });
  // 2. Rejeu du même paiement
  out.replayA = log("rejeu → A", await x402.retryWith(urlA, r1.paymentPayload, r1.requirements));
  // 3. Sous-paiement : l'agent triche sur le prix (0,100 au lieu de 0,137)
  await wallet.sync();
  const reqA = r1.requirements;
  const cheat = wallet.pay({ ...reqA, amount: "100000" }); wallet.notes.pop();
  out.underpay = log("sous-paiement → A", await x402.retryWith(urlA, { x402Version: 2, scheme: SCHEME, network: NETWORK, payload: cheat.payload }, reqA));
  // 4. Paiement construit pour B présenté à A, puis à B (payé avec la monnaie de A)
  const reqB = (await (await fetch(urlB)).json()).accepts[0];
  const pb = wallet.pay(reqB);
  const payloadB = { x402Version: 2, scheme: SCHEME, network: NETWORK, payload: pb.payload };
  out.wrongSeller = log("paiement pour B présenté à A", await x402.retryWith(urlA, payloadB, reqB));
  out.payB = log("le même paiement → B (0,042)", await x402.retryWith(urlB, payloadB, reqB), { spent: pb.spent.map(String), change: String(pb.change) });

  // 5. Vendeur sans compte de jetons → refus propre, note non brûlée
  const sC = seller(sellerC, "/news", 10_000n, { title: "…" });
  await new Promise((r) => sC.listen(PORTS.b + 1, "127.0.0.1", r));
  const reqC = (await (await fetch(`http://127.0.0.1:${PORTS.b + 1}/news`)).json()).accepts[0];
  await wallet.sync();
  const pc = wallet.pay(reqC); wallet.notes.pop();
  out.sellerWithoutAccount = log("vendeur sans compte de jetons", await x402.retryWith(`http://127.0.0.1:${PORTS.b + 1}/news`, { x402Version: 2, scheme: SCHEME, network: NETWORK, payload: pc.payload }, reqC));
  sC.close();

  // Vérifications
  await wallet.sync();
  const bal = async (owner) => { try { return String((await spl.getAccount(rpc, spl.getAssociatedTokenAddressSync(mint, owner))).amount); } catch { return "0"; } };
  out.balances = { sellerA: await bal(sellerA), sellerB: await bal(sellerB), facilitator: String((await spl.getAccount(rpc, relayer.relayerToken)).amount),
    vault: String((await spl.getAccount(rpc, vault)).amount), agentPrivateBalance: String(wallet.balance()), agentPublicTokens: await bal(agent.publicKey) };
  out.expected = { sellerA: "137000", sellerB: "42000", facilitator: "10000", vault: String(3_700_000n - 189_000n), agentPrivateBalance: String(UNIT - 189_000n), agentPublicTokens: "0" };
  out.agentInPaymentTxs = false;
  for (const sig of [out.payA.paymentResponse?.transaction, out.payB.paymentResponse?.transaction].filter(Boolean)) {
    const tx = await rpc.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses }).keySegments().flat().map((k) => k.toBase58());
    if (keys.includes(agent.publicKey.toBase58()) || keys.includes(agentAta.toBase58())) out.agentInPaymentTxs = true;
    out[sig === out.payA.paymentResponse?.transaction ? "txA" : "txB"] = { computeUnits: tx.meta.computeUnitsConsumed, fee: tx.meta.fee };
  }
  console.log(JSON.stringify({ balances: out.balances, expected: out.expected, agentInPaymentTxs: out.agentInPaymentTxs }));
  fs.writeFileSync(path.join(__dirname, `results-x402-joinsplit-${LOCAL ? "local" : "devnet"}.json`), JSON.stringify(out, null, 2) + "\n");
  for (const s of [fac, sA, sB]) s.close();
})();
