// Phase 0 de S1 : latence RÉELLE d'un lot d'ordres chiffrés sur Base Sepolia (CoFHE).
// Lancer : N=16 npx hardhat run scripts/latency-live.ts --network base-sepolia
//
// 1. Déploie SealedBatchPool (version de production : vrais ordres chiffrés).
// 2. Dérive N wallets de traders depuis PRIVATE_KEY (un ordre par trader et par lot)
//    et les approvisionne avec un peu d'ETH de test.
// 3. Chaque trader chiffre son ordre avec @cofhe/sdk (vérifieur Fhenix) et le soumet.
// 4. L'opérateur règle le lot (settleStep par pas de 8 ordres).
// 5. Chronomètre, pour chaque trader, le délai jusqu'à ce qu'il puisse déchiffrer son
//    exécution (calcul FHE du coprocesseur + déchiffrement par le réseau de seuil).
import hre from "hardhat";
import fs from "fs";
import path from "path";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { createCofheConfig, createCofheClient } from "@cofhe/sdk/node";
import { getChainById } from "@cofhe/sdk/chains";

// viem résolu depuis @cofhe/sdk (même version que le SDK).
// eslint-disable-next-line @typescript-eslint/no-var-requires
const viem = require(require.resolve("viem", { paths: [require.resolve("@cofhe/sdk")] }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const viemAccounts = require(require.resolve("viem/accounts", { paths: [require.resolve("@cofhe/sdk")] }));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const viemChains = require(require.resolve("viem/chains", { paths: [require.resolve("@cofhe/sdk")] }));

const N = Number(process.env.N || 16);
const STEP = Number(process.env.STEP || 8);
const FUND_WEI = hre.ethers.parseEther(process.env.FUND_ETH || "0.0003");
const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const now = () => performance.now() / 1000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function cofheClientFor(privateKey: `0x${string}`) {
  const chain = getChainById(84532)!;
  const account = viemAccounts.privateKeyToAccount(privateKey);
  const publicClient = viem.createPublicClient({ chain: viemChains.baseSepolia, transport: viem.http(RPC) });
  const walletClient = viem.createWalletClient({ account, chain: viemChains.baseSepolia, transport: viem.http(RPC) });
  const client = createCofheClient(createCofheConfig({ environment: "node", supportedChains: [chain] }));
  await client.connect(publicClient, walletClient);
  await client.acp.createSelf({ issuer: account.address });
  return client;
}

async function main() {
  const { ethers, network } = hre;
  if (network.name !== "base-sepolia" && !process.env.FORK_URL) throw new Error("À lancer avec --network base-sepolia");
  const [operator] = await ethers.getSigners();
  const bal = await ethers.provider.getBalance(operator.address);
  console.log(`Opérateur ${operator.address} — solde ${ethers.formatEther(bal)} ETH — N=${N}`);

  const log: Record<string, unknown> = { date: new Date().toISOString(), n: N, step: STEP };

  // 1. Déploiement
  let t = now();
  const f = await ethers.getContractFactory("SealedBatchPool");
  const pool = await f.connect(operator).deploy(operator.address);
  await pool.waitForDeployment();
  const poolAddress = await pool.getAddress();
  console.log(`SealedBatchPool déployé : ${poolAddress} (${(now() - t).toFixed(1)} s)`);
  log.pool = poolAddress;

  // 2. Traders dérivés et approvisionnés
  const baseKey = process.env.PRIVATE_KEY!;
  const traders = Array.from({ length: N }, (_, i) =>
    new ethers.Wallet(ethers.keccak256(ethers.solidityPacked(["bytes32", "uint256"], [baseKey, i])), ethers.provider),
  );
  let nonce = await ethers.provider.getTransactionCount(operator.address, "pending");
  const fundTxs = [];
  for (const w of traders) {
    if ((await ethers.provider.getBalance(w.address)) < FUND_WEI / 2n) {
      fundTxs.push(await operator.sendTransaction({ to: w.address, value: FUND_WEI, nonce: nonce++ }));
    }
  }
  await Promise.all(fundTxs.map((tx) => tx.wait()));
  console.log(`${fundTxs.length} traders approvisionnés`);

  // 3. Chiffrement et soumission des ordres
  const clients: any[] = [];
  const encTimes: number[] = [];
  const submitGas: bigint[] = [];
  const expected: { isBuy: boolean; qty: bigint }[] = [];
  for (let i = 0; i < N; i++) {
    const w = traders[i];
    const p = pool.connect(w) as any;
    await (await p.claimFaucet()).wait();
    const client = await cofheClientFor(w.privateKey as `0x${string}`);
    clients.push(client);
    const isBuy = i % 2 === 0;
    const qty = BigInt(5 + i);
    expected.push({ isBuy, qty });
    t = now();
    // Deux entrées chiffrées séparément (chacune avec sa preuve), en parallèle.
    const [[side, proofSide], [amount, proofQty]] = (await Promise.all([
      client.encryptInputs([Encryptable.bool(isBuy)]).setConsumingContract(poolAddress).execute(),
      client.encryptInputs([Encryptable.uint64(qty)]).setConsumingContract(poolAddress).execute(),
    ])) as any[];
    encTimes.push(now() - t);
    const r = await (await p.submitOrder(side, proofSide, amount, proofQty)).wait();
    submitGas.push(r.gasUsed);
    console.log(`  ordre ${i + 1}/${N} soumis (chiffrement ${encTimes[i].toFixed(1)} s, gas ${r.gasUsed})`);
  }

  // 4. Règlement
  const tSettle0 = now();
  const settleGas: bigint[] = [];
  let r = await (await pool.connect(operator).startSettlement(2500n)).wait();
  settleGas.push(r!.gasUsed);
  let done = false;
  while (!done) {
    done = await pool.connect(operator).settleStep.staticCall(STEP);
    r = await (await pool.connect(operator).settleStep(STEP)).wait();
    settleGas.push(r!.gasUsed);
  }
  const tSettled = now();
  console.log(`Lot réglé on-chain en ${(tSettled - tSettle0).toFixed(1)} s (${settleGas.length} tx)`);

  // 5. Latence jusqu'au déchiffrement de chaque exécution
  const ready: (number | null)[] = Array(N).fill(null);
  const fills: (bigint | null)[] = Array(N).fill(null);
  const deadline = tSettled + Number(process.env.TIMEOUT_S || 600);
  while (ready.some((x) => x === null) && now() < deadline) {
    await Promise.all(
      traders.map(async (w, i) => {
        if (ready[i] !== null) return;
        try {
          const h = await pool.lastFillOf(w.address);
          const v = await clients[i].decryptForView(h, FheTypes.Uint64).execute();
          fills[i] = BigInt(v);
          ready[i] = now() - tSettled;
        } catch {
          /* pas encore calculé */
        }
      }),
    );
    if (ready.some((x) => x === null)) await sleep(2000);
  }

  const got = ready.filter((x): x is number => x !== null).sort((a, b) => a - b);
  const pct = (q: number) => (got.length ? got[Math.min(got.length - 1, Math.floor(q * got.length))] : NaN);
  const sum = (a: bigint[]) => a.reduce((x, y) => x + y, 0n);
  Object.assign(log, {
    encryptSecondsAvg: encTimes.reduce((a, b) => a + b, 0) / N,
    submitGasAvg: (sum(submitGas) / BigInt(N)).toString(),
    settleGasTotal: sum(settleGas).toString(),
    settleTxs: settleGas.length,
    onchainSettleSeconds: tSettled - tSettle0,
    decryptReadySeconds: { first: got[0], median: pct(0.5), p90: pct(0.9), last: got[got.length - 1], ready: got.length, of: N },
    fills: fills.map((x) => (x === null ? null : x.toString())),
  });
  console.log(JSON.stringify(log, null, 2));
  const out = path.join(__dirname, "../deployments/latency-base-sepolia.json");
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(log, null, 2) + "\n");
  console.log(`Résultats écrits dans ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
