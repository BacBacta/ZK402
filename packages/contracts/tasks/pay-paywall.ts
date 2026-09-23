import { task, types } from "hardhat/config";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { ConfidentialPaywall } from "../typechain-types";
import { createCofheClient, getDeployment } from "./utils";

task("pay-paywall", "Paie la ressource avec un montant chiffré")
  .addOptionalParam("amount", "Montant en cents (ex. 10 ou 402)", 10, types.int)
  .setAction(async ({ amount }: { amount: number }, hre) => {
    const { ethers, network } = hre;
    const address = getDeployment(network.name, "ConfidentialPaywall");
    if (!address) throw new Error(`Pas de déploiement pour ${network.name} (lancez deploy-paywall).`);

    const [signer] = await ethers.getSigners();
    const paywall = (await ethers.getContractAt("ConfidentialPaywall", address)) as unknown as ConfidentialPaywall;
    const client = await createCofheClient(hre, signer);

    // La signature du lot est liée au contrat consommateur (pas de rejeu ailleurs).
    const [encAmount, proof] = await client
      .encryptInputs([Encryptable.uint64(BigInt(amount))])
      .setConsumingContract(address)
      .execute();

    const tx = await paywall.connect(signer).pay(encAmount, proof);
    await tx.wait();
    console.log(`pay() envoyé (tx ${tx.hash}) — le montant n'apparaît ni en calldata ni en event.`);

    const ok = await client.decryptForView(await paywall.lastPaymentOk(signer.address), FheTypes.Bool).execute();
    const access = await client.decryptForView(await paywall.accessOf(signer.address), FheTypes.Bool).execute();
    console.log(`Paiement accepté : ${ok} — accès : ${access}`);
  });
