// Dépense complète sur Solana : preuve Groth16 vérifiée + nullificateur compressé Light, en une
// instruction. Mesure CU, taille de transaction et frais ; teste la double dépense et une
// entrée publique modifiée.
// Local : light test-validator (+ Photon + prouveur) ; RPC=http://127.0.0.1:8899
// Devnet : RPC=https://devnet.helius-rpc.com/?api-key=… (le RPC doit servir l'API ZK Compression)
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const web3 = require("@solana/web3.js");
const L = require("@lightprotocol/stateless.js");

const RPC = process.env.RPC || "http://127.0.0.1:8899";
const LOCAL = RPC.includes("127.0.0.1");
const rpc = LOCAL
  ? L.createRpc(RPC, "http://127.0.0.1:8784", "http://127.0.0.1:3001", { commitment: "confirmed" })
  : L.createRpc(RPC, RPC, RPC, { commitment: "confirmed" });
const payer = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(process.env.KEYPAIR || path.join(os.homedir(), ".config/solana/devnet.json"), "utf8"))));
const PROGRAM_ID = web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(path.join(__dirname, "spend/target/deploy/spend-keypair.json"), "utf8")))).publicKey;
const DISC = crypto.createHash("sha256").update("global:spend").digest().subarray(0, 8);
const u32 = (n) => { const b = Buffer.alloc(4); b.writeUInt32LE(n); return b; };
const u16 = (n) => { const b = Buffer.alloc(2); b.writeUInt16LE(n); return b; };

async function lightData(nullifier) {
  L.featureFlags.version = L.VERSION.V2;
  const addressTree = new web3.PublicKey(L.batchAddressTree);
  let outputStateTree;
  if (LOCAL) outputStateTree = L.defaultTestStateTreeAccounts().merkleTree;
  else {
    // Les adresses V2 exigent un arbre d'état V2 (sinon StateMerkleTreeAccountDiscriminatorMismatch).
    const infos = (await rpc.getStateTreeInfos()).filter((i) => i.treeType === L.TreeType.StateV2);
    // Arbre V2 (par lots) : la sortie s'écrit dans sa file (queue), pas dans l'arbre.
    outputStateTree = L.selectStateTreeInfo(infos).queue;
  }
  const seed = L.deriveAddressSeedV2([Buffer.from("nullifier"), nullifier]);
  const address = L.deriveAddressV2(seed, addressTree, PROGRAM_ID);
  const proof = await rpc.getValidityProofV0([], [{ tree: addressTree, queue: addressTree, address: L.bn(address.toBytes()) }]);
  const pa = new L.PackedAccounts();
  pa.addSystemAccountsV2(L.SystemAccountMetaConfig.new(PROGRAM_ID));
  const addrIdx = pa.insertOrGet(addressTree);
  const outIdx = pa.insertOrGet(outputStateTree);
  const { remainingAccounts, systemStart } = pa.toAccountMetas();
  const cp = proof.compressedProof;
  const vp = cp ? Buffer.concat([Buffer.from([1]), Buffer.from(cp.a), Buffer.from(cp.b), Buffer.from(cp.c)]) : Buffer.from([0]);
  const data = Buffer.concat([vp, Buffer.from([addrIdx, addrIdx]), u16(proof.rootIndices[0]), Buffer.from([outIdx, systemStart])]);
  return { data, remainingAccounts, address };
}

function spendIx(proofBytes, pw, light, remainingAccounts) {
  const data = Buffer.concat([DISC, u32(proofBytes.length), proofBytes, u32(pw.length), pw, light]);
  return new web3.TransactionInstruction({
    programId: PROGRAM_ID,
    keys: [{ pubkey: payer.publicKey, isSigner: true, isWritable: true }, ...remainingAccounts],
    data,
  });
}

let lut = null;
async function ensureLut(keys) {
  if (lut) return lut;
  const slot = await rpc.getSlot("finalized");
  const [create, addr] = web3.AddressLookupTableProgram.createLookupTable({ authority: payer.publicKey, payer: payer.publicKey, recentSlot: slot });
  const extend = web3.AddressLookupTableProgram.extendLookupTable({ payer: payer.publicKey, authority: payer.publicKey, lookupTable: addr, addresses: keys });
  const tx = new web3.Transaction().add(create, extend);
  await web3.sendAndConfirmTransaction(rpc, tx, [payer], { commitment: "confirmed" });
  await new Promise((r) => setTimeout(r, LOCAL ? 2000 : 5000));
  lut = (await rpc.getAddressLookupTable(addr)).value;
  return lut;
}

async function send(ix, label) {
  const budget = web3.ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 });
  const { blockhash } = await rpc.getLatestBlockhash();
  let raw, usedLut = false;
  try {
    const tx = new web3.Transaction().add(budget, ix);
    tx.feePayer = payer.publicKey; tx.recentBlockhash = blockhash; tx.sign(payer);
    raw = tx.serialize();
  } catch {
    // > 1 232 octets : transaction v0 avec table d'adresses (comptes Light).
    const table = await ensureLut(ix.keys.slice(1).map((k) => k.pubkey).concat([ix.programId, web3.ComputeBudgetProgram.programId]));
    const msg = new web3.TransactionMessage({ payerKey: payer.publicKey, recentBlockhash: blockhash, instructions: [budget, ix] }).compileToV0Message([table]);
    const vtx = new web3.VersionedTransaction(msg); vtx.sign([payer]);
    raw = Buffer.from(vtx.serialize()); usedLut = true;
  }
  let sig, err = null;
  try {
    sig = await rpc.sendRawTransaction(raw, { skipPreflight: true });
    err = (await rpc.confirmTransaction(sig, "confirmed")).value.err;
  } catch (e) { err = e.message; }
  let info = null;
  for (let i = 0; i < 15 && !info && sig; i++) {
    info = await rpc.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!info) await new Promise((r) => setTimeout(r, 1000));
  }
  const r = { label, sig, ok: err === null, txBytes: raw.length, usedLookupTable: usedLut, computeUnits: info?.meta?.computeUnitsConsumed ?? null, feeLamports: info?.meta?.fee ?? null, logs: info?.meta?.logMessages ?? [] };
  console.log(`${label}: ok=${r.ok} CU=${r.computeUnits} tx=${r.txBytes} o (LUT=${usedLut}) frais=${r.feeLamports}`);
  if (!r.ok) console.log("   ", r.logs.filter((l) => /error|failed|Error/i.test(l)).slice(-2).join(" | "));
  return r;
}

(async () => {
  const proof = fs.readFileSync(path.join(__dirname, "claim/target/claim.proof"));
  const pw = fs.readFileSync(path.join(__dirname, "claim/target/claim.pw"));
  const nullifier = pw.subarray(12 + 32, 12 + 64);
  const out = { date: new Date().toISOString(), rpc: RPC.replace(/api-key=[^&]+/, "api-key=…"), program: PROGRAM_ID.toBase58() };
  const bal0 = await rpc.getBalance(payer.publicKey);

  // (1) entrée publique « recipient » modifiée → preuve refusée (avant tout effet)
  const bad = Buffer.from(pw); bad[12 + 2 * 32 + 31] ^= 1;
  const l0 = await lightData(nullifier);
  const r0 = await send(spendIx(proof, bad, l0.data, l0.remainingAccounts), "destinataire modifié");
  out.tamperedRecipient = { sig: r0.sig, rejected: !r0.ok };

  // (2) dépense valide
  const l1 = await lightData(nullifier);
  const r1 = await send(spendIx(proof, pw, l1.data, l1.remainingAccounts), "dépense valide");
  out.validSpend = { sig: r1.sig, ok: r1.ok, computeUnits: r1.computeUnits, txBytes: r1.txBytes, usedLookupTable: r1.usedLookupTable, feeLamports: r1.feeLamports };
  await new Promise((r) => setTimeout(r, 3000));
  try {
    const acc = await rpc.getCompressedAccount(L.bn(l1.address.toBytes()));
    out.validSpend.nullifierAccountIndexed = !!acc;
  } catch (e) { out.validSpend.nullifierAccountIndexed = `erreur: ${e.message}`; }

  // (3) double dépense : (a) l'indexeur refuse une preuve de non-existence ; (b) on rejoue
  //     l'ancienne instruction (preuve de non-existence périmée) → refus on-chain.
  try { await lightData(nullifier); out.doubleSpendValidityProof = "DÉLIVRÉE (anormal)"; }
  catch (e) { out.doubleSpendValidityProof = `refusée : ${e.message.slice(0, 120)}`; }
  console.log("preuve de non-existence pour un nullificateur déjà créé :", out.doubleSpendValidityProof);
  const r2 = await send(spendIx(proof, pw, l1.data, l1.remainingAccounts), "double dépense (rejeu)");
  out.doubleSpendReplay = { sig: r2.sig, rejected: !r2.ok };

  const bal1 = await rpc.getBalance(payer.publicKey);
  out.totalLamportsSpentByScript = bal0 - bal1;
  const net = LOCAL ? "local" : "devnet";
  fs.writeFileSync(path.join(__dirname, `results-spend-${net}.json`), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
})();
