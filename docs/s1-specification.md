# S1 — Spécification (incrément 1 : P7, P2, P1)

> Livrable 2 du programme [`prompt-s1-points-ouverts.md`](prompt-s1-points-ouverts.md).
> Menaces et faits d'infrastructure : [`s1-modele-menaces.md`](s1-modele-menaces.md).

## 0. Fonctionnalité idéale visée (référence de toutes les propriétés)

On définit la fonctionnalité idéale **F_DP** (dark pool par lots) au sens du modèle de
composabilité universelle (UC) :

- **Soumission** : un trader T envoie `(sens, q)` à F_DP pendant la fenêtre du lot k. F_DP
  enregistre l'ordre et **révèle à l'adversaire uniquement la fuite autorisée** ℓ_sub.
- **Règlement** : après l'échéance t_k, F_DP obtient le prix p_k par la **règle publique**
  R(oracles, t_k), calcule les exécutions par la règle d'allocation A (FIFO en v2) sur les ordres
  **couverts** par les soldes, met à jour les soldes, et révèle ℓ_set.
- **Lecture** : T n'apprend que **sa** propre exécution et **ses** soldes.

**Fuites autorisées** :
- en **v2** (incrément 1) : ℓ_sub = (identité de T, instant, k) ; ℓ_set = (k, p_k, nombre
  d'ordres) ;
- **cible P1** (incrément 2) : ℓ_sub = (k, instant) seulement ; identité remplacée par un
  pseudonyme non associable ; nombre d'ordres fixé.

Un protocole Π **réalise F_DP** si, pour tout adversaire A contre Π, il existe un simulateur S contre
F_DP tel qu'aucun environnement ne distingue les deux exécutions, **sous les hypothèses H1 à H4** :
- **H1** : sécurité IND-CPA du schéma TFHE de CoFHE (paramètres ≥ 128 bits) ;
- **H2** : Teecryptor ne divulgue pas la clé (TEE non compromis et partenaires non colludants) ;
- **H3** : au moins un des deux oracles est honnête **ou** les deux sont dans l'écart toléré du
  vrai prix ;
- **H4** : la chaîne Base est sûre (vivacité garantie à 12 h par l'inclusion forcée L1).

> H2 est l'hypothèse la plus forte, et elle **n'est pas de notre ressort** (voir le modèle de
> menaces, § 1). Toute affirmation de confidentialité ci-dessous est **conditionnelle à H2**.

---

## P7 — Suppression du pouvoir de l'opérateur

### Énoncé
En v1, `operator` choisit le prix et le moment du règlement. Il peut régler à un prix favorable
(T), retarder ou empêcher un lot (D), et c'est un rôle privilégié immuable (E).

### Adversaire
Actif et adaptatif. Il contrôle n'importe quel compte, y compris celui qui déclenche le règlement,
et peut choisir le moment de ses transactions à l'intérieur d'un bloc.

### Propriétés visées (définitions)
- **P7.1 Neutralité du prix.** Pour tout lot k, le prix p_k est une **fonction déterministe publique**
  de l'état des oracles au moment du règlement, bornée par les contrôles de R. Aucun appelant ne
  peut fournir ou influencer p_k autrement qu'en choisissant le moment du déclenchement, voir P7.2.
- **P7.2 Moment borné.** Le règlement de k n'est possible qu'à partir de t_k. La marge de choix du
  déclencheur se limite à l'intervalle [t_k, t_k + Δ], et son influence sur p_k est bornée par la
  variation du prix pendant Δ et par l'écart maximal toléré entre oracles.
- **P7.3 Pas de privilège.** Le contrat n'a **aucun** rôle, propriétaire, fonction de pause ou
  mécanisme de mise à jour.
- **P7.4 Vivacité sans permission.** Si les oracles sont valides, **tout** compte peut faire
  progresser le règlement jusqu'au bout.

### Alternatives comparées

| Option | Prix | Moment | Confiance | Retenue |
|---|---|---|---|---|
| a. Opérateur (v1) | Libre | Libre | Unilatérale | ❌ |
| b. Opérateur + multisig / timelock | Libre | Libre | k-sur-n humains | ❌ Déplace le problème sans le supprimer |
| c. **Échéance on-chain + règle d'oracle + déclenchement sans permission** | Règle publique | Borné par l'échéance | Oracles (2 sources) + chaîne | ✅ |
| d. Prix d'enchère interne (uniform price auction) | Endogène | Borné | Aucune source externe | Plus tard : exige des prix limites chiffrés et de la liquidité (P5) |

### Construction (implémentée : `SealedBatchPoolV2.sol`)
- Lots à durée fixe `BATCH_DURATION`. Le lot k accepte des ordres tant que `block.timestamp < t_k`.
- `startSettlement(pythUpdate)` : **sans permission**, possible si `block.timestamp ≥ t_k`, que le
  lot précédent est réglé et que la règle d'oracle est valide (P2). Sinon, le lot est **reporté**
  (événement `BatchPostponed`) : il n'est **jamais** réglé à un prix invalide.
- `settleStep(n)` : sans permission, idempotent par étapes.
- **Aucun** `owner`, `operator`, `pause` ni proxy.

### Argument
Le prix est calculé dans `startSettlement` par une fonction pure des lectures d'oracles (P7.1).
La seule variable laissée au déclencheur est le **bloc** d'appel, qui satisfait `≥ t_k` (P7.2).
L'absence de rôle est vérifiable dans le bytecode : aucune variable d'autorisation, aucune
fonction restreinte (P7.3). Tout appelant peut enchaîner `startSettlement` puis `settleStep`
(P7.4, testé).

### Risque résiduel
- **Choix du bloc de déclenchement dans [t_k, t_k + Δ]** : un déclencheur peut attendre une mise à
  jour d'oracle favorable. C'est borné par la volatilité sur Δ. En pratique Δ est court, car tout
  le monde peut déclencher et un premier arrivé honnête suffit. Parade prévue : un **prix figé à
  t_k** (lecture de l'historique des rounds Chainlink `getRoundData` au premier round ≥ t_k).
  **Incrément 2.**
- **Séquenceur de Base** : peut retarder le règlement ≤ 12 h (H4). Inhérent à la plateforme.

---

## P2 — Confiance : oracle, Teecryptor, vérifieur

### P2.a Oracle sans opérateur

**Règle R** (publique, dans le contrat) :
1. Chainlink : `latestRoundData()`. On exige `answer > 0`, `updatedAt ≥ now − MAX_STALENESS` et
   `answeredInRound ≥ roundId`.
2. Pyth : `getPriceNoOlderThan(id, MAX_STALENESS)`. On exige `price > 0` et
   `conf ≤ price × MAX_CONF_BPS / 10⁴`. La mise à jour Pyth peut être **poussée par le
   déclencheur** (`updatePriceFeeds`, frais payés par lui). Elle ne lui donne aucun pouvoir : les
   données sont signées par Pyth.
3. Normalisation des deux prix à 8 décimales, puis `|p_CL − p_Pyth| ≤ min(p_CL, p_Pyth) × MAX_DEV_BPS / 10⁴`.
4. `p_k = (p_CL + p_Pyth) / 2`, converti dans les unités du pool.
5. Si une condition échoue → le lot est **reporté**.

**Coût d'une manipulation** : pour déplacer p_k de x %, il faut corrompre **les deux** réseaux
d'oracles de façon cohérente (x ≤ MAX_DEV_BPS s'il n'en corrompt qu'un, et alors le prix ne se
déplace que de x/2). Pour Chainlink et Pyth, cela veut dire corrompre des ensembles de
fournisseurs indépendants. C'est **strictement plus dur** que l'opérateur unique de la v1.

**Alternatives écartées** :
- une seule source (point unique) ;
- un TWAP d'AMM on-chain : manipulable sur Base par des flash loans à coût modéré, et utilisable
  seulement comme troisième source avec une fenêtre longue.

### P2.b Teecryptor (déchiffrement) — ce qu'on peut et ne peut pas faire

- **Impossible pour notre protocole** : empêcher un Teecryptor compromis de **lire** les chiffrés.
  Toute la confidentialité CoFHE en dépend (H2). Aucune construction au-dessus de CoFHE ne l'évite,
  car le déchiffreur détient la clé complète. **On le déclare.**
- **Possible et exigé : séparer la sûreté des fonds de H2.**
  - **P2.2 (sûreté)** : même si Teecryptor est compromis, **aucun fonds ne peut sortir au-delà de
    ce que la règle publique autorise**.
  - v2 ne contient **aucun** chemin où un clair signé par Teecryptor déclenche un transfert.
  - Pour les retraits réels (P4), deux mécanismes, spécifiés dès maintenant :
    1. **Retrait en deux temps** : demande, puis exécution après `WITHDRAW_DELAY`. Le clair
       déchiffré est publié on-chain pendant le délai.
    2. **Disjoncteur de débit sans permission** : si le total des sorties réclamées sur une fenêtre
       W dépasse `MAX_OUTFLOW_BPS` des réserves, les retraits suivants passent en file d'attente.
       La règle est publique et automatique : **pas de pause humaine**, pas de backdoor.
  - **Borne** : un Teecryptor malveillant qui forge des clairs peut au pire extraire
    `MAX_OUTFLOW_BPS` des réserves par fenêtre W avant d'être visible, contre 100 % sans ces
    mécanismes.
  - C'est une **borne, pas une élimination**. L'élimination exige des **preuves de déchiffrement
    correct** vérifiables on-chain, que le réseau de seuil prévu par Fhenix devra fournir. **Critère
    d'adoption** : migrer dès qu'elles sont disponibles.
- **Vérifieur d'entrées compromis** : il pourrait admettre un chiffré mal formé ou déjà utilisé.
  - L'ACL de CoFHE empêche d'utiliser le handle d'autrui.
  - Un chiffré « frais » mal formé ne peut qu'affecter l'ordre de son propre auteur, puisque la
    couverture est vérifiée contre **son** solde.
  - Impact : borné à l'attaquant lui-même.

### P2.c Vivacité
Si Teecryptor ou le coprocesseur ne répondent pas, les lots se règlent quand même on-chain, car le
règlement n'exige aucun déchiffrement. Seule la **lecture** des exécutions est retardée. Pour les
retraits (P4) : le délai et la file d'attente, pas de perte.

---

## P1 — Métadonnées : conception (implémentation à l'incrément 2)

### Définition visée
**Jeu IND-META.**
1. L'adversaire A (observateur de toute la chaîne, contrôlant k traders) choisit deux
   configurations de lot (O⁰, O¹), identiques en nombre d'ordres honnêtes et en fuite ℓ, mais
   différentes par l'**attribution des ordres aux identités** honnêtes.
2. Le challenger exécute le lot avec O^b.
3. A gagne s'il devine b.

**Avantage exigé** : ≤ 1/|S| + négligeable, où S est l'**ensemble d'anonymat**. S = ensemble des
dépositaires actifs du pool blindé, taille publiée et mesurée.

### Construction retenue (après comparaison)

| Option | Non-association identité ↔ ordre | Confiance ajoutée | Coût | Retenue |
|---|---|---|---|---|
| a. Relayer qui soumet pour le compte des traders | Oui vis-à-vis du public | **Le relayer voit l'identité** → déplacement | Faible | ❌ (c'est la faille de Renegade) |
| b. ERC-4337 + paymaster | Non (le compte expéditeur reste visible) | Paymaster | Faible | ❌ |
| c. **Pool blindé de notes** (arbre de Merkle d'engagements, nullificateurs, preuve ZK Noir/UltraHonk) + comptes **pseudonymes éphémères** par lot, financés depuis le pool | **Oui** : le lien dépôt ↔ ordre est caché dans S | Aucune hors cryptographie (ZK + FHE) ; le gas du pseudonyme est payé depuis la note, avec paymaster **aveugle** vérifiant une preuve | Moyen | ✅ |
| d. Mixage FHE des identités (`eaddress`) | Partiel | Teecryptor (H2) | Élevé | ❌ (ajoute une dépendance à H2 pour l'anonymat) |

- **Dépôts et retraits (L5, L11)** : ils passent par le pool blindé. Un retrait prouve la
  possession d'une note sans révéler laquelle. Le délai aléatoire et le montant libre sont à la
  main de l'utilisateur ; l'avantage d'association temporelle est mesuré en simulation.
- **Nombre d'ordres (L4)** : lots de taille fixe N. Les places vides sont remplies d'**ordres nuls**
  chiffrés, que le circuit constant rend indistinguables. Qui les paie ? Le déclencheur, remboursé
  par les frais du lot. Coût : ≈ 1,2 M de gas par ordre nul (mesuré), soit ≈ 0,02 $.
- **Moment de soumission (L3)** : **inhérent**, on ne peut pas le cacher sur une chaîne publique.
  Borne : dans un lot, l'ordre de soumission n'affecte que le rang FIFO. En passant à une
  allocation **au prorata** (P3), le moment n'a plus d'effet économique, et l'information se
  réduit à « un pseudonyme a soumis à l'instant t ».
- **Sondage** : chaque ordre exige une note avec un solde minimal et des frais. L'information
  apprise par sondage est bornée par la seule sortie observable par l'attaquant, sa propre
  exécution, soit au plus log₂(q_max) bits par lot et par note engagée. Coût : frais × nombre de
  sondes.

### Risque résiduel annoncé
- Taille de S au démarrage (petit pool = petit ensemble d'anonymat) ;
- corrélation temporelle hors chaîne ;
- H2.
