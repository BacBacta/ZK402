// P1 en réel sur Base Sepolia : déploiement (Poseidon, vérifieur UltraHonk, pool, entrée
// blindée), 2 dépôts publics, preuve ZK générée localement, réclamation anonyme par un relayeur
// vers une adresse NEUVE (jamais financée par le déposant).
// Lancer : set -a && . ../../.env && set +a && npx hardhat run scripts/live-p1.ts --network base-sepolia
import hre from "hardhat";
import fs from "fs";
import path from "path";
import { BASE_SEPOLIA_ORACLES } from "./oracles-base-sepolia";
import { Tree, newNote, proveClaim } from "../test/helpers/zk";

const STIPEND = hre.ethers.parseEther("0.0002");
// Unité BASE du pool = 0,0001 ETH ; palier 0,001 ETH = 10 unités ; allocation 0,0002 ETH = 2 unités.
const BASE_CLASS = { isBase: true, depositAmount: hre.ethers.parseEther("0.001"), poolAmount: 10n };
const STIPEND_UNITS = 2n;
const MAX_OUTFLOW_BPS = 2_000n;
const GAS = { gasLimit: 8_000_000n };
// Nonces gérés localement : le RPC public répond parfois avec un état en retard.
let NONCE = 0;
const tx = () => ({ ...GAS, nonce: NONCE++ });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const [op] = await hre.ethers.getSigners();
  const e = hre.ethers;
  console.log("Opérateur", op.address, e.formatEther(await e.provider.getBalance(op.address)), "ETH");
  NONCE = await e.provider.getTransactionCount(op.address, "pending");
  const poseidon = await (await e.getContractFactory("PoseidonT3")).deploy(tx());
  await poseidon.waitForDeployment();
  const lib = await (await e.getContractFactory("ZKTranscriptLib")).deploy(tx());
  await lib.waitForDeployment();
  const verifier = await (await e.getContractFactory("HonkVerifier", { libraries: { ZKTranscriptLib: await lib.getAddress() } })).deploy(tx());
  await verifier.waitForDeployment();
  const entryAddr = e.getCreateAddress({ from: op.address, nonce: NONCE + 1 });
  const pool = await (await e.getContractFactory("SealedBatchPoolV2")).deploy(
    BASE_SEPOLIA_ORACLES, 1_000_000_000n, 120n, entryAddr, 0n, tx(),
  );
  await pool.waitForDeployment();
  const Entry = await e.getContractFactory("ShieldedEntry", { libraries: { PoseidonT3: await poseidon.getAddress() } });
  const entry = await Entry.deploy(await pool.getAddress(), await verifier.getAddress(), e.ZeroAddress, STIPEND, MAX_OUTFLOW_BPS, STIPEND_UNITS, [BASE_CLASS], tx());
  await entry.waitForDeployment();
  if ((await entry.getAddress()) !== entryAddr) throw new Error("adresse d'entrée inattendue");
  const addrs = {
    poseidonT3: await poseidon.getAddress(), zkTranscriptLib: await lib.getAddress(), honkVerifier: await verifier.getAddress(),
    pool: await pool.getAddress(), entry: entryAddr,
  };
  console.log(addrs);

  // Deux dépôts publics (ensemble d'anonymat minimal de démonstration).
  const tree = new Tree();
  const notes = [newNote(), newNote()];
  for (const n of notes) {
    const r = await (await entry.deposit(0, n.commitment, { value: BASE_CLASS.depositAmount + STIPEND, ...tx() })).wait();
    tree.insert(n.commitment);
    console.log(`  dépôt : gas ${r!.gasUsed}`);
  }
  await sleep(3000);
  const onchainRoot = await entry.currentRoot(0);
  console.log("  racine on-chain = racine locale :", onchainRoot === tree.root());

  // Réclamation anonyme de la note n° 2 vers une adresse neuve, via l'opérateur comme relayeur.
  const pseudo = e.Wallet.createRandom();
  const fee = STIPEND / 4n;
  const t0 = Date.now();
  const { proof } = proveClaim({ note: notes[1], tree, index: 1, recipient: pseudo.address, relayer: op.address, fee });
  const proveS = (Date.now() - t0) / 1000;
  const claimTx = await entry.claim(0, proof, tree.root(), e.toBeHex(notes[1].nullifier, 32), pseudo.address, op.address, fee, tx());
  const r = await claimTx.wait();
  await sleep(3000);
  const pseudoEth = await e.provider.getBalance(pseudo.address);
  const credited = await pool.hasAccount(pseudo.address);
  const out = {
    date: new Date().toISOString(), network: "base-sepolia", ...addrs,
    depositGas: "voir journal", claimTx: claimTx.hash, claimGas: r!.gasUsed.toString(), proveSeconds: proveS,
    pseudonym: pseudo.address, pseudonymEth: e.formatEther(pseudoEth), pseudonymCreditedInPool: credited,
    nullifierSpent: await entry.nullifierSpent(e.toBeHex(notes[1].nullifier, 32)),
  };
  console.log(out);
  fs.writeFileSync(path.join(__dirname, "../deployments/p1-base-sepolia.json"), JSON.stringify(out, null, 2) + "\n");
}
main().catch((err) => { console.error(err); process.exit(1); });
