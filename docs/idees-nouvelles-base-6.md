# Base — série 6 : idées guidées par la phase 0

> **Ce que la phase 0 a appris** ([`phase0-resultats.md`](phase0-resultats.md)) : sur Base, la
> demande réelle des agents porte sur les actions on-chain et sur l'analyse. Les preuves de
> « livraison » ne couvrent qu'une petite part du marché. Surtout, **les métriques de confiance sont
> gonflées** : des agents vendent des jobs réciproques pour augmenter leurs compteurs.
>
> Cette série part donc de la **confiance entre agents** : réputation et palmarès. On garde les
> mêmes critères : niche en croissance sur Base, douleur documentée par des sources ou par nos
> propres mesures, non résolue, ZK au cœur, peu de dépendance à des partenaires.

---

## R1 — « Avis prouvés » : une réputation d'agents résistante aux sybils, sans doxxing

### 1. La douleur, documentée et chiffrée
- **Étude empirique d'ERC-8004** (*Can Trustless Agents Be Trusted?*, 2026) :
  - sur **Base**, **90,6 %** des auteurs d'avis présentent des caractéristiques de sybil ;
  - après leur retrait, **86,8 %** des agents de Base perdent **tous** leurs avis valides ;
  - **92,6 %** des avis qui portent une « preuve de paiement » auto-déclarée sont aussi sybils sur
    Base. Le champ `proofOfPayment` n'est qu'une déclaration non vérifiée ;
  - verdict des auteurs : le registre de réputation « **ne peut pas fonctionner comme signal de
    confiance** ».
- **Nos propres données ACP** (phase 0) :
  - **MutualClaw** vend `mutual_buy` à 0,10 $ : « Nous rachetons votre offre à 0,01 $. Chaque agent
    gagne **+1 job, +1 acheteur unique** ». ShieldAI vend des « mutual_boost » de 0,01 $ à 1 $.
    Growth Driven Protocol vend `boost_agent` à 0,01 $ ;
  - 97 agents du top 500 ont **10 acheteurs uniques ou moins**.
- **Le débat est ouvert en ce moment** :
  - le ticket n° 99 du dépôt ERC-8004 (ouvert le 14 septembre 2026, sans réponse des mainteneurs)
    propose d'adosser les avis à des preuves de paiement x402 ;
  - des projets de hackathon (Assay, ETHOnline 2026) détectent le « lavage de réputation » par
    heuristiques. Exemple cité : sur l'agent le plus noté de Base, 95,5 % des 1 000 avis viennent
    d'**un seul wallet**, tous en moins de 24 h.

### 2. Pourquoi l'existant ne suffit pas
- **Une preuve de paiement seule ne suffit pas** : MutualClaw prouve que payer 0,01 $ entre deux
  wallets ne coûte rien. Un réseau sybil fabrique des paiements aussi facilement que des avis.
- **Les heuristiques** (concentration, horodatage) se contournent en étalant les avis sur plus de
  wallets et plus de temps.
- **Ce qui manque** : compter des **humains distincts** qui ont **réellement payé**, sans les exposer.
  Aujourd'hui, pour prouver « je suis un humain vérifié et j'ai payé cet agent », il faudrait publier
  le lien entre son wallet d'achat et son attestation Coinbase. Personne ne le fera.

### 3. L'idée
Un **contrat d'avis vérifiés** qui accepte un avis seulement avec une **preuve ZK** établissant que
son auteur :
1. est un **humain vérifié** : il appartient à un groupe Semaphore d'attestations *Coinbase Verified
   Account* (réutilise [`conception-identifiants-zk.md`](conception-identifiants-zk.md)) ;
2. contrôle un wallet qui a **réellement payé cet agent** : un job ACP terminé, un paiement x402 ou
   un transfert USDC, pour un montant d'au moins X ;
3. n'a **pas déjà donné d'avis** sur cet agent pendant cette période (nullificateur).

Le tout **sans révéler** ni l'identité, ni le wallet d'achat, ni les liens entre les wallets d'une
même personne.

Le contrat publie ensuite l'avis dans le **registre de réputation ERC-8004**. L'expéditeur est
alors le contrat : les consommateurs n'ont qu'à filtrer les avis venant de cette adresse. Cette
intégration ne demande aucune autorisation.

### 4. Mécanisme
1. **Registre d'activation des wallets** (repris de
   [`conception-preuve-detention.md`](conception-preuve-detention.md)) :
   - chaque wallet d'achat enregistre une fois `C_w = H(s_w, id)`, où `id` est l'engagement
     d'identité Semaphore de son propriétaire ;
   - le wallet signe la transaction lui-même, ce qui empêche d'enregistrer le wallet d'un autre ;
   - un agent acheteur est activé par son propriétaire humain.
2. **Arbre des paiements** : un indexeur construit l'arbre de Merkle des feuilles
   `(payeur, agent, montant, jobId)` à partir des événements publics : ACP Core
   `0x238E…32E0`, transferts USDC vers les adresses de paiement déclarées.
   - Tout le monde peut recalculer la racine. Une racine fausse se conteste pendant une période de
     contestation.
   - Une version 2 utiliserait des preuves de stockage à la place de l'indexeur.
3. **Preuve (Noir/UltraHonk, dans le navigateur ou chez l'agent)**. Le circuit montre qu'il existe :
   - une feuille `(wallet, C_w)` dans l'arbre d'activation ;
   - une feuille `(wallet, agent, montant ≥ X, jobId)` dans l'arbre des paiements ;
   - la relation `C_w = H(s_w, id)`, avec `id` dans le groupe Coinbase vérifié.

   Il produit en sortie :
   - `agent` et la tranche de montant ;
   - la note et le hash du commentaire ;
   - le nullificateur humain `H(s_id, agent, période)` : un avis par humain, par agent et par période ;
   - le nullificateur de job `H(s_w, jobId)` : un paiement ne sert qu'une fois.
4. **Affichage** : « **N humains vérifiés distincts**, montant payé prouvé ≥ Y $, note moyenne Z ».
   Ce chiffre ne se gonfle pas avec des wallets supplémentaires.

### 5. Ce que chaque attaque coûte désormais

| Attaque | Aujourd'hui | Avec R1 |
|---|---|---|
| 1 000 avis depuis des wallets générés | Gratuit (90,6 % de sybils sur Base) | Impossible : chaque avis exige un humain vérifié distinct |
| Jobs réciproques à 0,01 $ (MutualClaw) | 0,10 $ pour « +1 acheteur unique » | Ne compte pas sous le montant minimum X ; un humain ne compte qu'une fois par agent |
| Le propriétaire note son propre agent | Illimité | Un seul avis. Coinbase autorise au plus 3 adresses par compte, soit ≤ 3 identités, à confirmer |
| Faux avis achetés à de vrais humains | Bon marché | Coûte un compte Coinbase vérifié **et** un vrai paiement par avis. Reste possible : c'est la limite honnête |

### 6. Pourquoi le ZK est central
Sans ZK, il faudrait choisir entre deux mauvaises options :
- **publier les liens** « ce wallet appartient à cet humain vérifié et a acheté à cet agent », ce qui
  revient à doxxer les acheteurs et leurs stratégies ;
- **se fier à un tiers** qui connaît ces liens, ce qui recrée un point central.

Le nullificateur permet de **dédoublonner une personne à travers tous ses wallets** sans révéler
lesquels lui appartiennent. C'est exactement ce que ni une preuve de paiement ni une heuristique ne
savent faire.

### 7. Limites honnêtes
- **Couverture** : seuls les acheteurs dont le propriétaire a une attestation Coinbase comptent.
  Beaucoup d'acheteurs sont des agents, mais chaque agent a un propriétaire, et le compteur suit les
  **propriétaires distincts**.
  - **À mesurer** : la part des wallets acheteurs ACP ou x402 dont le propriétaire est vérifié.
  - Des groupes supplémentaires sont possibles plus tard (World ID, passeports ZK).
- **Petit ensemble d'anonymat** : un agent qui n'a que 5 acheteurs rend l'auteur d'un avis
  devinable. Parades :
  - publication différée et groupée par période ;
  - avis masqués tant qu'il n'y a pas au moins k acheteurs distincts.
- **Avertissement de Coinbase** : ses attestations ne valent pas KYC légal. Ici, elles servent
  d'anti-sybil, ce qui est leur usage raisonnable.
- **Indexeur des paiements** : c'est un point de confiance tant que les racines ne sont pas prouvées
  on-chain. Il est atténué par la contestation, car les données sont publiques.
- **Adoption** : les places de marché doivent afficher ce signal. Mais il se lit sans autorisation
  dans ERC-8004, et un agent honnête a intérêt à pousser ses acheteurs à le fournir.

### 8. Concurrence

| Acteur | Approche | Manque |
|---|---|---|
| ERC-8004 natif | Avis libres, `proofOfPayment` déclaratif | Aucun contrôle (92,6 % de sybils) |
| Ticket n° 99 (Predge) | Preuve de paiement x402 signée | Ni unicité humaine, ni confidentialité |
| Assay, EvalRank, Recall Rank | Scores par heuristiques ou par compétitions | Contournables ; pas de preuve |
| Notes ACP de Virtuals | Note des acheteurs de jobs terminés | Gonflable par jobs réciproques (MutualClaw) |

Je n'ai trouvé aucune réputation d'agents qui combine **unicité humaine**, **paiement réel** et
**anonymat**.

### 9. Plan

| Phase | Livrable | Critère |
|---|---|---|
| 0. Mesure | Parmi les acheteurs ACP (événements d'ACP Core) et les payeurs x402 sur Base, part des wallets liés à une attestation *Coinbase Verified Account*, directement ou via le wallet qui les finance | ≥ 10 % des acheteurs ou ≥ 30 % de la valeur payée |
| 1. Prototype | Contrat d'avis + circuit Noir + indexeur ACP sur Base Sepolia, publication dans ERC-8004 | Un avis valide accepté ; un double avis et un avis sans paiement refusés |
| 2. Lancement | Déploiement sur Base mainnet ; badge « humains vérifiés » ; API de score pour les routeurs d'agents | Premiers agents qui affichent le badge |

---

## R2 — « Palmarès scellé » : un historique de signaux prouvé, sans les divulguer

### 1. La douleur
- Nos données ACP : les agents qui vendent des **signaux, prédictions ou analyses de trading**
  représentent environ **8 % des revenus du top 500** (~314 k$), hors Ethy. Exemples : WhaleIntel,
  Loky, Tipper, The TA Guru, Remi, Otto Alpha, Cucumber Trade, Gaffer, Argonaut.
- **Aucun ne peut prouver son palmarès.** C'est le premier signal d'alarme dans les guides sur les
  arnaques aux signaux de trading : historiques fabriqués, résultats triés sur le volet, aucun
  historique audité.
- **Le dilemme** :
  - publier ses signaux pour prouver son palmarès détruit leur valeur commerciale ;
  - ne pas les publier rend le palmarès invérifiable.

### 2. L'idée
1. **Avant** de livrer un signal, l'agent l'**engage on-chain** : `H(signal, sel)` est ajouté à un
   accumulateur séquentiel sur Base et horodaté par le bloc.
2. **L'acheteur** reçoit le signal **et** son ouverture. Il vérifie que ce qu'il a acheté figure bien
   dans l'accumulateur.
3. **Chaque période**, l'agent publie une **preuve ZK** des statistiques calculées sur **tous** les
   engagements de la période : taux de réussite, rendement moyen, perte maximale.
   - Les prix de référence sont ceux des oracles on-chain (Chainlink et Pyth sont déjà sur Base) à
     l'horizon de chaque signal.
   - L'accumulateur impose l'**exhaustivité** : impossible d'omettre les mauvais signaux.
4. Les signaux eux-mêmes **restent secrets**.

### 3. Concurrence et limites
- **Concurrence** :
  - Recall organise des compétitions d'agents, mais les trades y sont publics et limités au concours ;
  - Foresight Arena est un banc d'essai de prévisions publiques ;
  - « Proof of Alpha » de Mina (2023) est un prototype, sur une autre chaîne ;
  - le papier de Chinco sur la preuve de compétence en sélection d'actions reste académique.
- **Limites** :
  - seuls les signaux mesurables par un prix on-chain sont couverts ;
  - **sélection adverse** : les mauvais agents n'adoptent pas le système, mais l'absence de sceau
    devient alors elle-même un signal ;
  - le marché est plus petit que celui de R1 (~8 % des revenus ACP).
- **Synergie** : R1 et R2 utilisent la même pile (Noir, arbres de Merkle, ERC-8004). R2 peut
  publier ses résultats dans le **registre de validation** d'ERC-8004.

---

## Pistes examinées et écartées

| Piste | Douleur | Pourquoi l'écarter |
|---|---|---|
| **Wallets d'agents vidés par injection de prompt** (Grok × Bankr sur Base, mai 2026 : 150 000 à 200 000 $) | Réelle et documentée | C'est un problème de **politique de dépenses** (plafonds, listes de destinataires ; Bankr impose déjà 500 $/jour par défaut). Le ZK n'y est pas central |
| **Vaults Morpho confidentiels** | Les institutions ne veulent pas exposer leurs positions | **Zama × Morpho × Steakhouse** ont ouvert 16 vaults confidentiels le 15 septembre 2026 (sur Ethereum). Terrain occupé par un acteur bien financé |
| **Opacité des curateurs** (effondrement de Stream Finance, 93 M$ de pertes, novembre 2025) | Réelle | Les allocations des vaults sont déjà publiques on-chain. L'opacité était **hors chaîne**, chez le gérant, et c'est un problème de **gouvernance et de preuve de réserves** plus que de ZK sur Base |
| **Crédit non collatéralisé via zkTLS** | Surcollatéralisation | **3Jane** le fait déjà sur Base (zkTLS, financement mené par Paradigm) |

---

## Synthèse

| | R1 Avis prouvés | R2 Palmarès scellé |
|---|---|---|
| Douleur | 90,6 % de sybils parmi les auteurs d'avis ERC-8004 sur Base ; boosts vendus à 0,10 $ | Palmarès invérifiables ; ~8 % des revenus ACP |
| Rôle du ZK | **Central** (unicité humaine entre wallets, anonymat, paiement réel) | **Central** (statistiques prouvées, signaux secrets) |
| Dépendance | Attestations Coinbase (publiques, sans accord), Semaphore (déployé) | Oracles de prix on-chain |
| Concurrence | Heuristiques et preuves de paiement sans unicité | Compétitions publiques |
| Priorité | ✅ **N°1** | ⚠️ N°2, marché plus petit |

## Sources
- Étude ERC-8004 : https://arxiv.org/abs/2606.26028
- Ticket ERC-8004 n° 99 : https://github.com/erc-8004/erc-8004-contracts/issues/99
- Assay : https://github.com/0xvikram/assay
- ERC-8004 : https://eips.ethereum.org/EIPS/eip-8004
- Données ACP : API publique `acpx.virtuals.io/api/agents` (voir [`phase0/`](phase0/))
- Arnaques aux signaux : https://ninjatrader.com/futures/blogs/ai-trading-scams/ ;
  https://www.investing.com/analysis/the-dark-side-of-ai-investing-platforms-200674832
- Palmarès : https://arxiv.org/pdf/2605.00420 (Foresight Arena) ; https://alexchinco.com/zero-knowledge-proofs.pdf ;
  https://minaprotocol.com/blog/proof-of-alpha ; https://messari.io/report/recall-open-markets-for-ai
- Grok × Bankr : https://www.giskard.ai/knowledge/how-grok-got-prompt-injected-an-x-user-drained-150-000-from-an-ai-wallet ;
  https://ambcrypto.com/ai-linked-wallet-drained-via-prompt-injection-in-bankr-exploit/ ; https://bankr.bot/agents
- Vaults confidentiels : https://www.crowdfundinsider.com/2026/09/310353-zama-extends-confidential-morpho-vaults-adds-private-swaps-on-ethereum/
- Stream Finance : https://thedefiant.io/news/defi/how-stream-finance-s-collapse-exposed-defi-s-looping-yield-bubble
- 3Jane : https://www.3jane.xyz/pdf/whitepaper.pdf
