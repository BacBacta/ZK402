// Lot RÉEL sur SealedBatchPoolV2 (Base Sepolia) : ordres chiffrés, clôture on-chain, règlement
// sans permission au prix « 2 sur 3 » à l'instant de clôture, lecture des exécutions.
// Lancer (après npx hardhat compile) :
//   set -a && . ../../.env && set +a
//   NODE_USE_ENV_PROXY=1 POOL=0x… npx ts-node --transpile-only scripts/live-v2-batch.ts
import fs from "fs";
import path from "path";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { createCofheConfig, createCofheClient } from "@cofhe/sdk/node";
import { getChainById } from "@cofhe/sdk/chains";

const req = (m: string) => require(require.resolve(m, { paths: [require.resolve("@cofhe/sdk")] }));
const viem = req("viem");
const { privateKeyToAccount } = req("viem/accounts");
const { baseSepolia } = req("viem/chains");
const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const POOL = process.env.POOL as `0x${string}`;
const CL = "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const abi = JSON.parse(fs.readFileSync(path.join(__dirname, "../artifacts/contracts/SealedBatchPoolV2.sol/SealedBatchPoolV2.json"), "utf8")).abi;
const clAbi = viem.parseAbi([
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function getRoundData(uint80) view returns (uint80,int256,uint256,uint256,uint80)",
]);
const pc = viem.createPublicClient({ chain: baseSepolia, transport: viem.http(RPC) });
const walletFor = (pk: `0x${string}`) =>
  viem.createWalletClient({ account: privateKeyToAccount(pk), chain: baseSepolia, transport: viem.http(RPC) });
const GAS: Record<string, bigint> = { claimFaucet: 1_000_000n, submitOrder: 1_500_000n, startSettlement: 1_500_000n, settleStep: 12_000_000n };

async function retry<T>(label: string, fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let k = 1; ; k++) {
    try { return await fn(); } catch (e: any) {
      if (k >= tries) throw e;
      console.log(`  ${label} : échec (${e?.code || e?.shortMessage || e?.message}), tentative ${k + 1}`);
      await sleep(4000 * k);
    }
  }
}
async function send(w: any, fn: string, args: unknown[]) {
  const hash = await retry(fn, () => w.writeContract({ address: POOL, abi, functionName: fn, args, gas: GAS[fn] }));
  const r = await pc.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${fn} a échoué (${hash})`);
  return r;
}
const read = (fn: string, args: unknown[] = []) => pc.readContract({ address: POOL, abi, functionName: fn, args });

/** Dernier round Chainlink avec updatedAt ≤ t. */
async function hintAt(t: bigint) {
  const [latest] = await pc.readContract({ address: CL, abi: clAbi, functionName: "latestRoundData" });
  let id = latest as bigint;
  for (;;) {
    const r = await pc.readContract({ address: CL, abi: clAbi, functionName: "getRoundData", args: [id] });
    if ((r[3] as bigint) <= t) return id;
    id -= 1n;
  }
}

async function main() {
  const opKey = process.env.PRIVATE_KEY as `0x${string}`;
  const traders = [0, 1].map((i) =>
    walletFor(viem.keccak256(viem.encodePacked(["bytes32", "string", "uint256"], [opKey, "trader", BigInt(i)]))),
  );
  const clients: any[] = [];
  if (process.env.SETTLE_ONLY) return settleOnly(traders, opKey);
  const sides = [true, false];
  const qtys = [7n, 9n];
  const enc: any[] = [];
  // 1. Chiffrer d'abord (≈ 30 s par ordre), hors du lot.
  for (let i = 0; i < 2; i++) {
    const w = traders[i];
    if (!(await read("hasAccount", [w.account.address]))) await send(w, "claimFaucet", []);
    const c = createCofheClient(createCofheConfig({ environment: "node", supportedChains: [getChainById(84532)!] }));
    await c.connect(pc, w);
    await c.acp.createSelf({ issuer: w.account.address });
    clients.push(c);
    const [side, ps] = (await retry("chiffrement", () => c.encryptInputs([Encryptable.bool(sides[i])]).setConsumingContract(POOL).execute())) as any;
    const [qty, pq] = (await retry("chiffrement", () => c.encryptInputs([Encryptable.uint64(qtys[i])]).setConsumingContract(POOL).execute())) as any;
    enc.push([side, ps, qty, pq]);
  }
  // 2. Attendre un lot neuf avec assez de temps restant, puis soumettre les deux ordres.
  let batch: bigint;
  let deadline: bigint;
  for (;;) {
    batch = (await read("currentBatch")) as bigint;
    deadline = (await read("batchDeadline", [batch])) as bigint;
    const now = (await pc.getBlock()).timestamp as bigint;
    if (deadline - now >= 60n) break;
    await sleep(5000);
  }
  console.log(`Lot ${batch}, clôture à ${deadline}`);
  for (let i = 0; i < 2; i++) {
    await send(traders[i], "submitOrder", enc[i]);
    console.log(`  ordre ${i + 1} soumis (${sides[i] ? "achat" : "vente"} ${qtys[i]})`);
  }
  // Le RPC public peut répondre avec un état en retard : relire plusieurs fois.
  let count = 0n;
  for (let k = 0; k < 6 && count !== 2n; k++) { count = (await read("orderCount", [batch])) as bigint; if (count !== 2n) await sleep(3000); }
  if (count !== 2n) throw new Error("ordres répartis sur plusieurs lots : relancer");
  // Attendre la clôture
  for (;;) {
    const b = await pc.getBlock();
    if (b.timestamp >= deadline) break;
    await sleep(5000);
  }
  // Régler les lots vides éventuels puis le nôtre, par un TIERS (l'opérateur n'a aucun rôle)
  const stranger = walletFor(opKey);
  // Régler, dans l'ordre, les lots antérieurs (vides ou non) puis le nôtre.
  for (;;) {
    const k = (await read("nextToSettle")) as bigint;
    if (k >= batch) break;
    const n = (await read("orderCount", [k])) as bigint;
    if (n === 0n) { await send(stranger, "startSettlement", [0n, []]); continue; }
    const tk = (await read("batchDeadline", [k])) as bigint;
    const r = await send(stranger, "startSettlement", [await hintAt(tk), []]);
    if (!viem.parseEventLogs({ abi, logs: r.logs, eventName: "SettlementStarted" }).length) throw new Error(`lot ${k} reporté`);
    for (;;) {
      const rs = await send(stranger, "settleStep", [8n]);
      if (viem.parseEventLogs({ abi, logs: rs.logs, eventName: "BatchSettled" }).length) break;
    }
    console.log(`  lot antérieur ${k} (${n} ordre) réglé`);
  }
  const hint = await hintAt(deadline);
  const r0 = await send(stranger, "startSettlement", [hint, []]);
  const ev = viem.parseEventLogs({ abi, logs: r0.logs });
  console.log("  startSettlement :", ev.map((e: any) => `${e.eventName}(${Object.values(e.args).join(", ")})`).join(" ; "));
  if (!ev.some((e: any) => e.eventName === "SettlementStarted")) return;
  for (;;) {
    const r = await send(stranger, "settleStep", [8n]);
    if (viem.parseEventLogs({ abi, logs: r.logs, eventName: "BatchSettled" }).length) break;
  }
  const t0 = Date.now();
  const fills: string[] = [];
  for (let i = 0; i < 2; i++) {
    for (;;) {
      try {
        const h = await read("lastFillOf", [traders[i].account.address]);
        fills[i] = String(await clients[i].decryptForView(h, FheTypes.Uint64).execute());
        break;
      } catch { await sleep(2000); }
    }
  }
  console.log(`  exécutions lues après ${((Date.now() - t0) / 1000).toFixed(1)} s :`, fills, "(attendu : 7 et 7)");
}
/** Règle, dans l'ordre et sans permission, tous les lots déjà fermés, puis lit les exécutions. */
async function settleOnly(traders: any[], opKey: `0x${string}`) {
  const stranger = walletFor(opKey);
  const now = (await pc.getBlock()).timestamp as bigint;
  for (;;) {
    const k = (await read("nextToSettle")) as bigint;
    const tk = (await read("batchDeadline", [k])) as bigint;
    if (tk > now) break;
    const n = (await read("orderCount", [k])) as bigint;
    const r = await send(stranger, "startSettlement", [n === 0n ? 0n : await hintAt(tk), []]);
    const evs = viem.parseEventLogs({ abi, logs: r.logs });
    console.log(`  lot ${k} (${n} ordres) :`, evs.map((e: any) => `${e.eventName}(${Object.values(e.args).map(String).join(", ")})`).join(" ; "));
    if (evs.some((e: any) => e.eventName === "BatchSkippedEmpty")) { await sleep(3000); continue; }
    if (!evs.some((e: any) => e.eventName === "SettlementStarted")) throw new Error(`lot ${k} reporté`);
    const t0 = Date.now();
    for (;;) {
      const rs = await send(stranger, "settleStep", [8n]);
      if (viem.parseEventLogs({ abi, logs: rs.logs, eventName: "BatchSettled" }).length) break;
    }
    console.log(`    réglé on-chain en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await sleep(3000); // laisser le RPC refléter le nouvel état
  }
  for (let i = 0; i < traders.length; i++) {
    const c = createCofheClient(createCofheConfig({ environment: "node", supportedChains: [getChainById(84532)!] }));
    await c.connect(pc, traders[i]);
    await c.acp.createSelf({ issuer: traders[i].account.address });
    const t0 = Date.now();
    for (;;) {
      try {
        const v = await c.decryptForView(await read("lastFillOf", [traders[i].account.address]), FheTypes.Uint64).execute();
        console.log(`  trader ${i + 1} : dernière exécution ${v} (lue en ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
        break;
      } catch { await sleep(2000); }
    }
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
