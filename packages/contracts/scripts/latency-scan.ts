// P3 — latence RÉELLE du règlement par scan (Base Sepolia), script autonome.
// 1. Déploie SealedBatchPoolV2 (mode démo : faucet, sans entrée ni frais), vrais oracles.
// 2. Chiffre les N ordres À L'AVANCE (preuve unique sens + quantité), en mesurant le temps.
// 3. Les soumet dans un même lot, attend la clôture, règle sans permission par pas de STEP.
// 4. Mesure le délai jusqu'à ce que CHAQUE trader puisse déchiffrer son exécution.
// Lancer : set -a && . ../../.env && set +a
//          NODE_USE_ENV_PROXY=1 N=16 npx ts-node --transpile-only scripts/latency-scan.ts
import fs from "fs";
import path from "path";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { createCofheConfig, createCofheClient } from "@cofhe/sdk/node";
import { getChainById } from "@cofhe/sdk/chains";
import { BASE_SEPOLIA_ORACLES } from "./oracles-base-sepolia";

const req = (m: string) => require(require.resolve(m, { paths: [require.resolve("@cofhe/sdk")] }));
const viem = req("viem");
const { privateKeyToAccount } = req("viem/accounts");
const { baseSepolia } = req("viem/chains");
const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const N = Number(process.env.N || 16);
const STEP = BigInt(process.env.STEP || 8);
const DURATION = BigInt(process.env.DURATION || 300);
const FUND = viem.parseEther(process.env.FUND_ETH || "0.0001");
const now = () => performance.now() / 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const art = JSON.parse(fs.readFileSync(path.join(__dirname, "../artifacts/contracts/SealedBatchPoolV2.sol/SealedBatchPoolV2.json"), "utf8"));
const abi = art.abi;
const clAbi = viem.parseAbi([
  "function latestRoundData() view returns (uint80,int256,uint256,uint256,uint80)",
  "function getRoundData(uint80) view returns (uint80,int256,uint256,uint256,uint80)",
]);
const pc = viem.createPublicClient({ chain: baseSepolia, transport: viem.http(RPC) });
const walletFor = (pk: `0x${string}`) => viem.createWalletClient({ account: privateKeyToAccount(pk), chain: baseSepolia, transport: viem.http(RPC) });

async function retry<T>(label: string, fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let k = 1; ; k++) {
    try { return await fn(); } catch (e: any) {
      if (k >= tries) throw e;
      console.log(`  ${label} : échec (${e?.code || e?.shortMessage || e?.message}), tentative ${k + 1}`);
      await sleep(4000 * k);
    }
  }
}
async function send(w: any, address: string, fn: string, args: unknown[], gas: bigint) {
  const hash = await retry(fn, () => w.writeContract({ address, abi, functionName: fn, args, gas }));
  const r = await pc.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${fn} a échoué (${hash})`);
  return r;
}
const read = (address: string, fn: string, args: unknown[] = []) => pc.readContract({ address, abi, functionName: fn, args });
async function hintAt(t: bigint) {
  const [latest] = await pc.readContract({ address: BASE_SEPOLIA_ORACLES.chainlinkFeed, abi: clAbi, functionName: "latestRoundData" });
  let id = latest as bigint;
  for (;;) {
    const r = await pc.readContract({ address: BASE_SEPOLIA_ORACLES.chainlinkFeed, abi: clAbi, functionName: "getRoundData", args: [id] });
    if ((r[3] as bigint) <= t) return id;
    id -= 1n;
  }
}

async function main() {
  const opKey = process.env.PRIVATE_KEY as `0x${string}`;
  const op = walletFor(opKey);
  const log: Record<string, unknown> = { date: new Date().toISOString(), network: "base-sepolia", n: N, step: String(STEP), algorithm: process.env.HOLD_APPLY === "1" ? "deux vitesses, Apply retenu (contrôle)" : "deux vitesses + délai de grâce on-chain avant Apply + preuve unique" };

  // 1. Déploiement (mode démo), ou reprise sur un pool existant (RESUME_POOL) dont le lot est chargé.
  const resume = process.env.RESUME_POOL;
  const pool = resume
    ? resume
    : ((await pc.waitForTransactionReceipt({
        hash: await op.deployContract({ abi, bytecode: art.bytecode, args: [BASE_SEPOLIA_ORACLES, 1_000_000_000n, DURATION, viem.zeroAddress, 0n], gas: 6_000_000n }),
      })).contractAddress as string);
  console.log("pool", pool);
  log.pool = pool;
  await sleep(4000);

  // 2. Traders, faucet, chiffrement à l'avance (preuve unique)
  const traders = Array.from({ length: N }, (_, i) =>
    walletFor(viem.keccak256(viem.encodePacked(["bytes32", "string", "uint256"], [opKey, "scan", BigInt(i)]))),
  );
  for (const w of traders) {
    if ((await pc.getBalance({ address: w.account.address })) < FUND / 2n) {
      const h = await op.sendTransaction({ to: w.account.address, value: FUND });
      await pc.waitForTransactionReceipt({ hash: h });
    }
  }
  const clients: any[] = [];
  const enc: any[] = [];
  const encTimes: number[] = [];
  const sides: boolean[] = [];
  const qtys: bigint[] = [];
  for (let i = 0; i < N; i++) {
    const w = traders[i];
    sides.push(i % 2 === 0);
    qtys.push(BigInt(5 + i));
    if (resume) {
      const c = createCofheClient(createCofheConfig({ environment: "node", supportedChains: [getChainById(84532)!] }));
      await c.connect(pc, w);
      await c.acp.createSelf({ issuer: w.account.address });
      clients.push(c);
      continue;
    }
    await send(w, pool, "claimFaucet", [], 1_000_000n);
    const c = createCofheClient(createCofheConfig({ environment: "node", supportedChains: [getChainById(84532)!] }));
    await c.connect(pc, w);
    await c.acp.createSelf({ issuer: w.account.address });
    clients.push(c);
    const t = now();
    enc.push(await retry("chiffrement", () => c.encryptInputs([Encryptable.bool(sides[i]), Encryptable.uint64(qtys[i])]).setConsumingContract(pool).execute()));
    encTimes.push(now() - t);
    console.log(`  ordre ${i + 1}/${N} chiffré (preuve unique) en ${encTimes[i].toFixed(1)} s`);
  }

  // 3. Soumission dans un lot neuf, clôture, règlement
  let batch: bigint;
  let deadline: bigint;
  const submitGas: bigint[] = [];
  if (resume) {
    batch = BigInt(process.env.RESUME_BATCH || "0");
    deadline = (await read(pool, "batchDeadline", [batch])) as bigint;
  } else {
    for (;;) {
      batch = (await read(pool, "currentBatch")) as bigint;
      deadline = (await read(pool, "batchDeadline", [batch])) as bigint;
      const ts = (await pc.getBlock()).timestamp as bigint;
      if (deadline - ts >= BigInt(Math.max(60, 4 * N))) break;
      await sleep(5000);
    }
    for (let i = 0; i < N; i++) {
      const [s, q, sig] = enc[i];
      const r = await send(traders[i], pool, "submitOrderBatched", [s, q, sig], 1_500_000n);
      submitGas.push(r.gasUsed);
    }
    console.log(`${N} ordres soumis dans le lot ${batch}`);
  }
  for (;;) {
    if (((await pc.getBlock()).timestamp as bigint) >= deadline) break;
    await sleep(5000);
  }
  // Lots antérieurs vides éventuels : passés sans oracle (n'importe qui peut le faire).
  for (;;) {
    const k = (await read(pool, "nextToSettle")) as bigint;
    if (k >= batch) break;
    if (((await read(pool, "orderCount", [k])) as bigint) !== 0n) throw new Error(`lot ${k} non vide inattendu`);
    await send(op, pool, "startSettlement", [0n, []], 500_000n);
    await sleep(3000);
  }
  const t0 = now();
  const gas: bigint[] = [];
  // Délai de lecture de chaque exécution, mesuré depuis le début du règlement et en parallèle
  // (règlement à deux vitesses : l'exécution est lisible dès la phase Fills, avant Apply).
  const ready: (number | null)[] = Array(N).fill(null);
  const fills: string[] = Array(N).fill("");
  let polling = true;
  const poller = (async () => {
    while (polling || (ready.some((x) => x === null) && now() - t0 < 1200)) {
      await Promise.all(traders.map(async (w, i) => {
        if (ready[i] !== null) return;
        try {
          const h = await read(pool, "lastFillOf", [w.account.address]);
          if (BigInt(h as any) === 0n) return;
          const v = await clients[i].decryptForView(h, FheTypes.Uint64).execute();
          fills[i] = String(v);
          ready[i] = now() - t0;
        } catch { /* pas encore */ }
      }));
      if (!ready.some((x) => x === null)) break;
      await sleep(2000);
    }
  })();
  const r0 = await send(op, pool, "startSettlement", [await hintAt(deadline), []], 1_500_000n);
  if (!viem.parseEventLogs({ abi, logs: r0.logs, eventName: "SettlementStarted" }).length) throw new Error("lot reporté (oracles)");
  gas.push(r0.gasUsed);
  let tFillsMined: number | null = null;
  // HOLD_APPLY=1 (expérience de contrôle) : la phase Apply n'est lancée qu'une fois toutes les
  // exécutions lues, pour isoler le coût de la phase Fills seule. Exige N multiple de STEP.
  const hold = process.env.HOLD_APPLY === "1";
  let steps = 0;
  for (;;) {
    if (hold && steps === N / Number(STEP)) {
      tFillsMined = now() - t0;
      polling = false;
      await poller;
      console.log(`phase Fills seule : dernière exécution lue à ${Math.max(...(ready as number[])).toFixed(1)} s`);
    }
    steps++;
    // Délai de grâce on-chain entre Fills et Apply (applyNotBefore).
    if (Number(await read(pool, "phase")) === 2) {
      if (tFillsMined === null) tFillsMined = now() - t0;
      const nb = (await read(pool, "applyNotBefore")) as bigint;
      while (((await pc.getBlock()).timestamp as bigint) < nb) await sleep(2000);
    }
    const r = await send(op, pool, "settleStep", [STEP], 15_000_000n);
    gas.push(r.gasUsed);
    const settled = viem.parseEventLogs({ abi, logs: r.logs, eventName: "BatchSettled" }).length > 0;
    if (tFillsMined === null && (settled || Number(await read(pool, "phase")) === 2)) tFillsMined = now() - t0;
    if (settled) break;
  }
  const tSettled = now();
  console.log(`réglé on-chain en ${(tSettled - t0).toFixed(1)} s, ${gas.length} tx (phase Fills minée à ${tFillsMined?.toFixed(1)} s)`);
  polling = false;
  await poller;

  // Vérification : FIFO de référence
  const tb = qtys.reduce((s, q, i) => s + (sides[i] ? q : 0n), 0n);
  const tsum = qtys.reduce((s, q, i) => s + (sides[i] ? 0n : q), 0n);
  let rb = tb < tsum ? tb : tsum;
  let rs = rb;
  const expected = qtys.map((q, i) => { const rem = sides[i] ? rb : rs; const f = q < rem ? q : rem; if (sides[i]) rb -= f; else rs -= f; return String(f); });
  const got = ready.filter((x): x is number => x !== null).sort((a, b) => a - b);
  const q = (p: number) => (got.length ? got[Math.min(got.length - 1, Math.floor(p * got.length))] : null);
  const sum = (a: bigint[]) => a.reduce((x, y) => x + y, 0n);
  Object.assign(log, {
    encryptSecondsPerOrderAvg: encTimes.length ? encTimes.reduce((a, b) => a + b, 0) / encTimes.length : "voir exécution précédente",
    submitGasAvg: submitGas.length ? String(sum(submitGas) / BigInt(submitGas.length)) : "voir exécution précédente",
    settleGasTotal: String(sum(gas)), settleTxs: gas.length, onchainSettleSeconds: tSettled - t0, fillsPhaseMinedSeconds: tFillsMined,
    decryptReadySeconds: { first: got[0] ?? null, median: q(0.5), p90: q(0.9), last: got[got.length - 1] ?? null, ready: got.length, of: N },
    fills, expected, correct: fills.every((f, i) => f === expected[i]),
  });
  console.log(JSON.stringify(log, null, 2));
  fs.writeFileSync(path.join(__dirname, `../deployments/latency-twospeed-n${N}${process.env.HOLD_APPLY === "1" ? "-hold" : ""}.json`), JSON.stringify(log, null, 2) + "\n");
}
main().catch((e) => { console.error(e); process.exit(1); });
