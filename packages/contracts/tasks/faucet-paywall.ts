import { task } from "hardhat/config";
import { FheTypes } from "@cofhe/sdk";
import { ConfidentialPaywall } from "../typechain-types";
import { createCofheClient, getDeployment } from "./utils";

task("faucet-paywall", "Réclame des crédits de démo et affiche le solde déchiffré").setAction(
  async (_, hre) => {
    const { ethers, network } = hre;
    const address = getDeployment(network.name, "ConfidentialPaywall");
    if (!address) throw new Error(`Pas de déploiement pour ${network.name} (lancez deploy-paywall).`);

    const [signer] = await ethers.getSigners();
    const paywall = (await ethers.getContractAt("ConfidentialPaywall", address)) as unknown as ConfidentialPaywall;

    const tx = await paywall.connect(signer).claimFaucet();
    await tx.wait();
    console.log(`Faucet OK (tx ${tx.hash})`);

    const client = await createCofheClient(hre, signer);
    const balance = await client.decryptForView(await paywall.balanceOf(signer.address), FheTypes.Uint64).execute();
    console.log(`Solde déchiffré (visible par vous seul) : ${balance} cents`);
  },
);
