import { loadFixture } from "@nomicfoundation/hardhat-toolbox/network-helpers";
import hre from "hardhat";
import { Encryptable, FheTypes } from "@cofhe/sdk";
import { expect } from "chai";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ConfidentialPaywall } from "../typechain-types";

const TASK_COFHE_MOCKS_DEPLOY = "task:cofhe-mocks:deploy";
const MIN_PRICE = 10n; // 10 cents = 0,10 $
const FAUCET = 1000n;

describe("ConfidentialPaywall", function () {
  async function deployFixture() {
    await hre.run(TASK_COFHE_MOCKS_DEPLOY);

    const [owner, facilitator, alice, bob, eve] = await hre.ethers.getSigners();
    const factory = await hre.ethers.getContractFactory("ConfidentialPaywall");
    const paywall = (await factory
      .connect(owner)
      .deploy(MIN_PRICE, facilitator.address)) as unknown as ConfidentialPaywall;
    const paywallAddress = await paywall.getAddress();

    const aliceClient = await hre.cofhe.createClientWithBatteries(alice);

    return { paywall, paywallAddress, owner, facilitator, alice, bob, eve, aliceClient };
  }

  async function payAs(
    paywall: ConfidentialPaywall,
    paywallAddress: string,
    signer: HardhatEthersSigner,
    cents: bigint,
  ) {
    const client = await hre.cofhe.createClientWithBatteries(signer);
    const [encAmount, proof] = await client
      .encryptInputs([Encryptable.uint64(cents)])
      .setConsumingContract(paywallAddress)
      .execute();
    return paywall.connect(signer).pay(encAmount, proof);
  }

  describe("Déploiement", function () {
    it("stocke owner, facilitateur et un prix chiffré", async function () {
      const { paywall, owner, facilitator } = await loadFixture(deployFixture);
      expect(await paywall.owner()).to.equal(owner.address);
      expect(await paywall.facilitator()).to.equal(facilitator.address);
      await hre.cofhe.mocks.expectPlaintext(await paywall.minPrice(), MIN_PRICE);
    });

    it("refuse un facilitateur nul", async function () {
      const factory = await hre.ethers.getContractFactory("ConfidentialPaywall");
      await expect(factory.deploy(MIN_PRICE, hre.ethers.ZeroAddress)).to.be.revertedWithCustomError(
        factory,
        "ZeroAddress",
      );
    });
  });

  describe("Faucet", function () {
    it("crédite un solde chiffré que seul le titulaire déchiffre", async function () {
      const { paywall, alice, aliceClient } = await loadFixture(deployFixture);
      await paywall.connect(alice).claimFaucet();

      const balance = await aliceClient
        .decryptForView(await paywall.balanceOf(alice.address), FheTypes.Uint64)
        .execute();
      expect(balance).to.equal(FAUCET);
    });

    it("est plafonné à MAX_FAUCET_CLAIMS appels", async function () {
      const { paywall, alice } = await loadFixture(deployFixture);
      const max = await paywall.MAX_FAUCET_CLAIMS();
      for (let i = 0; i < Number(max); i++) await paywall.connect(alice).claimFaucet();
      await expect(paywall.connect(alice).claimFaucet()).to.be.revertedWithCustomError(
        paywall,
        "FaucetLimitReached",
      );
      await hre.cofhe.mocks.expectPlaintext(await paywall.balanceOf(alice.address), FAUCET * BigInt(max));
    });
  });

  describe("pay() — les deux branches de FHE.select", function () {
    for (const cents of [10n, 402n]) {
      it(`accepte ${cents} cents : accès accordé, solde débité, revenu crédité`, async function () {
        const { paywall, paywallAddress, owner, alice, aliceClient } = await loadFixture(deployFixture);
        await paywall.connect(alice).claimFaucet();
        await payAs(paywall, paywallAddress, alice, cents);

        const access = await aliceClient
          .decryptForView(await paywall.accessOf(alice.address), FheTypes.Bool)
          .execute();
        const ok = await aliceClient
          .decryptForView(await paywall.lastPaymentOk(alice.address), FheTypes.Bool)
          .execute();
        const balance = await aliceClient
          .decryptForView(await paywall.balanceOf(alice.address), FheTypes.Uint64)
          .execute();
        expect(access).to.equal(true);
        expect(ok).to.equal(true);
        expect(balance).to.equal(FAUCET - cents);

        const ownerClient = await hre.cofhe.createClientWithBatteries(owner);
        const revenue = await ownerClient.decryptForView(await paywall.revenue(), FheTypes.Uint64).execute();
        expect(revenue).to.equal(cents);
      });
    }

    it("sous le prix : ne revert pas, débite 0, pas d'accès", async function () {
      const { paywall, paywallAddress, alice } = await loadFixture(deployFixture);
      await paywall.connect(alice).claimFaucet();
      await expect(payAs(paywall, paywallAddress, alice, 5n)).not.to.be.reverted;

      await hre.cofhe.mocks.expectPlaintext(await paywall.accessOf(alice.address), 0n);
      await hre.cofhe.mocks.expectPlaintext(await paywall.lastPaymentOk(alice.address), 0n);
      await hre.cofhe.mocks.expectPlaintext(await paywall.balanceOf(alice.address), FAUCET);
      await hre.cofhe.mocks.expectPlaintext(await paywall.revenue(), 0n);
    });

    it("solde insuffisant : ne revert pas, débite 0, pas d'accès", async function () {
      const { paywall, paywallAddress, bob } = await loadFixture(deployFixture);
      // Bob n'a jamais utilisé le faucet : solde chiffré = 0.
      await expect(payAs(paywall, paywallAddress, bob, 402n)).not.to.be.reverted;

      await hre.cofhe.mocks.expectPlaintext(await paywall.accessOf(bob.address), 0n);
      await hre.cofhe.mocks.expectPlaintext(await paywall.balanceOf(bob.address), 0n);
      await hre.cofhe.mocks.expectPlaintext(await paywall.revenue(), 0n);
    });

    it("l'accès reste acquis après un paiement ultérieur refusé (multi-tx, ACL allowThis)", async function () {
      const { paywall, paywallAddress, alice } = await loadFixture(deployFixture);
      await paywall.connect(alice).claimFaucet();
      await payAs(paywall, paywallAddress, alice, 10n);
      await payAs(paywall, paywallAddress, alice, 1n);
      await payAs(paywall, paywallAddress, alice, 402n);

      await hre.cofhe.mocks.expectPlaintext(await paywall.accessOf(alice.address), 1n);
      await hre.cofhe.mocks.expectPlaintext(await paywall.balanceOf(alice.address), FAUCET - 10n - 402n);
      await hre.cofhe.mocks.expectPlaintext(await paywall.revenue(), 412n);
    });
  });

  describe("Ce qui fuit (ou pas) on-chain", function () {
    it("10 ¢ et 4,02 $ produisent des logs identiques (sans montant ni issue)", async function () {
      const { paywall, paywallAddress, alice, bob } = await loadFixture(deployFixture);
      await paywall.connect(alice).claimFaucet();
      await paywall.connect(bob).claimFaucet();
      // Premier paiement de chacun pour initialiser les comptes de façon identique.
      await payAs(paywall, paywallAddress, alice, 1n);
      await payAs(paywall, paywallAddress, bob, 1n);

      const rA = await (await payAs(paywall, paywallAddress, alice, 10n)).wait();
      const rB = await (await payAs(paywall, paywallAddress, bob, 402n)).wait();

      const ours = (r: typeof rA) =>
        r!.logs.filter((l) => l.address.toLowerCase() === paywallAddress.toLowerCase());
      const [evA] = ours(rA);
      const [evB] = ours(rB);
      expect(ours(rA)).to.have.length(1);
      expect(ours(rB)).to.have.length(1);
      expect(evA.topics[0]).to.equal(evB.topics[0]);
      expect(evA.data).to.equal("0x");
      expect(evB.data).to.equal("0x");
      // Seule différence : le payeur (topic indexé), public par nature.
      expect(evA.topics.length).to.equal(evB.topics.length);
    });

    it("la calldata de pay() ne contient pas le montant en clair", async function () {
      const { paywall, paywallAddress, alice } = await loadFixture(deployFixture);
      await paywall.connect(alice).claimFaucet();
      const tx = await payAs(paywall, paywallAddress, alice, 402n);
      // 402 = 0x192 ; on vérifie l'absence d'un mot ABI encodant 402.
      const word402 = (402n).toString(16).padStart(64, "0");
      expect(tx.data.slice(10).toLowerCase()).not.to.include(word402);
    });

    it("le facilitateur peut déchiffrer l'accès d'un payeur (ACL)", async function () {
      const { paywall, paywallAddress, alice, facilitator } = await loadFixture(deployFixture);
      await paywall.connect(alice).claimFaucet();
      await payAs(paywall, paywallAddress, alice, 10n);

      const facilitatorClient = await hre.cofhe.createClientWithBatteries(facilitator);
      const access = await facilitatorClient
        .decryptForView(await paywall.accessOf(alice.address), FheTypes.Bool)
        .execute();
      expect(access).to.equal(true);
    });

    it("un tiers ne peut pas déchiffrer le solde d'un payeur (ACL)", async function () {
      const { paywall, paywallAddress, alice, eve } = await loadFixture(deployFixture);
      await paywall.connect(alice).claimFaucet();
      await payAs(paywall, paywallAddress, alice, 10n);

      const eveClient = await hre.cofhe.createClientWithBatteries(eve);
      let failed = false;
      try {
        await eveClient.decryptForView(await paywall.balanceOf(alice.address), FheTypes.Uint64).execute();
      } catch {
        failed = true;
      }
      expect(failed, "Eve ne doit pas pouvoir déchiffrer le solde d'Alice").to.equal(true);
    });
  });

  describe("setMinPrice", function () {
    it("réservé à l'owner", async function () {
      const { paywall, paywallAddress, alice } = await loadFixture(deployFixture);
      const client = await hre.cofhe.createClientWithBatteries(alice);
      const [enc, proof] = await client
        .encryptInputs([Encryptable.uint64(50n)])
        .setConsumingContract(paywallAddress)
        .execute();
      await expect(paywall.connect(alice).setMinPrice(enc, proof)).to.be.revertedWithCustomError(
        paywall,
        "NotOwner",
      );
    });

    it("un prix chiffré plus élevé rend 10 ¢ insuffisant", async function () {
      const { paywall, paywallAddress, owner, alice } = await loadFixture(deployFixture);
      const ownerClient = await hre.cofhe.createClientWithBatteries(owner);
      const [enc, proof] = await ownerClient
        .encryptInputs([Encryptable.uint64(50n)])
        .setConsumingContract(paywallAddress)
        .execute();
      await paywall.connect(owner).setMinPrice(enc, proof);

      await paywall.connect(alice).claimFaucet();
      await payAs(paywall, paywallAddress, alice, 10n);
      await hre.cofhe.mocks.expectPlaintext(await paywall.accessOf(alice.address), 0n);

      await payAs(paywall, paywallAddress, alice, 402n);
      await hre.cofhe.mocks.expectPlaintext(await paywall.accessOf(alice.address), 1n);
    });
  });
});
