# ZK infra on Base: (A) historical-state / storage proofs & ZK coprocessors, (B) zkTLS / web-data proofs for AI agents

Research date: 25 September 2026. About 20 tool calls. Dates are given for every data point. Where a figure comes from an aggregator or exchange blog rather than a primary source, it is marked.

## (A) Storage proofs and ZK coprocessors: market, competitors on Base, traction, pain

### Takeaway
The category has consolidated around two or three well-funded incumbents. Brevis is the clear traction leader on Base: it has a token, runs ProverNet on Base, and powers PancakeSwap campaigns there. Herodotus supports Base as a source and destination chain. Space and Time has oracle contracts on Base. Axiom shut down its coprocessor and pivoted to OpenVM. Lagrange pivoted its story toward zkML (DeepProve). The primitive itself (prove historical state, then compute on it) is commoditised and sits behind multi-million-dollar funded teams. A small new team would not win on the general coprocessor. It could only compete as a thin vertical application built on top of these systems, for example Base-specific loyalty, fee tiers or reputation.

### Cited Findings
**Brevis**
- ZK coprocessor that lets smart contracts read historical on-chain data and run custom computations on it trustlessly — [Brevis docs](https://coprocessor-docs.brevis.network/)
- Raised a $7.5M seed round, structured as a token round and co-led by Polychain and Binance Labs (Nov 2024). Also in the round: IOSG, Bankless Ventures, HashKey. Early partners were Kwenta, JoJo Exchange and Trusta — [The Block](https://www.theblock.co/post/325504/brevis-network-seed-funding-token-round); [Brevis blog](https://blog.brevis.network/2024/11/11/brevis-announces-7-5m-seed-round-to-shape-the-future-of-verifiable-computing/)
- ProverNet whitepaper (Nov 2025): a decentralized marketplace for ZK proving. ProverNet launches first on Base and plans to migrate later to a dedicated Brevis rollup that uses BREV as gas — [Brevis blog](https://blog.brevis.network/2025/11/17/brevis-provernet-the-open-marketplace-for-zero-knowledge-proofs/); Base detail from [KuCoin blog (exchange source)](https://www.kucoin.com/blog/en-what-is-brevis-brev-deep-dive-into-kucoin-s-new-zk-coprocessor-and-brev-tokenomics)
- BREV token listed on KuCoin on 6 Jan 2026 — [KuCoin blog](https://www.kucoin.com/blog/en-what-is-brevis-brev-deep-dive-into-kucoin-s-new-zk-coprocessor-and-brev-tokenomics)
- Self-reported traction:
  - Nov 2025: "340M+ proofs across 50+ protocols on 8+ blockchains" — [Brevis blog, 26 Nov 2025](https://blog.brevis.network/2025/11/26/pancakeswap-launches-incentra-campaigns-for-base-liquidity-providers/)
  - Whitepaper figure: ">250M proofs across 30+ partners" — [Bitget News summary](https://www.bitget.com/news/detail/12560605068236)
  - Performance claim: multi-GPU clusters prove 45M-gas Ethereum blocks in about 6.9 s — [bex.co (secondary)](https://bex.co/blog/2026/02/07/zk-coprocessor-technology-brevis-verifiable-computation)
- On Base (Nov 2025), PancakeSwap ran Incentra LP campaigns powered by Brevis:
  - 11 v3 pools on Base
  - 240,000 OP in total, about 20k OP per week, claimed on Optimism
  - Rewards proportional to the fees each LP generates, computed and proven in ZK
  
  The page's own pool list is internally inconsistent: it says "8 pools at 0.01% + 3 at 0.05%" but lists 7 + 4 — [Brevis blog](https://blog.brevis.network/2025/11/26/pancakeswap-launches-incentra-campaigns-for-base-liquidity-providers/)
- PancakeSwap Infinity hooks powered by Brevis: more than 26M ZK proofs and $1.18B trading volume "to date" as of Nov 2025. Earlier telemetry: 17,277,767 proofs and 3,678 unique addresses — [Brevis blog](https://blog.brevis.network/2025/11/26/pancakeswap-launches-incentra-campaigns-for-base-liquidity-providers/); [Brevis blog May 2025](https://blog.brevis.network/2025/05/12/hook-into-the-future-intelligent-ux-on-pancakeswap-infinity-powered-by-brevis/); [search summary of whitepaper data](https://brevis.network/whitepaper/provernet.pdf)
- Uniswap v4 hook demo (2023): "VIP trader" fee tiers that compute each address's 30-day volume off-chain and prove it to the hook — [Brevis blog 2023](https://blog.brevis.network/2023/11/01/uniswap-v4-hook-brevis-zk-coprocessor-data-driven-dex-experiences/)

**Herodotus**
- Storage Proofs can originate from Ethereum, Starknet, Optimism, Base and ApeChain. They can be verified on Starknet, Arbitrum, Base, Optimism, World Chain and others. The Herodotus Data Processor (HDP) can read from the same chains — [Herodotus Cloud](https://www.herodotus.cloud/en/learn/zk-coprocessor); [Satellite docs](https://docs.herodotus.cloud/satellite-contracts/introduction)
- Atlantic is a managed STARK prover built on StarkWare's SHARP — [Herodotus Atlantic](https://www.herodotus.cloud/en/atlantic)
- Flagship use case: Snapshot X on-chain governance, where voters submit a storage proof of their balance at a checkpoint (article dated Mar 2026) — [Herodotus Medium](https://medium.com/herodotus/storage-proofs-powering-onchain-governance-with-snapshot-x-70cf85702080)
- No Base-specific usage numbers found.

**Axiom**
- Axiom "has shut down the ZK coprocessor product". The Halo2 circuits were reused in OpenVM, a general zkVM (Trail of Bits, 30 May 2025) — [Trail of Bits](https://blog.trailofbits.com/2025/05/30/a-deep-dive-into-axioms-halo2-circuits/)
- Current products are OpenVM (v1 in production, 2.0 aimed at real-time Ethereum proving) and the Axiom Proving API — [Axiom](https://www.axiom.xyz/); [OpenVM 2.0 blog](https://www.axiom.xyz/blog/openvm-2)
- Previously raised $20M led by Paradigm and Standard Crypto (Jan 2024) — [CoinDesk](https://www.coindesk.com/tech/2024/01/25/axiom-protocol-for-historical-ethereum-data-raises-20m-led-by-paradigm-standard-crypto)

**Lagrange**
- Runs a ZK Prover Network and an SQL-based ZK coprocessor. It now brands itself as "Verifiable Compute for AI & Autonomy", with DeepProve (zkML) as the flagship. It has an LA token — [lagrange.dev](https://lagrange.dev/); [CoinMarketCap AI summary (secondary)](https://coinmarketcap.com/cmc-ai/lagrange/latest-updates/)
- Secondary sources report a DeepProve release on 23 Feb 2026 and an Intel partnership on 16 Feb 2026. Unverified at primary source — [CMC AI](https://coinmarketcap.com/cmc-ai/lagrange/latest-updates/)
- A secondary source says the LA price is at its all-time low while the technology keeps shipping — [Crypto News Navigator](https://www.cryptonewsnavigator.com/academy/article/lagrange-la-deepprove-zkml-tech-vs-token-price-divergence)

**Space and Time**
- Proof of SQL is a ZK prover for SQL queries, with sub-second proofs over 1M+ rows. SXT Chain is a decentralized database with indexers, has an SXT token, and settles on ZK Stack — [GitHub](https://github.com/spaceandtimefdn/sxt-proof-of-sql); [SXT Chain blog](https://www.spaceandtime.io/blog/introducing-sxt-chain)
- Oracle contracts are deployed on Base mainnet — [SxT docs](https://docs.spaceandtime.io/docs/what-is-space-and-time-quick-intro)
- Pain point (by design): data enters SxT through indexers that the network "witnesses", so trust shifts to the ingestion and consensus layer — [SXT Chain blog](https://www.spaceandtime.io/blog/introducing-sxt-chain)

**vlayer (overlap with A)**
- Offers "Time Travel" (historical state) and "Teleport" (cross-chain) alongside Web Proofs. Mainnet supports Ethereum, Base, Optimism and Arbitrum — [vlayer book](https://book.vlayer.xyz/getting-started/dev-and-production.html); [intro](https://book.vlayer.xyz/introduction.html)

### Inferences
- The typical use cases (volume-based fees, LP rewards, loyalty, governance weight) are already shipped on Base by Brevis with PancakeSwap and by Herodotus. A newcomer's differentiation would have to come from a vertical product or distribution, not from the proving tech.
- Consolidation signals from 2025–26:
  - Axiom exited coprocessors.
  - Lagrange moved its narrative from coprocessor to zkML.
  - Brevis moved from coprocessor to a prover marketplace plus its own rollup.
  
  Together these suggest that "historical data coprocessor" on its own was not a large enough standalone business.
- Documented pain is mostly implicit: DEXes and airdrops rely on trusted off-chain indexers or Merkle-drop scripts, which is what Brevis's pitch replaces. I found no primary postmortem of Sybil airdrops on Base that cites coprocessors as the fix.

### Gaps
- No Dune dashboard or on-chain verifier call counts found for Brevis, Herodotus or SxT specifically on Base.
- Herodotus funding and 2026 status (any pivot toward Atlantic-only) not verified.
- Whether Lagrange's coprocessor is deployed on Base is not confirmed.
- Exact date of Axiom's coprocessor shutdown not found. The only source is the Trail of Bits post of May 2025.

## (B) zkTLS / web-data proofs, especially for AI agents: market, competitors on Base, traction, pain

### Takeaway
zkTLS is a crowded market (7+ teams) with more than $40M of venture funding. Several players have tokens (zkPass ZKP) or points programs (Primus). Base is supported by Reclaim and vlayer. Actual AI-agent demand is mostly demos and integrations: Opacity and Reclaim plugins for ElizaOS in Jan 2025, and the EigenLayer "verifiable agents" initiative. There is little evidence of paid, recurring agent usage. As of Sept 2026, practitioners still describe the tech as suitable for "bounded pilots". A small team could compete only by packaging an agent-specific wedge on top of existing zkTLS SDKs such as TLSNotary or Reclaim zkFetch, for example "prove what my agent fetched" for x402-paid APIs on Base. Building a new zkTLS protocol would not be a viable way in.

### Cited Findings
**Market overview**
- Architectures differ by player:
  - Reclaim: proxy/witness model, 2–4 s mobile proofs, 889 data sources
  - zkPass: hybrid proxy + MPC
  - Opacity: decentralized MPC network
  - vlayer: web proofs aimed at Ethereum developers
  
  There is no unified standard, and "$40+ million in venture funding" went into zkTLS in 2025–26. This is a secondary source (bex.co, Mar 2026) — [bex.co](https://bex.co/blog/2026/03/19/zktls-zero-knowledge-transport-layer-security-privacy-preserving-identity-web3); also cited by [Wavect search summary](https://wavect.io/blog/zktls-ai-agents/)
- Wavect, Sept 2026:
  - TLSNotary's latest release is v0.1.0-alpha.15 (pre-release, 2 Sep 2026).
  - Only TLS 1.2 is supported; TLS 1.3 is on the roadmap.
  - Proxy mode takes 1–2 s and MPC mode 3.6–15.5 s for a 1 KB request (May 2026 measurements).
  - Overall judgment: zkTLS is suited to "bounded pilots and selected production flows".
  
  — [Wavect](https://wavect.io/blog/zktls-ai-agents/)

**Reclaim Protocol**
- Claims 4M+ verifications as of July 2026, 29,000+ universities and employment sources in 90+ countries. Pricing runs from free (25/month) to $2k/month (Solopreneur), $5k/month (Startup), and down to $0.10 per verification at enterprise scale. Backed by YC. Offers MCP support for coding agents. The homepage no longer emphasises chains; it has repositioned toward Web2 employment and education verification (KYB/KYC-like) — [reclaimprotocol.org](https://www.reclaimprotocol.org/)
- Multichain support including Base — [Solana Compass / aggregator](https://solanacompass.com/projects/reclaim-protocol)
- Funding sources conflict: Tracxn says "not raised any funding", while the site says "Backed by YC" — [Tracxn](https://tracxn.com/d/companies/reclaim-protocol/__pHhg8cx_6Z8VAV7b2KqGSmej-oXFXjTd-cES4gbB_G0) vs [reclaimprotocol.org](https://www.reclaimprotocol.org/)
- A Reclaim zkTLS plugin was proposed for ElizaOS (PR #1558) — [GitHub](https://github.com/elizaOS/eliza/pull/1558)

**zkPass**
- Raised a $2.5M seed (Aug 2023) and a $12.5M Series A as a SAFT at a $100M token valuation. Investors include dao5, Animoca and Flow Traders — [The Block](https://www.theblock.co/post/321723/zkpass-funding-token-valuation)
- ZKP token: IDO held 27 Oct – 3 Nov 2025, trading live 19 Dec 2025 (Kraken) — [Kraken](https://blog.kraken.com/product/asset-listings/zkp-is-available-for-trading); [zkPass docs](https://docs.zkpass.org/zkpass-dao/zkp)

**Opacity Network**
- Raised a $12M seed co-led by Archetype and Breyer — [The Block](https://www.theblock.co/post/321160/opacity-network-funding-zk-data-verification)
- Runs as a mainnet AVS on EigenLayer. MPC nodes restake 32 stETH and can be slashed — [Bitget News](https://www.bitget.com/news/detail/12560604086431)
- Added "verifiable inference" to Eliza in Jan 2025 by proving calls to the OpenAI API through zkTLS. The stated motivation was the aixbt incident — [Eliza PR #1673](https://github.com/elizaOS/eliza/pull/1673); [Nader Dabit on X, Jan 2025](https://x.com/dabit3/status/1877056923092267066); [EigenLayer blog](https://www.eigenlabs.org/blog/introducing-verifiable-agents-on-eigenlayer/)
- No Base-specific deployment was found.

**vlayer**
- Offers Web Proofs (TLSNotary-based) and Email Proofs. Mainnet v1.0 covers Ethereum, Base, OP and Arbitrum — [vlayer book](https://book.vlayer.xyz/getting-started/dev-and-production.html)
- Search results mention an Unigox partnership in Apr 2026 (crypto–fiat exchange via bank-transfer proofs) and TEE-backed TLSNotary work by Livy Labs under a vlayer grant in Aug 2026. Both are unverified at primary source — [vlayer X](https://x.com/vlayer_xyz)
- The site now positions vlayer as "verified user data for businesses that reward users", which reads as a pivot toward loyalty and rewards — [vlayer.xyz](https://vlayer.xyz/)

**Primus (formerly PADO)**
- Combines zkTLS with FHE and positions itself as a "trust, verification and privacy layer for the crypto and agent economy" — [Primus docs](https://docs.primuslabs.xyz/data-verification/pado-extension/overview/)
- Raised a $6.5M seed in Feb 2025 led by Dispersion, Symbolic and VanEck, with Samsung Next and Alchemy participating — [Dispersion](https://dispersion.xyz/learn/503/why-we-invested-in-primus); [Messari](https://messari.io/project/primus-labs/profile)

**Pluto**
- Based in New York, founded 2021. Offers MPC, Origo proxy and TEE modes for Web Proofs. Backed by Variant — [Pluto blog](https://pluto.xyz/blog/web-proof-techniques-tee-mode); [Variant](https://variant.fund/articles/promise-zero-knowledge-proofs-personae-pluto/)
- 2026 status was not found. No evidence either way of a shutdown.

**TLSNotary (PSE / EF)**
- Open source, still alpha (v0.1.0-alpha.15, Sept 2026) — [Wavect](https://wavect.io/blog/zktls-ai-agents/)

**Agents and x402 on Base**
- x402 (Coinbase, May 2025) is live on Base with USDC. Proposals exist for "verifiable decision attestations" through x402 — [valory-xyz issue](https://github.com/valory-xyz/trader/issues/1041); [Wikipedia x402](https://en.wikipedia.org/wiki/X402)
- Academic work (IACR 2026, "zkAgent") uses zkTLS subproofs to bind an agent's tool observations into end-to-end proofs of verifiable LLM agent execution — [ePrint 2026/199](https://eprint.iacr.org/2026/199)

### Inferences
- Demand from agent builders is real but so far takes the form of plugins, grants and research, not paid volume. The Eliza plugins date from Jan 2025, and I found no subsequent usage metrics.
- The leading teams have shifted toward Web2 use cases (Reclaim toward employment and education verification, vlayer toward rewards). This suggests the crypto and agent market alone has not sustained them.
- Only a few Base-native zkTLS apps show up publicly, which could leave an opening for a Base plus x402 "verified fetch receipt" product. That is an inference, not a documented market.

### Gaps
- No Base-specific traction numbers were found for any zkTLS provider (no Dune dashboards located).
- Nillion's relation to zkTLS was not researched.
- Opacity token status and 2026 activity are unknown.
- Pluto 2026 status is unknown.
- Reclaim's funding amount is undisclosed.
- No confirmed zkTLS shutdowns in 2025–26 were found.
