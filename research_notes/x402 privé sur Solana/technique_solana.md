# Porting the shielded note pool (private x402) to Solana: technical feasibility and cost (as of 25 Sep 2026)

## Q1. ZK proof verification on Solana: syscalls, CU cost, CU/tx limit, tx size

### Takeaway
Groth16 over BN254 is cheap to verify on Solana. Light Protocol's `groth16-solana` verifies in about 78k–109k CU for 1–8 public inputs, well under the 1.4M CU per-transaction cap. The old 1,232-byte transaction limit was the main constraint. It was lifted to 4,096 bytes by v1 transactions (SIMD-0296/0385), live on mainnet since 15 Sep 2026. UltraHonk has no cheap on-chain path on Solana, so the port means switching the proof system to Groth16.

### Cited Findings
- Hard limits in the Agave runtime: `MAX_COMPUTE_UNIT_LIMIT = 1_400_000` CU per tx and `DEFAULT_INSTRUCTION_COMPUTE_UNIT_LIMIT = 200_000`. Heap is 256 KiB max, call depth 64 — [agave execution_budget.rs](https://raw.githubusercontent.com/anza-xyz/agave/master/program-runtime/src/execution_budget.rs)
- Syscall CU costs, same file:
  - alt_bn128 G1 add: 334 CU. G1 mul: 3,840 CU. G2 add: 535 CU. G2 mul: 15,670 CU.
  - Pairing: 36,364 CU for the first pair, then 12,121 CU for each extra pair.
  - G1 compress/decompress: 30/398 CU. G2 compress/decompress: 86/13,610 CU.
  - Poseidon: `61*n^2 + 542` CU, where n is the number of inputs.
  - Source: [agave execution_budget.rs](https://raw.githubusercontent.com/anza-xyz/agave/master/program-runtime/src/execution_budget.rs)
- The `sol_alt_bn128_group_op` syscall does G1 add, G1 mul and pairing checks. `sol_poseidon` is Poseidon with an x^5 S-box and BN254 parameters. Summarised by the search tool; the underlying pages were [Helius blog](https://www.helius.dev/blog/zero-knowledge-proofs-its-applications-on-solana) and the [Solana syscall reference](https://github.com/solana-foundation/solana-com/blob/main/apps/docs/content/docs/en/core/programs/syscall-reference.mdx), which I did not read directly. G2 syscalls are specified in [SIMD-0302](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0302-bn254-g2-syscalls.md); I did not verify whether that feature is active on mainnet.
- `groth16-solana` (Light Protocol) end-to-end verification costs:
  - Groth16: 78,293–108,762 CU for 1–8 public inputs.
  - Groth16 with BSB22 commitment (gnark): 134,764–165,236 CU.
  - It uses alt_bn128 syscalls, which have been live on mainnet since Solana 1.18. It accepts circom/snarkjs and gnark verifying keys and is Apache-2.0.
  - The README fetch did not mention an audit.
  - Source: [Lightprotocol/groth16-solana](https://github.com/Lightprotocol/groth16-solana)
- Chainstack (guide pinned as of Apr 2026) gives wider ranges:
  - Groth16 verification "roughly 170,000–500,000 compute units, depending on circuit complexity and the number of public inputs".
  - Proof size of about 324–388 bytes; proof plus public witness about 400–464 bytes.
  - Source: [Chainstack](https://docs.chainstack.com/docs/solana-zk-proofs)
  - This conflicts with the lower groth16-solana benchmarks. The higher figure probably includes the Sunspot/gnark verifier and overhead (see Q2).
- Transaction size: "The maximum transaction size is now 4096 bytes, up from 1232". Activated at mainnet epoch 1035 on 15 Sep 2026, around 01:00 UTC — [solana.com upgrades](https://solana.com/upgrades/larger-transaction-sizes)
- Constraints of the v1 format, same source:
  - CU limits must be set in the message config. Omitting them sets the limits to zero.
  - ComputeBudget instructions become no-ops.
  - Address Lookup Tables are not supported; up to 64 inline account addresses are allowed.
  - Wallets must advertise v1 support, and RPC reads need `maxSupportedTransactionVersion: 1`.
- Spec for the size increase: [SIMD-0296](https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0296-larger-transactions.md). The v1 format is defined in SIMD-0385 — [solana.com](https://solana.com/upgrades/larger-transaction-sizes)
- UltraHonk: the alt_bn128 syscalls "cover G1/G2 arithmetic and pairing — enough for Groth16 — but not the multi-point KZG openings UltraHonk relies on". Sunspot to Groth16 is described as "the only production path from Noir to Solana" — [Chainstack](https://docs.chainstack.com/docs/solana-zk-proofs)

### Inferences
- A 2-in/2-out join-split has about 6–8 public inputs: root, 2 nullifiers, 2 output commitments, ext data hash, and possibly amount and recipient. With `groth16-solana` that should cost about 100k–110k CU to verify (from the benchmark table). With BSB22 (gnark/Sunspot), expect about 150k–165k CU.
- The 4.1M gas per claim on Base comes mostly from the UltraHonk Solidity verifier. On Solana the equivalent work is around 10% of the per-tx CU budget.
- A Groth16 proof (256 bytes compressed, about 324–388 bytes by Chainstack's count) plus inputs fits in a legacy 1,232-byte tx, but only barely once accounts and signers are added. Since 15 Sep 2026, v1 txs (4,096 bytes) remove the need for ALTs or split transactions. v1 drops ALTs and caps inline accounts at 64, and wallet and relayer support is new, so check the relayer and wallet stack.
- Porting UltraHonk natively looks impractical. Any KZG or multi-scalar-multiplication work would have to be done with the G1 mul syscall at 3,840 CU per mul, and an UltraHonk verifier needs many of them. This is an inference; I found no measured UltraHonk-on-Solana number.

### Gaps
- I found no audited or measured UltraHonk verifier for Solana, and no primary source quoting its CU cost.
- Mainnet activation status of the SIMD-0302 G2 syscalls was not verified.

## Q2. Noir on Solana: Sunspot, other backends, UltraHonk

### Takeaway
The practical route for keeping the Noir circuits is Reilabs' Sunspot. It compiles Noir ACIR to gnark's constraint system, proves with gnark Groth16, and generates a Solana verifier program. It is unaudited, pinned to specific Noir betas, and needs a proper trusted setup (a per-circuit Groth16 ceremony). The team would lose UltraHonk's universal setup.

### Cited Findings
- Sunspot (reilabs) provides compile, setup, prove, verify and deploy commands for Noir to Groth16 to Solana — [reilabs/sunspot](https://github.com/reilabs/sunspot)
- The README says "Sunspot has not been audited yet and is provided as-is. We make no guarantees to its safety or reliability" — [reilabs/sunspot](https://github.com/reilabs/sunspot)
- The built-in setup is unsafe: "THIS IS UNSAFE! IT PERFORMS GNARK TRUSTED SETUP WITH NO MITIGATION FOR CRYPTOGRAPHIC TOXIC WASTE!" The README points users to external ceremony tooling — [reilabs/sunspot](https://github.com/reilabs/sunspot)
- The current README requires Noir 1.0.0-beta.22 — [reilabs/sunspot](https://github.com/reilabs/sunspot)
- Chainstack (Apr 2026) pinned nargo 1.0.0-beta.18, Solana CLI 3.1.x and Go 1.24+, and warns that "version drift ... causes serialization mismatches" — [Chainstack](https://docs.chainstack.com/docs/solana-zk-proofs)
- Official examples of Noir with Sunspot on Solana — [solana-foundation/noir-examples](https://github.com/solana-foundation/noir-examples)
- Poseidon trap:
  - Noir's stdlib Poseidon and the `sol_poseidon` syscall disagree on which state element is the output.
  - The fix is to use the external `noir-lang/poseidon` library, which matches circomlib and the syscall.
  - Source: [Chainstack](https://docs.chainstack.com/docs/solana-zk-proofs)
- The existing Base circuit uses PoseidonT3 on the Solidity side, which is circomlib-compatible. I did not re-verify that the Noir side uses the matching library.
- Reference implementation, veil402:
  - Uses the exact stack under study: Noir, Groth16 via Sunspot and Anchor.
  - Shielded UTXO pool with a fixed 2-in/2-out join-split, "Poseidon over BN254 (circom parameters), byte-identical between the Noir circuit and the on-chain `solana-poseidon` syscall".
  - Verification costs "approximately 544K CU locally", via CPI into the Sunspot verifier.
  - Status: "Not audited. Not for production or real funds."
  - Source: [21r21a33333/veil402](https://github.com/21r21a33333/veil402)
- Other Groth16 verifier options: [zz-sol/groth16-verifier-program](https://github.com/zz-sol/groth16-verifier-program); [succinctlabs/sp1-solana](https://github.com/succinctlabs/sp1-solana) for SP1 zkVM proofs wrapped in Groth16.

### Inferences
- There is a large gap between veil402's measured about 544k CU and groth16-solana's about 100k–165k CU. It suggests the Sunspot-generated verifier (plus CPI) is much less optimised than Light's crate. Possible routes:
  - Export the gnark VK and verify with `groth16-solana`, which supports gnark VKs and BSB22.
  - Rewrite the circuit in circom for plain Groth16.
  - Neither route is benchmarked in these notes.
  - Even at 544k CU, the verification fits within 1.4M CU.
- Migration cost: the Noir circuit logic can largely be reused. What changes:
  - Prover: bb/UltraHonk is replaced by gnark Groth16.
  - A per-circuit trusted-setup ceremony is needed.
  - Client and prover tooling changes. Proving is in Go/gnark, and I found no WASM or browser story for Sunspot.
  - The verifier becomes a Rust program instead of a Solidity one.

### Gaps
- No public CU benchmark of Sunspot-generated verifiers other than veil402's local figure.
- Unknown whether Sunspot supports every Noir black-box function used in the Base circuit.
- Browser or mobile proving with Sunspot/gnark (for x402 clients) is undocumented in what I found.

## Q3. Merkle trees and nullifier storage on Solana: concurrent Merkle trees, ZK Compression, rent

### Takeaway
On-chain Poseidon Merkle trees are affordable: about 786 CU per 2-to-1 hash, so about 16k CU for a depth-20 path. Light's audited concurrent Merkle tree is reusable. Nullifiers are the main storage-cost decision:
- A plain PDA per nullifier locks about 0.001 SOL of rent forever.
- Light's compressed "nullifier PDA" costs about 15,000 lamports (about 0.000015 SOL).
- The compressed option depends on Light's infrastructure (indexer/Photon, foresters, validity proofs).

### Cited Findings
- Poseidon syscall cost is `61*n^2 + 542` CU — [agave execution_budget.rs](https://raw.githubusercontent.com/anza-xyz/agave/master/program-runtime/src/execution_budget.rs)
- veil402 uses "Light Protocol's audited `light-concurrent-merkle-tree`" with depth 20 (about 1M leaves), a 64-root history window, and "one PDA per nullifier" as the double-spend guard — [veil402](https://github.com/21r21a33333/veil402)
- Light's nullifier example:
  - PDA nullifier: about 0.001 SOL. Compressed PDA nullifier: about 0.000015 SOL.
  - "Nullifier accounts must remain active, hence lock ~0.001 SOL in rent per nullifier PDA permanently."
  - Sources: [Lightprotocol/program-examples zk/nullifier](https://github.com/Lightprotocol/program-examples/tree/main/zk/nullifier); [zkcompression.com](https://www.zkcompression.com/compressed-pdas/nullifier-pda)
- Light also runs a deployed nullifier program at `NFLx5WGPrTHHvdRNsidcrNcLxRruMC92E4yv7zhZBoT` on mainnet and devnet:
  - It creates a rent-free compressed PDA with seeds `["nullifier", id]`, at about 15,000 lamports per nullifier.
  - If the address already exists, the transaction fails.
  - Source: [zkcompression.com](https://www.zkcompression.com/compressed-pdas/nullifier-pda)
- ZK Compression state trees are Poseidon concurrent Merkle trees with only the root stored on-chain.
  - Appending a leaf costs about 100–200 lamports; nullifying a leaf about 5,000 lamports.
  - Creating a compressed token account costs about 5,000 lamports, versus about 2,000,000 lamports for a normal one.
  - Sources: [Lightprotocol/light-protocol](https://github.com/Lightprotocol/light-protocol); summary via search of [HackMD](https://hackmd.io/@0xMukesh/r1mwqUGDR) and [Helius](https://www.helius.dev/blog/zk-compression-keynote-breakpoint-2024). These are secondary sources, and the figures may be from 2024.
- Unlike the pool's own note tree, ZK Compression state is designed around the Light system program. Using it means CPI into Light plus an off-chain indexer (Photon) to serve validity proofs — [light-protocol GitHub](https://github.com/Lightprotocol/light-protocol)

### Inferences
- Poseidon Merkle append at depth 20: 20 × (61·4 + 542) = 20 × 786 ≈ 15.7k CU, plus program overhead. This is computed from the Agave formula. Combined with Groth16 (about 100k–544k CU) and token transfer CPIs, one spend tx should fit in roughly 200k–700k CU.
- Nullifier rent: a join-split with 2 input notes creates 2 nullifiers.
  - With plain PDAs: about 0.002 SOL locked forever per spend. At about $116/SOL (see Q5) that is about $0.23 per spend, unrecoverable because nullifier accounts must never be closed.
  - With compressed nullifiers: about 0.00003 SOL (about $0.0035).
  - Recommended design: the note tree in the pool's own concurrent Merkle tree (Light crate), with nullifiers as compressed PDAs or as a nullifier indexed Merkle tree.
- Light's `light-concurrent-merkle-tree` allows several appends per slot without root conflicts (concurrent changelog). This matters on Solana, where many txs land in the same block. The pool must accept any of the last N roots (for example 64), as veil402 does.

### Gaps
- No primary 2026 figure for the exact rent-exempt lamports of a 32-byte PDA. The number above comes from Light's approximate "~0.001 SOL".
- Current Light V2 (batched trees) costs and CU for compressed-nullifier validity proofs were not found.

## Q4. Existing open-source shielded pools on Solana to reuse

### Takeaway
The most reusable production-grade code is Privacy Cash:
- Circom/Groth16 on Anchor, MIT licence, several audits.
- As last documented, SOL only; SPL was "soon".

Veil402 is the closest architectural match (Noir + Sunspot + 2x2 join-split + Light Merkle tree, x402-oriented name) but is unaudited. Elusiv is sunset. Light's old PSP/privacy product has been superseded by ZK Compression.

### Cited Findings
- Privacy Cash (GitHub):
  - Deposits SOL into a pool as commitments in a Merkle tree; withdrawals to any address use ZK proofs.
  - Anchor program, circom 2.2.2 circuits, MIT licence.
  - "Private SPL tokens transfer and private swap will soon follow."
  - "fully audited by Accretion, HashCloak, Zigtur and Kriko, and verified onchain".
  - Source: [Privacy-Cash/privacy-cash](https://github.com/Privacy-Cash/privacy-cash)
- Privacy Cash tweet: "core code is now open source ... 4 expert audits, from @accretion_xyz, @hashcloak, @zigtur & @krikoeth" — [X/@theprivacycash](https://x.com/theprivacycash/status/1973097040839147757)
- Summary claims "20 audits in total — 14 Solana, 6 Base/EVM" plus Veridise formal verification. These were only in an aggregator/search summary, not confirmed on a primary page, so treat as unverified — [Solana Compass](https://solanacompass.com/projects/privacy-cash)
- veil402: Noir + Groth16 + Anchor shielded UTXO pool with selective disclosure; unaudited research code — [veil402](https://github.com/21r21a33333/veil402)
- Other open repos that appeared in search:
  - tidex6: "One Groth16 circuit, live on Solana mainnet, Arc and EVM" — [koshak01/tidex6](https://github.com/koshak01/tidex6)
  - ZNGLABS confidential-swap-kit: circom/Groth16, "zero rent per swap", MIT — [ZNGLABS/confidential-swap-kit](https://github.com/ZNGLABS/confidential-swap-kit)
  - I did not inspect either in depth.
- Elusiv announced its sunset on 29 Feb 2024 and was withdrawal-only until Jan 2025 — [Elusiv Medium](https://medium.com/elusiv-privacy/sunsetting-elusiv-transitioning-towards-the-future-of-privacy-and-confidentiality-0b078e9bcfac); [Helius blog](https://www.helius.dev/blog/privacy-on-solana-with-elusiv-and-light)

### Inferences
- The fastest low-risk path: fork or adapt Privacy Cash's audited Anchor program and circom circuits, and add SPL/USDC support. The audits cover the SOL flow only, so USDC support would need re-audit.
- Alternatively, keep Noir via Sunspot using veil402 as a template, and own the audit risk (both Sunspot and the program are unaudited).

### Gaps
- Primary source for the current Privacy Cash SPL/USDC support status in Sep 2026 not found.
- Light Protocol's old PSP code status and licence were not verified on a primary source.

## Q5. Transaction fees on Solana for a spend tx (USD) vs Base

### Takeaway
A shielded spend on Solana costs about $0.001–0.01 in fees at typical priority-fee levels. The real per-spend cost driver is nullifier storage: about $0.23 with plain PDAs, versus under $0.01 compressed. I did not collect the Base gas price needed for a precise comparison with the 4.1M-gas claim.

### Cited Findings
- Base fee is 5,000 lamports per signature (50% burned).
- Priority fee = ceil(CU_price[micro-lamports] × CU_limit / 1e6). It is charged on the requested CU limit, even if the tx fails.
- Source: [solana.com fee structure](https://solana.com/docs/core/fees/fee-structure)
- The priority fee is based on the CU limit requested, not the CU used — [RPC Fast](https://rpcfast.com/blog/solana-transaction-fees-explained)
- Typical Solana txs cost $0.001–$0.01 — [BloFin 2026](https://blofin.com/en/academy/education/solana/solana-gas-fees-and-priority-fees) (secondary source)
- SOL was about $116.32 on 25 Sep 2026. This came from a search-engine summary with the source page unclear, so treat as approximate — [Bybit price page](https://www.bybit.com/en/price/solana/)

### Inferences
Worked example, all computed:
- Assumptions: 1 relayer signature, 700k CU limit, 10,000 micro-lamports/CU priority price.
- Fee: 5,000 + 7,000 = 12,000 lamports, about 0.000012 SOL, about $0.0014.
- At 100,000 micro-lamports/CU: about 75,000 lamports, about $0.009.
- Plus nullifier storage: plain PDAs about 0.002 SOL, about $0.23; compressed about $0.0035.
- Plus rent for the recipient's USDC associated token account if it does not yet exist (about 0.002 SOL). That cost applies on any Solana transfer.

For comparison with Base: at 4.1M gas the fee is 4.1M × gas price. The figure was not sourced here; the Base/EVM researcher should supply it.

### Gaps
- No primary 2026 median priority-fee value (micro-lamports/CU) was found.
- Base gas price at the same date is missing.

## Q6. USDC on Solana: freeze authority; Token-2022 confidential transfer as an alternative

### Takeaway
USDC on Solana is a classic SPL token whose freeze authority is held by Circle. Circle can freeze the pool's vault token account in one instruction, freezing every shielded user's funds at once. This is the same class of risk as the Tornado Cash USDC blacklisting on Ethereum.

Token-2022 Confidential Transfers only hide amounts, not the sender/recipient graph. The feature was disabled from June 2025 to June 2026. It is not a substitute for a note pool for USDC, and I found no source saying USDC uses Token-2022.

### Cited Findings
- On Solana, an SPL mint's freeze authority "freezes a holder's token account for that mint with a single instruction — the balance stays in place and cannot move until the authority thaws it". Circle holds this authority for USDC — [stablescan](https://stablescan.achivx.com/solana/freezes)
- In Aug 2022 Circle froze USDC at sanctioned Tornado Cash addresses on Ethereum — [Cointelegraph](https://cointelegraph.com/news/circle-freezes-blacklisted-tornado-cash-smart-contract-addresses)
- Circle has frozen USDC on Solana before: about $57–58M in wallets tied to the LIBRA scandal — [Decrypt](https://decrypt.co/322558/circle-freezes-58-million-usdc-solana-wallets-libra-scandal)
- Timeline of the ZK ElGamal Proof program (which confidential transfers depend on):
  - Fiat-Shamir transcript bug found on 10 June 2025.
  - Confidential transfers disabled on 19 June 2025 (epoch 805).
  - Re-enable gate activated on 4 June 2026 (epoch 982).
  - Token-2022 redeployed with confidential instructions about two weeks later.
  - Sources: [Solana post-mortem](https://solana.com/news/post-mortem-june-25-2025); [xroot.dev](https://xroot.dev/blog/solana-confidential-transfers-kill-switch-proof-cost); [token-2022 issue #657](https://github.com/solana-program/token-2022/issues/657)
- Confidential transfer costs: 64-bit range proof 111k CU, 128-bit 200k CU, 256-bit 368k CU. The earlier multi-tx flow can now fit in a single v1 tx — [xroot.dev](https://xroot.dev/blog/solana-confidential-transfers-kill-switch-proof-cost)
- Confidential Balances only encrypt balances and amounts via ElGamal. Accounts remain public — [Solana docs](https://solana.com/docs/tokens/extensions/confidential-transfer)

### Inferences
- A USDC shielded pool on Solana holds all deposits in one program-owned token account. A single `FreezeAccount` by Circle would freeze the whole pool. Mitigations to design for:
  - Compliance features such as deposit screening and viewing keys (Privacy Cash advertises selective disclosure).
  - Or several vaults.
  - None of this removes the risk.
- Confidential transfers need a Token-2022 mint with the extension. USDC is a legacy SPL mint (per stablescan's description of the SPL freeze authority), so confidential transfers cannot be applied to native USDC. They also leave sender and recipient visible, which does not meet x402 unlinkability goals. At most they are a building block for amount hiding with a wrapped USDC token.
- The one-year kill-switch episode is itself a dependency risk.

### Gaps
- No primary source confirming whether Circle has ever frozen a Solana program vault. The stablescan page says Solana freeze events are "not indexed yet".
- No primary Circle statement found on USDC migrating to Token-2022 on Solana.
