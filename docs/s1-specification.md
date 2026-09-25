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
- ~~Choix du bloc de déclenchement~~ **Traité à l'incrément 2** : prix évalué à t_k (voir P2.a).
  Il reste le résidu R5′, borné à maxDeviationBps / 2.
- (historique) **Choix du bloc de déclenchement dans [t_k, t_k + Δ]** : un déclencheur peut attendre une mise à
  jour d'oracle favorable. C'est borné par la volatilité sur Δ. En pratique Δ est court, car tout
  le monde peut déclencher et un premier arrivé honnête suffit. Parade prévue : un **prix figé à
  t_k** (lecture de l'historique des rounds Chainlink `getRoundData` au premier round ≥ t_k).
  **Incrément 2.**
- **Séquenceur de Base** : peut retarder le règlement ≤ 12 h (H4). Inhérent à la plateforme.

---

## P2 — Confiance : oracle, Teecryptor, vérifieur

### P2.a Oracle sans opérateur — règle « 2 sur 3 à l'instant de clôture » (incrément 2)

**Règle R(t_k)** : publique, dans le contrat. Elle est évaluée à l'instant de **clôture** t_k, et
non à l'instant du déclenchement.

| Source | Valeur « à t_k » | Validité |
|---|---|---|
| **Chainlink** (avec historique) | Round `h` fourni par le déclencheur, **vérifié** comme le dernier round tel que `updatedAt ≤ t_k` : `updatedAt(h) ≤ t_k` et `updatedAt(h+1) > t_k` s'il existe. Un mauvais indice fait **revert** : aucun choix possible. | `answer > 0`, `answeredInRound ≥ h`, âge à t_k ≤ `chainlinkMaxAge` |
| **API3** (Api3ReaderProxyV1, sans historique) | Valeur courante **seulement si** `updatedAt ≤ t_k`. Sinon la valeur à t_k est inconnue et la source est invalide. | `answer > 0`, âge à t_k ≤ `api3MaxAge` (heartbeat 24 h + marge ; entre-temps, mises à jour sur déviation) |
| **Pyth** | (a) **Première** publication signée dans [t_k, t_k + `pythWindow`] (`parsePriceFeedUpdatesUnique` : unicité garantie par `prevPublishTime < t_k`) ; ou (b) valeur stockée si `publishTime ≤ t_k` | Prix > 0, confiance ≤ `maxConfBps`, âge ≤ `pythMaxAge` |

**Agrégation** :
- au moins **2 sources valides** ;
- prix = **médiane** (moyenne s'il n'y en a que 2) ;
- au moins deux sources, dont la médiane, à ≤ `maxDeviationBps` l'une de l'autre ;
- prix du pool ∈ ]0, `MAX_POOL_PRICE`].

Sinon, le lot est **reporté**.

**Ce que le déclencheur contrôle encore (résidu R5′)** : seulement la **validité** d'API3 et de
Pyth-stocké. Par exemple, s'il attend qu'API3 se mette à jour après t_k, API3 devient invalide.
L'effet est borné : le prix passe de la médiane à 3 sources à la moyenne des 2 autres, toutes deux
concordantes à `maxDeviationBps` près. **Borne : ≤ maxDeviationBps / 2 du prix** (0,5 % avec
1 %). Avant l'incrément 2, la borne était la variation totale du marché entre t_k et le
déclenchement.

**Coût d'une manipulation** : corrompre **2 réseaux d'oracles indépendants sur 3** de façon
cohérente. Une seule source corrompue est écartée par la médiane (testé).

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

## P1 — Métadonnées : conception, puis implémentation (incrément 3)

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

---

## Intégrité arithmétique (incrément 2) — découverte par vérification formelle

**Constat** : les opérations `euint64` de CoFHE (`add`, `sub`, `mul`) **rebouclent modulo 2⁶⁴**.
Dans le circuit v1 et le premier circuit v2, le contrôle de couverture calcule `need = q × prix`.
Un attaquant choisit q ≈ 2⁶⁴ / prix, de sorte que `need` reboucle vers une petite valeur et que le
contrôle passe. Il est alors exécuté contre de vrais vendeurs. Si le coût réel `fill × prix`
dépasse son solde QUOTE, `quote − coût` reboucle vers ≈ 2⁶⁴ : **création monétaire**, puis vol
lors d'un retrait.
- **Démontré** sur la v1 (test `VULNÉRABILITÉ CONNUE…`) : solde QUOTE de l'attaquant ≈ 1,8 × 10¹⁹.
- Contre-exemple **recherché symboliquement** avec Halmos sur le modèle opération par opération
  (`packages/formal`).

**Correctif (v2)** :
- `MAX_QTY = 10¹²` (contrôle chiffré `FHE.lte(q, MAX_QTY)` intégré à la couverture) ;
- `MAX_POOL_PRICE = 10⁶` (contrôle public dans la règle de prix).

Comme MAX_QTY × MAX_POOL_PRICE = 10¹⁸ < 2⁶⁴, aucune multiplication ne reboucle, et la couverture
est exacte. L'addition des soldes reste bornée par l'offre totale (< 2⁶²), qui sera garantie par
les réserves réelles (P4).

**Propriétés vérifiées formellement** (Halmos, pour toutes les entrées, 3 ordres de 3 traders) :
- conservation de BASE et de QUOTE ;
- absence de solde rebouclé ;
- exécution ≤ quantité demandée ;
- volume acheté = volume vendu ;
- l'acheteur paie exactement `fill × prix`.

Résultats : voir `docs/s1-risques-residuels.md`.

---

## P1 — Implémentation (incrément 3)

**Construction implémentée** (option c, sous une forme adaptée à une contrainte de CoFHE découverte
en lisant le TaskManager) : la signature du vérifieur d'entrées lie chaque chiffré au couple
**(expéditeur, contrat)**. Un relayeur ne peut donc pas soumettre un ordre chiffré à la place du
trader. C'est le **pseudonyme lui-même** qui doit envoyer ses ordres, d'où l'allocation de gas
versée par le contrat.

| Étape | Qui | Ce qui est public | Ce qui est caché |
|---|---|---|---|
| 1. **Dépôt** (`ShieldedEntry.deposit`) | Adresse A | A, la classe (palier fixe), l'engagement C = H(nk, secret) | nk, secret |
| 2. **Réclamation** (`claim`) | N'importe quel relayeur R | La classe, le nullificateur, le pseudonyme P, R, les frais | **Quelle note** (donc A) : preuve ZK d'appartenance à l'arbre |
| 3. **Financement de P** | Le contrat | P reçoit `stipend − fee` en ETH **du contrat** | Lien A ↔ P |
| 4. **Crédit** (`pool.credit`) | Le contrat d'entrée uniquement | P a un compte, montant de la classe | Solde ensuite chiffré (FHE) |
| 5. **Ordres** | P | P a soumis un ordre dans le lot k | Sens, quantité (FHE) |

**Propriété obtenue (IND-META restreinte)** : pour un observateur de toute la chaîne, P est
associable à **n'importe quelle** note non dépensée de la même classe déposée avant la réclamation.
L'avantage est de ≤ 1/|S| (S = notes éligibles), sous H1–H4 et sous la sécurité de UltraHonk en mode
ZK (`bb -t evm`).

**Anti-détournement** : `recipient`, `relayer` et `fee` sont des entrées publiques de la preuve. Une
transaction interceptée ne peut pas être rejouée vers un autre destinataire (testé : 3 variantes
refusées).

**Registre de confiance (P1)** :

| Acteur | Voit | Peut | Changement |
|---|---|---|---|
| Relayeur | Les entrées publiques de la réclamation, et l'**adresse IP** de l'utilisateur s'il la reçoit directement | Refuser de relayer (censure) ; ne peut ni détourner ni lier | Nouveau, **sans pouvoir** : tout le monde peut relayer, P peut aussi se faire relayer par n'importe qui |
| Observateur | Dépôts (A, classe), réclamations (P, classe) | Corréler par le **moment** (dépôt puis réclamation immédiate) | Borné par l'ensemble d'anonymat et le délai choisi par l'utilisateur |

**Limites assumées (non résolues ici)** :
- **P est un pseudonyme persistant** : ses ordres sont associables entre eux d'un lot à l'autre. Pour
  en changer, il faut retirer puis redéposer : **P4 (retraits) n'est pas encore implémenté**. Les
  fonds déposés ne peuvent donc pas encore ressortir : ce système est réservé au testnet.
- **Montants par paliers** : un pseudonyme qui réclame plusieurs notes révèle la somme de ses
  paliers (entrées publiques). Ensuite, ses soldes et ses exécutions sont chiffrés.
- **Nombre d'ordres par lot (L4)** : toujours visible. Le remplissage par ordres factices n'est pas
  implémenté : il exigerait des pseudonymes de remplissage dont le financeur connaîtrait les
  factices. Son intérêt est limité tant que les participants sont déjà pseudonymes.
- **Moment (L3)** : inhérent.
- **Réseau** : l'IP n'est pas protégée par le protocole (utiliser Tor ou un relais réseau).

---

## P4 — Actifs réels et sorties sécurisées (incrément 4)

### Mécanisme

| Étape | Fonction | Ce qui se passe | Confiance |
|---|---|---|---|
| 1. Conversion | `pool.requestNoteOut(cls, C)` (par le pseudonyme P) | Circuit constant : `ok = BASE ≥ s + d` (palier BASE) ou `QUOTE ≥ d ∧ BASE ≥ s` (palier QUOTE) ; débits `select(ok, …, 0)` ; `ok` rendu déchiffrable publiquement. L'**allocation de gas** de la future note (s unités BASE) est prélevée sur le solde chiffré : **aucun ETH extérieur**, donc aucun lien avec une autre adresse | Interdit pendant un règlement (protection de la couverture) |
| 2. Finalisation | `pool.finalizeNoteOut(id, ok, signature)` (n'importe qui) | Vérifie la signature du déchiffreur (`verifyDecryptResultSafe`), puis insère la note (`entry.insertFromPool`) si ok | **Teecryptor (H2)** |
| 3a. Rotation | `entry.claim` | La note est réclamée vers un NOUVEAU pseudonyme | ZK |
| 3b. Sortie | `entry.exit` | Même preuve ZK : l'actif réel part vers **n'importe quelle** adresse, sans révéler quelle note | ZK |
| 4. Disjoncteur | `_reserveCapacity` / `processExitQueue` | Sorties plafonnées par fenêtre de 24 h à max(`maxOutflowBps` × réserves, un palier) ; au-delà, **file d'attente**, payée sans permission à la fenêtre suivante | Règle publique, sans humain |
| 5. Paiement ou créance | `_payOut` / `withdrawOwed` | Gas plafonné (50 000) ; si le destinataire refuse (contrat hostile, liste noire USDC), le montant devient une créance récupérable. **La file ne peut pas être bloquée** | — |

### Invariant de solvabilité (testé)

`ETH détenu par l'entrée = réserves[ETH] + stipend × (notes non dépensées)`.
- Un dépôt ajoute palier + stipend.
- Une réclamation verse le stipend.
- Une note créée par le pool transfère s de `réserves` vers la garantie des allocations.
- Une sortie verse palier + stipend.

### Borne en cas de compromission du déchiffreur (P2.b réalisé)

Un Teecryptor malveillant peut signer `ok = vrai` pour un solde insuffisant, et créer ainsi une
note non adossée. Ce qu'il peut en tirer est borné par le disjoncteur : au plus
**max(maxOutflowBps × réserves, un palier) par fenêtre de 24 h** et par actif. Avant l'incrément 4,
il n'y avait pas de chemin de sortie ; sans disjoncteur, la perte possible aurait été de 100 %.

**Limite déclarée** : la compromission elle-même n'est **pas détectable** on-chain, puisque
personne d'autre ne peut déchiffrer. Le disjoncteur borne donc le **débit** de la fuite, pas son
existence. L'éliminer exige des preuves de déchiffrement correct (réseau de seuil Fhenix à venir,
ou déchiffrement vérifiable).

### Failles trouvées et corrigées pendant l'incrément (revue adversariale)

1. **Réentrance dans `processExitQueue`** : le paiement partait avant l'avancement de la file, ce
   qui permettait un double paiement. **Corrigé** : réservation de capacité, puis avancement de la
   file, puis paiement, avec un verrou de réentrance sur toutes les fonctions qui transfèrent de la
   valeur.
2. **Blocage de la file par un destinataire hostile** : un paiement qui échoue bloquait toute la
   file. **Corrigé** : paiement ou créance, gas plafonné (test avec un contrat qui tente une
   réentrance puis refuse l'ETH).
3. **Lien par le financement du gas** : la première conception exigeait que le pseudonyme verse
   l'allocation en ETH, et donc qu'il reçoive de l'ETH de l'extérieur. **Corrigé** : allocation
   débitée du solde chiffré en BASE.

---

## P3 — Latence et passage à l'échelle (incrément 5)

### Constructions

1. **Appariement par sommes préfixes** (scan de Blelloch). Le reste de chaque ordre vaut
   `max(0, M − Σ_{j<i, même sens} eff_j)`. Toutes les exécutions deviennent **indépendantes** ;
   la profondeur passe de O(N) à O(log N). Règlement en phases Eff / Up / Down / Fills,
   découpables en transactions.
   - **Équivalence avec le FIFO séquentiel prouvée** (Halmos, toutes entrées, 4 ordres) ;
   - 80 scénarios aléatoires et un lot de 19 ordres réglé par pas de 3 sont conformes au modèle.
2. **Mises à jour de soldes compactes** : 12 opérations FHE au lieu de 14 par exécution. Égalité
   avec l'écriture d'origine prouvée modulo 2⁶⁴ (Halmos).
3. **Soumission à preuve unique** (`submitOrderBatched`) : sens et quantité vérifiés avec une seule
   signature, donc une seule preuve côté client.

### Mesures réelles (Base Sepolia, 25 septembre 2026)

| Lot | Version | Chiffrement client | Règlement on-chain | Lecture : médiane | Lecture : dernier | Gas du règlement | Exact |
|---|---|---|---|---|---|---|---|
| 16 | FIFO séquentiel (phase 0) | 27 s (2 preuves) | 3,9 s | 31,1 s | 39,8 s | 14,7 M | 16/16 |
| 16 | **Scan + preuve unique** | **16 s** | 7,4 s | **24,7 s** | **35,2 s** | 21,0 M | 16/16 |
| 32 | **Scan + preuve unique** | 15,7 s | 13,8 s | 48,2 s | 68,7 s | 42,1 M | 32/32 |

### Conclusion (constat, pas hypothèse)

- **La latence double quand le lot double** (35 s → 69 s). Le facteur limitant est le **débit**
  du coprocesseur CoFHE du testnet, environ **15 opérations FHE par seconde** (≈ 860 opérations
  en ≈ 55 s pour 32 ordres), et **non la profondeur** du calcul. Le scan apporte un gain réel mais
  limité (−12 % à −21 % à 16 ordres), ce qui suggère un parallélisme partiel chez le coprocesseur.
- **Avec le scan seul**, l'objectif « 64 ordres en < 60 s » n'était pas atteignable (voir la solution 1 ci-dessous, qui l'atteint). Par
  extrapolation linéaire mesurée, 64 ordres donneraient ≈ 135 s.
- **Ce qui est atteignable** : **≈ 24 ordres par lot pour une lecture en < 60 s**, et de l'ordre de
  1 500 ordres par heure si le débit du coprocesseur est partagé entre tous les lots (à vérifier
  avec Fhenix).
- **Leviers restants**, par ordre d'impact :
  1. le débit du coprocesseur, qui ne dépend pas de nous : **à demander à Fhenix** (mainnet,
     accélération GPU annoncée) ;
  2. réduire encore les opérations par ordre, sachant que les deux multiplications (couverture et
     coût) sont les plus coûteuses ;
  3. calibrer la taille des lots sur l'objectif de latence visé.
- **Chiffrement côté client** : 16 s mesurées dans un conteneur cloud, pour un objectif de 5 s.
  **Non atteint.** Le coût est dominé par la preuve de connaissance du chiffré, calculée
  localement ; reste à mesurer sur un vrai poste ou un serveur multi-cœur.

### Solution 1 — règlement à deux vitesses (incrément 5 bis, implémentée et mesurée)

Le micro-banc ([`s1-microbanc-cofhe.md`](s1-microbanc-cofhe.md)) a montré que le goulot est la
**multiplication 64 bits** (≈ 1 par seconde, non parallélisée), et non la profondeur du calcul.
La construction retire donc les multiplications du chemin qui mène à la lecture des exécutions.

1. **Séquestre au prix plafond, à la soumission.** La première soumission d'un lot k fixe
   `cap_k = R(maintenant) × (1 + 3 %)` (règle 2 sur 3, publique). Chaque ordre bloque alors, pendant
   que le lot est encore ouvert :
   - un vendeur : `q` BASE ;
   - un acheteur : `q × cap_k` QUOTE (la multiplication se fait ici, hors chemin critique).
   `eff = q` si la couverture et la borne `q ≤ MAX_QTY` sont satisfaites, 0 sinon (ok chiffré).
2. **Préfixes incrémentaux.** À chaque soumission, le préfixe du même sens (Σ des `eff`
   antérieurs) est copié dans l'ordre, puis les totaux chiffrés sont mis à jour. Aucune passe de
   scan au règlement.
3. **Phase Fills (rapide)** : `M = min(totB, totS)`, ou `M = 0` si le prix de règlement `p > cap_k`
   (lot non exécuté, tout est remboursé). Pour chaque ordre, 4 opérations **sans multiplication** :
   `rem = M ≥ prefix ? M − prefix : 0 ; fill = min(eff, rem)`. C'est exactement la formule du scan,
   déjà **prouvée équivalente au FIFO** (Halmos, `check_scanEqualsFifo`). L'exécution est alors
   lisible par son trader.
4. **Délai de grâce on-chain**, fixé à la fin de Fills :
   `applyNotBefore = maintenant + min(6 + n/2, 120)` secondes ; toute étape Apply plus tôt échoue
   (`ApplyTooEarly`). Raison **mesurée** : lancées aussitôt, les multiplications d'Apply passent
   devant les déchiffrements des exécutions dans la file du coprocesseur.
5. **Phase Apply (différée)** : `coût = fill × p` ; l'acheteur reçoit `fill` BASE et récupère
   `séquestre − coût` ; le vendeur reçoit `coût` QUOTE et récupère `eff − fill` BASE.

**Sûreté.** Comme `p ≤ cap_k` dès qu'il y a exécution, `coût ≤ fill × cap_k ≤ séquestre` : pas de
rebouclage ni de solde négatif. Si `p > cap_k`, rien n'est exécuté et le séquestre est rendu en
entier. Tests : 117 au total, dont 80 scénarios aléatoires contre le modèle de référence (avec
plafond), un dépassement de plafond remboursé et un lot de 19 ordres réglé par pas de 3.

#### Mesures réelles (Base Sepolia, 25 septembre 2026, preuve unique, pas de 8 ordres)

| Lot | Version | Règlement on-chain | Lecture : médiane | Lecture : dernier | Gas du règlement | Exact |
|---|---|---|---|---|---|---|
| 32 | Scan (rappel) | 13,8 s | 48,2 s | 68,7 s | 42,1 M | 32/32 |
| 32 | Deux vitesses, Apply enchaîné | 7,4 s | 19,2 s | 35,3 s | 18,4 M | 32/32 |
| 32 | Deux vitesses, Apply retenu (contrôle) | — | 14,2 s | **14,6 s** | 18,4 M | 32/32 |
| 64 | Deux vitesses, Apply enchaîné | 13,9 s | 37,1 s | 75,6 s | 37,0 M | 64/64 |
| 64 | **Deux vitesses + délai de grâce on-chain** | 55,9 s¹ | **21,0 s** | **22,4 s** | 37,1 M | 64/64 |

¹ Inclut le délai de grâce (38 s) ; les soldes sont définitifs à la fin d'Apply.

Latence mesurée depuis l'envoi de `startSettlement` jusqu'à la lecture de l'exécution par son
trader (`decryptForView`). Données : `packages/contracts/deployments/latency-twospeed-*.json`.

**Conclusion.** L'objectif **« 64 ordres lisibles en moins de 60 s » est atteint : 22,4 s**, contre
≈ 135 s extrapolés pour le scan (÷ 6). Coûts associés, annoncés :
- l'acheteur immobilise 3 % de QUOTE en plus pendant le lot (rendus à Apply) ;
- un mouvement de prix > 3 % entre l'ouverture et la clôture du lot annule le lot (aucune perte) ;
- une soumission exige des oracles frais (2 sur 3) à l'ouverture du lot ;
- les soldes définitifs arrivent ≈ 40 s après les exécutions (délai de grâce + Apply) ;
- le débit global reste 2 multiplications 64 bits par ordre : ce qui a changé, c'est **où** elles se
  trouvent, pas **combien** il y en a.
