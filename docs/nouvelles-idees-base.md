# Base — nouvelles idées ZK / FHE (septembre 2026)

> Complète [`opportunites-zk-fhe-base.md`](opportunites-zk-fhe-base.md) (O1–O8). Ne reprend pas ces
> idées. Sources en fin de document.

---

## 0. Ce que la recherche change

1. **Hinkal fait déjà des transferts USDC privés sur Base mainnet** : ZK (Groth16), contrôle KYT
   Chainalysis avant chaque transfert, 500 M$+ de volume cumulé, six audits, intégré au wallet
   Polygon. **Conséquence** : construire notre propre pool blindé (conception v2, paie) n'a plus de
   sens comme infrastructure. La valeur est dans les **applications au-dessus** d'une infrastructure
   existante (Hinkal, Base Ledgers, Semaphore, Inco…).
2. **Le social on-chain sur Base s'est effondré** : Coinbase a arrêté les creator coins et le fil
   Farcaster en février 2026. Toute idée « social » est à écarter.
3. **Ce qui croît** : paiements USDC marchands (Shopify via Stripe sur Base, paiements USDC sans gas),
   prêts garantis par du bitcoin (Coinbase × Morpho : 3,62 Md$ de collatéral, 1,57 Md$ prêtés,
   ~53 000 emprunteurs, liquidations record en février 2026), portefeuilles d'agents IA (Coinbase
   Agentic Wallets, février 2026).

---

## 1. Les idées

### N1 — Bouclier de liquidation pour les prêts adossés au bitcoin (FHE)

- **Douleur** : sur Morpho, chaque position est publique : collatéral, dette, prix de liquidation.
  Les bots savent exactement quelles positions tomberont à quel prix. Les grosses positions deviennent
  des cibles, et les cascades de liquidation l'ont montré en février 2026.
- **Demande prouvée** : 3,62 Md$ de collatéral, 53 000 emprunteurs, taux fixe lancé le 22 septembre
  2026 (Morpho Midnight). Les emprunteurs ont beaucoup à perdre.
- **Solution** : un *marché de prêt à positions chiffrées*. Collatéral et dette sont stockés en FHE ;
  la vérification de santé calcule `collatéral × prix ≥ dette × seuil` sur des valeurs chiffrées. Seul
  un **booléen** « liquidable » est déchiffré, puis la liquidation est ouverte à tous. Le prix de
  liquidation de chaque emprunteur n'est jamais visible.
- **Difficultés** :
  - FHE sur Base mainnet : Inco Lightning (TEE) y est, Fhenix n'y est qu'en testnet ;
  - chaque tick de prix déclenche des déchiffrements asynchrones : il faut un keeper ;
  - liquidités : il faut convaincre des prêteurs ou s'intégrer à Morpho (marché isolé dédié).
- **Concurrence** : Zama × Morpho fait des coffres de dépôt confidentiels, pas de l'emprunt.
  Aucun marché d'emprunt à positions chiffrées trouvé sur Base.
- **Verdict** : ✅ **la plus forte demande en valeur**, ⚠️ technique lourde. Commencer par un pilote
  sur Inco (TEE) ou sur Fhenix testnet.

### N2 — Payer sans montrer son portefeuille (checkout privé)

- **Douleur** : payer un marchand en USDC depuis son wallet lui révèle tout le portefeuille (solde,
  historique, autres achats). Le montant et le lien « ce wallet achète chez ce marchand » deviennent
  publics.
- **Demande** : paiement USDC sur Base intégré à Shopify Payments ; paiements USDC sans gas grâce au
  paymaster de Base. Polygon a jugé utile de lancer « Privately Send » (avec Hinkal) dans son wallet.
- **Solution** : un **bouton « Payer en privé »** (SDK pour wallets et checkouts) qui paie depuis un
  solde Hinkal ou une adresse à usage unique. Le reçu est vérifiable par le marchand (preuve de
  paiement), et le gas reste pris en charge.
- **Concurrence** : Hinkal lui-même (s'il fait l'intégration checkout) ; Polygon sur sa chaîne.
- **Verdict** : ⚠️ **bonne idée produit, faible barrière technique**. Le succès dépend de la
  distribution (wallets, prestataires de paiement). À aborder comme un partenariat avec Hinkal
  plutôt que comme une infrastructure concurrente.

### N3 — Réserves vérifiables en continu pour émetteurs de stablecoins et fonds RWA (ZK + zkTLS)

- **Contexte réglementaire** : le GENIUS Act (signé en juillet 2025, effectif au plus tard le
  18 janvier 2027) impose un rapport **mensuel** de réserves, examiné par un cabinet d'audit et
  certifié par le CEO et le CFO.
- **Attention** : la loi exige de **publier** la composition des réserves et les noms des banques. Le
  ZK n'apporte donc **pas** de confidentialité ici, mais de la **vérifiabilité en continu**. On
  prouve chaque jour (via zkTLS depuis les comptes bancaires et de conservation) que
  `réserves ≥ offre en circulation sur Base`, entre deux rapports mensuels.
- **Clients** : petits émetteurs de stablecoins et fonds tokenisés sur Base, pour qui la confiance est
  l'obstacle principal.
- **Verdict** : ⚠️ intéressant en B2B, cycle de vente long. La promesse est de l'**intégrité**, pas de
  la confidentialité.

### N4 — Budgets confidentiels pour agents IA (FHE)

- **Idée** : une entreprise fixe on-chain des plafonds de dépense chiffrés par agent et par
  fournisseur. Le contrat les applique sans révéler budgets ni fournisseurs privilégiés.
- **Contexte** : Coinbase Agentic Wallets (février 2026) intègre déjà des contrôles de dépense, gérés
  côté infrastructure et non chiffrés on-chain. La demande de paiements d'agents reste faible (x402).
- **Verdict** : ⏳ trop tôt.

### N5 — Jeux à information cachée (FHE)

- **Idée** : poker, jeux de bluff, jeux de stratégie à brouillard de guerre. Inco Lightning, en
  production sur Base, le permet déjà en Solidity.
- **Limites** : aucune métrique de joueurs trouvée ; le poker d'argent est un jeu d'argent
  réglementé.
- **Verdict** : ⏳ vitrine technique plutôt qu'opportunité prouvée.

### N6 — Enchères par lots à ordres chiffrés contre le MEV

- **Douleur** : sur Base, les Flashblocks ont concentré la compétition sur le premier slot ; le spam
  MEV consomme la capacité.
- **Concurrence** : **CoW Swap** (présent sur Base) fait déjà des enchères par lots à prix uniforme.
  Chiffrer les ordres vis-à-vis des solveurs est un gain marginal.
- **Verdict** : ❌ terrain occupé.

---

## 2. Priorisation

| Idée | Demande prouvée | Concurrence | Maturité technique sur Base | Verdict |
|---|---|---|---|---|
| **N1 Bouclier de liquidation** | Forte (Md$, liquidations record) | Libre | Faible (FHE mainnet) | ✅ Pilote |
| **N2 Checkout privé** | Moyenne | Hinkal / Polygon | Forte (Hinkal existe) | ⚠️ Partenariat |
| **N3 Réserves vérifiables** | Moyenne (réglementaire, 2027) | À étudier | Moyenne (zkTLS) | ⚠️ B2B long terme |
| N4 Budgets d'agents | Faible | Coinbase | Faible | ⏳ |
| N5 Jeux cachés | Non mesurée | Inco (démos) | Bonne (Inco) | ⏳ |
| N6 Lots anti-MEV | Forte | CoW Swap | Bonne | ❌ |

---

## 3. Mise à jour des idées précédentes

| Idée précédente | Impact de la découverte de Hinkal |
|---|---|
| Pool blindé (conception v2) | À ne pas reconstruire : Hinkal fait déjà transferts privés + KYT sur Base. |
| Paie confidentielle (O3) | Construire la **couche paie** (lots, multisig, fiches, audit) **au-dessus de Hinkal** plutôt que notre propre pool. Moins de risque (6 audits), mise sur le marché plus rapide. |
| Identifiants ZK (O1) | Inchangé (Semaphore, pas de concurrent direct trouvé). |
| Lancements scellés (O2) | Inchangé. |

---

## Sources

- Hinkal : https://hinkal.io/ ; https://github.com/Hinkal-Protocol/wdk-hinkal-demo ;
  https://blockeden.xyz/blog/2026/04/19/hinkal-protocol-privacy-wallet-solana-400m-confidential-volume/
- Polygon — paiements privés : https://polygon.technology/blog/private-payments-are-live-on-polygon ;
  https://thedefiant.io/news/blockchains/polygon-launches-shielded-usdc-and-usdt-payments
- Fin du social sur Base : https://www.odaily.news/en/post/5211890 ;
  https://finance.biggo.com/news/8ab86d43-3e10-4deb-9181-f77a7a37b49d
- Shopify et USDC sur Base :
  https://www.coinbase.com/blog/coinbase-and-shopify-bring-usdc-payments-on-base-to-millions-of-merchants-worldwide ;
  https://www.pymnts.com/cryptocurrency/2026/shopifys-usdc-integration-shows-how-platforms-could-pick-stablecoin-favorites/
- USDC sans gas sur Base : https://eco.com/support/en/articles/15183708-how-to-send-usdc-networks-fees-and-wallet-steps-in-2026
- Prêts bitcoin Coinbase × Morpho :
  https://www.theblock.co/news/defi/2026-09-22-coinbase-fixed-rate-bitcoin-loans-morpho-midnight-416050 ;
  https://decrypt.co/379091/borrow-against-bitcoin-fixed-rate-coinbase-morpho
- Coinbase Agentic Wallets : https://www.pymnts.com/cryptocurrency/2026/coinbase-debuts-crypto-wallet-infrastructure-for-ai-agents/
- GENIUS Act : https://www.congress.gov/bill/119th-congress/senate-bill/1582 ;
  https://www.ridgewayfs.com/stablecoin-reserve-requirements-genius-act/
- Jeux confidentiels (Inco) : https://www.inco.org/blog/confidential-onchain-games
- MEV et Flashblocks : https://arxiv.org/html/2604.00234v1
- CoW Swap : https://cow.fi/learn/understanding-mev-protection
