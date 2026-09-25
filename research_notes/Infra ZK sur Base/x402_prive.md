# Private / shielded x402 payments for AI agents on Base: market, competition, pain (as of 25 Sept 2026)

Method note: all figures come from web sources retrieved on 25 Sept 2026. Several are secondary aggregators, which is flagged where it applies. No live x402scan or Dune query was run, so there is no September 2026 figure. The most recent traction figures are from July 2026.

## 1. x402: what it is, current state, and measurable traction

### Takeaway
x402 is now a Linux Foundation standard with heavy corporate backing: Visa, Mastercard, Google, AWS, Stripe, Circle and others. It has processed roughly 120 to 165M cumulative transactions but only about $41 to 50M in cumulative USD volume. Real demand is thin: about $28K a day, and around half of transactions are judged gamed or artificial. Base leads by transaction count, but sources disagree on the Base vs Solana split.

### Cited Findings
**Governance and standard**
- Sept 2025: Coinbase and Cloudflare announced they would launch an x402 Foundation. — [Coinbase blog](https://www.coinbase.com/blog/coinbase-and-cloudflare-will-launch-x402-foundation); [Cloudflare blog](https://blog.cloudflare.com/x402/)
- 2 Apr 2026: the Linux Foundation launched the x402 Foundation, and Coinbase contributed the protocol. Founding members: Adyen, AWS, American Express, Ampersend.ai, Base, Circle, Cloudflare, Coinbase, Fiserv, Google, KakaoPay, Mastercard, Merit Systems, Microsoft, Polygon Labs, PPRO, Shopify, Sierra, Solana Foundation, Stripe, thirdweb and Visa. The same release states that "Solana currently drives approximately 65% of x402 transaction volume." — [Linux Foundation press release](https://www.linuxfoundation.org/press/linux-foundation-is-launching-the-x402-foundation-and-welcoming-the-contribution-of-the-x402-protocol)
- The GitHub repo now lives under the `x402-foundation` org (github.com/x402-foundation/x402). — [GitHub issue #2641](https://github.com/x402-foundation/x402/issues/2641)
- x402 v2 is supported by the CDP facilitator. Production networks: Base, Polygon, Arbitrum, World and Solana. Supported mechanisms: EIP-3009, Permit2 and SPL. — [CDP Facilitator docs](https://docs.cdp.coinbase.com/x402/seller/facilitator) (via search snippet)
- Google built x402 into AP2, its Agent Payments Protocol, which launched with more than 60 partners. — [PayRam explainer](https://payram.com/blog/mcp-a2a-ap2-acp-x402-erc-8004) (secondary)

**Traction (dated)**
- Chainalysis, 3 Jun 2026: 100M cumulative x402 transactions on Base through Q1 2026. Transactions of $1 or more rose from 49% of volume in early 2025 to 95% in early 2026. Tester-to-payer conversion improved 4x over six months. Weekly wallet retention peaked at 87% during the PING meme-coin spike, then fell to 5%. — [Chainalysis](https://www.chainalysis.com/blog/x402-agentic-payments-adoption/)
- CoinDesk, 11 Mar 2026: about 131,000 transactions a day for about $28,000 in daily volume, an average of about $0.20. One February day saw 3.8M transactions and about $2M, mostly testing. Artemis estimated that roughly half of x402 transactions are artificial or gamed. — [CoinDesk](https://www.coindesk.com/markets/2026/03/11/coinbase-backed-ai-payments-protocol-wants-to-fix-micropayment-but-demand-is-just-not-there-yet)
- Dashboard as of 14 Apr 2026: 120M+ transactions and $41M+ in USDC volume across 14 chains. Base had about 70M transactions and $21.5M (58% share). Solana had about 45M transactions and $16.4M (38%). Others had about 4%. Top facilitators: Daydreams (8.1M+ transactions), Coinbase (7.6M+), x402rs (411K) and Canza (12K). — [web3trackers x402 dashboard](https://www.web3trackers.com/x402-dashboard) (aggregator, methodology unverified)
- As of Mar 2026: 119M+ transactions on Base and 35M on Solana, with about $600M in "annualized volume." — [Presenc AI / search snippet](https://presenc.ai/research/x402-protocol-adoption-tracker-2026) (secondary). The $600M annualized figure conflicts with the $28K/day real volume reported by CoinDesk, so treat it as UNCERTAIN.
- Late Apr 2026: Coinbase reported 69,000 active agents, 165M transactions and about $50M in cumulative volume when it launched the Agent.market directory. — [Presenc AI](https://presenc.ai/research/x402-protocol-adoption-tracker-2026); [DEV Community](https://dev.to/t49qnsx7qtkpanks/x402-hit-165-million-transactions-heres-what-it-still-cant-do-4f4d) (secondary; the original Coinbase post was not retrieved)
- As of 19 Jul 2026: 157,413,420 cumulative transactions and $41,062,036 in stablecoin volume across 7 chains and 18 facilitators. — [agenteconomy.to](https://agenteconomy.to/stats/x402-transactions) (via search snippet; aggregator)
- USENIX Security 2026 paper (arXiv, 21 Jul 2026): the 15 major facilitators studied serve "over 60K sellers and 360K buyers." The paper analyzed over 119M recent Base and Solana transactions, found violations in every facilitator, and led to mitigations including changes by Coinbase. — [arXiv 2607.19545](https://arxiv.org/abs/2607.19545)

### Inferences
- The addressable volume today is tiny. At about $41 to 50M cumulative and about $28K a day, even a 1% fee on all x402 volume would generate less than $150K a year. A private x402 business case rests on future growth, or on enterprise or agent-platform demand, not on current flows.
- Sources disagree on the Base vs Solana share. The Linux Foundation says Solana has about 65% of volume (2 Apr 2026). web3trackers says Base has 58% (14 Apr 2026). The gap is probably a difference in metric (USD volume vs transaction count) or in time window. Base clearly leads on cumulative transaction count.

### Gaps
- No primary x402scan or Dune figure for September 2026 was retrieved. The latest numbers above date from July 2026.
- Funding for the x402 ecosystem and an unduplicated count of real sellers and buyers were not found beyond the USENIX figure (60K sellers, 360K buyers).

## 2. Existing private, shielded or anonymous x402 and agent-payment projects

### Takeaway
The space is already crowded with prototypes and early products: FHE, MPC and ZK-note approaches, mostly testnet or hackathon stage, several of them on Base. The most serious are TACEO (MPC+ZK, early access), Mind Network x402z (FHE, testnet), Fhenix402 (FHE, Base Sepolia PoC), RelAI (Privacy Pools, testnets) and Privacy Cash (live on Solana). The closest in design to the proposed product (ZK notes and nullifiers on Base) is the open-source shielded-x402 repo. The platform-level threat is Coinbase's own Base Privacy / Base Ledgers, launched 17 Jun 2026 in early access for enterprises.

### Cited Findings
| Project | Tech | Chain | Status | Traction / funding | Source |
|---|---|---|---|---|---|
| **shielded-x402** (nhestrompia) | Noir ZK, notes plus nullifiers, Merkle tree; a sequencer enforces nonces and balances; per-chain relayers; commitment roots posted hourly on Base | Base Sepolia plus Solana | Open-source MVP; posted on HN about 7 months ago (around Feb 2026) | 4 stars, 0 forks, 43 commits | [GitHub](https://github.com/nhestrompia/shielded-x402); [HN](https://news.ycombinator.com/item?id=47036522) |
| **TACEO Merces, Confidential x402** | MPC plus ZK; hides amounts and balances; sender and receiver addresses stay VISIBLE ("full private transfers on the roadmap") | L2, not named | Early access via design partners; security paper IACR ePrint 2026/850 | No metrics disclosed | [TACEO](https://taceo.io/agents/); [Financial IT](https://financialit.net/news/payments/taceo-merces-brings-confidential-payments-x402-new-internet-payment-standard) |
| **Mind Network x402z** (with Zama) | FHE plus ERC-7984 confidential tokens; hides amounts, balances and intent | Zama/EVM | Testnet launched 20 Jan 2026; "x402z A2A Payment Alliance" | Mind Network backed by YZi Labs, HashKey and Chainlink (round sizes not given) | [Cointelegraph PR](https://cointelegraph.com/press-releases/mind-network-launches-x402z-a-confidential-a2a-payment-solution-for-the-ai-economy); [Phemex](https://phemex.com/news/article/mind-network-launches-x402z-testnet-for-confidential-ai-payments-54700); [x402z site](https://x402z.mindnetwork.xyz/) |
| **Fhenix402** | FHE (FHERC20); encrypted amounts | Base Sepolia | PoC built in one day; 2 test transactions; post dated 7 Nov 2025, updated 17 Apr 2026 | Demo only | [Fhenix blog](https://www.fhenix.io/blog/fhenix402) |
| **RelAI** | Privacy Pools with an ASP compliance layer, stealth recipients, encrypted receipts | Solana, Base, SKALE, Avalanche, Polygon, SEI, peaq | "3 chains live testnets"; 5% platform fee; $5/month Pro plan | No funding disclosed | [relai.fi](https://relai.fi/) |
| **Privacy Cash x402 SDK** | ZK mixer pool; breaks the payer-to-recipient link | Solana | Privacy Cash pool live; x402 SDK exists | Not found | [GitHub Privacy-Cash](https://github.com/Privacy-Cash/privacy-cash); [privacyx402.com](https://privacyx402.com/) |
| **zkx402 (NovaNet)** | zkML proofs for authorization and "proof-aware pricing"; privacy of inputs, not of payments | not clear | Unveiled around Nov 2025 | Not found | [vhspace/zkx402 GitHub](https://github.com/vhspace/zkx402); [X post](https://x.com/HouseofZK/status/1988942972293972367) |
| **Kage** | Deposit and withdraw ZK proofs, stealth addresses, double-spend rejection | Stellar testnet (USDC/XLM) | Testnet / hackathon | Not found | [DEV](https://dev.to/venkat___/kage-private-payments-for-autonomous-ai-agents-43bj) |
| **Shade402** | Private, rule-controlled x402 facilitator | Midnight | Prototype; shielded settlement "planned" | Not found | [GitHub](https://github.com/mhizer-fatai/shade402) |
| **VeiledHood** | Pay-per-call settlement to stealth addresses via x402 | not clear | not clear | Not found | [veiledhood.com](https://www.veiledhood.com/) |
| **Policy-gated ZK payer (x402 issue #2641)** | Circom/Groth16 proof carried in the EIP-3009 signature slot and checked through EIP-1271; the spending cap stays hidden (only a commitment is posted) | EVM/USDC | PoC, 16 Jun 2026; no replies | none | [GitHub issue #2641](https://github.com/x402-foundation/x402/issues/2641) |
| **Base Privacy / Base Ledgers** (Coinbase) | Private ledger connected to Base through a Portal contract. "Deposits hide the recipient. Withdrawals hide the sender." Coinbase-managed (Coinbase KYC plus sanctions screening) or self-managed | Base | Launched 17 Jun 2026, early access, enterprise-focused; agents and x402 NOT mentioned on the page | Coinbase-backed; Iron Fish team acquired Mar 2025 | [base.org/ledgers](https://www.base.org/ledgers); [CDP on X](https://x.com/CoinbaseDev/status/2066992742094483718); [PANews](https://www.panewslab.com/en/articles/019ed319-f4c9-72a3-ada4-59645100bb9f); [Coinbase blog, Iron Fish](https://www.coinbase.com/blog/Coinbase-acquires-team-to-accelerate-privacy-efforts-on-Base) |
| **Solana privacy stack** (Confidential Balances, privacy hackathon) | Token-2022 confidential transfer | Solana | Live | n/a | [Solana privacy](https://solana.com/privacy); [Solana Privacy Hack](https://solana.com/privacyhack) |

- Brian Armstrong said on 22 Oct 2025 that Coinbase is building private transactions for Base. — [CoinDesk](https://www.coindesk.com/business/2025/10/22/coinbase-is-building-private-transactions-for-base-ceo-brian-armstrong-says)

### Inferences
- The combination of "private x402 on Base with ZK notes and nullifiers" is not novel as a concept. shielded-x402, Fhenix402 and the #2641 PoC all exist. None of them shows meaningful traction, and none is a funded, production-grade Base product dedicated to agents. The gap is execution and distribution, not the idea.
- Coinbase's Base Ledgers is the biggest strategic risk. If CDP extends it to x402 or AgentKit, it would own distribution. It is also a possible partnership or integration target.
- FHE approaches (Zama, Fhenix, Mind) hide amounts but not necessarily counterparties. TACEO explicitly leaves addresses public. That leaves room for a design that hides both the payer address and the payment graph.

### Gaps
- Funding rounds (amounts and dates) for TACEO, RelAI, Privacy Cash, NovaNet and Fhenix in 2026 were not retrieved.
- No usage metrics for any private x402 product were found.
- Railgun, Aztec, Nillion and Umbra were not found to have specific x402 integrations in the searches performed. That is not a confirmed absence.

## 3. Is confidentiality of agent payments a documented pain?

### Takeaway
Yes, but it is documented mostly by vendors, researchers and VCs, and by Coinbase through its enterprise privacy product. It is not yet documented by paying x402 buyers complaining publicly. The strongest evidence comes from academic papers on metadata and PII leakage, Coinbase's Base Privacy rationale ("cannot expose supplier relationships..."), and a16z calling privacy crypto's main moat. No privacy-focused discussion with maintainer engagement was found on the x402 GitHub.

### Cited Findings
- Base Privacy launch framing (June 2026): banks, payment companies, brokers and treasuries "cannot expose supplier relationships, client positions, payroll data or internal capital movements every time they complete an onchain transaction." — [search summary citing Base launch coverage](https://cryptoadventure.com/base-launches-private-settlement-rails-for-institutional-transactions/); [CDP on X, "Going onchain shouldn't mean giving up privacy"](https://x.com/CoinbaseDev/status/2066992742094483718)
- arXiv 2604.11430 (Stantchev, 13 Apr 2026, revised 30 Jun 2026): every x402 request embeds a resource URL, description and reason. These reach servers and centralized facilitators before settlement, "typically without data processing agreements," and may contain PII. The paper proposes presidio-hardened-x402 middleware with F1 0.898. — [arXiv](https://arxiv.org/abs/2604.11430)
- "Five Attacks on x402" (arXiv 2605.11781, May 2026) is cited as listing "privacy leakage via transaction-graph linkability" as a vulnerability class. — [arXiv 2605.11781](https://arxiv.org/html/2605.11781v1) (via search snippet; the full text was not read)
- A search summary of the privacy literature states: "each agent making thousands of x402 payments per day produces a public map of internal operations: which vendors are used, how often, and at what cost." — [arXiv 2604.11430 v1](https://arxiv.org/html/2604.11430v1) (attribution from the search snippet; exact wording not verified in full text)
- The TACEO pitch says to hide "agent operator's pricing signals and valuations" and the "API provider's dynamic pricing and margin structures." — [TACEO](https://taceo.io/agents/) (vendor claim)
- Mind Network (Jan 2026): agents should pay "without exposing amounts, balances, or intent." — [Cointelegraph PR](https://cointelegraph.com/press-releases/mind-network-launches-x402z-a-confidential-a2a-payment-solution-for-the-ai-economy) (vendor claim)
- a16z crypto's 2026 outlook (Dec 2025 / Jan 2026): privacy "will become the strongest moat in crypto." It also predicts a shift from KYC to "Know Your Agent." — [Cryptonews](https://cryptonews.com/news/vc-firm-a16z-flags-stablecoins-tokenization-and-privacy-as-key-themes-for-2026/); [Bitcoin.com](https://news.bitcoin.com/how-crypto-could-reshape-finance-ai-and-privacy-by-2026-a16z-crypto/) (secondary coverage)
- On ERC-8004 privacy: an ACTA post argues that an agent's visible feedback and delegation trail "can leak operational edge before the agent ever signs a transaction," and proposes anonymous credentials. — [Paragraph/ACTA](https://paragraph.com/@arcabot/acta-and-erc-8004-agent-trust-needs-privacy-now)
- CoinDesk (Mar 2026) quotes a16z's Noah Levine and x402 creator Erik Reppel on weak demand. The retrieved summary did not include privacy complaints. — [CoinDesk](https://www.coindesk.com/markets/2026/03/11/coinbase-backed-ai-payments-protocol-wants-to-fix-micropayment-but-demand-is-just-not-there-yet)
- Chainalysis can profile x402 payers, for example wallet age (197 days on average vs 423 for Base overall), holdings (26 token types vs 4) and 12x capital inflows. This shows how analyzable agent wallets are. — [Chainalysis](https://www.chainalysis.com/blog/x402-agentic-payments-adoption/)

### Inferences
- The pain is credible for enterprises and trading or research agents, where vendor lists and spending reveal strategy. Coinbase building Base Privacy validates it at the platform level. Chainalysis's payer profiling shows linkability is real in practice.
- No dated public complaints from actual x402 buyers or sellers about privacy were found. Demand evidence is mostly supply-side: vendors, researchers and VCs.
- Metadata leakage (URL, description) at the facilitator is a separate privacy problem that on-chain ZK does not solve. A full solution also needs facilitator and metadata privacy.

### Gaps
- No x402 GitHub Discussions thread on privacy with maintainer responses was found. Issue #2641 had no replies. A deeper GitHub search could change this.
- No enterprise survey quantifying demand for private agent payments was found.

## 4. Regulatory and compliance constraints

### Takeaway
Compliance is the central design constraint. USDC and other GENIUS-regulated stablecoins can be frozen. Circle already froze an entire confidential-USDC pool (Zama, May 2026), locking unrelated users' funds. The dominant facilitator (Coinbase CDP) runs KYT and OFAC screening. A private x402 product on Base will likely need selective disclosure (view keys or ASP-style association sets) and must reckon with pool-level blacklist risk.

### Cited Findings
- The GENIUS Act was signed 18 Jul 2025. On 8 Apr 2026, FinCEN and OFAC proposed AML and sanctions rules requiring permitted payment stablecoin issuers to be able to "block, freeze, and reject prohibited transactions." — [Holland & Knight](https://www.hklaw.com/en/insights/publications/2026/04/fincen-and-ofac-propose-aml-sanctions-rules-for-stablecoin-issuers); [Mayer Brown](https://www.mayerbrown.com/en/insights/publications/2026/04/stable-rules-for-stablecoins-treasury-proposes-aml-and-sanctions-framework-for-issuers); [Treasury](https://home.treasury.gov/news/press-releases/sb0435)
- FDIC's BSA and sanctions standards for PPSIs were published in the Federal Register on 5 Jun 2026. — [Federal Register](https://www.federalregister.gov/documents/2026/06/05/2026-11342/bank-secrecy-act-and-sanctions-compliance-standards-for-fdic-supervised-permitted-payment-stablecoin)
- Late May 2026: a court order led Circle to blacklist Zama's cUSDC wrapper contract, locking about $12.6M, including unrelated users' funds. Zama paused cUSDC, cUSDT and cWETH. The depositing address had not been flagged by KYT at the time of the 11 May deposit. — [The Defiant](https://thedefiant.io/news/defi/circle-freeze-on-zamas-confidential-usdc-locks-12-6m-of-user-funds-in-defi-crossfire); [Unchained](https://unchainedcrypto.com/court-order-forces-circle-to-freeze-12-6-million-in-zamas-confidential-usdc-contract-locking-unrelated-users-funds/); [CryptoTimes, 30 May 2026](https://www.cryptotimes.io/2026/05/30/circle-blocks-zama-confidential-usdc-contract-freezing-12-6m/)
- The Coinbase CDP facilitator runs automated KYT and blocks payments to OFAC-sanctioned and high-risk addresses. — [Coinbase, CDP facilitator on Polygon](https://www.coinbase.com/en-fr/developer-platform/discover/launches/x402facilitator-polygon); [CDP docs](https://docs.cdp.coinbase.com/x402/seller/facilitator)
- Base Ledgers' Coinbase-managed mode includes "KYC by Coinbase Direct, sanctions screening built in." Iron Fish-derived privacy on Base uses "view keys" to provide data to authorities. — [base.org/ledgers](https://www.base.org/ledgers); [search summary of Base/Iron Fish coverage](https://financefeeds.com/coinbase-base-private-transactions-iron-fish/)
- TACEO keeps sender and receiver addresses public "for regulatory compliance." RelAI uses Privacy Pools with ASP compliance. — [TACEO](https://taceo.io/agents/); [RelAI](https://relai.fi/)
- a16z frames "Know Your Agent" as the emerging compliance model. — [Cryptonews](https://cryptonews.com/news/vc-firm-a16z-flags-stablecoins-tokenization-and-privacy-as-key-themes-for-2026/)
- A Fifth Circuit Tornado Cash ruling on OFAC's authority over immutable smart contracts is referenced as background. The details were not retrieved. — [Coincub](https://coincub.com/blog/stablecoin-issuers-freeze-funds/) (secondary)

### Inferences
- A USDC shielded pool on Base is exposed to the Zama-style risk: one bad depositor can get the whole pool frozen. Possible mitigations include deposit screening, association sets, per-tenant pools, or view-key disclosure. This risk should be a core point in any pitch.
- Hiding the payer's address from a Coinbase facilitator that must run KYT may conflict with the facilitator's compliance model. A custom facilitator or relayer is likely needed.

### Gaps
- No specific guidance was found from FinCEN or OFAC on privacy pools used by AI agents.
- EU MiCA and AMLR treatment of shielded stablecoin transfers was not researched.

## 5. ERC-8004, AP2 and privacy

### Takeaway
ERC-8004 (on-chain agent identity, reputation and validation registries) and Google's AP2 (mandates, integrates x402) are about trust and accountability, not payment confidentiality. Privacy there is being added by third parties: anonymous credentials (ACTA) and the SKALE ERC-8004 deployment marketed "with privacy."

### Cited Findings
- ERC-8004 defines identity, reputation and validation registries for trustless agents. — [EIP-8004](https://eips.ethereum.org/EIPS/eip-8004); [QuickNode guide](https://www.quicknode.com/blog/erc-8004-a-developers-guide-to-trustless-ai-agent-identity)
- ACTA argues that ERC-8004 agent trust trails leak operational edge and proposes predicate proofs through anonymous credentials. — [Paragraph/ACTA](https://paragraph.com/@arcabot/acta-and-erc-8004-agent-trust-needs-privacy-now)
- SKALE markets ERC-8004 "with privacy" plus zero gas. — [SKALE blog](https://www.skale.space/blog/erc-8004-on-skale-trustless-agents-with-privacy-zero-gas-real-time-execution)
- AP2 incorporates x402 and launched with over 60 partners (Mastercard, PayPal, Visa, Adyen). — [PayRam](https://payram.com/blog/mcp-a2a-ap2-acp-x402-erc-8004) (secondary)
- The ERC-8004 plus x402 identity-payment stack is described as complementary. — [RNWY blog](https://rnwy.com/blog/erc-8004-x402-identity-payment-stack)

### Inferences
- ERC-8004 reputation linked to payment receipts makes linkability worse, because a public identity is tied to a spending trail. A ZK x402 product could offer "prove an ERC-8004 reputation or policy predicate without revealing the wallet." This is a differentiated angle.

### Gaps
- No primary AP2 spec text on privacy or selective disclosure was retrieved.
