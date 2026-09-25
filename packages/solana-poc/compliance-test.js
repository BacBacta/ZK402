// Conformité du pool join-split (Solana devnet) :
//  1. dépôts FILTRÉS : le programme exige la co-signature du contrôleur du pool ; le contrôleur
//     refuse un déposant sanctionné ;
//  2. paiements : le facilitateur refuse un destinataire sanctionné ;
//  3. CLÉ DE CONSULTATION : un auditeur reconstitue tout l'historique d'Alice (et la note reçue
//     par Bob) sans pouvoir dépenser ; un tiers sans clé ne voit rien.
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const web3 = require("@solana/web3.js");
const spl = require("@solana/spl-token");
const L = require("@lightprotocol/stateless.js");
const { createJoinSplitRelayer } = require("./relayer-js");
const { ShieldedWallet } = require("./shielded-wallet");
const { createScreener } = require("./compliance");

const SCRATCH = process.env.SCRATCH || "/tmp/claude-0/-home-user-ZK402/43d32747-df7e-5df0-afc3-9fd3ed17f379/scratchpad";
const RPC = process.env.RPC || "http://127.0.0.1:8899";
const LOCAL = RPC.includes("127.0.0.1");
const rpc = LOCAL ? L.createRpc(RPC, "http://127.0.0.1:8784", "http://127.0.0.1:3001", { commitment: "confirmed" }) : L.createRpc(RPC, RPC, RPC, { commitment: "confirmed" });
const funder = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.KEYPAIR || path.join(os.homedir(), ".config/solana/devnet.json"), "utf8"))));
const PROGRAM_ID = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(__dirname, "jspool/target/deploy/jspool-keypair.json"), "utf8")))).publicKey;
const UNIT = 1_000_000n, FEE = 5_000n;
const disc = (n) => crypto.createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);
const sendTx = (ixs, signers) => web3.sendAndConfirmTransaction(rpc, new web3.Transaction().add(...ixs), signers, { commitment: "confirmed" });
const s = (x) => String(x);
const fmt = (h) => JSON.parse(JSON.stringify(h, (k, v) => (typeof v === "bigint" ? String(v) : v)));

(async () => {
  const out = { date: new Date().toISOString(), rpc: RPC.replace(/api-key=[^&]+/, "api-key=…"), program: PROGRAM_ID.toBase58() };
  const screenerKp = web3.Keypair.generate(), aliceKp = web3.Keypair.generate(), malloryKp = web3.Keypair.generate(), facKp = web3.Keypair.generate();
  const seller = web3.Keypair.generate().publicKey, sanctionedSeller = web3.Keypair.generate().publicKey;
  await sendTx([aliceKp, malloryKp].map((k) => web3.SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: k.publicKey, lamports: 10_000_000 }))
    .concat([web3.SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: facKp.publicKey, lamports: 80_000_000 })]), [funder]);

  // Pool avec contrôleur
  const mint = await spl.createMint(rpc, funder, funder.publicKey, null, 6);
  const [pool] = web3.PublicKey.findProgramAddressSync([Buffer.from("pool"), mint.toBuffer()], PROGRAM_ID);
  const vault = await spl.createAccount(rpc, funder, mint, pool, web3.Keypair.generate());
  await sendTx([new web3.TransactionInstruction({ programId: PROGRAM_ID, data: Buffer.concat([disc("initialize"), screenerKp.publicKey.toBuffer()]), keys: [
    { pubkey: funder.publicKey, isSigner: true, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: pool, isSigner: false, isWritable: true }, { pubkey: vault, isSigner: false, isWritable: false },
    { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false }] })], [funder]);
  const funderAta = await spl.createAssociatedTokenAccount(rpc, funder, mint, funder.publicKey);
  const aliceAta = await spl.createAssociatedTokenAccount(rpc, funder, mint, aliceKp.publicKey);
  const malloryAta = await spl.createAssociatedTokenAccount(rpc, funder, mint, malloryKp.publicKey);
  for (const o of [seller, sanctionedSeller]) await spl.createAssociatedTokenAccount(rpc, funder, mint, o);
  await spl.mintTo(rpc, funder, mint, funderAta, funder, 5n * UNIT);
  await spl.mintTo(rpc, funder, mint, aliceAta, funder, UNIT);
  await spl.mintTo(rpc, funder, mint, malloryAta, funder, UNIT);

  const screener = createScreener({ keypair: screenerKp, denylist: new Set([malloryKp.publicKey.toBase58()]) });
  const opts = { rpc, programId: PROGRAM_ID, pool, vault, mint, circuitDir: path.join(__dirname, "joinsplit"),
    nargo: process.env.NARGO || `${SCRATCH}/nargo22/nargo`, sunspot: process.env.SUNSPOT || `${SCRATCH}/sunspot-bin` };
  const alice = new ShieldedWallet({ ...opts, name: "alice" }), bob = new ShieldedWallet({ ...opts, name: "bob" });
  const mallory = new ShieldedWallet({ ...opts, name: "mallory" }), others = new ShieldedWallet({ ...opts, name: "autres" });
  const carol = new ShieldedWallet({ ...opts, name: "carol" });

  async function deposit(wallet, kp, ata, amount, { skipScreener = false, fakeScreener = null } = {}) {
    const tx = new web3.Transaction().add(wallet.depositIx(kp.publicKey, fakeScreener ? fakeScreener.publicKey : screener.publicKey, ata, amount));
    tx.feePayer = kp.publicKey; tx.recentBlockhash = (await rpc.getLatestBlockhash()).blockhash;
    if (fakeScreener) tx.partialSign(fakeScreener);
    else if (!skipScreener) { const r = screener.cosignDeposit(tx, kp.publicKey); if (!r.ok) { wallet.notes.pop(); return { ok: false, stage: "contrôleur", reason: r.reason }; } }
    tx.partialSign(kp);
    try {
      const sig = await rpc.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      const err = (await rpc.confirmTransaction(sig, "confirmed")).value.err;
      if (err) {
        wallet.notes.pop();
        const logs = (await rpc.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }))?.meta?.logMessages ?? [];
        return { ok: false, stage: "programme", reason: (logs.find((l) => l.includes("Error Message")) || JSON.stringify(err)).slice(0, 160), sig };
      }
      return { ok: true, sig };
    } catch (e) { wallet.notes.pop(); return { ok: false, stage: "transaction", reason: e.message.slice(0, 120) }; }
  }

  // 1. Dépôts filtrés
  out.malloryScreened = await deposit(mallory, malloryKp, malloryAta, UNIT);
  console.log("Mallory (sanctionnée) demande un dépôt :", JSON.stringify(out.malloryScreened));
  out.mallorySelfSigned = await deposit(mallory, malloryKp, malloryAta, UNIT, { fakeScreener: malloryKp });
  console.log("Mallory contourne le contrôleur (se désigne elle-même) :", JSON.stringify(out.mallorySelfSigned));
  out.aliceDeposit = await deposit(alice, aliceKp, aliceAta, UNIT);
  await deposit(others, funder, funderAta, 2n * UNIT);
  console.log("Alice dépose 1,00 (co-signé) :", out.aliceDeposit.ok, " journal du contrôleur :", JSON.stringify(screener.log));

  // 2. Paiements via le facilitateur (qui filtre les destinataires)
  const relayer = createJoinSplitRelayer({ rpc, local: LOCAL, keypair: facKp, programId: PROGRAM_ID, mint, pool, vault, minFee: FEE, denylist: new Set([sanctionedSeller.toBase58()]) });
  await relayer.init();
  const reqFor = (payTo, amount) => ({ asset: mint.toBase58(), payTo: payTo.toBase58(), amount: s(amount), extra: { fee: s(FEE), feeRecipient: relayer.relayerToken.toBase58() } });
  await alice.sync();
  const bad = alice.pay(reqFor(sanctionedSeller, 50_000n)); alice.notes.pop();
  out.paySanctioned = await relayer.relay(bad.payload, { recipientOwner: sanctionedSeller.toBase58(), amount: "50000" });
  console.log("Alice → vendeur sanctionné :", out.paySanctioned.status, out.paySanctioned.error);
  const p1 = alice.pay(reqFor(seller, 137_000n));
  const r1 = await relayer.relay(p1.payload, { recipientOwner: seller.toBase58(), amount: "137000" });
  out.paySeller = { status: r1.status, sig: r1.sig, txBytes: r1.txBytes };
  console.log("Alice → vendeur 0,137 :", r1.status, r1.sig);
  await alice.sync();
  const t = alice.transfer(bob.address(), 300_000n, FEE, { owner: facKp.publicKey, token: relayer.relayerToken });
  const r2 = await relayer.relay(t.payload);
  out.transferBob = { status: r2.status, sig: r2.sig, txBytes: r2.txBytes };
  console.log("Alice → Bob 0,30 en note privée :", r2.status, r2.sig, `(${r2.txBytes} o)`);

  // 3. Clés de consultation
  await alice.sync();
  const auditorA = new ShieldedWallet({ ...opts, name: "auditeurA", viewingKey: alice.viewingKey() });
  const auditorB = new ShieldedWallet({ ...opts, name: "auditeurB", viewingKey: bob.viewingKey() });
  await Promise.all([auditorA.sync(), auditorB.sync(), carol.sync(), bob.sync()]);
  out.audit = {
    alice: { balanceSeenByAlice: s(alice.balance()), balanceSeenByAuditor: s(auditorA.balance()), history: fmt(auditorA.history) },
    bob: { balanceSeenByBob: s(bob.balance()), balanceSeenByAuditor: s(auditorB.balance()), history: fmt(auditorB.history) },
    carol: { balance: s(carol.balance()), history: carol.history.length },
  };
  try { auditorA.pay(reqFor(seller, 10_000n)); out.auditorCanSpend = true; } catch (e) { out.auditorCanSpend = false; out.auditorSpendError = e.message; }
  console.log("Historique d'Alice vu par l'auditeur :"); for (const h of auditorA.history) console.log("  ", JSON.stringify(fmt(h)));
  console.log("Historique de Bob vu par l'auditeur :"); for (const h of auditorB.history) console.log("  ", JSON.stringify(fmt(h)));
  console.log(`soldes : Alice ${alice.balance()} = auditeur ${auditorA.balance()} ; Bob ${bob.balance()} = auditeur ${auditorB.balance()} ; Carol ${carol.balance()} ; l'auditeur peut dépenser : ${out.auditorCanSpend} (${out.auditorSpendError})`);
  out.expected = { alice: s(UNIT - 137_000n - FEE - 300_000n - FEE), bob: "300000", sellerToken: spl.getAssociatedTokenAddressSync(mint, seller).toBase58() };
  fs.writeFileSync(path.join(__dirname, `results-compliance-${LOCAL ? "local" : "devnet"}.json`), JSON.stringify(out, null, 2) + "\n");
})();
