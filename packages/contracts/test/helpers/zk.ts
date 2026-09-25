// Outils ZK pour les tests : arbre de Merkle Poseidon (identique à ShieldedEntry) et génération
// de preuves UltraHonk avec nargo + bb (chaîne installée : ~/.nargo/bin, ~/.bb).
import { execFileSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { poseidon2 } from "poseidon-lite";

export const SNARK_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const DEPTH = 20;
const CIRCUIT_DIR = path.join(__dirname, "../../../circuits/claim");
const BIN = [path.join(os.homedir(), ".nargo/bin"), path.join(os.homedir(), ".bb")].join(":");
const ENV = { ...process.env, PATH: `${BIN}:${process.env.PATH}` };

export const H = (a: bigint, b: bigint) => poseidon2([a, b]);

export function randomField(): bigint {
  return BigInt("0x" + Buffer.from(crypto.getRandomValues(new Uint8Array(31))).toString("hex")) % SNARK_FIELD;
}

export function zeros(): bigint[] {
  const z = [0n];
  for (let i = 0; i < DEPTH; i++) z.push(H(z[i], z[i]));
  return z;
}

/** Arbre incrémental : même algorithme que ShieldedEntry._insert. */
export class Tree {
  leaves: bigint[] = [];
  z = zeros();
  insert(leaf: bigint) {
    this.leaves.push(leaf);
  }
  private level(nodes: bigint[], lvl: number): bigint[] {
    const out: bigint[] = [];
    for (let i = 0; i < nodes.length; i += 2) out.push(H(nodes[i], i + 1 < nodes.length ? nodes[i + 1] : this.z[lvl]));
    return out;
  }
  root(): bigint {
    let nodes = [...this.leaves];
    for (let l = 0; l < DEPTH; l++) nodes = nodes.length ? this.level(nodes, l) : [this.z[l + 1]];
    return nodes[0];
  }
  proof(index: number): { path: bigint[]; bits: number[] } {
    let nodes = [...this.leaves];
    const p: bigint[] = [];
    const bits: number[] = [];
    let idx = index;
    for (let l = 0; l < DEPTH; l++) {
      const sib = idx ^ 1;
      p.push(sib < nodes.length ? nodes[sib] : this.z[l]);
      bits.push(idx & 1);
      nodes = this.level(nodes, l);
      idx >>= 1;
    }
    return { path: p, bits };
  }
}

export type Note = { nk: bigint; secret: bigint; commitment: bigint; nullifier: bigint };

export function newNote(): Note {
  const nk = randomField();
  const secret = randomField();
  return { nk, secret, commitment: H(nk, secret), nullifier: H(nk, nk) };
}

const hex = (x: bigint) => "0x" + x.toString(16);

/** Génère une preuve UltraHonk (cible evm, ZK) pour réclamer `note`. */
export function proveClaim(args: {
  note: Note;
  tree: Tree;
  index: number;
  recipient: string;
  relayer: string;
  fee: bigint;
}): { proof: string; publicInputs: string[] } {
  const { path: p, bits } = args.tree.proof(args.index);
  const tag = `t${process.pid}_${Date.now()}`;
  const toml = [
    `nk = "${hex(args.note.nk)}"`,
    `secret = "${hex(args.note.secret)}"`,
    `path = [${p.map((x) => `"${hex(x)}"`).join(", ")}]`,
    `index_bits = [${bits.join(", ")}]`,
    `root = "${hex(args.tree.root())}"`,
    `nullifier = "${hex(args.note.nullifier)}"`,
    `recipient = "${args.recipient.toLowerCase()}"`,
    `relayer = "${args.relayer.toLowerCase()}"`,
    `fee = "${hex(args.fee)}"`,
  ].join("\n");
  fs.writeFileSync(path.join(CIRCUIT_DIR, `Prover_${tag}.toml`), toml);
  const out = fs.mkdtempSync(path.join(os.tmpdir(), "claim-"));
  try {
    execFileSync("nargo", ["execute", "-p", `Prover_${tag}`, `w_${tag}`], { cwd: CIRCUIT_DIR, env: ENV, stdio: "pipe" });
    execFileSync(
      "bb",
      ["prove", "-b", "target/claim.json", "-w", `target/w_${tag}.gz`, "-o", out, "-t", "evm"],
      { cwd: CIRCUIT_DIR, env: ENV, stdio: "pipe" },
    );
    const proof = "0x" + fs.readFileSync(path.join(out, "proof")).toString("hex");
    const pi = fs.readFileSync(path.join(out, "public_inputs"));
    const publicInputs: string[] = [];
    for (let i = 0; i < pi.length; i += 32) publicInputs.push("0x" + pi.subarray(i, i + 32).toString("hex"));
    return { proof, publicInputs };
  } finally {
    fs.rmSync(path.join(CIRCUIT_DIR, `Prover_${tag}.toml`), { force: true });
    fs.rmSync(path.join(CIRCUIT_DIR, `target/w_${tag}.gz`), { force: true });
    fs.rmSync(out, { recursive: true, force: true });
  }
}
