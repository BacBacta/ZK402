# Opportunités ZK et FHE sur Base — cartographie et priorisation

> **Statut** : analyse stratégique (septembre 2026), à confronter à des entretiens clients.
> Sources en fin de document ; ce qui n'a pas pu être vérifié est signalé comme tel.

---

## 1. Grille de lecture : quel outil pour quel problème

| Question | ZK (preuves à divulgation nulle) | FHE (calcul sur données chiffrées) |
|---|---|---|
| Ce qu'il cache le mieux | **Qui** (identité, lien entre actions) et **quoi** (attributs prouvés sans les montrer) | **Les valeurs** d'un état partagé (montants, offres, positions) |
| Situation typique | *Une* personne prouve quelque chose sur *ses* données | *Plusieurs* acteurs calculent ensemble sur un état chiffré commun |
| Confiance | Mathématique (plus le setup, selon le système de preuve) | Réseau de seuil qui détient la clé (Fhenix : Stage 1 sur testnet) ou TEE (Inco Lightning) |
| Maturité sur Base (sept. 2026) | **Prête** : vérificateurs Solidity, rien à attendre d'un tiers | Fhenix CoFHE : **testnet** ; Inco Lightning (TEE) : **sur mainnet** ; Zama : présence sur Base non vérifiée |
| Coût | Preuve générée côté client (quelques secondes), vérification on-chain | Opérations coûteuses et asynchrones via le coprocesseur |

**Règle de décision** :
- une personne, une preuve, de l'anonymat → **ZK** ;
- un état commun que tout le monde modifie sans que personne ne le voie → **FHE** ;
- beaucoup de produits ont besoin des **deux**, par exemple une offre scellée (FHE) déposée par un humain
  vérifié mais anonyme (ZK).

---

## 2. Ce qui est propre à Base

| Fait | Conséquence pour la confidentialité |
|---|---|
| **Coinbase Verifications** : attestations KYC publiques (EAS) sur Base | Utiliser son attestation **relie publiquement** une adresse à une identité vérifiée et à un pays. |
| **Actions tokenisées Coinbase** sur Base (août 2026 : NVDA, AAPL, TSLA…), réservées aux non-US (Reg S), gel possible par l'émetteur | Les positions de chaque détenteur sont publiques ; il faut prouver l'éligibilité (non-US) pour les intégrer à la DeFi. |
| **Flashblocks** (micro-blocs de 200 ms) | Les bots voient les déploiements de tokens et achètent dans le même bloc. Au lancement du token de Jesse Pollak, deux snipers ont pris environ 26 % de l'offre et ~1,3 M$ de profit. |
| **Marchés de prédiction** (Limitless : ~62 000 traders actifs par mois en juin 2026) | Positions et gros joueurs visibles, donc copiables et manipulables. |
| **Base Ledgers** (Coinbase, juin 2026) | Paiements privés pour grandes entreprises, avec opérateur et KYC : terrain occupé par Coinbase. |
| **x402** : ~85 % du volume sur Base, mais ~28 000 $ par jour dont environ la moitié artificielle (mars 2026) | Demande réelle encore faible. |

---

## 3. Les opportunités, une par une

Pour chaque opportunité : douleur, preuve de demande, solution technique, concurrence, verdict.

### O1 — « Prouver sans se doxxer » : identifiants ZK à partir de Coinbase Verifications

- **Douleur** : pour accéder à une app réservée aux comptes vérifiés (airdrop anti-sybil, pool
  conforme, jeton Reg S), il faut montrer une adresse attestée. Son historique complet devient alors
  lié à une identité KYC. Les attestations EAS sont publiques et composables par conception.
- **Demande** : la résistance aux sybils (airdrops, subventions, lancements) est un besoin permanent ;
  les actions tokenisées exigent de prouver qu'on n'est pas une personne US ; les apps grand public de
  Base veulent « un humain = un compte ».
- **Solution ZK** :
  1. **Inscription** (une seule fois, publique) : l'adresse attestée enregistre un engagement d'identité
     `idc = H(secret)` dans un registre. Le contrat vérifie on-chain que l'adresse porte une attestation
     valide (compte vérifié, pays).
  2. Le registre tient des **groupes** (arbres de Merkle) : `vérifiés`, `vérifiés-non-US`,
     `vérifiés-pays-X`…
  3. **Utilisation** (anonyme) : preuve d'appartenance à un groupe, avec un nullifier
     `H(secret, portée)` par application ou par campagne. On a un compte par humain et par campagne,
     sans aucun lien avec l'adresse d'origine.
  4. **Révocation** : si l'attestation est révoquée, un gardien (ou n'importe qui, avec une preuve de
     révocation) retire la feuille, et les racines suivantes l'excluent.
- **Concurrence** : ZK-KYC génériques (zkPass, zkMe, Self, World ID). Aucun produit trouvé qui rende
  **les attestations Coinbase elles-mêmes** utilisables de façon anonyme (à vérifier).
- **Réutilise** : arbres de Merkle, nullifiers, relayers et portefeuille des conceptions v2 et paie.
- **Verdict** : ✅ **fort**. Très aligné avec Base, techniquement mûr (ZK seul), MVP réalisable en
  quelques semaines, et c'est une **brique** pour O2, O4 et la paie (KYB).
- **Limite honnête** : l'inscription est publique : on sait que telle adresse *a rejoint* le groupe,
  pas où elle est utilisée ensuite. L'anonymat dépend de la taille du groupe.
- **Limites vérifiées depuis** (détail dans [`conception-identifiants-zk.md`](conception-identifiants-zk.md)) :
  Coinbase précise que ses attestations **ne doivent pas servir à des fins légales ou de
  conformité**, donc O1 est un outil anti-sybil et de filtrage d'accès, pas un KYC. Un compte peut
  attester jusqu'à 3 adresses (à confirmer), donc la borne est de ≤ 3 participations par personne et
  par campagne. Semaphore v4 est déjà déployé sur Base et peut être réutilisé tel quel.

### O2 — Lancements équitables : enchères scellées anti-snipe

- **Douleur prouvée sur Base** : les Flashblocks rendent la course au premier acheteur imbattable pour
  les humains ; le lancement du jeton de Jesse Pollak en est l'exemple public.
- **Demande** : écosystème très actif de lancements (creator coins, memecoins, ventes
  communautaires). La vente du jeton ZAMA (enchère scellée en FHE) a été sursouscrite à 218 % :
  preuve qu'un lancement scellé attire.
- **Solution FHE — enchère par lots à prix uniforme** :
  1. Pendant la fenêtre, chaque participant envoie une **offre chiffrée** `(quantité, prix limite)`.
     L'ordre d'arrivée ne compte plus, donc voir les Flashblocks ne sert plus à rien.
  2. Le prix est discrétisé en `K` paliers (ex. 16). Pour chaque palier `p`, le contrat calcule
     **homomorphiquement** la demande `D(p) = Σ select(prixᵢ ≥ p, qtéᵢ, 0)`. C'est `K × N` opérations,
     ce qui reste faisable pour quelques centaines ou milliers d'offres, par lots.
  3. À la clôture, seule la **courbe agrégée** `D(p)` est déchiffrée. Le prix de compensation est le
     plus haut palier où `D(p) ≥ offre`. Les offres individuelles ne sont jamais révélées.
  4. Allocation : chaque gagnant reçoit sa quantité au prix uniforme ; au palier marginal, un
     prorata est calculé sur une valeur chiffrée multipliée par une constante publique.
  5. **Anti-sybil optionnel** : une offre par humain vérifié via O1. Le produit combine alors ZK et FHE.
- **Alternative sans FHE** : chiffrement à seuil des offres (type Shutter) + commit-reveal. C'est plus
  simple, mais les offres sont révélées à la fin, et un participant peut refuser de révéler (grief).
- **Concurrence** : lanceurs anti-sniper sur Solana ; Zama a fait sa propre vente sur Ethereum. **Aucun
  lanceur scellé trouvé sur Base** (à vérifier).
- **Dépendance technique** : FHE sur **mainnet** Base. Fhenix n'y est qu'en testnet ; Inco Lightning
  (TEE) y est, mais avec une confiance matérielle. C'est le point à trancher (§ 5).
- **Verdict** : ✅ **fort sur la demande**, ⚠️ **risque d'infrastructure FHE**. Excellent démonstrateur
  de la combinaison ZK + FHE.

### O3 — Paie et paiements confidentiels (déjà conçu : `conception-paie.md`)

- **Demande** : la plus documentée (Fireblocks : la confidentialité est le premier obstacle
  institutionnel ; paie en stablecoins en forte hausse).
- **Concurrence, mise à jour** :
  - **Zama × Bron** ont réalisé une paie confidentielle en cUSDT (ERC-7984, FHE) sur mainnet dès
    janvier 2026. Elle cache les montants, mais les adresses restent visibles.
  - **Base Ledgers** : grandes entreprises, avec opérateur.
  - **Aleo × Toku** : paie en ZK, sur une autre chaîne.
- **Notre différenciation** : non-custodial, **sans lien employeur → salarié** (ZK, que le FHE de
  Zama ne cache pas), natif Base, preuve d'origine pour les exchanges.
- **Verdict** : ✅ demande forte mais **concurrence croissante** et **cycle de vente long**
  (conformité, comptabilité). Mieux en deuxième temps, en s'appuyant sur O1 pour le KYB.

### O4 — Détention confidentielle d'actions tokenisées

- **Douleur** : un fonds ou un desk ne veut pas exposer ses positions (Fireblocks : « les desks ne
  règlent pas on-chain si leurs positions fuient »). Les actions Coinbase sur Base sont publiques
  par adresse.
- **Solution** :
  - **FHE** : un *wrapper* ERC-7984 (`cNVDAc`) aux soldes chiffrés, avec des hooks de conformité (gel
    sur demande de l'émetteur, liste noire) ;
  - **ZK** : l'éligibilité Reg S (non-US) prouvée via O1, sans révéler l'identité. **Attention** :
    les attestations Coinbase ne peuvent pas servir de preuve de conformité selon leurs conditions ;
    cet usage exige un accord explicite de Coinbase.
- **Obstacle majeur** : l'**émetteur** (Coinbase) doit accepter qu'un wrapper détienne ses jetons et
  que son pouvoir de gel s'exerce à travers lui. C'est une question juridique autant que technique.
- **Concurrence** : outillage ERC-7984 générique (Zama, OpenZeppelin, Inco) ; Base Ledgers pour les
  institutions.
- **Verdict** : ⚠️ **fort potentiel, dépendant d'un partenariat émetteur**. À ouvrir par une
  discussion, pas par du code.

### O5 — Marchés de prédiction à positions privées

- **Douleur** : copie des gros joueurs, manipulation, exposition des paris (sujets politiques).
- **Demande** : marché en forte croissance (~21 Md$ par mois tous acteurs confondus en 2026),
  Limitless actif sur Base. Mais les places on-chain restent sous 4 % du volume de Polymarket.
- **Solution** : positions en notes blindées (ZK) réglées par preuve ; cotes agrégées publiques. Un
  carnet d'ordres chiffré (FHE) serait trop coûteux aujourd'hui.
- **Obstacle** : réglementation (jeux d'argent, sujets politiques). Il faudrait **s'intégrer à une
  place existante** plutôt qu'en créer une.
- **Verdict** : ⚠️ intéressant, mais une niche réglementairement délicate. Plus tard, en partenariat.

### O6 — Preuve de revenu par zkTLS et crédit sous-collatéralisé

- **Idée** : prouver « je touche ≥ X » depuis sa banque (zkTLS) ou depuis la paie ZK402 (O3), pour
  emprunter sur Base sans surcollatéral.
- **Demande** : discutée depuis longtemps, peu matérialisée. Des briques zkTLS existent (Reclaim,
  zkPass, Opacity).
- **Verdict** : ⏳ **plus tard**. C'est une extension naturelle de O3 (preuve de revenu déjà conçue).

### O7 — Trading privé (anti copy-trading)

- **Douleur** : réelle ; il existe une industrie de bots qui copient les wallets sur Base.
- **Solution** : swaps depuis un pool blindé (modèle Railgun, **absent de Base**).
- **Obstacle** : c'est le cas d'usage le plus exposé réglementairement (mixeur perçu). Les shielded
  pools grand public restent petits (Railgun : ~16 M$ blindés hors staking, sept. 2026).
- **Verdict** : ⚠️ plus tard, en réutilisant le pool à dépôts restreints de O3 (fonds d'origine vérifiée).

### O8 — Paiements x402 privés pour agents

- **Verdict** : ⏳ **demande pas encore là** (voir § 2). À garder comme extension du même pool.

---

## 4. Matrice de priorisation

Notes de 1 à 5 : **Demande** prouvée · **Adéquation** à Base · **Concurrence** (5 = terrain libre) ·
**Maturité technique** sur Base mainnet · **Réutilisation** de ce qui est déjà conçu.

| Opportunité | Demande | Base | Concurrence | Maturité | Réutil. | Total | Techno |
|---|---|---|---|---|---|---|---|
| **O1 Identifiants ZK Coinbase** | 4 | 5 | 4 | 5 | 5 | **23** | ZK |
| **O2 Lancements scellés** | 5 | 5 | 4 | 2 | 3 | **19** | FHE + ZK |
| **O3 Paie confidentielle** | 5 | 4 | 2 | 4 | 5 | **20** | ZK |
| O4 Actions tokenisées confidentielles | 4 | 5 | 3 | 2 | 2 | 16 | FHE + ZK |
| O5 Prédiction privée | 3 | 4 | 4 | 3 | 3 | 17 | ZK |
| O6 Revenu / crédit | 2 | 3 | 3 | 3 | 4 | 15 | ZK (+zkTLS) |
| O7 Trading privé | 3 | 4 | 5 | 4 | 4 | 20* | ZK |
| O8 x402 privé | 1 | 5 | 2 | 4 | 5 | 17 | ZK |

\* O7 a un bon score brut, mais le risque réglementaire le repousse (non noté dans la grille).

---

## 5. Recommandation : une plateforme en trois étages

```
          ┌──────────────────────────────────────────────────────────────┐
  Étage 3 │ Paie confidentielle (O3) · plus tard : actions (O4), crédit (O6)│  ← revenus récurrents B2B
          ├──────────────────────────────────────────────────────────────┤
  Étage 2 │ Lancements équitables scellés (O2)                           │  ← démonstrateur ZK+FHE, viral
          ├──────────────────────────────────────────────────────────────┤
  Étage 1 │ Identifiants ZK sur Coinbase Verifications (O1)              │  ← brique commune, rapide
          └──────────────────────────────────────────────────────────────┘
```

1. **Commencer par O1** : c'est le plus rapide à livrer et entièrement en ZK, donc sans attendre le
   mainnet FHE. Il sert tous les étages suivants : anti-sybil pour les lancements, KYB et éligibilité
   pour la paie et les actions.
2. **Puis O2** : forte visibilité (le problème des snipers est connu de tout Base) et vitrine de la
   combinaison ZK + FHE. Il faut trancher l'infrastructure FHE :
   - **(a)** Fhenix CoFHE, dès son mainnet ;
   - **(b)** Inco Lightning (TEE), disponible, mais avec une confiance matérielle à expliquer ;
   - **(c)** chiffrement à seuil + commit-reveal, sans FHE.
   Recommandation : développer sur (a) en testnet, et lancer sur (b) ou (c) si le mainnet Fhenix tarde.
3. **Puis O3** : cycle de vente plus long, mais revenus récurrents, et O1 fournit déjà le KYB.

**Le fil conducteur** : *la confidentialité comme infrastructure pour Base*. Le même socle (arbres,
nullifiers, relayers, portefeuille) sert tous les produits. L'ensemble d'anonymat est partagé, et il
grossit avec chaque produit.

---

## 6. Ce qu'il faut valider avant de coder

| Hypothèse | Test |
|---|---|
| Les apps Base veulent un anti-sybil anonyme basé sur Coinbase Verifications | 10 équipes (airdrops, lanceurs, apps sociales) : l'intégreraient-elles ? |
| Les créateurs de jetons paieraient pour un lancement scellé | 10 créateurs ou lanceurs de jetons sur Base ; mesurer l'intérêt pour un pilote |
| Une enchère FHE de quelques centaines d'offres tient en coût et en délai | Prototype sur Fhenix testnet (Base Sepolia) : mesurer gas, latence et coût de déchiffrement de la courbe |
| Coinbase accepterait un wrapper confidentiel de ses actions (O4) | Prise de contact, avant tout développement |
| Termes d'utilisation des attestations Coinbase compatibles avec O1 | Lecture des conditions + contact Coinbase |

---

## Sources

- Base Ledgers : https://www.base.org/ledgers ;
  https://incrypted.com/en/coinbase-launched-private-transactions-on-base-for-enterprises/
- Coinbase Verifications : https://github.com/coinbase/verifications ;
  https://blockworks.com/news/coinbase-identity-verification-kyc
- Actions tokenisées sur Base :
  https://www.coindesk.com/business/2026/08/24/coinbase-debuts-tokenized-stocks-on-base-network-joining-race-to-bring-equities-on-blockchain
- Snipers et Flashblocks :
  https://finance.yahoo.com/news/flashblocks-let-bots-front-run-111149882.html ;
  https://www.indexbox.io/blog/flashblocks-enable-13m-profits-during-base-founders-token-launch/
- Vente ZAMA en enchère scellée : https://blockeden.xyz/blog/2026/01/05/zama-protocol/
- ERC-7984 et paie Zama × Bron :
  https://docs.openzeppelin.com/confidential-contracts/token ;
  https://www.zama.org/post/erc-7984-the-confidential-token-standard-explained
- Marchés de prédiction :
  https://www.trmlabs.com/resources/blog/how-prediction-markets-scaled-to-usd-21b-in-monthly-volume-in-2026 ;
  https://cryptorank.io/news/feed/47d2f-10-prediction-market-platforms-worth-knowing-in-2026
- zkTLS : https://bex.co/blog/2026/01/13/zktls-verifiable-web-data-zero-knowledge-proofs
- Fireblocks (confidentialité, obstacle institutionnel) :
  https://blockchain.news/news/stablecoin-privacy-institutional-blockchain-adoption-barrier
- x402 (demande réelle) :
  https://www.coindesk.com/markets/2026/03/11/coinbase-backed-ai-payments-protocol-wants-to-fix-micropayment-but-demand-is-just-not-there-yet
- Inco Lightning sur Base :
  https://mpost.io/inco-lightning-launches-on-base-expanding-smart-contract-privacy-with-encrypted-computation-and-data-protection/
- Railgun (TVL) : https://defillama.com/protocol/railgun
