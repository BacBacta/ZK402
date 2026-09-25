// Facilitateur / relayeur pour le pool JOIN-SPLIT (jspool). Même interface que relayer.js :
// prepare(body, expect) (contrôles + simulation, rien n'est payé) et relay(body, expect).
// body = { proof, publicWitness, recipientOwner, memo? } (memo = note chiffrée pour son destinataire) — aucune signature, aucun SOL côté agent.
// Contrôles : la preuve désigne CE relayeur ; frais prouvés ≥ minimum ; destinataire prouvé =
// compte de jetons (ATA) de recipientOwner ; si x402 (`expect`) : paiement public = EXACTEMENT
// le prix et destinataire = payTo ; preuve de non-existence des 2 nullificateurs ; simulation.
const crypto = require("crypto");
const web3 = require("@solana/web3.js");
const spl = require("@solana/spl-token");
const L = require("@lightprotocol/stateless.js");

const disc = (n) => crypto.createHash("sha256").update(`global:${n}`).digest().subarray(0, 8);
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };
const pkField = (pk) => { const b = Buffer.from(pk.toBytes()); b[0] = 0; return b; };
const PW_HEADER = 12, NR_INPUTS = 9;
const IN = { root: 0, null0: 1, null1: 2, out0: 3, out1: 4, withdraw: 5, fee: 6, recipient: 7, relayer: 8 };
const input = (pw, i) => pw.subarray(PW_HEADER + i * 32, PW_HEADER + (i + 1) * 32);
const big = (b) => BigInt("0x" + Buffer.from(b).toString("hex"));

function createJoinSplitRelayer({ rpc, local, keypair, programId, mint, pool, vault, minFee }) {
  const relayerToken = spl.getAssociatedTokenAddressSync(mint, keypair.publicKey);
  let lut = null;

  async function lightData(nullifiers) {
    L.featureFlags.version = L.VERSION.V2;
    const addressTree = new web3.PublicKey(L.batchAddressTree);
    const outputStateTree = local
      ? L.defaultTestStateTreeAccounts().merkleTree
      : L.selectStateTreeInfo((await rpc.getStateTreeInfos()).filter((i) => i.treeType === L.TreeType.StateV2)).queue;
    const addrs = nullifiers.map((n) => L.deriveAddressV2(L.deriveAddressSeedV2([Buffer.from("nullifier"), n]), addressTree, programId));
    const proof = await rpc.getValidityProofV0([], addrs.map((a) => ({ tree: addressTree, queue: addressTree, address: L.bn(a.toBytes()) })));
    const pa = new L.PackedAccounts();
    pa.addSystemAccountsV2(L.SystemAccountMetaConfig.new(programId));
    const ai = pa.insertOrGet(addressTree), oi = pa.insertOrGet(outputStateTree);
    const { remainingAccounts, systemStart } = pa.toAccountMetas();
    const c = proof.compressedProof;
    const vp = c ? Buffer.concat([Buffer.from([1]), Buffer.from(c.a), Buffer.from(c.b), Buffer.from(c.c)]) : Buffer.from([0]);
    return { data: Buffer.concat([vp, Buffer.from([ai, ai]), u16(proof.rootIndices[0]), Buffer.from([oi, systemStart])]), remainingAccounts };
  }

  async function init() {
    await spl.getOrCreateAssociatedTokenAccount(rpc, keypair, mint, keypair.publicKey);
    const r = () => { const b = crypto.randomBytes(32); b[0] = 0; return b; };
    const l = await lightData([r(), r()]);
    const statics = [programId, pool, vault, relayerToken, mint, spl.TOKEN_PROGRAM_ID, spl.ASSOCIATED_TOKEN_PROGRAM_ID,
      web3.SystemProgram.programId, web3.ComputeBudgetProgram.programId, ...l.remainingAccounts.map((a) => a.pubkey)];
    const keys = [...new Map(statics.map((k) => [k.toBase58(), k])).values()];
    const [create, addr] = web3.AddressLookupTableProgram.createLookupTable({ authority: keypair.publicKey, payer: keypair.publicKey, recentSlot: await rpc.getSlot("finalized") });
    const extend = web3.AddressLookupTableProgram.extendLookupTable({ payer: keypair.publicKey, authority: keypair.publicKey, lookupTable: addr, addresses: keys });
    await web3.sendAndConfirmTransaction(rpc, new web3.Transaction().add(create, extend), [keypair], { commitment: "confirmed" });
    await new Promise((res) => setTimeout(res, local ? 3000 : 6000));
    lut = (await rpc.getAddressLookupTable(addr)).value;
  }

  async function prepare({ proof, publicWitness, recipientOwner, memo }, expect) {
    const pr = Buffer.from(proof, "base64"), pw = Buffer.from(publicWitness, "base64");
    const mm = memo ? Buffer.from(memo, "base64") : Buffer.alloc(0);
    if (mm.length > 128) return { status: 400, error: "message chiffré trop long" };
    if (pw.length !== PW_HEADER + NR_INPUTS * 32) return { status: 400, error: "témoin public mal formé" };
    if (pr.length > 1024) return { status: 400, error: "preuve trop longue" };
    let owner;
    try { owner = new web3.PublicKey(recipientOwner); } catch { return { status: 400, error: "destinataire invalide" }; }
    if (!input(pw, IN.relayer).equals(pkField(relayerToken))) return { status: 400, error: "la preuve ne désigne pas ce relayeur" };
    const fee = big(input(pw, IN.fee)), withdraw = big(input(pw, IN.withdraw));
    if (fee < minFee) return { status: 400, error: `frais ${fee} < minimum ${minFee}` };
    const recipientToken = spl.getAssociatedTokenAddressSync(mint, owner);
    if (!input(pw, IN.recipient).equals(pkField(recipientToken))) return { status: 400, error: "destinataire ≠ destinataire prouvé" };
    if (expect) {
      if (expect.recipientOwner !== owner.toBase58()) return { status: 400, error: "le paiement ne va pas au vendeur" };
      if (BigInt(expect.amount) !== withdraw) return { status: 400, error: `montant payé ${withdraw} ≠ prix ${expect.amount}` };
    }
    let light;
    try { light = await lightData([Buffer.from(input(pw, IN.null0)), Buffer.from(input(pw, IN.null1))]); }
    catch { return { status: 409, error: "note déjà dépensée (nullificateur existant) ou indexeur indisponible" }; }
    // Le compte de jetons du destinataire doit exister : le créer dans la même transaction la
    // ferait dépasser 1 232 octets (mesuré : 1 251). Le vendeur le crée une fois pour toutes.
    if (!(await rpc.getAccountInfo(recipientToken))) return { status: 400, error: "compte de jetons du destinataire inexistant" };
    const ixs = [web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_000_000 })];
    ixs.push(new web3.TransactionInstruction({ programId, data: Buffer.concat([disc("transact"), u32(pr.length), pr, u32(pw.length), pw, light.data, u32(mm.length), mm]), keys: [
      { pubkey: keypair.publicKey, isSigner: true, isWritable: true }, { pubkey: pool, isSigner: false, isWritable: true },
      { pubkey: vault, isSigner: false, isWritable: true }, { pubkey: recipientToken, isSigner: false, isWritable: true },
      { pubkey: relayerToken, isSigner: false, isWritable: true }, { pubkey: spl.TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      ...light.remainingAccounts] }));
    const { blockhash, lastValidBlockHeight } = await rpc.getLatestBlockhash();
    const tx = new web3.VersionedTransaction(new web3.TransactionMessage({ payerKey: keypair.publicKey, recentBlockhash: blockhash, instructions: ixs }).compileToV0Message([lut]));
    tx.sign([keypair]);
    const size = tx.serialize().length;
    const sim = await rpc.simulateTransaction(tx, { sigVerify: true });
    if (sim.value.err) {
      const why = (sim.value.logs || []).find((l) => l.includes("Error Message")) || JSON.stringify(sim.value.err);
      return { status: 422, error: `simulation refusée : ${why.slice(0, 160)}` };
    }
    return { status: 200, tx, size, blockhash, lastValidBlockHeight, sim, recipientToken, withdraw, fee };
  }

  async function relay(body, expect) {
    const p = await prepare(body, expect);
    if (p.status !== 200) return p;
    const sig = await rpc.sendRawTransaction(p.tx.serialize(), { skipPreflight: true });
    const conf = await rpc.confirmTransaction({ signature: sig, blockhash: p.blockhash, lastValidBlockHeight: p.lastValidBlockHeight }, "confirmed");
    if (conf.value.err) return { status: 500, error: "transaction échouée", sig };
    return { status: 200, sig, simulatedComputeUnits: p.sim.value.unitsConsumed, txBytes: p.size, recipientToken: p.recipientToken.toBase58() };
  }

  return { init, prepare, relay, relayerToken };
}

module.exports = { createJoinSplitRelayer };
