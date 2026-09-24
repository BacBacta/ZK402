// Phase 0 de S1 : latence RÉELLE d'un lot d'ordres chiffrés sur Base Sepolia (CoFHE),
// en script autonome (hors Hardhat : dans le processus Hardhat, les appels du SDK vers
// le vérifieur Fhenix échouaient ; hors Hardhat ils passent).
//
// Lancer (depuis packages/contracts, après `npx hardhat compile`) :
//   set -a && . ../../.env && set +a
//   NODE_USE_ENV_PROXY=1 N=16 npx ts-node --transpile-only scripts/latency-standalone.ts
import fs from "fs";
import path from "path";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { createCofheConfig, createCofheClient } from "@cofhe/sdk/node";
import { getChainById } from "@cofhe/sdk/chains";

const req = (m: string) => require(require.resolve(m, { paths: [require.resolve("@cofhe/sdk")] }));
const viem = req("viem");
const { privateKeyToAccount } = req("viem/accounts");
const { baseSepolia } = req("viem/chains");

const N = Number(process.env.N || 16);
const STEP = BigInt(process.env.STEP || 8);
const FUND_WEI = viem.parseEther(process.env.FUND_ETH || "0.0003");
const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const TIMEOUT_S = Number(process.env.TIMEOUT_S || 900);
const now = () => performance.now() / 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function retry<T>(label: string, fn: () => Promise<T>, tries = 6): Promise<T> {
  for (let k = 1; ; k++) {
    try {
      return await fn();
    } catch (e: any) {
      if (k >= tries) throw e;
      console.log(`  ${label} : échec (${e?.code || e?.shortMessage || e?.message}), tentative ${k + 1}/${tries}`);
      await sleep(4000 * k);
    }
  }
}

const artifact = JSON.parse(
  fs.readFileSync(path.join(__dirname, "../artifacts/contracts/SealedBatchPool.sol/SealedBatchPool.json"), "utf8"),
);
const abi = artifact.abi;
const publicClient = viem.createPublicClient({ chain: baseSepolia, transport: viem.http(RPC) });

function walletFor(pk: `0x${string}`) {
  const account = privateKeyToAccount(pk);
  return viem.createWalletClient({ account, chain: baseSepolia, transport: viem.http(RPC) });
}

// Plafonds de gas explicites : l'estimation du nœud sous-évalue les appels au
// TaskManager CoFHE (un settleStep estimé à 810 k a échoué à court de gas).
const GAS: Record<string, bigint> = {
  claimFaucet: 1_000_000n,
  submitOrder: 1_500_000n,
  startSettlement: 1_000_000n,
  settleStep: 12_000_000n,
};

async function send(wallet: any, fn: string, args: unknown[], address: `0x${string}`) {
  const hash = await retry(`${fn}`, () =>
    wallet.writeContract({ address, abi, functionName: fn, args, gas: GAS[fn] }),
  );
  const r = await publicClient.waitForTransactionReceipt({ hash });
  if (r.status !== "success") throw new Error(`${fn} a échoué (tx ${hash})`);
  return r;
}

async function cofheFor(wallet: any) {
  const client = createCofheClient(
    createCofheConfig({ environment: "node", supportedChains: [getChainById(84532)!] }),
  );
  await client.connect(publicClient, wallet);
  await client.acp.createSelf({ issuer: wallet.account.address });
  return client;
}

async function main() {
  const opKey = process.env.PRIVATE_KEY as `0x${string}`;
  const operator = walletFor(opKey);
  const bal = await publicClient.getBalance({ address: operator.account.address });
  console.log(`Opérateur ${operator.account.address} — ${viem.formatEther(bal)} ETH — N=${N}`);
  const log: Record<string, unknown> = { date: new Date().toISOString(), network: "base-sepolia", n: N };

  // 1. Déploiement
  const deployHash = await operator.deployContract({ abi, bytecode: artifact.bytecode, args: [operator.account.address] });
  const dep = await publicClient.waitForTransactionReceipt({ hash: deployHash });
  const pool = dep.contractAddress as `0x${string}`;
  console.log(`SealedBatchPool déployé : ${pool}`);
  log.pool = pool;
  log.deployTx = deployHash;

  // 2. Traders (clés dérivées de la clé opérateur, suffixe distinct du script Hardhat)
  const traders = Array.from({ length: N }, (_, i) =>
    walletFor(viem.keccak256(viem.encodePacked(["bytes32", "string", "uint256"], [opKey, "trader", BigInt(i)]))),
  );
  for (const w of traders) {
    if ((await publicClient.getBalance({ address: w.account.address })) < FUND_WEI / 2n) {
      const h = await operator.sendTransaction({ to: w.account.address, value: FUND_WEI });
      await publicClient.waitForTransactionReceipt({ hash: h });
    }
  }
  console.log(`${N} traders prêts`);

  // 3. Chiffrement et soumission
  const clients: any[] = [];
  const encTimes: number[] = [];
  const submitGas: bigint[] = [];
  for (let i = 0; i < N; i++) {
    const w = traders[i];
    await send(w, "claimFaucet", [], pool);
    const client = await retry(`client ${i + 1}`, () => cofheFor(w));
    clients.push(client);
    const isBuy = i % 2 === 0;
    const qty = BigInt(5 + i);
    let t = now();
    const [side, proofSide] = (await retry(`chiffrement sens ${i + 1}`, () =>
      client.encryptInputs([Encryptable.bool(isBuy)]).setConsumingContract(pool).execute(),
    )) as any;
    const [amount, proofQty] = (await retry(`chiffrement quantité ${i + 1}`, () =>
      client.encryptInputs([Encryptable.uint64(qty)]).setConsumingContract(pool).execute(),
    )) as any;
    encTimes.push(now() - t);
    const r = await send(w, "submitOrder", [side, proofSide, amount, proofQty], pool);
    submitGas.push(r.gasUsed);
    console.log(`  ordre ${i + 1}/${N} (${isBuy ? "achat" : "vente"} ${qty}) : chiffrement ${encTimes[i].toFixed(1)} s, gas ${r.gasUsed}`);
  }

  // 4. Règlement
  const tSettle0 = now();
  const settleGas: bigint[] = [];
  settleGas.push((await send(operator, "startSettlement", [2500n], pool)).gasUsed);
  for (;;) {
    const r = await send(operator, "settleStep", [STEP], pool);
    settleGas.push(r.gasUsed);
    // Fin du lot : l'événement BatchSettled est émis dans le reçu.
    const settled = viem.parseEventLogs({ abi, logs: r.logs, eventName: "BatchSettled" });
    if (settled.length > 0) break;
  }
  const tSettled = now();
  console.log(`Lot réglé on-chain en ${(tSettled - tSettle0).toFixed(1)} s (${settleGas.length} tx)`);

  // 5. Délai jusqu'au déchiffrement de chaque exécution
  const ready: (number | null)[] = Array(N).fill(null);
  const fills: (string | null)[] = Array(N).fill(null);
  let lastErr = "";
  while (ready.some((x) => x === null) && now() - tSettled < TIMEOUT_S) {
    await Promise.all(
      traders.map(async (w, i) => {
        if (ready[i] !== null) return;
        try {
          const h = await publicClient.readContract({ address: pool, abi, functionName: "lastFillOf", args: [w.account.address] });
          const v = await clients[i].decryptForView(h, FheTypes.Uint64).execute();
          fills[i] = String(v);
          ready[i] = now() - tSettled;
          console.log(`  trader ${i + 1} : exécution ${v} lisible après ${ready[i]!.toFixed(1)} s`);
        } catch (e: any) {
          lastErr = e?.code || e?.message || String(e);
        }
      }),
    );
    if (ready.some((x) => x === null)) await sleep(2000);
  }

  const got = ready.filter((x): x is number => x !== null).sort((a, b) => a - b);
  const q = (p: number) => (got.length ? got[Math.min(got.length - 1, Math.floor(p * got.length))] : null);
  const sum = (a: bigint[]) => a.reduce((x, y) => x + y, 0n);
  Object.assign(log, {
    encryptSecondsPerOrderAvg: encTimes.reduce((a, b) => a + b, 0) / N,
    submitGasAvg: String(sum(submitGas) / BigInt(N)),
    settleGasTotal: String(sum(settleGas)),
    settleTxs: settleGas.length,
    onchainSettleSeconds: tSettled - tSettle0,
    decryptReadySeconds: { first: got[0] ?? null, median: q(0.5), p90: q(0.9), last: got[got.length - 1] ?? null, ready: got.length, of: N },
    fills,
    lastDecryptError: got.length < N ? lastErr : undefined,
  });
  console.log(JSON.stringify(log, null, 2));
  const out = path.join(__dirname, "../deployments/latency-base-sepolia.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(log, null, 2) + "\n");
  console.log(`Résultats : ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
