# Base — nouvelle série d'idées (critères stricts)

> Critères : niche **en croissance sur Base**, douleur **documentée**, **non résolue**, ZK/FHE
> **central**. Niches examinées cette fois : agents IA (Virtuals, ACP), perps (Avantis), actions
> tokenisées de Coinbase, empoisonnement d'adresses, récupération des comptes à passkey.

---

## A1 — « Preuve de livraison » : évaluateurs prouvés pour le commerce entre agents (ACP / ERC-8183)

### 1. La niche sur Base
- **Virtuals** est le premier écosystème d'agents IA sur Base : plus de **1,77 million de jobs**
  réalisés, **479 M$ d'« aGDP »** déclarés et ~**2,63 M$ de revenus mensuels** du protocole (février
  2026), ~18 000 agents.
- Son **Agent Commerce Protocol (ACP)** : un client finance un séquestre en USDC, un prestataire
  (agent) livre, et un **évaluateur** décide de libérer ou de rembourser. ACP v2 tourne sur **Base**,
  fonctionne par **hooks** attachés à chaque job, et implémente **ERC-8183** (standard proposé pour
  le commerce entre agents).

### 2. La douleur, documentée
- **Qui évalue l'évaluateur ?**
  - L'article de synthèse académique sur la sécurité du commerce entre agents (*SoK*, 2026) note
    qu'un évaluateur compromis peut **approuver des livraisons frauduleuses ou rejeter des livraisons
    légitimes**.
  - Le papier *RAILS* (2026) pose le même problème fondamental : « qui évalue si un agent a agi
    correctement ? ».
- **En pratique, l'évaluateur est souvent un agent LLM, ou le client lui-même.** Le guide ACP
  décrit la libération du séquestre à l'**approbation de l'acheteur**. Un client de mauvaise foi peut
  refuser de payer un travail correct ; un évaluateur LLM peut se tromper ou être manipulé.
- **Crédibilité des métriques** : des analystes se demandent si l'aGDP reflète une demande réelle ou
  une activité circulaire (le débat reste ouvert : les partisans rappellent que chaque job brûle de
  vrais frais).
- **Non résolu** : ERC-8183 prévoit explicitement que l'évaluateur « **PEUT être un contrat qui
  vérifie une preuve à divulgation nulle** », mais les discussions portent surtout sur des consensus
  de plusieurs LLM. Je n'ai trouvé **aucun évaluateur prouvé en production** ; RAILS reste de la
  recherche.

### 3. L'idée
Remplacer le jugement par une **preuve**, pour toutes les catégories de jobs dont le résultat est
**vérifiable** :

| Catégorie de job | Ce qui est prouvé | Technique |
|---|---|---|
| **Récupération de données** (prix hors chaîne, résultat, statistique, contenu d'une page, réponse d'API) | « Cette donnée vient bien de cette source, à cette heure » | **zkTLS**, avec les mêmes notaires M-sur-N que *Verdict* |
| **Action on-chain** (swap, bridge, dépôt, paiement) | « L'état attendu est atteint » | Vérification on-chain directe (pas besoin de ZK) |
| **Calcul déterministe** (backtest, agrégation, conversion, script) | « Ce résultat est la sortie de ce programme sur ces entrées » | **zkVM** (SP1 / RISC Zero) |
| **Génération créative ou LLM** (texte, image) | — | ❌ hors de portée du ZK aujourd'hui ; reste aux évaluateurs classiques |

**Intégration sans autorisation** :
1. un **contrat évaluateur** conforme ERC-8183 (le rôle d'évaluateur peut être n'importe quelle adresse
   ou contrat) : le client le désigne à la création du job ;
2. ou un **hook ACP v2** (`afterAction` sur la soumission) qui refuse une livraison sans preuve valide.

Dans les deux cas, **ni le client ni le prestataire ne peuvent tricher** : le séquestre suit la
preuve.

### 4. Mécanisme
1. **À la création du job**, le client choisit un **modèle de livraison** (comme les modèles de sources
   de *Verdict*) : type de preuve, source ou programme, format du résultat, délai. Le hash du modèle et
   de ses paramètres est lié au job.
2. **Le prestataire livre** le résultat **et** sa preuve (attestations zkTLS M-sur-N, ou preuve zkVM).
3. **L'évaluateur contractuel** vérifie : preuve valide, conforme au modèle, dans les délais. Si oui,
   `complete` (le séquestre est versé) ; si la preuve est absente à l'échéance, `reject` (remboursement).
4. **Données privées** : si la livraison contient des données sensibles (ex. solde d'un compte
   client), la preuve révèle seulement ce qui est convenu (divulgation sélective du zkTLS).

### 5. Pourquoi c'est cohérent avec *Verdict*
Même infrastructure (réseau de notaires zkTLS cautionnés, modèles de sources, vérification on-chain),
deux marchés de Base :
- **les marchés de prédiction**, qui doivent trancher une question ;
- **le commerce entre agents**, qui doit valider une livraison.

Les coûts fixes (notaires, audits, modèles) sont amortis sur les deux.

### 6. Limites honnêtes
- **Couverture** : seuls les jobs vérifiables sont concernés. **La part de ces jobs dans ACP est
  inconnue** et doit être mesurée (phase 0).
- **Confiance** : zkTLS dépend des notaires (M-sur-N, caution), comme pour *Verdict*.
- **Adoption** : il faut que les clients choisissent cet évaluateur. Arguments : moins de litiges, des
  paiements garantis pour les prestataires honnêtes, et une meilleure réputation (branchement ERC-8004).
- **Coût zkVM** : acceptable pour des jobs de valeur moyenne à élevée, pas pour des micro-jobs à
  quelques centimes (dans ce cas, zkTLS ou on-chain seulement).

### 7. Plan
| Phase | Livrable | Critère |
|---|---|---|
| 0. Mesure | Classer un échantillon de jobs ACP récents (données publiques on-chain et registre d'agents) par catégorie de vérifiabilité | Part vérifiable ≥ 30 % des jobs ou de la valeur |
| 1. Prototype | Évaluateur ERC-8183 + modèle « récupération de données » (zkTLS) + modèle « action on-chain » sur Base Sepolia | Job complet validé par preuve, et rejeté sans preuve |
| 2. Extension | Modèle « calcul » (zkVM), intégration comme hook ACP v2 | Premiers prestataires volontaires sur Base mainnet |

---

## Pistes examinées et écartées (au regard des critères)

| Niche sur Base | Constat | Raison de l'écart |
|---|---|---|
| **Perps (Avantis)** : ~22 Md$ de volume cumulé | Pas de douleur spécifique documentée (chasse aux positions, etc.) | Critère « douleur documentée » non rempli |
| **Actions tokenisées de Coinbase** : ~50 apps DeFi intégrées au lancement (Aave, Morpho, Euler, Aerodrome, Wasabi) ; l'émetteur peut geler les wallets en juridiction interdite (Reg S) | Risque réel pour la DeFi, mais pas de douleur documentée à ce jour ; et les attestations Coinbase ne valent pas preuve de conformité | À surveiller : si des gels touchent des pools, une preuve ZK d'éligibilité non-US deviendra pertinente |
| **Empoisonnement d'adresses** : pertes record (50 M$ en décembre 2025, 12,4 M$ en janvier 2026, 24 M$ en mars 2026) | Douleur énorme | Le ZK n'est pas central (les adresses furtives l'atténuent, mais Fluidkey les propose déjà) |
| **Récupération des comptes à passkey** (Coinbase Smart Wallet) | Perte de l'appareil ou du compte cloud = perte d'accès | Déjà traité par la phrase de récupération de Coinbase ; ZK non central |

---

## Sources

- Virtuals / ACP : https://whitepaper.virtuals.io/llms-full.txt (ACP v2 : hooks, ERC-8183, Base) ;
  https://blockeden.xyz/blog/2026/04/21/agdp-agent-gdp-virtuals-protocol-ai-blockchain-valuation-primitive-tvl-displacement/ ;
  https://bex.co/blog/2026/05/09/virtuals-protocol-ai-economic-os-agdp-agent-platform ;
  https://members.delphidigital.io/feed/virtuals-agent-commerce-protocol-acp-towards-multi-agent-collaboration
- ERC-8183 : https://ethereum-magicians.org/t/erc-8183-agentic-commerce/27902
- Sécurité du commerce entre agents : https://arxiv.org/pdf/2604.15367 ; RAILS : https://arxiv.org/pdf/2606.08790
- Avantis : https://defillama.com/protocol/avantis ; https://perps.info/dex/avantis
- Actions tokenisées : https://financefeeds.com/coinbase-debuts-tokenized-us-stocks-on-base-for-investors-outside-the-us/ ;
  https://thedefiant.io/news/defi/coinbase-launches-tokenized-stocks-on-base
- Empoisonnement d'adresses : https://bex.co/blog/2026/03/11/address-poisoning-defi-stealth-attack-vector ;
  https://cylab.cmu.edu/news/2026/01/07-blockchain-address-poisoning.html
- Récupération Coinbase Smart Wallet : https://help.coinbase.com/en/wallet/getting-started/smart-wallet-recovery ;
  https://cryptoslate.com/crypto-wallets/base-wallet-review/
