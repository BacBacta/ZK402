// Test de faisabilité Solana : (1) Poseidon natif = Poseidon du circuit Noir ;
// (2) la preuve de réclamation (Noir → Groth16 via Sunspot) est vérifiée on-chain ;
// (3) une preuve dont une entrée publique est modifiée est refusée. Mesure CU et taille.
// Usage : RPC=http://127.0.0.1:8899 node run.js   (ou RPC=https://api.devnet.solana.com)
const fs = require("fs");
const path = require("path");
const os = require("os");
const {
  Connection, Keypair, PublicKey, Transaction, TransactionInstruction, ComputeBudgetProgram,
} = require("@solana/web3.js");

const RPC = process.env.RPC || "http://127.0.0.1:8899";
const KEY = process.env.KEYPAIR || path.join(os.homedir(), ".config/solana/devnet.json");
const conn = new Connection(RPC, "confirmed");
const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(KEY, "utf8"))));
const pid = (f) => Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(f, "utf8")))).publicKey;
const VERIFIER = pid(path.join(__dirname, "claim/target/claim-keypair.json"));
const POSEIDON = pid(path.join(__dirname, "poseidon-check/target/deploy/poseidon_check-keypair.json"));

const be32 = (x) => Buffer.from(BigInt(x).toString(16).padStart(64, "0"), "hex");
function prover() {
  const t = fs.readFileSync(path.join(__dirname, "claim/Prover.toml"), "utf8");
  const get = (k) => t.match(new RegExp(`^${k} = (.*)$`, "m"))[1];
  const arr = (k) => get(k).replace(/[\[\]" ]/g, "").split(",");
  return {
    nk: get("nk").replace(/"/g, ""), secret: get("secret").replace(/"/g, ""),
    path: arr("path"), bits: arr("index_bits").map((b) => b === "true"),
    root: BigInt(get("root").replace(/"/g, "")), nullifier: BigInt(get("nullifier").replace(/"/g, "")),
  };
}

async function send(programId, data, label) {
  const tx = new Transaction().add(
    ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
    new TransactionInstruction({ programId, keys: [], data }),
  );
  tx.feePayer = payer.publicKey;
  tx.recentBlockhash = (await conn.getLatestBlockhash()).blockhash;
  tx.sign(payer);
  const raw = tx.serialize();
  const t0 = Date.now();
  let sig, err = null;
  try {
    sig = await conn.sendRawTransaction(raw, { skipPreflight: true });
    const c = await conn.confirmTransaction(sig, "confirmed");
    err = c.value.err;
  } catch (e) { err = e.message; }
  let info = null;
  for (let i = 0; i < 10 && !info && sig; i++) {
    info = await conn.getTransaction(sig, { commitment: "confirmed", maxSupportedTransactionVersion: 0 });
    if (!info) await new Promise((r) => setTimeout(r, 1000));
  }
  const r = {
    label, sig, ok: err === null, txBytes: raw.length, dataBytes: data.length,
    computeUnits: info?.meta?.computeUnitsConsumed ?? null, feeLamports: info?.meta?.fee ?? null,
    confirmMs: Date.now() - t0, logs: info?.meta?.logMessages ?? [],
  };
  console.log(`${label}: ok=${r.ok} CU=${r.computeUnits} tx=${r.txBytes} o, frais=${r.feeLamports} lamports`);
  return r;
}

(async () => {
  const p = prover();
  const out = { date: new Date().toISOString(), rpc: RPC, verifier: VERIFIER.toBase58(), poseidonCheck: POSEIDON.toBase58() };

  // (1) Poseidon natif
  const index = p.bits.reduce((acc, b, i) => acc | ((b ? 1 : 0) << i), 0);
  const idx = Buffer.alloc(4); idx.writeUInt32LE(index);
  const pd = Buffer.concat([be32(p.nk), be32(p.secret), idx, ...p.path.map(be32)]);
  const r1 = await send(POSEIDON, pd, "poseidon");
  const log = (k) => { const l = r1.logs.find((x) => x.includes(`${k} = `)); return l ? BigInt("0x" + l.split(" = ")[1]) : null; };
  const cu = r1.logs.filter((l) => l.includes("consumption:") || l.match(/Program consumption|remaining/)).map((l) => l);
  out.poseidon = {
    sig: r1.sig, ok: r1.ok, computeUnits: r1.computeUnits, cuLogs: cu,
    h12Matches: log("H(1,2)") === 0x115cc0f5e7d690413df64c6b9662e9cf2a3617f2743245519e19607a4417189an,
    rootMatchesCircuit: log("root") === p.root, nullifierMatchesCircuit: log("nullifier") === p.nullifier,
  };
  console.log(out.poseidon);

  // (2) vérification de la preuve Groth16
  const proof = fs.readFileSync(path.join(__dirname, "claim/target/claim.proof"));
  const pw = fs.readFileSync(path.join(__dirname, "claim/target/claim.pw"));
  const r2 = await send(VERIFIER, Buffer.concat([proof, pw]), "preuve valide");
  out.validProof = { sig: r2.sig, ok: r2.ok, computeUnits: r2.computeUnits, txBytes: r2.txBytes, proofBytes: proof.length, publicWitnessBytes: pw.length, feeLamports: r2.feeLamports, confirmMs: r2.confirmMs };

  // (3) chaque entrée publique modifiée (root, nullifier, recipient, relayer, fee) → doit échouer
  const names = ["root", "nullifier", "recipient", "relayer", "fee"];
  out.tamperedInputs = {};
  for (let i = 0; i < names.length; i++) {
    const bad = Buffer.from(pw); bad[12 + i * 32 + 31] ^= 1;
    const r = await send(VERIFIER, Buffer.concat([proof, bad]), `${names[i]} modifié`);
    out.tamperedInputs[names[i]] = { sig: r.sig, rejected: !r.ok };
  }

  // (4) preuve altérée → doit échouer
  const badp = Buffer.from(proof); badp[40] ^= 1;
  const r4 = await send(VERIFIER, Buffer.concat([badp, pw]), "preuve altérée");
  out.tamperedProof = { sig: r4.sig, rejected: !r4.ok };

  const net = RPC.includes("devnet") ? "devnet" : "local";
  fs.writeFileSync(path.join(__dirname, `results-${net}.json`), JSON.stringify(out, null, 2) + "\n");
  console.log(JSON.stringify(out, null, 2));
})();
