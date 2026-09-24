# Base — série 7 : grand marché, faible concurrence, douleur documentée

> **Critères** : marché **important** sur Base, **peu de concurrence**, douleur **documentée**,
> ZK/FHE au cœur.
>
> **Leçon des séries précédentes** : sur Base, l'argent circule dans les **swaps** :
> - Aerodrome traite à lui seul ~500 M$ par jour et 50 à 60 % du volume des DEX de Base ;
> - dans nos mesures ACP, 99 % de la valeur déplacée par les agents vient de swaps (Ethy AI :
>   218 M$).
>
> On cherche donc là où ce flux souffre.

---

## S1 — « Bassin scellé » : un dark pool FHE sur Base

### 1. Le marché
- **Volume des DEX de Base** : de l'ordre de **15 Md$ par mois**. Aerodrome a atteint 16,5 Md$ en
  un mois.
- **Hors chaîne, la demande de confidentialité d'exécution est massive** :
  - les dark pools et les places hors bourse traitent **plus de 40 %** des actions américaines, et
    ont dépassé **50 %** en 2025 ;
  - en crypto, 40 % des institutions interrogées par Finery Markets préfèrent les desks OTC. Elles y
    font passer plus de la moitié de leur volume, précisément pour éviter le front-running et le MEV.
- **Agents de trading sur Base** : Ethy, Axelrod, Otto, Wasabot, Capminal. Leurs ordres (DCA,
  exécution progressive) sont **prévisibles et visibles**. C'est un flux d'ordres naturel à attirer.

### 2. La douleur, documentée
- **Le seul dark pool de Base est défaillant sur la confidentialité.** Article de septembre 2026
  (*Privacy Gaps in the Renegade Decentralized Dark Pool*), sur plus de **700 000 transactions
  Renegade sur Base** :
  - **88 % du trafic** passe par une poignée de relayers qui **voient les wallets en clair**. Le
    système fonctionne donc comme un carnet d'ordres centralisé ;
  - le calcul multipartite (MPC) « avec abandon » permet à un participant de **découvrir le résultat
    d'un appariement puis d'abandonner** sans pénalité : la confidentialité avant exécution est
    cassée ;
  - des abandons répétés permettent de **reconstruire l'historique des ordres** de la contrepartie ;
  - le réseau entier tient sur **4 nœuds**, tous hébergés chez Amazon dans la même zone.
- **Côté grands comptes** : « les institutions ne régleront pas de grosses positions on-chain tant
  qu'elles ne pourront pas le faire confidentiellement » (21Shares, 2026).
- **MEV** : environ 1,7 Md$ extraits entre 2022 et 2025, toutes chaînes confondues.

### 3. La concurrence

| Acteur | Sur Base ? | Limite |
|---|---|---|
| **Renegade** (MPC) | Oui | Failles documentées ci-dessus : relayers en clair, abandons, centralisation |
| **Zama**, swaps privés (septembre 2026) | **Non**, Ethereum seulement | Enchères scellées auprès de teneurs de marché, entre stablecoins et parts de vaults confidentiels uniquement |
| Hinkal, swaps privés | Oui | Cache l'**identité**, mais le swap passe par un AMM public : pas d'appariement au prix médian, montant visible au moment de l'exécution |
| CoW Protocol (enchères par lots) | Oui | Ordres **en clair** pour les solveurs |
| Écosystème Fhenix | — | Je n'y ai trouvé aucun dark pool (Fluton, Obolos et Privara font autre chose). **À confirmer** |

**Conclusion** : la place du « dark pool réellement confidentiel sur Base » est **libre**. Le seul
occupant a des failles publiées.

### 4. L'idée : un appariement chiffré de bout en bout, sans relayer et sans abandon possible
**Fhenix CoFHE fonctionne sur Base** (en production depuis février 2026). On peut donc calculer
directement sur des ordres chiffrés.

1. **Dépôt** : le trader dépose des USDC ou des jetons, convertis en **solde chiffré** (FHERC20),
   comme dans notre prototype v1.
2. **Ordre** : le sens (achat ou vente), la quantité et une limite de prix sont **chiffrés** côté
   client (`encryptInputs`) puis envoyés **directement au contrat**. Il n'y a **pas de relayer**,
   donc aucune fuite à l'étape de découverte des contreparties.
3. **Appariement par lots** (par exemple toutes les 10 à 30 s) au **prix médian** d'un oracle
   (Chainlink ou Pyth sur Base) :
   - le contrat calcule en FHE le total acheteur, le total vendeur et la quantité croisée
     `min(A, V)` ;
   - il répartit ensuite les exécutions avec `FHE.select`, sans aucun branchement sur des valeurs
     chiffrées.
4. **Règlement** : les soldes chiffrés sont mis à jour. **Chacun ne peut déchiffrer que sa propre
   exécution** (permis ACL). Le volume croisé total peut rester chiffré, ou être publié avec du
   retard.
5. **Reste non exécuté** : il reste dans le carnet ou est annulé. En option, il est routé vers
   Aerodrome via une exécution progressive.

**Pourquoi cela corrige les failles de Renegade** :

| Faille documentée | Correction |
|---|---|
| Relayers qui voient les ordres en clair | Aucun relayer : l'ordre est chiffré avant de quitter le client |
| Abandon après avoir vu le résultat | Personne ne voit le résultat avant qu'il soit définitif : le calcul se fait sur des chiffrés et le règlement est atomique dans la même transaction |
| Reconstruction par sondages répétés | Pas d'appariement bilatéral interactif ; lots agrégés ; un ordre de sondage coûte des frais et un dépôt réel |
| Réseau de 4 nœuds | L'exécution se fait sur Base, et le déchiffrement passe par le réseau de seuil de CoFHE |

**Types d'ordres, déclinables pour les agents** : médian simple, limite, DCA ou exécution
progressive scellés, stop-loss à seuil chiffré. Le seuil est comparé au prix de l'oracle en FHE,
donc invisible pour les chasseurs de stops.

### 5. Valeur
- **Gain pour le trader** : exécution au prix médian, soit l'économie d'une demi-fourchette, sans
  MEV ni fuite d'intention.
- **Hypothèse de revenus** : des frais de 1 à 5 points de base sur le volume croisé.
  - Capter **1 % du volume des DEX de Base** (~150 M$ par mois) rapporterait **15 000 à 75 000 $
    par mois**.
  - Capter 5 % rapporterait 75 000 à 375 000 $ par mois.
- **C'est le premier marché de cette série qui se compte en milliards** de volume, et non en
  milliers.

### 6. Limites honnêtes
- **Confiance** :
  - le déchiffrement repose sur le **réseau de seuil de CoFHE** (Fhenix) : si une majorité de ses
    participants s'entendait, les ordres seraient exposés ;
  - l'oracle de prix est une dépendance, comme chez Renegade.
- **Performance** : le FHE coûte cher. Un lot de N ordres demande environ N comparaisons et
  sélections chiffrées. Il faut mesurer le coût et la latence par lot sur Base Sepolia. La taille
  des lots sera limitée : on fera plusieurs paires, avec des lots courts.
- **Démarrage à froid** : un dark pool vit de la **coïncidence des ordres**. Leviers :
  - les **agents de trading**, dont le flux DCA est régulier ;
  - des teneurs de marché invités à fournir l'autre côté au prix médian ;
  - le routage du reste vers un AMM.
- **Fuites résiduelles** :
  - les dépôts et retraits restent visibles ;
  - le moment d'une exécution se voit, même si son montant reste chiffré.

  Parades : conserver des soldes chiffrés dans la durée, publier en différé, ajouter des ordres
  factices.
- **Réglementation** : un dark pool sans contrôle d'accès attire l'attention. Une porte d'entrée
  optionnelle est possible (groupes anonymes Coinbase Verified, voir
  [`conception-identifiants-zk.md`](conception-identifiants-zk.md)).
- **Concurrence future** : **Zama pourrait venir sur Base**. L'avantage doit se construire vite, sur
  le flux des agents de Base.

### 7. Plan

| Phase | Livrable | Critère |
|---|---|---|
| 0. Mesure | (a) Coût en gas et latence CoFHE d'un lot de 8, 16 et 32 ordres sur Base Sepolia ; (b) volume des agents DCA sur Base (Ethy, Axelrod…) et coût payé en MEV et en fourchette | Lot de 16 ordres réglé en moins de 60 s pour moins de 1 $ par ordre ; flux agent ≥ 10 M$ par mois |
| 1. Prototype | Contrat de lots FHE sur une paire (ETH/USDC), soldes FHERC20, interface et SDK pour les agents | Appariement correct et confidentiel, testé en simulation de CoFHE puis sur testnet |
| 2. Lancement | Base mainnet sur une paire, avec 2 ou 3 agents de trading partenaires en source d'ordres | Premiers M$ croisés au prix médian |

**Lien avec le projet d'origine** : S1 réutilise directement la pile du prototype v1 (CoFHE,
`encryptInputs`, `FHE.select`, ACL, soldes chiffrés). C'est le prolongement naturel de ZK402.

---

## Pistes examinées et écartées

| Piste | Douleur documentée | Pourquoi l'écarter |
|---|---|---|
| **Spam MEV sur Base** | Des bots consomment plus de 50 % du gas des rollups OP Stack en payant moins de 10 % des frais ; deux bots font plus de 80 % du spam sur Base | Problème de **conception du séquenceur**, que Base traite (Flashblocks). Ni ZK ni FHE n'y sont centraux |
| **Privacy Pools sur Base** | Vie privée conforme | 0xbow est absent de Base, mais Hinkal y est déjà ; la demande est modeste (6 M$ et 1 500 utilisateurs sur Ethereum) |
| **Preuve de réserves de cbBTC** | Critiques publiques sur l'opacité | Exige les données de Coinbase : **dépendance totale** au partenaire |
| **Actions tokenisées confidentielles** | Portefeuilles publics | L'émetteur peut geler un wrapper ; Obolos (écosystème Fhenix) vise déjà la conformité des actions tokenisées |
| **Anti-sybil pour un éventuel token Base** | Farming massif | Base décide seul de ses critères ; Human Passport et World ID sont déjà en place |

---

## Sources
- Failles de Renegade (700 000 transactions sur Base) : https://arxiv.org/abs/2609.27100
- Institutions et exécution confidentielle : https://www.21shares.com/en-eu/insights/crypto-privacy-tokens-sector-outlook-2026 ;
  https://www.dwf-labs.com/research/institutional-trading-heats-up-5-major-crypto-otc-desks-to-consider-in-2026
- Volume de Base et d'Aerodrome : https://www.altrady.com/blog/cryptocurrency/base-l2-coinbase-ecosystem-guide-2026 ;
  https://defillama.com/chain/base
- Swaps privés de Zama (Ethereum) : https://www.crowdfundinsider.com/2026/09/310353-zama-extends-confidential-morpho-vaults-adds-private-swaps-on-ethereum/
- CoFHE sur Base : https://www.kucoin.com/news/articles/fhe-in-2026-computing-on-encrypted-data-and-the-projects-making-private-blockchains-a-reality ;
  https://www.fhenix.io/ecosystem
- Spam MEV sur Base : https://arxiv.org/html/2604.00234v1 ; https://arxiv.org/abs/2606.00720
- Privacy Pools : https://thedefiant.io/news/defi/0xbow-raises-usd3-5-million-to-expand-privacy-pools
- Données des agents ACP : [`phase0/`](phase0/)
