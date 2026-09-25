// Remise des notes privées (Solana devnet, pool join-split, notes v2 avec propriétaire).
// Alice dépose 1,00 et paie Bob 0,30 EN NOTE PRIVÉE : aucun montant public, la note est
// chiffrée pour Bob et jointe à la transaction. Bob (qui n'a jamais eu de SOL ni de compte)
// la trouve en synchronisant, puis la dépense (paiement public de 0,10 à un vendeur).
// Carol, observatrice, ne trouve rien. Attaques : Alice tente de dépenser la note de Bob ;
// Alice envoie à Bob un message mensonger (montant annoncé 5,00 pour une note de 0,01).
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const web3 = require("@solana/web3.js");
const spl = require("@solana/spl-token");
const L = require("@lightprotocol/stateless.js");
const { createJoinSplitRelayer } = require("./relayer-js");
const { ShieldedWallet, encryptNote, parseAddress } = require("./shielded-wallet");

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

(async () => {
  const out = { date: new Date().toISOString(), rpc: RPC.replace(/api-key=[^&]+/, "api-key=…"), program: PROGRAM_ID.toBase58() };
  const aliceKp = web3.Keypair.generate(), facKp = web3.Keypair.generate(), seller = web3.Keypair.generate().publicKey;
  await sendTx([web3.SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: aliceKp.publicKey, lamports: 10_000_000 }),
    web3.SystemProgram.transfer({ fromPubkey: funder.publicKey, toPubkey: facKp.publicKey, lamports: 80_000_000 })], [funder]);
  const mint = await spl.createMint(rpc, funder, funder.publicKey, null, 6);
  const [pool] = web3.PublicKey.findProgramAddressSync([Buffer.from("pool"), mint.toBuffer()], PROGRAM_ID);
  const vault = await spl.createAccount(rpc, funder, mint, pool, web3.Keypair.generate());
  await sendTx([new web3.TransactionInstruction({ programId: PROGRAM_ID, data: disc("initialize"), keys: [
    { pubkey: funder.publicKey, isSigner: true, isWritable: true }, { pubkey: mint, isSigner: false, isWritable: false },
    { pubkey: pool, isSigner: false, isWritable: true }, { pubkey: vault, isSigner: false, isWritable: false },
    { pubkey: web3.SystemProgram.programId, isSigner: false, isWritable: false }] })], [funder]);
  const funderAta = await spl.createAssociatedTokenAccount(rpc, funder, mint, funder.publicKey);
  const aliceAta = await spl.createAssociatedTokenAccount(rpc, funder, mint, aliceKp.publicKey);
  await spl.createAssociatedTokenAccount(rpc, funder, mint, seller);
  await spl.mintTo(rpc, funder, mint, funderAta, funder, 5n * UNIT);
  await spl.mintTo(rpc, funder, mint, aliceAta, funder, UNIT);

  const opts = { rpc, programId: PROGRAM_ID, pool, vault, mint, circuitDir: path.join(__dirname, "joinsplit"),
    nargo: process.env.NARGO || `${SCRATCH}/nargo22/nargo`, sunspot: process.env.SUNSPOT || `${SCRATCH}/sunspot-bin` };
  const alice = new ShieldedWallet({ ...opts, name: "alice" }), bob = new ShieldedWallet({ ...opts, name: "bob" });
  const carol = new ShieldedWallet({ ...opts, name: "carol" }), others = new ShieldedWallet({ ...opts, name: "autres" });
  out.bobAddress = bob.address();
  await sendTx([others.depositIx(funder.publicKey, funderAta, 2n * UNIT)], [funder]);
  await sendTx([alice.depositIx(aliceKp.publicKey, aliceAta, UNIT)], [aliceKp]);
  await sendTx([others.depositIx(funder.publicKey, funderAta, 500_000n)], [funder]);

  const relayer = createJoinSplitRelayer({ rpc, local: LOCAL, keypair: facKp, programId: PROGRAM_ID, mint, pool, vault, minFee: FEE });
  await relayer.init();
  const relayerInfo = { owner: facKp.publicKey, token: relayer.relayerToken };
  const txInfo = async (sig) => { const t = await rpc.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 }); return { computeUnits: t.meta.computeUnitsConsumed, fee: t.meta.fee }; };

  // 1. Alice → Bob : 0,30 en note privée
  await alice.sync();
  const t = alice.transfer(bob.address(), 300_000n, FEE, relayerInfo);
  const r1 = await relayer.relay(t.payload);
  out.transfer = { status: r1.status, error: r1.error ?? null, sig: r1.sig, txBytes: r1.txBytes, memoBytes: Buffer.from(t.payload.memo, "base64").length, proveMs: t.proveMs, ...(r1.sig ? await txInfo(r1.sig) : {}) };
  console.log(`Alice → Bob 0,30 en note privée : ${r1.status} ${r1.error || r1.sig} (${r1.txBytes} o, message ${out.transfer.memoBytes} o)`);

  // 2. Synchronisations
  await Promise.all([alice.sync(), bob.sync(), carol.sync()]);
  out.afterTransfer = { alice: s(alice.balance()), bob: s(bob.balance()), carol: s(carol.balance()), bobReceived: bob.received.map((x) => s(x.amount)) };
  console.log("soldes privés après le paiement :", JSON.stringify(out.afterTransfer));

  // 3. Attaque : Alice (qui connaît pk_Bob, blinding et montant) tente de dépenser la note de Bob
  const bobNote = bob.spendable()[0];
  try {
    alice.build([{ ...t.out, index: bobNote.index }], [alice.own({ ...t.out }), alice.own({ ...t.out })], 0n, FEE, relayer.relayerToken, relayer.relayerToken);
    out.aliceSpendsBobNote = "PREUVE PRODUITE (anormal)";
  } catch (e) { out.aliceSpendsBobNote = `impossible : ${String(e.stderr || e.message).match(/note absente de l'arbre|nullificateur incorrect|Failed[^\n]*/)?.[0] ?? "échec du circuit"}`; }
  console.log("Alice tente de dépenser la note de Bob :", out.aliceSpendsBobNote);

  // 4. Attaque : message mensonger (note réelle de 0,01, message annonçant 5,00)
  const t2 = alice.transfer(bob.address(), 10_000n, FEE, relayerInfo);
  t2.payload.memo = encryptNote(parseAddress(bob.address()).enc, 5n * UNIT).memo.toString("base64");
  const r2 = await relayer.relay(t2.payload);
  await bob.sync();
  out.lyingMemo = { status: r2.status, bobBalance: s(bob.balance()), rejectedMemos: bob.rejectedMemos };
  console.log(`message mensonger publié (${r2.status}) → Bob l'écarte : solde ${bob.balance()}, messages rejetés ${bob.rejectedMemos}`);

  // 5. Bob dépense sa note : paiement public de 0,10 à un vendeur (prix exact), monnaie à Bob
  const req = { asset: mint.toBase58(), payTo: seller.toBase58(), amount: "100000", extra: { fee: s(FEE), feeRecipient: relayer.relayerToken.toBase58() } };
  const pb = bob.pay(req);
  const r3 = await relayer.relay(pb.payload, { recipientOwner: seller.toBase58(), amount: "100000" });
  out.bobPays = { status: r3.status, error: r3.error ?? null, sig: r3.sig, change: s(pb.change), ...(r3.sig ? await txInfo(r3.sig) : {}) };
  console.log(`Bob paie 0,10 au vendeur avec la note reçue : ${r3.status} ${r3.error || r3.sig}`);

  await Promise.all([alice.sync(), bob.sync(), carol.sync()]);
  const bal = async (a) => s((await spl.getAccount(rpc, a)).amount);
  out.final = { alicePrivate: s(alice.balance()), bobPrivate: s(bob.balance()), carolPrivate: s(carol.balance()),
    seller: await bal(spl.getAssociatedTokenAddressSync(mint, seller)), relayer: await bal(relayer.relayerToken), vault: await bal(vault) };
  out.expected = { alicePrivate: s(UNIT - 300_000n - FEE - 10_000n - FEE), bobPrivate: s(300_000n - 100_000n - FEE) /* la note de 0,01 au message mensonger reste introuvable pour Bob */, carolPrivate: "0",
    seller: "100000", relayer: s(3n * FEE), vault: s(3_500_000n - 100_000n - 3n * FEE) };
  console.log(JSON.stringify({ final: out.final, expected: out.expected }));
  fs.writeFileSync(path.join(__dirname, `results-notes-${LOCAL ? "local" : "devnet"}.json`), JSON.stringify(out, null, 2) + "\n");
})();
