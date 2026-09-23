import { task, types } from "hardhat/config";
import { saveDeployment } from "./utils";

task("deploy-paywall", "Déploie ConfidentialPaywall")
  .addOptionalParam("price", "Prix plancher en cents", 10, types.int)
  .addOptionalParam(
    "facilitator",
    "Adresse du serveur x402 autorisé à déchiffrer l'accès (défaut : FACILITATOR_ADDRESS ou le déployeur)",
  )
  .setAction(async ({ price, facilitator }: { price: number; facilitator?: string }, hre) => {
    const { ethers, network } = hre;
    const [deployer] = await ethers.getSigners();
    if (!deployer) {
      throw new Error("Aucun compte : renseignez PRIVATE_KEY dans .env (clé de TESTNET uniquement).");
    }

    const facilitatorAddress = facilitator ?? process.env.FACILITATOR_ADDRESS ?? deployer.address;
    console.log(`Réseau        : ${network.name}`);
    console.log(`Déployeur     : ${deployer.address}`);
    console.log(`Facilitateur  : ${facilitatorAddress}`);
    console.log(`Prix plancher : ${price} cents`);

    const factory = await ethers.getContractFactory("ConfidentialPaywall");
    const paywall = await factory.deploy(price, facilitatorAddress);
    await paywall.waitForDeployment();
    const address = await paywall.getAddress();

    console.log(`ConfidentialPaywall déployé : ${address}`);
    console.log(`→ ajoutez NEXT_PUBLIC_PAYWALL_ADDRESS=${address} à votre .env`);
    saveDeployment(network.name, "ConfidentialPaywall", address);
    return address;
  });
