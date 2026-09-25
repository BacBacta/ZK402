// Cycle P4 RÉEL sur Base Sepolia (script autonome : le SDK CoFHE ne fonctionne pas dans Hardhat
// en réseau réel) : 3 dépôts → 2 réclamations anonymes vers un pseudonyme neuf → conversion d'un
// palier du solde CHIFFRÉ en note (débit en FHE) → déchiffrement de « ok » par Teecryptor →
// finalisation → sortie ANONYME de la note vers une adresse neuve.
// Lancer : set -a && . ../../.env && set +a
//          NODE_USE_ENV_PROXY=1 npx ts-node --transpile-only scripts/live-p4.ts
import fs from "fs";
import path from "path";
import { createCofheConfig, createCofheClient } from "@cofhe/sdk/node";
import { getChainById } from "@cofhe/sdk/chains";
import { Tree, newNote, proveClaim } from "../test/helpers/zk";

const req = (m: string) => require(require.resolve(m, { paths: [require.resolve("@cofhe/sdk")] }));
const viem = req("viem");
const { privateKeyToAccount, generatePrivateKey } = req("viem/accounts");
const { baseSepolia } = req("viem/chains");
const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const art = (f: string, n: string) => JSON.parse(fs.readFileSync(path.join(__dirname, `../artifacts/contracts/${f}/${n}.json`), "utf8")).abi;
const entryAbi = art("ShieldedEntry.sol", "ShieldedEntry");
const poolAbi = art("SealedBatchPoolV2.sol", "SealedBatchPoolV2");
const D = JSON.parse(fs.readFileSync(path.join(__dirname, "../deployments/p4-base-sepolia.json"), "utf8"));
const pc = viem.createPublicClient({ chain: baseSepolia, transport: viem.http(RPC) });
const walletFor = (pk: `0x${string}`) => viem.createWalletClient({ account: privateKeyToAccount(pk), chain: baseSepolia, transport: viem.http(RPC) });
const STIPEND = viem.parseEther("0.0002");
const DEPOSIT = viem.parseEther("0.001");
const hex32 = (x: bigint) => viem.toHex(x, { size: 32 });

async function send(w: any, address: string, abi: any, fn: string, args: unknown[], value = 0n, gas = 3_000_000n) {
  for (let k = 1; ; k++) {
    try {
      const hash = await w.writeContract({ address, abi, functionName: fn, args, value, gas });
      const r = await pc.waitForTransactionReceipt({ hash });
      if (r.status !== "success") throw new Error(`${fn} a échoué (${hash})`);
      return r;
    } catch (e: any) {
      if (k >= 4 || String(e?.message).includes("a échoué")) throw e;
      console.log(`  ${fn} : nouvelle tentative (${e?.shortMessage || e?.message})`);
      await sleep(4000 * k);
    }
  }
}

async function main() {
  const op = walletFor(process.env.PRIVATE_KEY as `0x${string}`);
  const log: Record<string, unknown> = { date: new Date().toISOString(), ...D };
  const tree = new Tree();
  // 1. Trois dépôts publics.
  const notes = [newNote(), newNote(), newNote()];
  for (const n of notes) {
    await send(op, D.entry, entryAbi, "deposit", [0, n.commitment], DEPOSIT + STIPEND, 1_500_000n);
    tree.insert(n.commitment);
  }
  await sleep(3000);
  const root0 = await pc.readContract({ address: D.entry, abi: entryAbi, functionName: "currentRoot", args: [0] });
  console.log("3 dépôts ; racine on-chain = locale :", root0 === tree.root());

  // 2. Deux réclamations anonymes vers un pseudonyme NEUF (clé générée ici, jamais financé par op).
  const pk = generatePrivateKey();
  const P = walletFor(pk);
  for (const i of [0, 1]) {
    const { proof } = proveClaim({ note: notes[i], tree, index: i, recipient: P.account.address, relayer: op.account.address, fee: 0n });
    await send(op, D.entry, entryAbi, "claim", [0, proof, tree.root(), hex32(notes[i].nullifier), P.account.address, op.account.address, 0n], 0n, 6_000_000n);
  }
  await sleep(3000);
  console.log("pseudonyme", P.account.address, "ETH =", viem.formatEther(await pc.getBalance({ address: P.account.address })));

  // 3. Le pseudonyme convertit un palier (10 unités) + allocation (2 unités) de son solde CHIFFRÉ en note.
  const out = newNote();
  const r = await send(P, D.pool, poolAbi, "requestNoteOut", [0, out.commitment], 0n, 2_500_000n);
  const ev = viem.parseEventLogs({ abi: poolAbi, logs: r.logs, eventName: "NoteOutRequested" })[0];
  console.log(`requestNoteOut : id ${ev.args.id}, gas ${r.gasUsed}`);

  // 4. Déchiffrement public de « ok » par le réseau Fhenix (Teecryptor), puis finalisation.
  const client = createCofheClient(createCofheConfig({ environment: "node", supportedChains: [getChainById(84532)!] }));
  await client.connect(pc, op);
  const t0 = Date.now();
  let dec: any;
  for (let k = 0; k < 60 && !dec; k++) {
    try { dec = await client.decryptForTx(ev.args.okHandle).withoutACP().execute(); } catch (e: any) { await sleep(3000); }
  }
  if (!dec) throw new Error("déchiffrement indisponible");
  const decS = (Date.now() - t0) / 1000;
  console.log(`ok déchiffré = ${dec.decryptedValue} (en ${decS.toFixed(1)} s)`);
  const rf = await send(op, D.pool, poolAbi, "finalizeNoteOut", [ev.args.id, dec.decryptedValue === 1n, dec.signature], 0n, 1_500_000n);
  const inserted = viem.parseEventLogs({ abi: entryAbi, logs: rf.logs, eventName: "NoteFromPool" }).length === 1;
  tree.insert(out.commitment);
  console.log("note insérée :", inserted);

  // 5. Sortie ANONYME de la nouvelle note vers une adresse neuve (relayée par op, sans frais).
  const dest = privateKeyToAccount(generatePrivateKey()).address;
  const { proof } = proveClaim({ note: out, tree, index: tree.leaves.length - 1, recipient: dest, relayer: op.account.address, fee: 0n });
  const rx = await send(op, D.entry, entryAbi, "exit", [0, proof, tree.root(), hex32(out.nullifier), dest, op.account.address, 0n], 0n, 6_000_000n);
  await sleep(3000);
  const destEth = await pc.getBalance({ address: dest });
  Object.assign(log, {
    pseudonym: P.account.address, requestNoteOutGas: String(r.gasUsed), decryptSeconds: decS, okDecrypted: String(dec.decryptedValue),
    noteInserted: inserted, exitTx: rx.transactionHash, exitGas: String(rx.gasUsed), destination: dest,
    destinationEth: viem.formatEther(destEth), expectedEth: viem.formatEther(DEPOSIT + STIPEND),
    reservesBase: String(await pc.readContract({ address: D.entry, abi: entryAbi, functionName: "reserves", args: [0n] })),
  });
  console.log(log);
  fs.writeFileSync(path.join(__dirname, "../deployments/p4-cycle-base-sepolia.json"), JSON.stringify(log, null, 2) + "\n");
}
main().catch((e) => { console.error(e); process.exit(1); });
