# Competitive landscape: private x402 / AI-agent payments on Solana (as of 25 Sept 2026)

Method note: about 20 web searches and fetches. DefiLlama, privacyx402.com and trojan.com returned 403/503 errors, so some metrics come only from search-result snippets and are marked as such. Every figure carries a date where one was available.

## 1. Privacy Cash: launch, TVL/volume, users, funding, compliance, incidents, x402

### Takeaway
Privacy Cash is the most-used retail privacy pool on Solana. It is a Tornado-style ZK mixer for SOL, USDC and USDT, launched in late August 2025. It has processed roughly $200M+ in cumulative volume, but its TVL is only about $2M. It screens deposits for OFAC sanctions (CipherOwl) and has had no reported exploits. It is general-purpose: its "x402" angle comes from third-party wrappers, not from an agent-native product. I could not confirm an official x402 SDK from Privacy Cash.

### Cited Findings
- Launched on Solana in late August 2025. It is a non-custodial ZK shielded pool that breaks the on-chain link between deposit and withdrawal — [SolanaFloor](https://solanafloor.com/news/privacy-cash-over-121-m-in-private-transfers-during-its-first-100-days); [Solana Compass](https://solanacompass.com/projects/privacy-cash)
- First 100 days (article undated, probably Dec 2025): more than $121M in combined deposits and withdrawals, 11.7K wallets, peak weekly volume of $15.4M (late Oct 2025), about $241K cumulative fees (1.35K SOL), TVL about $620K, and USDC private transfers in devnet testing from late Nov 2025 — [SolanaFloor](https://solanafloor.com/news/privacy-cash-over-121-m-in-private-transfers-during-its-first-100-days)
- Solana Compass (data around Jan 2026): TVL $2.1M, more than $270M cumulative transfer volume by early 2026, daily active addresses peaked at 1,192 on the day private swaps launched (Jan 2026), and swaps route through Jupiter — [Solana Compass](https://solanacompass.com/projects/privacy-cash)
- DefiLlama search snippet (undated; the page itself returned 403): TVL $2.1M with 93.3% on Solana, "over $210M" in transfers since Aug 2025, $136,076 in fees over 30 days, "140K+ users", ranked #5 privacy protocol by TVL on DefiLlama, and deployed on Solana, Base, Ethereum, Robinhood Chain, BSC and Hyperliquid — [DefiLlama](https://defillama.com/protocol/privacy-cash). These numbers conflict with Solana Compass ($270M) and with the 11.7K-wallet figure, so treat the snippet as unverified.
- Privacy Cash's own X post (Dec 2025, going by the status ID) says it is "now the biggest USDC privacy pool on Solana" — [X](https://x.com/theprivacycash/status/1999832479469817929)
- Compliance: it uses "CipherOwl for OFAC screening at the point of deposit". Wallets flagged against sanctions lists are rejected before funds enter the pool — [Solana Compass](https://solanacompass.com/projects/privacy-cash). Other sources describe it as "compliance-first" with "selective-disclosure or oversight paths for AML/KYT and law-enforcement" — [Bitkan](https://bitkan.com/learn/what-is-privacy-cash-and-how-does-it-work-62837) (secondary source)
- Security: four audits (Accretion, HashCloak, Zigtur, Kriko) and "no exploits or incidents reported". The team is pseudonymous. The GitHub repo has about 139 stars and 57 forks — [Solana Compass](https://solanacompass.com/projects/privacy-cash); [GitHub](https://github.com/Privacy-Cash/privacy-cash)
- Funding: one Solana Compass snippet says it is "backed by AllianceDAO", but the fetched page says "no public information disclosed" on funding — [Solana Compass](https://solanacompass.com/projects/privacy-cash). This is conflicting and unverified.
- SDKs: a TypeScript SDK exposes deposit(), withdraw() and getPrivateBalance(), plus SPL variants for USDC and USDT, and was audited by Zigtur. There is also an EVM SDK (Base, BNB) and a Rust crate — [GitHub SDK](https://github.com/Privacy-Cash/privacy-cash-sdk/); [EVM SDK](https://github.com/Privacy-Cash/privacy-cash-sdk-evm); [crates.io](https://crates.io/crates/privacy-cash)
- x402: privacyx402.com describes "an SDK for privacy-enhanced HTTP 402 payments on Solana" in which payments "are mixed through Privacy Cash before reaching your treasury". This is from a search snippet only; the site returned 503 and I could not confirm who runs it — [privacyx402](https://privacyx402.com/)
- Privacy Cash sponsored a $15K bounty at Solana Privacy Hack (Jan 2026) for private lending, games and bridging — [Solana Privacy Hack](https://solana.com/privacyhack)

### Inferences
- The TVL is small (about $2M) compared with the flow (more than $200M), which suggests pass-through mixing rather than people holding balances. That behavior fits x402 micropayments poorly, because a per-request flow needs a standing shielded balance.
- Privacy Cash is the obvious candidate to become a "private x402 facilitator" on Solana. So far, x402 integration appears to come from third parties, not the team itself.

### Gaps
- No verified funding round and no clearly first-party x402 SDK.
- No Privacy Cash metrics dated after Q1 2026: I could not load the live DefiLlama page.
- I found no incident or enforcement action against Privacy Cash. That is absence of evidence only.

## 2. shielded-x402 (open-source MVP)

### Takeaway
nhestrompia/shielded-x402 is a very early, low-traction MIT-licensed MVP. It combines Noir circuits (notes and nullifiers) with Solidity contracts and x402. It started on Base Sepolia and has since become a "multi-chain credit MVP" with a Solana relayer.

### Cited Findings
- Repo https://github.com/nhestrompia/shielded-x402: MIT license, 4 stars, 43 commits. It describes itself as a "breaking multi-chain credit MVP" with an authoritative sequencer (nonce and balance), per-chain relayers for Base and Solana, and shielded settlement with periodic Base commitment roots. It includes Noir circuits, Solidity with Foundry, a client SDK and an x402 merchant gateway. It is at testnet/local-dev stage — [GitHub](https://github.com/nhestrompia/shielded-x402)
- Show HN post, about Feb 2026 ("7 months ago" as of Sept 2026): "drop-in for existing x402 flows", testable on Base Sepolia, 1 point and 1 comment — [Hacker News](https://news.ycombinator.com/item?id=47036522)
- Flow: the agent builds a proof and signature, and a relayer verifies the proof, the nullifier and the challenge binding before calling ShieldedPool plus the verifier — [search summary of the GitHub repo](https://github.com/nhestrompia/shielded-x402)

### Inferences
- Settlement is anchored on Base, and the Solana side is a relayer. It is not a native Solana shielded pool, and the sequencer adds a trust assumption.

### Gaps
- Exact date of the last commit and whether it is deployed on Solana devnet or mainnet: not visible in the fetch.

## 3. Other Solana privacy players

### Takeaway
Solana privacy infrastructure is now live: Arcium Mainnet Alpha (Feb 2026), Umbra (public since about March 2026), Token-2022 Confidential Transfers (re-enabled June 2026), Inco Lightning (TEE) and Hinkal (Mar 2026). None of them is primarily an agent/x402 product. The only explicit "private x402 on Solana" entries I found are hackathon-grade projects (IncoPay, privacyx402 and similar).

### Cited Findings
**Arcium (MPC encrypted compute)**
- Mainnet Alpha launched on Solana on 2 Feb 2026. Umbra was the first app. Arcium raised a $5.5M strategic round led by Greenfield Capital (2024), for about $9M total. It was built by the former Elusiv team — [The Block](https://www.theblock.co/post/387564/arcium-launches-privacy-preserving-mainnet-alpha-on-solana-as-umbra-debuts-shielded-finance-layer)
- Its roadmap put a fully decentralized mainnet and TGE in Q1 2026 — [Arcium roadmap](https://www.arcium.com/articles/arcium-roadmap-update) (via a search snippet; I did not confirm that it happened)
- The article mentions no x402 or agent payments — [The Block](https://www.theblock.co/post/387564/arcium-launches-privacy-preserving-mainnet-alpha-on-solana-as-umbra-debuts-shielded-finance-layer). Arcium also offers Confidential SPL (C-SPL) — [Trojan/Medium snippet](https://medium.com/@trojantrading/privacy-is-finally-coming-to-solana-in-2026-and-the-infrastructure-is-already-live-c773048c8137)
- Arcium-track winners at Privacy Hack (17 Feb 2026) were Bench (private opportunity market), Crafts (sealed-bid auction), Epoch (private prediction market) and Undesk (encrypted OTC). None of them is about x402 or agents — [Arcium Substack](https://arcium.substack.com/p/winners-of-solana-privacy-hack)

**Umbra (shielded pool on Arcium)**
- Raised about $155M in ICO commitments on MetaDAO (Oct 2025) — [The Block](https://www.theblock.co/post/387564/arcium-launches-privacy-preserving-mainnet-alpha-on-solana-as-umbra-debuts-shielded-finance-layer). More than 10,500 participants and a $3M allocation cap — [Yellow](https://yellow.com/news/arcium-deploys-encrypted-computation-layer-on-solana-as-umbra-goes-live)
- Private mainnet opened 2 Feb 2026 with 100 users per week and a $500 deposit cap. It later opened to the public — [The Block](https://www.theblock.co/post/387564/arcium-launches-privacy-preserving-mainnet-alpha-on-solana-as-umbra-debuts-shielded-finance-layer); [Arcium Substack](https://arcium.substack.com/p/umbra-is-now-open-to-the-public-powered)
- It positions itself as "compliance-ready" — [Umbra docs](https://docs.umbraprivacy.com/docs/introduction/what-is-umbra)

**Elusiv**
- Sunset announced 29 Feb 2024. It moved to withdrawal-only mode until 1 Jan 2025, and the team became Arcium — [Arcium X](https://x.com/ArciumHQ/status/1763263327763841493); [Elusiv Medium](https://medium.com/elusiv-privacy/sunsetting-elusiv-transitioning-towards-the-future-of-privacy-and-confidentiality-0b078e9bcfac)

**Token-2022 Confidential Transfers / ZK ElGamal Proof Program**
- June 2025: a Fiat-Shamir transcript soundness bug (the "phantom challenge") allowed forged sigma-OR proofs, and with them potential unauthorized minting or burning. No exploitation is known — [Solana post-mortem](https://solana.com/news/post-mortem-june-25-2025); [zkSecurity](https://blog.zksecurity.xyz/posts/solana-phantom-challenge-bug/)
- The program was disabled at epoch 805 (19 June 2025) and re-enabled at epoch 982 (4 June 2026). Token-2022 confidential instructions were redeployed later in June 2026. As of 17 Sept 2026 it had not been disabled again — [xroot.dev](https://xroot.dev/blog/solana-confidential-transfers-kill-switch-proof-cost); [token-2022 issue #657](https://github.com/solana-program/token-2022/issues/657)
- Critics point to the "kill switch" (a validator feature gate) as a centralization concern and note a proof cost of about 368K compute units — [xroot.dev](https://xroot.dev/blog/solana-confidential-transfers-kill-switch-proof-cost); [DEV](https://dev.to/sulimanmukhtar/confidential-transfers-have-a-kill-switch-what-it-costs-you-5h39)

**Inco (TEE-based confidential compute on Solana)**
- Inco Lightning plus a Confidential SPL Token program with encrypted balances and amounts — [Inco docs](https://docs.inco.org/svm/tutorials/confidential-spl-token/overview); [Inco Lightning](https://www.inco.org/lightning)
- "IncoPay": private x402 payments on Solana, "confidential, gasless, one-sign". It is a DoraHacks hackathon build — [DoraHacks](https://dorahacks.io/buidl/41991/milestones)

**Hinkal**
- Launched on Solana on 16 Mar 2026 and claims more than $400M in confidential volume across its stack. Access requires an attestation token from a CEX or KYC provider, and viewing keys allow selective disclosure. It targets institutions — [bex.co](https://bex.co/blog/2026/04/19/hinkal-protocol-privacy-wallet-solana-400m-confidential-volume)

**Solana Privacy Hack (Encode Club, 12–30 Jan 2026, winners on 10 Feb 2026)**
- Prize pool of more than $100K. Tracks: Private Payments, Privacy Tooling and Open. Sponsors included Privacy Cash, Radr Labs (ShadowWire), Anoncoin, Arcium, Aztec/Noir, Inco, Helius, MagicBlock, SilentSwap, Range and Encrypt.trade — [solana.com/privacyhack](https://solana.com/privacyhack)
- Reported winners: Veil (private Venmo/Wise-style payments), Dark Bridge, Mixoor, Anoncoin, and ShadowWire (Bulletproofs) — [search summary, MEXC/Trojan](https://www.mexc.com/news/631199) (secondary source; I did not fetch the full list)

**Other private x402 SDKs (not Solana)**
- PRXVT/sdk: privacy for x402 through a fresh burner wallet per payment and ZK withdrawals. It runs on Base and Polygon mainnets, has 24 stars and 7 commits, and does not use Privacy Cash — [GitHub](https://github.com/prxvt/sdk)
- LOGIA: a ZK layer over x402 using Groth16 and an ERC-4337 ZKPaymaster. It is EVM-based, testnet-only, unaudited, and has 0 stars and 3 commits — [GitHub](https://github.com/Logiaterminal/sdk)
- shade402 targets Midnight, not Solana — [GitHub](https://github.com/mhizer-fatai/shade402)
- x402privacy.xyz presents itself as "Secure Solana Transactions", but the page had no content I could extract — [x402privacy.xyz](https://www.x402privacy.xyz/)

**Context: x402 on Solana**
- Solana is said to handle 76% of x402 transactions (23.2M in four weeks) — [CryptoNews](https://cryptonews.com/news/x402-solana-news-ai-payments/) (undated snippet). Pay.sh (Google Cloud and the Solana Foundation) launched on 5 May 2026 — [TECHi](https://www.techi.com/solana-pay-sh-ai-agent-payments/). Across all chains, x402 has passed 180M transactions — [CoinDesk, 21 Sep 2026](https://www.coindesk.com/tech/2026/09/21/cardano-joins-solana-xrp-ledger-in-race-to-power-ai-agent-payments)

### Inferences
- The primitives are live (a Groth16 mixer, MPC, TEE, and native ElGamal). The missing layer is an x402 facilitator and scheme ("exact-private") that plugs those primitives into the standard x402 flow with per-request privacy, reasonable latency and compliance hooks.
- Confidential Transfers hide amounts but not the parties, and they carry a kill-switch risk. On their own they do not provide unlinkability between payer and payee.

### Gaps
- Light Protocol / ZK Compression, encrypt.trade, Hush, GhostPay, Nillion and Zama on Solana: I did not research these because I ran out of call budget. Veil appears only as a hackathon winner and I have no details on it.
- No current (Sept 2026) usage figures for Umbra or Arcium.
- I found no private x402 facilitator on Solana with measurable production traction.

## 4. Regulatory and compliance incidents

### Takeaway
I found no Tornado-style enforcement action against a Solana privacy protocol. Circle's freeze policy is the main operational risk: it freezes only under legal compulsion and did freeze USDC held in a privacy protocol's contract in May 2026.

### Cited Findings
- Drift exploit, 1 Apr 2026: about $280M stolen. Circle did not freeze about $232M of USDC bridged through CCTP from Solana to Ethereum, which led to a class action. Circle says it freezes only when legally compelled — [CoinDesk](https://www.coindesk.com/business/2026/04/03/circle-under-fire-after-usd285-million-drift-hack-over-inaction-to-freeze-stolen-usdc); [The Paypers](https://thepaypers.com/fraud-and-fincrime/news/circle-faces-class-action-lawsuit-over-failure-to-freeze-funds-in-drift-protocol-exploit)
- May 2026: by court order, Circle froze $12.6M of USDC held in a Zama contract, tied to the Overnight Finance lawsuit. The source does not say which chain — [CoinCentral](https://coincentral.com/circle-freezes-12-6m-in-usdc-tied-to-privacy-protocol-zama-in-court-ordered-action/)
- ZachXBT says Circle froze 16 legitimate wallets while missing hacks — [Bitcoin.com](https://news.bitcoin.com/usdc-freeze-controversy-zachxbt-says-circle-froze-16-legitimate-wallets-missed-real-hacks/)
- Hinkal frames itself as an answer to Tornado Cash's legal failure: it can exclude sanctioned users and lets users prove clean provenance — [bex.co](https://bex.co/blog/2026/04/19/hinkal-protocol-privacy-wallet-solana-400m-confidential-volume)

### Inferences
- A shielded USDC pool on Solana carries issuer freeze risk at the pool-contract level. Deposit screening (as Privacy Cash does) and viewing keys (as Hinkal does) are becoming the standard way to reduce that risk.

### Gaps
- I found no reported freeze of Privacy Cash or Umbra and no sanctions action against a Solana privacy protocol, and this search was not exhaustive.
