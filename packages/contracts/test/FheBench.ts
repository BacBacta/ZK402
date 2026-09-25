import hre from "hardhat";
import { Encryptable } from "@cofhe/sdk";
import { expect } from "chai";

describe("FheBench (micro-banc P3) — correction des calculs sur mocks", function () {
  it("chaînes et opérations indépendantes, 16/32/64 bits", async function () {
    await hre.run("task:cofhe-mocks:deploy");
    const [a] = await hre.ethers.getSigners();
    const b = await (await hre.ethers.getContractFactory("FheBench")).deploy();
    const addr = await b.getAddress();
    const c = await hre.cofhe.createClientWithBatteries(a);
    const r = (await c.encryptInputs([Encryptable.uint16(100n), Encryptable.uint32(100n), Encryptable.uint64(100n)]).setConsumingContract(addr).execute()) as any[];
    await b.setSeeds(r[0], r[1], r[2], r[3]);
    for (const w of [16, 32, 64]) {
      const n1 = (await b.nonce()) + 1n; // constantes : i + 2 + (nonce mod 97)·100
      const c = (i: bigint, n: bigint) => i + 2n + (n % 97n) * 100n;
      await b.run(w, 0, true, 3); // 100 + c0 + c1 + c2
      await hre.cofhe.mocks.expectPlaintext(await b.last(0), 100n + c(0n, n1) + c(1n, n1) + c(2n, n1));
      const n2 = n1 + 1n;
      await b.run(w, 1, false, 3); // min(100, c2)
      await hre.cofhe.mocks.expectPlaintext(await b.last(2), 100n < c(2n, n2) ? 100n : c(2n, n2));
    }
  });
});
