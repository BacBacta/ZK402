// Génère Prover.toml : note (nk, secret) insérée à l'index 5 d'un arbre de profondeur 20
// (Poseidon compatible circomlib, comme le contrat Base).
const { poseidon2 } = require("../../contracts/node_modules/poseidon-lite");
const DEPTH = 20, INDEX = 5;
const nk = 123456789n, secret = 987654321n;
const recipient = BigInt(process.argv[2] || "0xabc"), relayer = 0xdefn, fee = 1n;
const zeros = [0n];
for (let i = 0; i < DEPTH; i++) zeros.push(poseidon2([zeros[i], zeros[i]]));
const leaf = poseidon2([nk, secret]);
// feuilles 0..4 = zéro sauf la note en 5 ; chemin = frères (feuille 4 = 0, puis sous-arbres vides)
let node = leaf; const path = []; const bits = [];
for (let i = 0; i < DEPTH; i++) {
  const b = (INDEX >> i) & 1;
  // frère gauche au niveau 0 (index 4) et au niveau 2 (sous-arbre [0..3]) : vides ici
  const sib = zeros[i];
  path.push(sib); bits.push(b === 1);
  node = b ? poseidon2([sib, node]) : poseidon2([node, sib]);
}
const toml = [
  `nk = "${nk}"`, `secret = "${secret}"`,
  `path = [${path.map((x) => `"${x}"`).join(", ")}]`,
  `index_bits = [${bits.join(", ")}]`,
  `root = "${node}"`, `nullifier = "${poseidon2([nk, nk])}"`,
  `recipient = "${recipient}"`, `relayer = "${relayer}"`, `fee = "${fee}"`,
].join("\n") + "\n";
require("fs").writeFileSync(__dirname + "/Prover.toml", toml);
console.log(JSON.stringify({ root: "0x" + node.toString(16), nullifier: "0x" + poseidon2([nk, nk]).toString(16), leaf: "0x" + leaf.toString(16) }));
