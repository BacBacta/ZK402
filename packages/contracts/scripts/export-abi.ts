// Copie l'ABI compilée de ConfidentialPaywall vers le front (packages/web).
import fs from "fs";
import path from "path";

const artifact = path.join(
  __dirname,
  "../artifacts/contracts/ConfidentialPaywall.sol/ConfidentialPaywall.json",
);
const target = path.join(__dirname, "../../web/lib/abi/ConfidentialPaywall.ts");

const { abi } = JSON.parse(fs.readFileSync(artifact, "utf8"));
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.writeFileSync(
  target,
  "// Généré par `pnpm export-abi` — ne pas modifier à la main.\n" +
    `export const confidentialPaywallAbi = ${JSON.stringify(abi, null, 2)} as const;\n`,
);
console.log(`ABI écrite dans ${target}`);
