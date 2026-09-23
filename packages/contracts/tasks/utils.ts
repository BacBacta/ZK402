import fs from "fs";
import path from "path";
import { HardhatRuntimeEnvironment } from "hardhat/types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { createCofheConfig, createCofheClient as createNodeCofheClient } from "@cofhe/sdk/node";
import { getChainById } from "@cofhe/sdk/chains";
import type { CofheClient } from "@cofhe/sdk";

const DEPLOYMENTS_DIR = path.join(__dirname, "../deployments");

const deploymentPath = (network: string) => path.join(DEPLOYMENTS_DIR, `${network}.json`);

export const saveDeployment = (network: string, contractName: string, address: string) => {
  fs.mkdirSync(DEPLOYMENTS_DIR, { recursive: true });
  const file = deploymentPath(network);
  const deployments: Record<string, string> = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, "utf8"))
    : {};
  deployments[contractName] = address;
  fs.writeFileSync(file, JSON.stringify(deployments, null, 2) + "\n");
  console.log(`Déploiement enregistré dans ${file}`);
};

export const getDeployment = (network: string, contractName: string): string | null => {
  const file = deploymentPath(network);
  if (!fs.existsSync(file)) return null;
  const deployments = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, string>;
  return deployments[contractName] ?? null;
};

/** Client CoFHE utilisable sur le réseau Hardhat (mocks) comme sur Base Sepolia. */
export const createCofheClient = async (
  hre: HardhatRuntimeEnvironment,
  signer: HardhatEthersSigner,
): Promise<CofheClient> => {
  const chainId = Number((await signer.provider.getNetwork()).chainId);
  const chain = getChainById(chainId);
  if (!chain) {
    throw new Error(`Aucune configuration CoFHE pour le chainId ${chainId} (voir @cofhe/sdk/chains).`);
  }

  if (chain.environment === "MOCK") {
    return (await hre.cofhe.createClientWithBatteries(signer)) as unknown as CofheClient;
  }

  const client = createNodeCofheClient(
    createCofheConfig({ environment: "node", supportedChains: [chain] }),
  );
  const { publicClient, walletClient } = await hre.cofhe.hardhatSignerAdapter(signer);
  // L'adaptateur du plugin et le SDK peuvent résoudre deux versions de viem :
  // types structurellement proches mais non identiques, d'où le cast.
  await client.connect(publicClient as any, walletClient as any);
  await client.acp.createSelf({ issuer: signer.address });
  return client as unknown as CofheClient;
};
