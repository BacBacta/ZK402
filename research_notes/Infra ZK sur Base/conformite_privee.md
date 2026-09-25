# Private compliance on Base: Privacy Pools model and alternatives (as of 25 Sept 2026)

Scope: ZK "proof of innocence" / association-set privacy with a focus on Base. About 18 tool calls. Several figures come from secondary aggregators; the notes flag this where it applies.

## Q1. 0xbow Privacy Pools: launch, chains, TVL/volume, ASP model, funding, Vitalik, 2026 status

### Takeaway
Privacy Pools (0xbow) launched on Ethereum mainnet in March 2025 and is still small: about $9.3M TVL and about 7.4K cumulative deposits on L2BEAT at the time of the search (Sept 2026). The only deployment L2BEAT lists is Ethereum. I found no evidence of a Base deployment. 0xbow has Coinbase Ventures money and EF (Kohaku) backing, so a Base deployment by 0xbow itself is a plausible competitive threat.

### Cited Findings
- Launched on Ethereum mainnet in March 2025. Founders are Ameen Soleimani, Nathaniel Fried (CEO) and Zak Cole. — [The Block, 18 Nov 2025](https://www.theblock.co/post/379395/0xbow-raises-3-5-million-seed-round-ethereum-foundation-backed-privacy-pools)
- Early traction: 238 transactions and 67.49 ETH within three days of launch (April 2025). — [CoinDesk, 3 Apr 2025](https://www.coindesk.com/tech/2025/04/03/0xbow-s-ethereum-privacy-pools-surpass-200-deposits-as-user-interest-grows)
- By Nov 2025: about $6M total transaction volume, more than 1,500 users, 1,186 withdrawals. — [The Block](https://www.theblock.co/post/379395/0xbow-raises-3-5-million-seed-round-ethereum-foundation-backed-privacy-pools); [The Defiant](https://thedefiant.io/news/defi/0xbow-raises-usd3-5-million-to-expand-privacy-pools)
- Funding: $3.5M seed on 18 Nov 2025, led by Starbloom Capital. Other investors: Coinbase Ventures, BOOST VC, Bankless, Number Group and Public Works. Angels include Balaji Srinivasan, Sam Kazemian and Dan Finlay. — [The Block](https://www.theblock.co/post/379395/0xbow-raises-3-5-million-seed-round-ethereum-foundation-backed-privacy-pools)
- Vitalik Buterin co-authored the research on association sets behind the protocol and took part in the March 2024 pre-seed. Privacy Pools is described as "a keystone part of the Ethereum Foundation's Kohaku wallet initiative." — [The Block](https://www.theblock.co/post/379395/0xbow-raises-3-5-million-seed-round-ethereum-foundation-backed-privacy-pools)
- Features added in July 2025: support for Sky's USDS and a "Tornado Cash Proof of Association" pool. The seed round is meant to fund expansion beyond Ethereum mainnet. — [The Block](https://www.theblock.co/post/379395/0xbow-raises-3-5-million-seed-round-ethereum-foundation-backed-privacy-pools)
- L2BEAT figures, current at fetch in Sept 2026:
  - TVL $9.27M; 7,410 total deposits; 624 deposits in the last 30 days.
  - Top assets: USDT $6.64M, ETH $1.99M, USDC $0.48M.
  - 4 active relayers over 30 days; 80 trusted-setup participants.
  - Ethereum is the only chain listed. The anonymity set is defined as the whitelisted deposits of the same token.
  - Source: [L2BEAT Privacy Pools](https://l2beat.com/privacy/projects/privacy-pools)
- ASP model: a compliance layer, the Association Set Provider run by 0xbow, screens deposits. Flagged deposits are left out of the approved set. On withdrawal, the user proves in ZK that their deposit is in the approved set. — [bex.co blog, Apr 2026](https://bex.co/blog/2026/04/12/0xbow-privacy-compliance-defi-fatf-travel-rule); [GitHub privacy-pools-core](https://github.com/0xbow-io/privacy-pools-core)
- Multichain: Brevis, BNB Chain and 0xbow planned an "Intelligent Privacy Pool" on BNB Chain for Q1 2026. — Search-result summary of the [bex.co blog](https://bex.co/blog/2026/04/12/0xbow-privacy-compliance-defi-fatf-travel-rule). I could not verify this against a primary source.
- Conflicting figure: a Medium interview from EthCC9 (May 2026) is quoted in search snippets as giving "around $450M TVL" for Privacy Pools. — [Medium, Crypto Diva, May 2026](https://medium.com/@crypto.diva/ethcc9-interview-with-0xbow-privacy-pools-compliant-onchain-privacy-cfec581d39a9) (page returned 403, so I could not verify it). This contradicts L2BEAT's $9.27M. I treat the $450M as unreliable; it may be a mix-up with Tornado Cash or Railgun TVL.

### Inferences
- About $9M TVL after 18 months shows that demand for "compliant privacy" on L1 is real but niche. Stablecoins, mostly USDT, dominate by value, while ETH dominates by number of deposits.
- Coinbase Ventures sits on 0xbow's cap table and the protocol is open source. 0xbow (or anyone) could deploy on Base cheaply, so a new team has little defensibility in simply forking Privacy Pools onto Base.

### Gaps
- There is no official 0xbow statement on L2 deployments (Base, Optimism, Arbitrum) as of Sept 2026. The privacypools.com homepage did not render. The claim that the code is "configurable for Ethereum, BSC, Optimism, Starknet" comes from an aggregator snippet and is unverified.
- I found no current Dune dashboard for 2026 cumulative volume.

## Q2. Other players (Railgun, Tornado Cash, Hinkal, Aztec, Kohaku, Zama, Coinbase/Base's own work)

### Takeaway
By TVL the incumbents are still Tornado Cash (about $717M) and Railgun (about $93M), both on L2BEAT. Zama confidential tokens have reached about $83M. On Base, the direct competitors are Hinkal and, above all, Coinbase's own "Base Privacy / Ledgers" (June 2026). Base Privacy is an enterprise, KYC-based design rather than a ZK proof-of-innocence design, but it occupies the "compliant privacy on Base" slot with first-party distribution.

### Cited Findings
- L2BEAT privacy dashboard (Ethereum-focused), Sept 2026:

  | Project | TVL | Deposits |
  |---|---|---|
  | Tornado Cash | $717.26M | 307.4K |
  | Railgun | $93.25M | 67.15K |
  | Zama Confidential Tokens | $82.90M | 4.06K |
  | Privacy Pools | $9.27M | 7.41K |
  | STRK-20 | $0.83M | not noted |
  | Payy | about $700 | not noted |

  Umbra, Fluidkey, Cloaked and Privacy Boost are also tracked. Source: [L2BEAT Privacy](https://l2beat.com/privacy)
- **Railgun**: Private Proofs of Innocence (PPOI) let users prove their tokens do not come from a list of bad actors without revealing balances or viewing keys. — [Railgun docs](https://docs.railgun.org/wiki/assurance/private-proofs-of-innocence); [Blockworks](https://blockworks.co/news/defi-privacy-zero-knowledge-proofs)
  - Railgun is deployed on Ethereum, Polygon, Arbitrum and BSC. — [SQD case study](https://blog.sqd.dev/case-study-railgun-leveraging-sqd-trace-data-to-enable-privacy-pools/)
  - I found no source for Railgun on Base.
- **Hinkal**:
  - Claims to run on Ethereum, Solana, Tron, Polygon, **Base**, Arbitrum, Optimism, Arc and Tempo. — [BlockEden blog, 19 Apr 2026](https://blockeden.xyz/blog/2026/04/19/hinkal-protocol-privacy-wallet-solana-400m-confidential-volume/). This is a secondary source that relays Hinkal's own claims.
  - Claims more than $400M in private volume and six audits. — same BlockEden source
  - Compliance design: Chainalysis KYT screening at entry. If a depositor is flagged later, their funds can only be withdrawn publicly back to the original address. Also offers viewing keys and ZK checks above $10K. — [Hinkal compliance docs](https://hinkal-team.gitbook.io/hinkal/introduction/compliance)
  - Positions itself explicitly against Privacy Pools and Canton for institutions. — [Hinkal blog](https://hinkal.io/blog/hinkal-vs-privacy-pools-vs-canton)
- **Coinbase / Base Privacy (Ledgers)**:
  - On about 19 June 2026, Coinbase Developer Platform announced: "Private transactions are launching on @base today, powered by a new enterprise privacy architecture called Ledgers, with Coinbase Developer Platform running the first Base Ledger." — [CoinbaseDev on X](https://x.com/CoinbaseDev/status/2066992742094483718); [Bitget News](https://www.bitget.com/news/detail/12560605468096)
  - How it works: senders and recipients are hidden on the public chain, while balances and transfers stay in the ledger. Deposits hide the recipient and withdrawals hide the sender. The design does not guarantee full anonymity.
  - Compliance: "KYC by Coinbase Direct, sanctions screening built in, and Coinbase handles licensing." A self-run option lets a business bring its own KYC and policies. — [base.org/ledgers](https://www.base.org/ledgers); [Incrypted](https://incrypted.com/en/coinbase-launched-private-transactions-on-base-for-enterprises/)
  - Use cases: B2B payments, payroll, treasury, stablecoin issuance, cross-border transfers and brokerage settlement.
  - Status: early access. Enterprise only, with no retail product. — [Bitget News](https://www.bitget.com/news/detail/12560605468096)
- **Kohaku (Ethereum Foundation)**:
  - The Kohaku SDK was released on 25 May 2026. It lets wallets integrate Railgun, Tornado Cash and Privacy Pools. — [The Defiant](https://thedefiant.io/news/blockchains/ethereum-foundation-kohaku-sdk-privacy-wallet-integration-bb4t52); [Crypto Times, 26 May 2026](https://www.cryptotimes.io/2026/05/26/vitalik-ethereum-has-enough-privacy-narratives-as-kohaku-sdk-advances/)
  - Led by Vitalik Buterin and Nicolas Consigny.
  - v0.0.1-alpha.21 ships with 4337 relaying through Railgun. The Privacy Pools and Tornado integrations were still "in development."
  - Ambire and a breadcoop-built extension are preparing integrations.
- **Tornado Cash**: TVL is still about $717M, which shows that uncompliant privacy still dominates. — [L2BEAT](https://l2beat.com/privacy)
- **Privacy Cash (Solana)**: over $121M in private transfers in its first 100 days. — [StepData substack](https://stepdata.substack.com/p/privacy-cash-over-121m-in-private). This is Solana, not Base. The source date was not verified.

### Inferences
- Base Privacy puts Coinbase itself in the compliant-privacy space on Base. It targets enterprises through custodial or permissioned ledgers, which is the opposite of the trustless ZK association-set model. That leaves room for permissionless retail and DeFi privacy with proof of innocence. But Coinbase controls the distribution (Base App, CDP) and could add a retail feature later.
- Hinkal already claims Base support with KYT-based compliance. A new team would not be first on Base.

### Gaps
- No verified figures for Hinkal volume on Base specifically.
- Aztec mainnet status in 2026, Fhenix, and Nocturne's shutdown (reported mid-2024) and Elusiv's sunset (reported early 2024) were not verified in this session for lack of tool budget. The shutdown details are from memory and need a source before use.
- Zama confidential tokens (about $83M TVL) and their compliance hooks were not researched further, and neither was whether they run on Base.

## Q3. Regulatory context 2025–2026

### Takeaway
The US stance softened sharply: Tornado Cash was delisted in March 2025 after Van Loon, and Treasury's March 2026 GENIUS Act report acknowledged lawful uses of mixers. Developer liability is still unresolved: the Storm § 1960 conviction stands and the retrial is set for April 2027. The EU AMLR bars CASPs from anonymous accounts from July 2027. I found no official endorsement of proof-of-innocence or association sets.

### Cited Findings
- **Van Loon v. Treasury**: on 26 Nov 2024 the Fifth Circuit held that immutable smart contracts are not "property" under IEEPA, so OFAC exceeded its authority. — [Dynamis LLP](https://www.dynamisllp.com/knowledge/van-loon-case-tornado-cash)
- **Tornado Cash delisting**: OFAC removed Tornado Cash from the SDN list on 21 March 2025. Treasury framed this as an exercise of "discretion." — [Treasury press release sb0057](https://home.treasury.gov/news/press-releases/sb0057); [Steptoe](https://www.steptoe.com/en/news-publications/international-compliance-blog/treasury-department-delists-tornado-cash-following-the-fifth-circuits-decision.html)
- **US v. Storm, conviction**: in August 2025 Storm was convicted of conspiracy to operate an unlicensed money-transmitting business (18 U.S.C. § 1960, max 5 years). The jury hung on money laundering and sanctions. — [DeFi Education Fund, 2026](https://www.defieducationfund.org/u-s-v-storm-2026-update/)
- **US v. Storm, acquittal motion and retrial**:
  - The Rule 29 acquittal motion was argued on 9 April 2026 and was still undecided at the last scheduling order.
  - The DOJ sought a retrial in October 2026.
  - Judge Failla postponed the retrial to 26 April 2027.
  - Sources: [crypto.news](https://crypto.news/tornado-cash-co-founder-roman-storm-retrial-pushed-to-april-2027/); [Crypto Briefing](https://cryptobriefing.com/roman-storm-retrial-postponed-april-2027/); [CourtListener docket](https://www.courtlistener.com/docket/67720380/united-states-v-storm/)
- **Treasury GENIUS Act report (9 March 2026)**:
  - Treasury acknowledged that lawful users use mixers for "financial privacy when transacting through public blockchains," for example to protect wealth, business payments and donations.
  - It said custodial mixers must register with FinCEN.
  - The coverage I read did not mention Privacy Pools, ZK or proof of innocence.
  - Sources: [Treasury report PDF](https://home.treasury.gov/system/files/246/GENIUS-Act-Illicit-Finance-Innovation-Congressional-Report-March-2026.pdf); [Yahoo Finance](https://finance.yahoo.com/news/u-treasury-takes-dramatic-u-185016802.html); [Orrick, 13 Mar 2026](https://infobytes.orrick.com/2026-03-13/treasury-issues-genius-act-report-on-innovative-methods-to-combat-illicit-finance/)
  - The August 2025 request for comment drew more than 220 responses. — [FinCEN](https://www.fincen.gov/news/news-releases/treasury-seeks-public-comment-implementation-genius-act)
- **GENIUS Act implementation**: the FDIC proposed illicit-finance standards under the GENIUS Act in June 2026. — [Global Financial Regulatory Blog](https://www.globalfinregblog.com/2026/06/fdic-issues-proposal-on-illicit-finance-standards-under-genius-act/)
- **EU AMLR (Regulation 2024/1624) Art. 79**:
  - From 1 July 2027, credit institutions, financial institutions and CASPs may not maintain anonymous accounts or handle anonymity-enhancing coins.
  - It does not ban individuals from holding them, and self-custody P2P is outside its scope.
  - Sources: [Cointelegraph](https://cointelegraph.com/news/eu-crypto-ban-anonymous-privacy-tokens-2027); [LeoDex explainer](https://leodex.io/learn/delistings/eu-privacy-coin-ban-2027)

### Inferences
- The US regulatory tailwind for non-custodial privacy tools is real in 2025–26. The Storm § 1960 conviction, pending Rule 29, remains the main legal risk for teams that run relayers or front ends.
- For EU users, the question is whether CASPs will accept withdrawals from privacy protocols after 2027. A verifiable ZK association-set proof is a plausible answer, but no regulator has endorsed it.

### Gaps
- No FATF 2025–26 statement on proof of innocence or association sets was found (not searched in depth).
- No official OFAC, FinCEN or EU acceptance of proof-of-innocence approaches was found.

## Q4. Documented pain: users and institutions blocked by compliance

### Takeaway
The evidence of pain is mostly indirect: vendor blogs and the logic of the products. I found no dated, primary report of an exchange rejecting Privacy Pools or Railgun withdrawals within the tool budget. The strongest pain signal is institutional. Coinbase built Base Ledgers specifically because enterprises (payroll, B2B, treasury) cannot use fully transparent chains.

### Cited Findings
- Base Privacy explicitly targets payroll, B2B payments, treasury and brokerage settlement. It is pitched as "Going onchain shouldn't mean giving up privacy." — [CoinbaseDev on X, June 2026](https://x.com/CoinbaseDev/status/2066992742094483718); [base.org/ledgers](https://www.base.org/ledgers)
- Treasury itself names protecting personal wealth, business payments and donations from public-ledger exposure as legitimate needs. — [Yahoo Finance on the Treasury report, Mar 2026](https://finance.yahoo.com/news/u-treasury-takes-dramatic-u-185016802.html)
- Exchanges like Coinbase freeze funds when required by court orders or OFAC sanctions. — [Coinbase Help](https://help.coinbase.com/en/coinbase/other-topics/other/does-coinbase-freeze-accounts)
- Hinkal markets itself as a "compliant answer to Tornado Cash" for institutions. That is a vendor claim. — [BlockEden](https://blockeden.xyz/blog/2026/04/19/hinkal-protocol-privacy-wallet-solana-400m-confidential-volume/)

### Inferences
- Enterprise pain is validated by the fact that Coinbase shipped a product for it. For retail, the pain of "exchanges flag my privacy-protocol funds" is widely asserted but thinly documented in citable form.

### Gaps
- No dated, primary case was found of a CEX rejecting Privacy Pools or Railgun PPOI withdrawals, or of a CEX formally accepting association-set proofs.

## Q5. Demand and volume evidence on Base specifically, and verdict for a small new team

### Takeaway
I found no public on-chain metric for privacy-tool usage on Base. L2BEAT's privacy tracker covers Ethereum and lists no Base deployments. Base's own privacy product launched as enterprise early access in June 2026, with no usage figures disclosed. A retail ZK proof-of-innocence protocol on Base would compete with Coinbase's first-party offering, Hinkal, and a likely 0xbow expansion. The whole compliant-privacy category is still small (Privacy Pools has about $9M TVL).

### Cited Findings
- L2BEAT privacy tracking is Ethereum-focused. No Base deployment is shown for Privacy Pools, Railgun or the others. — [L2BEAT Privacy](https://l2beat.com/privacy); [L2BEAT Privacy Pools](https://l2beat.com/privacy/projects/privacy-pools)
- Base Privacy is in early access, and availability depends on region and regulation. — [Bitget News](https://www.bitget.com/news/detail/12560605468096)
- Hinkal lists Base among its chains, but gives no per-chain figures. — [BlockEden](https://blockeden.xyz/blog/2026/04/19/hinkal-protocol-privacy-wallet-solana-400m-confidential-volume/)

### Inferences (verdict for a small new team)
- **Against the idea**:
  1. Coinbase owns Base and has shipped compliant privacy with KYC and licensing handled, so it controls the most valuable, institutional segment.
  2. 0xbow has Coinbase Ventures and EF backing plus Kohaku wallet distribution, and can redeploy on Base.
  3. Hinkal is already on Base.
  4. Measured demand for association-set privacy is small ($9M TVL on L1 after 18 months).
  5. Anonymity sets on a new Base pool would start tiny, which weakens the privacy itself.
  6. The legal risk around § 1960 for relayer or front-end operators persists until the Storm Rule 29 ruling and the April 2027 retrial.
- **For the idea**:
  1. Base Ledgers is permissioned and enterprise-only, so permissionless retail and DeFi privacy with ZK innocence proofs on Base is still open.
  2. The regulatory climate in the US is the most favourable in years.
  3. AMLR 2027 creates a need for a CASP-acceptable "clean funds" proof.
- **Suggested positioning**: do not build another pool. Build a complementary layer instead: ASP tooling, proof verification for CEXs, off-ramps and dApps, or a proof-of-clean-funds attestation service that composes with 0xbow, Railgun, Hinkal and Base Ledgers. That avoids competing with Coinbase or 0xbow directly. This is my inference, not something a source states.

### Gaps
- No Dune or DefiLlama data on privacy-protocol volume on Base.
- No usage figures for Base Ledgers.
- No confirmation of 0xbow's L2 roadmap for Base.
