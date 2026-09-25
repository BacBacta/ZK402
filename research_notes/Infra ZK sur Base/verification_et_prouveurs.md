# ZK proof verification/aggregation and proving services on Base (as of 25 Sep 2026)

Scope: (A) cheap proof verification/aggregation on Base; (B) proving services and fast provers, including for Noir. Research done 25 Sep 2026. Every source's date is given where known. Secondary aggregators (BlockEden, MEXC, CoinMarketCap AI, whales.market, OpenLiquid) are marked as lower-confidence.

## Q1. On-chain verification costs (Groth16 / PLONK / UltraHonk) on EVM, and USD cost on Base

### Takeaway
Base's own engineering benchmark (Sep 2025) found that a Noir/UltraHonk verification costs about 2.4M gas, compared with about 350k gas for Groth16 (snarkjs/rapidsnark). UltraHonk is therefore about 6–7x more expensive to verify, but it proves 5–50x faster. Our measured ~4.1M gas for a full Noir claim tx on Base Sepolia fits this: roughly 2.4M for the verifier plus calldata and app logic. At Base's typical L2 gas price (0.005 gwei floor), 4.1M gas costs only a few US cents in L2 execution. So the cost pain on Base comes mostly from spikes, from the L1 data fee on large proofs, and from the tx gas-limit/UX side, not from the steady-state execution price.

### Cited Findings
- Base Engineering Blog, "Benchmarking ZKP Systems for Passkey ECDSA Verification" (2 Sep 2025): on-chain verification gas was SnarkJS/Rapidsnark (Groth16) **347,665**, Gnark (Groth16) **407,664** and Noir (UltraHonk) **2,396,575** (+590%). Noir generated proofs in about 2.1 s on a c7i.2xlarge, against 40–50 s for the Groth16 systems, a 5–50x advantage that depends on hardware. The stated reason is that Groth16 proofs are constant-size while UltraHonk proofs grow logarithmically with circuit size. The blog concludes that Noir suits client-side proving and Groth16 suits cases where verification cost matters most. — [Base blog](https://blog.base.dev/benchmarking-zkp-systems)
- NEBRA docs: a single Groth16 verification, submission included, costs about **250–270k gas** on L1. — [NEBRA docs](https://docs.nebra.one/developer-guide/gas-costs-on-l1s)
- A secondary source (May 2026) gives baseline Ethereum verification costs of "250,000 to 500,000 gas per proof". — [BlockEden (secondary)](https://blockeden.xyz/blog/2026/05/07/ility-multi-chain-zk-proof-aggregation-l2-unified-verification)
- Electron Labs claimed its Quantum testnet verifies proofs for "under 14,000 gas" per proof once aggregated, with 94.4% average gas saved (undated marketing claim). — [Electron Labs via search snippet / GitHub](https://github.com/Electron-Labs/)
- bb-generated UltraHonk Solidity verifiers used to exceed the EIP-170 24,576-byte contract size limit. The ERC-8262 reference implementation patched them to 24,453–24,455 B, which saved about 800 gas per `verifyProof` and made them deployable on mainnet and OP-Stack L2s. The repo is unaudited. — [xochi-fi/ERC-8262](https://github.com/xochi-fi/ERC-8262)
- A related report says HonkVerifier contracts are around 33 KB, above EIP-170. This contradicts the ERC-8262 figure unless patched; the size probably depends on the bb version and circuit. — [dev.to Hello Noir part 2](https://dev.to/0xluk3/hello-noir-part-2-36l7)
- Base's minimum base fee is 5,000,000 wei (0.005 gwei). Base's docs give roughly $0.002 for a 200k-gas tx at an ETH price of $2,000. — [Base docs, network fees](https://docs.base.org/base-chain/network-information/network-fees); BaseScan showed 0.005 gwei ([BaseScan gas tracker](https://basescan.org/gastracker))
- One lower-confidence blog says Base gas can briefly reach 5–10 gwei during Coinbase-promoted drops. — [OpenLiquid (secondary)](https://openliquid.io/blog/base-chain-gas-fees-explained/)
- Non-EVM chains feel the same pain. Nethermind cut Noir/UltraHonk verification on Stellar by 64% (from 224.8M to 80M CPU instructions) through host functions, because "the verifier was just too expensive". — [Nethermind](https://www.nethermind.io/blog/making-noir-verification-cheaper-on-stellar)

### Inferences
- USD arithmetic, my own calculation using Base's documented $2,000 ETH assumption; recompute with the live ETH price:
  - At 0.005 gwei, 4.1M gas = 2.05e13 wei = 0.0000205 ETH, about **$0.04**.
  - At 0.005 gwei, 2.4M gas (verifier only) ≈ $0.024, and 350k gas (Groth16) ≈ $0.0035.
  - During a 5 gwei spike, 4.1M gas ≈ 0.0205 ETH ≈ **$41**, which is 1000x worse.
  - These figures exclude the L1 data fee on the proof calldata. An UltraHonk proof is several KB, while a Groth16 proof is about 256 B, so UltraHonk also pays more L1 data fee. I have no sourced proof-size figure.
- On Base at normal prices, one-off UltraHonk verification is cheap in absolute dollars. An aggregation service saving ~2M gas per proof saves about $0.02 per proof. That is a thin value proposition unless volumes are very large (millions of proofs), gas spikes, or the app needs many verifications per user action.
- Converting UltraHonk to Groth16 (for example by wrapping it in a recursive Groth16 proof) or verifying off-chain with an attestation are the realistic cost levers.

### Gaps
- I found no official Aztec/Barretenberg benchmark of UltraHonk verifier gas by circuit size. An Aztec forum post (8 Jul 2025) asked for exactly this and got no answer shown. — [Aztec forum](https://forum.aztec.network/t/benchmark-for-verification-cost-across-noir-proof-backends/8061)
- I did not find a sourced PLONK (snarkjs/halo2-KZG) gas figure. Commonly cited values are about 300k gas, but they are unverified here.
- I found no sourced UltraHonk proof byte size or L1 data fee on Base.

## Q2. Aggregation / verification layers: status, chains, Base support, traction, funding

### Takeaway
The standalone verification/aggregation category has consolidated and partly retreated:
- **Aligned** deprecated its EigenLayer verification AVS in July 2026 and moved to an Ethereum-L1 aggregation service while broadening into RaaS and wallets.
- **NEBRA** looks dormant; its public updates stop in 2024.
- **Electron Labs** Quantum's docs domain no longer resolves.
- **zkVerify** (Horizen) is the most active. It has a mainnet since 30 Sep 2025, explicit UltraHonk support, and a token deployed on Base.

None of these is a Base-native aggregator widely used by Base apps. This is both an opening and a warning sign: demand has been weak.

### Cited Findings
**Aligned Layer**
- Its Proof Verification Layer (an EigenLayer AVS) reached mainnet beta in Nov 2024. — [Aligned blog, Dec 2024](https://blog.alignedlayer.com/aligned-align-tokenomics-and-roadmap/)
- As of Dec 2024 it ran 35 operators, had more than 650k ETH restaked and more than 30 partnerships, and had processed "millions of proofs" in testnet 2. — [Aligned blog](https://blog.alignedlayer.com/aligned-align-tokenomics-and-roadmap/)
- A later figure puts traction at 136,000+ proofs verified with 50+ operators. — [Aligned CoinGecko update](https://blog.alignedlayer.com/aligned-align-project-and-token-information-update-for-coingecko/)
- On 21 July 2026, Aligned deprecated the Proof Verification Layer and told operators to deregister. The Proof Aggregation Service is now "the default and only verification solution". — [Aligned CoinGecko update](https://blog.alignedlayer.com/aligned-align-project-and-token-information-update-for-coingecko/); [Bitget Academy (secondary)](https://www.bitget.com/academy/what-is-aligned-align-ethereum-fintech-infrastructure-how-it-works-tokenomics)
- The Aggregation Service went to testnet in Q1 2025 and mainnet alpha in Q1 2026. It settles on Ethereum, is paid in $ALIGN, and trades higher latency for full Ethereum security. — [Aligned CoinGecko update](https://blog.alignedlayer.com/aligned-align-project-and-token-information-update-for-coingecko/); [Aligned blog](https://blog.alignedlayer.com/proof-verification-layer-vs-aggregation-service/)
- Aligned has repositioned toward "Ethereum fintech infrastructure": Rollup-as-a-Service, Wallet-as-a-Service and LambdaVM. — [Bitget Academy (secondary)](https://www.bitget.com/academy/what-is-aligned-align-ethereum-fintech-infrastructure-how-it-works-tokenomics)
- The Defiant reports that airdrop details came about 20 months late, that there is no token launch date, and that the public auction was "canceled". — [The Defiant](https://thedefiant.io/news/tokens/aligned-details-align-airdrop-still-no-launch-date)

**NEBRA (UPA)**
- NEBRA's aggregator went live on Ethereum mainnet. Early users named are Worldcoin, Brevis and AltLayer. It claims up to 10x lower cost. — [The Block](https://www.theblock.co/post/311295/nebras-zero-knowledge-proof-aggregator-goes-live-on-ethereum-mainnet)
- NEBRA later launched on World Chain, which is OP Stack. — [The Block](https://www.theblock.co/post/324036/zero-knowledge-proof-startup-nebra-launches-aggregation-tool-on-world-chain)
- Its docs give about 53k gas per proof with on-chain submission and about 40k with off-chain submission (32-proof batches), against 250–270k gas for a single Groth16. They say "Off-chain submission will be available soon". — [NEBRA docs](https://docs.nebra.one/developer-guide/gas-costs-on-l1s)
- The homepage still presents UPA and lists SP1 and RISC Zero support (announced 20 Oct 2024). Its latest posts date from April–October 2024 and it does not mention Base. — [nebra.one](https://nebra.one/)
- I found no shutdown announcement. The inactivity after 2024 suggests dormancy, but that is unconfirmed.

**Electron Labs (Quantum)**
- Quantum is a recursion-based "Superproof" aggregator. Its testnet claims under 14k gas per proof, with Scroll and Worldcoin proofs aggregated. — [Electron Labs GitHub](https://github.com/Electron-Labs/)
- On 25 Sep 2026 the docs domain docs.electron.dev failed DNS resolution (ENOTFOUND, from my fetch attempt). This suggests the project is inactive or has pivoted, but it is unconfirmed.

**zkVerify (Horizen)**
- Mainnet and the VFY token launched on 30 Sep 2025. — [zkVerify blog](https://zkverify.io/blog/zkverify-mainnet-and-vfy-is-live); [PR Newswire](https://www.prnewswire.com/news-releases/zkverify-mainnet-launches-as-first-dedicated-blockchain-for-zero-knowledge-proof-verification-302570087.html)
- It supports Groth16, UltraPlonk, **UltraHonk**, RISC Zero, SP1 and Space and Time verifiers, and claims verification at "less than 1/100 of Ethereum's L1" cost. — [BlockEden (secondary)](https://blockeden.xyz/blog/2026/05/07/ility-multi-chain-zk-proof-aggregation-l2-unified-verification)
- VFY is deployed on Base (contract 0xa749dE6c28262B7ffbc5De27dC845DD7eCD2b358). Attestations can be relayed to Ethereum, Base, Arbitrum, Optimism and others. — [zkVerify 2025 review](https://zkverify.io/blog/zkverify-2025-year-in-review)
- Traction: 8M proofs verified in 2025, an annualized rate of more than 35M claimed by the founder, and 50k–100k proofs a day from the CallScan integration. It is the "first chain to natively verify SP1 Prover Network proofs". — [zkVerify 2025 review (23 Dec 2025)](https://zkverify.io/blog/zkverify-2025-year-in-review)

**Others**
- Brevis worked with NEBRA on cheaper ZKP for DeFi. — [NEBRA blog](https://blog.nebra.one/brevis/)
- Polygon AggLayer (pessimistic proofs, SP1-based) and ILITY (alpha mainnet Jan 2026, $2M seed) are grouped with these in a secondary 2026 overview. — [BlockEden (secondary)](https://blockeden.xyz/blog/2026/05/07/ility-multi-chain-zk-proof-aggregation-l2-unified-verification)

### Inferences
- The dedicated universal-aggregator thesis, where an app pays to batch Groth16 proofs, has underperformed:
  - Aligned dropped its AVS and diversified.
  - NEBRA has been quiet since 2024.
  - Electron's docs are gone.
- A likely cause is that L2 gas is cheap enough that individual apps don't feel verification cost, while the big payers (rollups) do their own recursion.
- zkVerify is the direct incumbent for "verify Noir/UltraHonk cheaply and attest to Base". A new team would compete with a funded, token-backed network that already supports UltraHonk and Base.
- A possible small-team wedge is a lightweight, Base-native, non-token batcher. It would recursively wrap many UltraHonk proofs into one UltraHonk or Groth16 proof and verify on Base, for one high-volume vertical such as claims, identity or x402-style payments. It would be sold as an SDK or service, not as a new chain.

### Gaps
- I found no reliable funding figures for Aligned, NEBRA, Electron Labs or zkVerify in this session.
- I found no Dune or L2BEAT data on proofs verified by aggregators on Base.
- I could not confirm Aligned's supported proof systems: its aggregation docs page returned 404.
- I could not verify NEBRA's or Electron Labs' current status beyond the signals above.

## Q3. Proving services and markets (general and Noir-specific)

### Takeaway
Succinct dominates proving for Base itself. Base Azul uses SP1 in a TEE+ZK multiproof, and Optimism made Succinct its preferred ZK provider in Feb 2026. RISC Zero's Boundless launched mainnet on Base (beta Jul 2025, full Sep 2025) and shut down its hosted Bonsai service in Dec 2025. Brevis (Pico/ProverNet), Cysic, Fermah and ZkCloud are active but aimed at zkVM and rollup workloads. For Noir, proving is mostly client-side with Barretenberg (bb.js, native, mobile via Mopro). The main pain is browser speed, not server provers.

### Cited Findings
**Succinct (SP1, Prover Network, PROVE)**
- Base's Azul upgrade (announced 4 May 2026) moves from optimistic fault proofs to a TEE + SP1 ZK multiproof. When both proofs agree, finality falls from 7 days to 1 day. It covers $7.4B in deposits. SP1 has 35+ customers and the Prover Network has "generated millions of proofs". — [Succinct blog](https://blog.succinct.xyz/base-sp1/)
- Optimism named Succinct its first preferred ZK proving provider for the OP Stack/Superchain, around 12 Feb 2026. Succinct says this brings it to "90% of the rollup market". — [Optimism blog](https://www.optimism.io/blog/optimism-partners-with-succinct-as-preferred-provider-to-accelerate-zk-proving-on-the-superchain); [Succinct blog](https://blog.succinct.xyz/optimism-superchain/); [BanklessTimes, 12 Feb 2026](https://www.banklesstimes.com/articles/2026/02/12/optimism-integrates-zk-proving-as-op-price-consolidates/)
- OP Succinct proving latency is "minutes", at 0.5–1 cent per transaction (2024 claim). — [Succinct blog, OP Succinct](https://blog.succinct.xyz/op-succinct/)
- Succinct reports 6M+ proofs in 2025, 1,700 unique programs and more than $4B secured. — [Succinct 2025 recap](https://blog.succinct.xyz/succinct-2025-recap/); [CoinMarketCap AI (secondary)](https://coinmarketcap.com/cmc-ai/succinct/latest-updates/)
- PROVE is the payment and staking token of the Prover Network. — [Succinct network/PROVE post](https://blog.succinct.xyz/network/introducing-the-succinct-network-architecture-and-the-prove-token/)

**RISC Zero / Boundless**
- Boundless mainnet launched on Base (CoinDesk, 12 Sep 2025), after a mainnet beta on Base in July 2025. It uses "Proof of Verifiable Work" rewards. Provers stake ZKC as collateral and requestors pay in the chain's native token. — [CoinDesk](https://www.coindesk.com/tech/2025/09/12/boundless-launches-mainnet-on-base-ushering-in-universal-zero-knowledge-compute); [Boundless ZKC docs](https://docs.boundless.network/zkc/introduction)
- Wormhole is integrating Boundless. — [BlockEden (secondary), Jan 2026](https://blockeden.xyz/blog/2026/01/14/boundless-risc-zero-decentralized-proof-market-zk/)
- Bonsai, RISC Zero's hosted proving API, was shut down in Dec 2025 and replaced by Boundless. — [Boundless docs, Migrating from Bonsai](https://docs.boundless.network/developers/tutorials/bonsai)

**Brevis (Pico / ProverNet)**
- ProverNet mainnet beta is a proof market run as continuous auctions. It is paid in USDC for now, moving to BREV at full launch. It runs the Pico zkVM and the Pico Prism distributed prover, and early workloads include Ethereum block proving (Dec 2025). — [House of ZK, 10 Dec 2025](https://www.hozk.io/news/proving-services-latest-2025-12-10)

**Cysic**
- Its testnet had 43k+ verifiers and about 1k provers in early 2025. Cysic Network, a Cosmos-based L1 with Proof-of-Compute, launched on 24 Sep 2025. Cysic is a multi-node prover on the Succinct network. — [House of ZK / search](https://www.hozk.io/news/proving-services-latest-2025-10-02); [Messari](https://messari.io/project/cysic)
- A partnership with Noya covers zkML (EZKL, Halo2/KZG) verified on **Base**. — [House of ZK, Dec 2025](https://www.hozk.io/news/proving-services-latest-2025-12-10)

**Fermah**
- Fermah reached testnet phase 3 (pre-mainnet) with a zkSync integration. Its founder is Vanishree Rao and it is positioned on "predictable costs". — [House of ZK](https://www.hozk.io/news/proving-services-latest-2025-12-10)

**ZkCloud (formerly Gevulot)**
- The Firestarter network went live in Q4 2024 with pay-per-proof pricing: about **$0.035 per 5 min of GPU time** and $0.84/h for a dual-4090 node, claimed to be more than 95% cheaper than AWS/GCP. — [Decrypt](https://decrypt.co/295019/gevulot-launches-firestarter-revolutionizing-zk-proofs-with-high-speed-and-affordability)
- It worked on real-time Ethereum block proving (Devcon, Nov 2025). — [House of ZK](https://www.hozk.io/news/proving-services-latest-2025-12-10)

**Noir-specific proving**
- Mopro × Noir (12 May 2025), Stealthnote JWT circuit: proving took 37.3 s in the browser, 2.02 s on a Mac M1 Pro, 2.63 s on an iPhone 16 Pro and 4.79 s on an Android emulator. Native mobile is "up to 10x faster" than the browser. Poseidon2 needed a custom Rust implementation. — [Mopro blog](https://zkmopro.org/blog/noir-integraion/); [Mopro benchmarks](https://zkmopro.org/docs/performance/)
- Base's own benchmark measured Noir proving at about 2.1 s on a server-class 8-vCPU instance. — [Base blog](https://blog.base.dev/benchmarking-zkp-systems)
- Aztec's CHONK (client-side-optimized PLONK) powers proving on phones and in browsers. Aztec v5 Execution Layer Alpha (around Jul 2026) cut proving times, per a secondary summary. — [Aztec roadmap update](https://aztec.network/blog/aztec-network-roadmap-update); [KuCoin (secondary)](https://www.kucoin.com/blog/aztec-v5-alpha-client-side-zk-proving)

### Inferences
- Base's chain-level proving (Azul) is locked up by Succinct in partnership with OP Labs. A small team cannot compete there.
- General zkVM proving markets are crowded, token-subsidized and consolidating: Succinct, Boundless, Brevis, ZkCloud, Cysic and Fermah. Bonsai's shutdown shows that even RISC Zero stopped running a hosted service.
- Noir/UltraHonk server-side proving is mostly not a market. Proofs are small and fast: about 2 s on a laptop or server and a few seconds on a phone. Delegating proving would also send private witness data to a third party, which defeats the privacy purpose. The real Noir pain is in-browser proving (tens of seconds for JWT-sized circuits) and on-chain verification gas. That points to tooling (fast WASM/WebGPU provers, mobile SDKs) or to aggregation/wrapping, not to a proving marketplace.

### Gaps
- I found no verified 2025–2026 funding rounds for Succinct, Brevis, Cysic, Fermah, Lagrange, Nexus or ZkCloud in this session, so none are cited.
- I did not research Lagrange (DeepProve / Prover Network) or Nexus zkVM status in 2026.
- I found no revenue figures for the Succinct Prover Network or Boundless. The PROVE and ZKC token prices were not captured.
- I found no published per-proof pricing for proving a Noir circuit in any marketplace.

## Q4. Documented developer pain (verification gas, proving latency and cost, client-side speed)

### Takeaway
There is solid, dated evidence of pain in three areas: UltraHonk verification gas (Base's own benchmark), EIP-170 contract size limits for Honk verifiers, and slow browser proving (Mopro). Explicit complaints about verification cost on Base specifically are sparse. Most documented pain comes from non-EVM chains or L1.

### Cited Findings
- Base Engineering (Sep 2025) calls Noir verification +590% versus Groth16 and advises Groth16 "when on-chain verification costs are the primary constraint". — [Base blog](https://blog.base.dev/benchmarking-zkp-systems)
- Aztec forum (8 Jul 2025): "I haven't seen any benchmarks for UltraHonk or UltraPlonk, especially regarding verification gas costs on Ethereum." There was no answer. — [Aztec forum](https://forum.aztec.network/t/benchmark-for-verification-cost-across-noir-proof-backends/8061)
- HonkVerifier contracts exceed EIP-170 and need patching or optimizer workarounds. — [ERC-8262](https://github.com/xochi-fi/ERC-8262); [dev.to](https://dev.to/0xluk3/hello-noir-part-2-36l7)
- Stellar/Soroban: the UltraHonk verifier was "just too expensive" (224.8M CPU instructions), which led to host-function work. Several noir-lang discussions cover UltraHonk verifiers for Soroban. — [Nethermind](https://www.nethermind.io/blog/making-noir-verification-cheaper-on-stellar); [noir-lang discussion #8560](https://github.com/orgs/noir-lang/discussions/8560)
- Browser proving took 37 s for a JWT circuit, against about 2.6 s natively on an iPhone (May 2025). — [Mopro](https://zkmopro.org/blog/noir-integraion/)
- A HelPhone GitHub issue targets browser proving under 3 s, with a circuit budget under 50k constraints. — [HelPhone issue #577](https://github.com/Hel-Phone/HelPhone/issues/577)

### Inferences
- The pain is real but moderate on Base. It is sharper on L1, on non-EVM chains and in browsers.
- Our 4.1M-gas measurement matches the documented UltraHonk overhead.

### Gaps
- I found no dated X posts complaining specifically about Base verification gas; I did not search X directly.

## Q5. Base-specific: ZK plans and grants

### Takeaway
Base is moving to ZK at the chain level through Azul, a TEE + SP1 multiproof announced in May 2026, as a step toward full ZK proving. Base publishes ZK benchmarks, which suggests internal interest in app-level ZK such as passkeys. Its grant programs are general and retroactive (1–5 ETH); I found no dedicated ZK-infra grant track.

### Cited Findings
- Base Azul uses a multiproof of TEE plus SP1 ZK, with 1-day finality when both proofs agree, "an intermediary step towards full ZK proving". — [Succinct blog, 4 May 2026](https://blog.succinct.xyz/base-sp1/); [The Cryptonomist, 8 May 2026](https://en.cryptonomist.ch/2026/05/08/base-adds-zk-proofs-with-succinct-a-big-step-forward-for-blockchain-security/)
- A calendar entry points to Base ZK-proofs activity around 25 May 2026. It is lower-confidence and may mark the Azul mainnet date. — [TradingView/CoinMarketCal](https://www.tradingview.com/news/coinmarketcal:939d8afb7094b:0-succinct-prove-base-zk-proofs-25-may-2026/)
- Base benchmarked ZK systems for passkey ECDSA verification in Sep 2025, which shows interest in ZK for smart wallets. — [Base blog](https://blog.base.dev/benchmarking-zkp-systems)
- Base Builder Grants are retroactive, typically 1–5 ETH, and cover developer tooling and infrastructure among other categories. — [Gitcoin: Base Builder Grants](https://gitcoin.co/apps/base-builder-grants)
- Boundless (RISC Zero) launched its mainnet on Base, and zkVerify deployed VFY on Base. — [CoinDesk](https://www.coindesk.com/tech/2025/09/12/boundless-launches-mainnet-on-base-ushering-in-universal-zero-knowledge-compute); [zkVerify](https://zkverify.io/blog/zkverify-2025-year-in-review)
- Other ZK-relevant grants: EF ZK Grants had a Noir wave. — [Aztec blog](https://aztec.network/blog/announcing-the-noir-awardees-of-the-inaugural-ef-zk-grants-wave)

### Inferences
- Base-native ZK apps are a small but growing niche. Chain-level proving is taken, so the openings are app-level: verifying Noir proofs cheaply, passkey/identity proofs and client-side SDKs.
- Base grants are small and retroactive. They can bootstrap a tool but not fund an infra company.

### Gaps
- I could not confirm the Azul mainnet activation date on Base.
- I found no Base-specific ZK infra grant program or amount.
- I found no Dune dashboard of ZK verifier contract usage on Base.

## Q6. Can a small new team compete? (synthesis inputs)

### Takeaway
(A) A generic aggregation layer looks hard. Incumbents either retreated (Aligned, NEBRA, Electron) or are token-funded with UltraHonk and Base support (zkVerify), and the gas savings on Base are only a few cents per proof. (B) Proving services are dominated by well-funded zkVM networks (Succinct, Boundless, Brevis), and Noir proving is inherently client-side. The best small-team openings are niche developer tools:
- UltraHonk→Groth16 wrapping or batching SDKs for Base apps.
- Tooling that keeps verifiers under the EIP-170 size limit and cuts their gas.
- Faster browser and mobile Noir proving (WebGPU, Mopro-style).

### Cited Findings
- See Q1–Q5. Key anchors are the Base benchmark (2.4M vs 348k gas), [Base blog](https://blog.base.dev/benchmarking-zkp-systems); Aligned's July 2026 deprecation, [Aligned](https://blog.alignedlayer.com/aligned-align-project-and-token-information-update-for-coingecko/); zkVerify's UltraHonk + Base support, [zkVerify](https://zkverify.io/blog/zkverify-2025-year-in-review); Succinct on Base Azul, [Succinct](https://blog.succinct.xyz/base-sp1/); and Bonsai's shutdown, [Boundless docs](https://docs.boundless.network/developers/tutorials/bonsai).

### Inferences
- An aggregator's value per proof on Base is about ~$0.02 (2M gas at 0.005 gwei, ETH at $2k; my own calculation). A business at $0.005 per proof would need tens of millions of proofs a month to reach meaningful revenue. zkVerify's 8M proofs over all of 2025 suggests demand of that size is not there yet.
- Fast Noir browser proving and gas-light verification serve a real, documented pain. They can win as open-source tools, grant-funded work or a feature of an app product (for example ZK402), rather than as a standalone infra business.

### Gaps
- There is no market-size data (total $ spent on proof verification on Base). Any TAM figure would be speculative.
