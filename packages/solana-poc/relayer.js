// Relayeur du pool blindé Solana.
// L'utilisateur envoie { proof, publicWitness, recipientOwner } (aucune signature, aucun SOL).
// Le relayeur : (1) vérifie que la preuve le désigne comme relayeur et que les frais prouvés
// couvrent son minimum ; (2) dérive le compte de jetons du destinataire (ATA) et vérifie qu'il
// correspond au destinataire prouvé ; (3) obtient la preuve de non-existence du nullificateur ;
// (4) SIMULE la transaction et ne l'envoie que si elle réussit (une preuve invalide ou une
// double dépense ne lui coûte rien) ; (5) signe et paie les frais Solana.
// Ce n'est qu'un test : pas de limitation de débit, pas de file d'attente, pas de Tor.
const http = require("http");
const crypto = require("crypto");
const web3 = require("@solana/web3.js");
const spl = require("@solana/spl-token");
const L = require("@lightprotocol/stateless.js");

const disc = (n) => crypto.createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const pkField = (pk) => { const b = Buffer.from(pk.toBytes()); b[0] = 0; return b; };
const PW_HEADER = 12, NR_INPUTS = 5;
const input = (pw, i) => pw.subarray(PW_HEADER + i * 32, PW_HEADER + (i + 1) * 32);

function createRelayer({ rpc, local, keypair, programId, mint, pool, vault, minFee, denomination }) {
  const relayerToken = spl.getAssociatedTokenAddressSync(mint, keypair.publicKey);
  let lut = null;

  async function lightData(nullifier) {
    L.featureFlags.version = L.VERSION.V2;
    const addressTree = new web3.PublicKey(L.batchAddressTree);
    const outputStateTree = local
      ? L.defaultTestStateTreeAccounts().merkleTree
      : L.selectStateTreeInfo((await rpc.getStateTreeInfos()).filter((i) => i.treeType === L.TreeType.StateV2)).queue;
    const seed = L.deriveAddressSeedV2([Buffer.from("nullifier"), nullifier]);
    const address = L.deriveAddressV2(seed, addressTree, programId);
    const proof = await rpc.getValidityProofV0([], [{ tree: addressTree, queue: addressTree, address: L.bn(address.toBytes()) }]);
    const pa = new L.PackedAccounts();
    pa.addSystemAccountsV2(L.SystemAccountMetaConfig.new(programId));
    const addrIdx = pa.insertOrGet(addressTree);
    const outIdx = pa.insertOrGet(outputStateTree);
    const { remainingAccounts, systemStart } = pa.toAccountMetas();
    const c = proof.compressedProof;
    const vp = c ? Buffer.concat([Buffer.from([1]), Buffer.from(c.a), Buffer.from(c.b), Buffer.from(c.c)]) : Buffer.from([0]);
    return { data: Buffer.concat([vp, Buffer.from([addrIdx, addrIdx]), u16(proof.rootIndices[0]), Buffer.from([outIdx, systemStart])]), remainingAccounts };
  }

  async function ensureLut(keys) {
    if (lut) return lut;
    const slot = await rpc.getSlot("finalized");
    const [create, addr] = web3.AddressLookupTableProgram.createLookupTable({ authority: keypair.publicKey, payer: keypair.publicKey, recentSlot: slot });
    const extend = web3.AddressLookupTableProgram.extendLookupTable({ payer: keypair.publicKey, authority: keypair.publicKey, lookupTable: addr, addresses: keys });
    await web3.sendAndConfirmTransaction(rpc, new web3.Transaction().add(create, extend), [keypair], { commitment: "confirmed" });
    await new Promise((r) => setTimeout(r, local ? 3000 : 6000));
    lut = (await rpc.getAddressLookupTable(addr)).value;
    return lut;
  }

  async function init() {
    // Compte de jetons du relayeur (reçoit les frais) et table d'adresses statiques.
    await spl.getOrCreateAssociatedTokenAccount(rpc, keypair, mint, keypair.publicKey);
    const l = await lightData(crypto.randomBytes(32).fill(0, 0, 1));
    const statics = [programId, pool, vault, relayerToken, mint, spl.TOKEN_PROGRAM_ID, spl.ASSOCIATED_TOKEN_PROGRAM_ID,
      web3.SystemProgram.programId, web3.ComputeBudgetProgram.programId, ...l.remainingAccounts.map((a) => a.pubkey)];
    await ensureLut([...new Map(statics.map((k) => [k.toBase58(), k])).values()]);
  }

  /** Vérifie une demande et construit + simule la transaction, SANS l'envoyer.
   *  `expect` (optionnel, x402) : { recipientOwner, amount } exigés par le vendeur. */
  async function prepare({ proof, publicWitness, recipientOwner }, expect) {
    const pr = Buffer.from(proof, "base64");
    const pw = Buffer.from(publicWitness, "base64");
    if (pw.length !== PW_HEADER + NR_INPUTS * 32) return { status: 400, error: "témoin public mal formé" };
    if (pr.length > 1024) return { status: 400, error: "preuve trop longue" };
    let owner;
    try { owner = new web3.PublicKey(recipientOwner); } catch { return { status: 400, error: "destinataire invalide" }; }
    // (1) la preuve doit payer CE relayeur, et assez
    if (!input(pw, 3).equals(pkField(relayerToken))) return { status: 400, error: "la preuve ne désigne pas ce relayeur" };
    const fee = BigInt("0x" + input(pw, 4).toString("hex"));
    if (fee < minFee) return { status: 400, error: `frais ${fee} < minimum ${minFee}` };
    // (2) destinataire : ATA dérivé du propriétaire, doit être celui de la preuve
    const recipientToken = spl.getAssociatedTokenAddressSync(mint, owner);
    if (!input(pw, 2).equals(pkField(recipientToken))) return { status: 400, error: "destinataire ≠ destinataire prouvé" };
    if (expect) {
      if (expect.recipientOwner !== owner.toBase58()) return { status: 400, error: "le paiement ne va pas au vendeur" };
      if (denomination === undefined || BigInt(expect.amount) !== denomination - fee) return { status: 400, error: `montant ${denomination - fee} ≠ prix ${expect.amount}` };
    }
    // (3) preuve de non-existence du nullificateur (échoue si déjà dépensé)
    let light;
    try { light = await lightData(Buffer.from(input(pw, 1))); }
    catch (e) { return { status: 409, error: "nullificateur déjà utilisé ou indexeur indisponible" }; }
    const ixs = [
      web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 600_000 }),
      spl.createAssociatedTokenAccountIdempotentInstruction(keypair.publicKey, recipientToken, owner, mint),
      new web3.TransactionInstruction({ programId, data: Buffer.concat([disc("spend"), u32(pr.length), pr, u32(pw.length), pw, light.data]), keys: [
        { pubkey: keypair.publicKey, isSigner: true, isWritable: true }, { pubkey: pool, isSigner: false, isWritable: false },
        { pubkey: vault, isSigner: false, isWritable: true }, { pubkey: recipientToken, isSigner: false, isWritable: true },
        { pubkey: relayerToken, isSigner: false, isWritable: true }, { pubkey: spl.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
        ...light.remainingAccounts] }),
    ];
    const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
    const msg = new web3.TransactionMessage({ payerKey: keypair.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message([lut]);
    const tx = new web3.VersionedTransaction(msg); tx.sign([keypair]);
    // (4) simulation : rien n'est payé si elle échoue
    const sim = await rpc.simulateTransaction(tx, { sigVerify: true });
    if (sim.value.err) {
      const why = (sim.value.logs || []).find((l) => l.includes("Error Message")) || JSON.stringify(sim.value.err);
      return { status: 422, error: `simulation refusée : ${why.slice(0, 160)}` };
    }
    return { status: 200, tx, blockhash, lastValidBlockHeight, sim, recipientToken, amount: denomination === undefined ? null : denomination - fee, fee };
  }

  async function relay(body, expect) {
    const p = await prepare(body, expect);
    if (p.status !== 200) return p;
    const { tx, blockhash, lastValidBlockHeight, sim, recipientToken } = p;
    // (5) envoi
    const sig = await rpc.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    const conf = await rpc.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, "confirmed");
    if (conf.value.err) return { status: 500, error: "transaction échouée", sig };
    return { status: 200, sig, simulatedComputeUnits: sim.value.unitsConsumed, txBytes: tx.serialize().length, recipientToken: recipientToken.toBase58() };
  }

  function listen(port) {
    const server = http.createServer(async (req, res) => {
      const reply = (status, body) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(body)); };
      try {
        if (req.method === "GET" && req.url === "/info")
          return reply(200, { relayer: keypair.publicKey.toBase58(), relayerToken: relayerToken.toBase58(), minFee: String(minFee), program: programId.toBase58(), pool: pool.toBase58(), mint: mint.toBase58() });
        if (req.method === "POST" && req.url === "/relay") {
          let body = ""; for await (const c of req) { body += c; if (body.length > 16384) return reply(413, { error: "requête trop grande" }); }
          const r = await relay(JSON.parse(body));
          return reply(r.status, r);
        }
        reply(404, { error: "inconnu" });
      } catch (e) { reply(500, { error: String(e.message).slice(0, 200) }); }
    });
    return new Promise((resolve) => server.listen(port, "127.0.0.1", () => resolve(server)));
  }

  return { init, prepare, relay, listen, relayerToken };
}

module.exports = { createRelayer };
