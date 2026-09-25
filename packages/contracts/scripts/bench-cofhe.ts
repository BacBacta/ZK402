// Micro-banc RÉEL du coprocesseur CoFHE (Base Sepolia) : débit par largeur (16/32/64 bits) et par
// opération, parallélisme (indépendant vs chaîné). Mesure = délai entre la confirmation de la
// transaction et la disponibilité du DERNIER résultat (déchiffrement public).
// Lancer : set -a && . ../../.env && set +a && NODE_USE_ENV_PROXY=1 npx ts-node --transpile-only scripts/bench-cofhe.ts
import fs from "fs";
import path from "path";
import { Encryptable } from "@cofhe/sdk";
import { createCofheConfig, createCofheClient } from "@cofhe/sdk/node";
import { getChainById } from "@cofhe/sdk/chains";

const req = (m: string) => require(require.resolve(m, { paths: [require.resolve("@cofhe/sdk")] }));
const viem = req("viem");
const { privateKeyToAccount } = req("viem/accounts");
const { baseSepolia } = req("viem/chains");
const RPC = process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => performance.now() / 1000;
const art = JSON.parse(fs.readFileSync(path.join(__dirname, "../artifacts/contracts/test/FheBench.sol/FheBench.json"), "utf8"));
const pc = viem.createPublicClient({ chain: baseSepolia, transport: viem.http(RPC) });
const op = viem.createWalletClient({ account: privateKeyToAccount(process.env.PRIVATE_KEY), chain: baseSepolia, transport: viem.http(RPC) });
const OPS = ["add", "min", "mul", "gte+sub+select"];
const K = Number(process.env.K || 40);

async function main() {
  const dh = await op.deployContract({ abi: art.abi, bytecode: art.bytecode, gas: 5_000_000n });
  const bench = (await pc.waitForTransactionReceipt({ hash: dh })).contractAddress as string;
  console.log("FheBench", bench);
  await sleep(4000);
  const client = createCofheClient(createCofheConfig({ environment: "node", supportedChains: [getChainById(84532)!] }));
  await client.connect(pc, op);
  const r = (await client.encryptInputs([Encryptable.uint16(1000n), Encryptable.uint32(1000n), Encryptable.uint64(1000n)]).setConsumingContract(bench).execute()) as any[];
  await pc.waitForTransactionReceipt({ hash: await op.writeContract({ address: bench, abi: art.abi, functionName: "setSeeds", args: [r[0], r[1], r[2], r[3]], gas: 2_000_000n }) });
  console.log("graines enregistrées");

  const plan: [number, number, boolean, number][] = [];
  if (process.env.PLAN === "parallel") {
    // Opérations INDÉPENDANTES à opérandes tous distincts : la latence reste-t-elle plate quand k croît ?
    for (const w of [16, 64]) {
      plan.push([w, 2, false, 5], [w, 2, false, 20], [w, 2, false, 40], [w, 0, false, 10], [w, 0, false, 80]);
    }
  } else if (process.env.PLAN === "extra") {
    // Parallélisme des multiplications et pente (coût marginal) des chaînes.
    for (const w of [16, 64]) {
      plan.push([w, 2, false, 10], [w, 2, false, 20], [w, 2, true, 20], [w, 0, true, 80], [w, 3, true, 60]);
    }
  } else for (const w of [16, 32, 64]) {
    plan.push([w, 0, true, K]); // add chaîné
    plan.push([w, 1, true, K]); // min chaîné
    plan.push([w, 3, true, K]); // motif du règlement chaîné
    plan.push([w, 2, true, Math.max(5, K / 4)]); // mul chaîné
    plan.push([w, 0, false, K]); // add indépendants
  }
  const results: any[] = [];
  for (const [w, o, chained, k] of plan) {
    const hash = await op.writeContract({ address: bench, abi: art.abi, functionName: "run", args: [w, o, chained, k], gas: 16_000_000n });
    const rc = await pc.waitForTransactionReceipt({ hash });
    const t0 = now();
    const ev = viem.parseEventLogs({ abi: art.abi, logs: rc.logs, eventName: "Run" })[0];
    const handles: string[] = ev.args.handles;
    const pending = new Set(handles);
    while (pending.size && now() - t0 < 600) {
      await Promise.all([...pending].map(async (h) => {
        try { await client.decryptForTx(h).withoutACP().execute(); pending.delete(h); } catch { /* pas prêt */ }
      }));
      if (pending.size) await sleep(1000);
    }
    const latency = now() - t0;
    const opsPerTx = chained ? k : k; // opérations FHE du motif (hors chiffrements triviaux)
    const fheOps = o === 3 ? 3 * k : k;
    const row = { width: w, op: OPS[o], chained, k, fheOps, gas: String(rc.gasUsed), latencySeconds: +latency.toFixed(2), opsPerSecond: +(fheOps / latency).toFixed(2), complete: pending.size === 0 };
    results.push(row);
    console.log(row);
  }
  fs.writeFileSync(path.join(__dirname, `../deployments/bench-cofhe-base-sepolia${process.env.PLAN ? "-" + process.env.PLAN : ""}.json`), JSON.stringify({ date: new Date().toISOString(), bench, K, results }, null, 2) + "\n");
}
main().catch((e) => { console.error(e); process.exit(1); });
