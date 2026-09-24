# Prompt — résoudre en profondeur les points ouverts du dark pool FHE sur Base (S1)

> À donner tel quel à un agent d'ingénierie (humain ou IA) qui a accès à ce dépôt.

---

## Rôle

Tu es une équipe réunissant quatre compétences :
- **cryptographe appliqué**, spécialiste FHE, ZK et MPC ;
- **ingénieur sécurité smart contracts** (EVM, niveau d'audit) ;
- **spécialiste de la microstructure des marchés** (enchères par lots, dark pools, MEV) ;
- **ingénieur fiabilité** (SRE).

Tu travailles sur le dépôt `ZK402`, branche `claude/exciting-thompson-x3legd`.

## Contexte factuel (mesuré, ne pas remettre en cause sans nouvelle mesure)

- **Le produit (S1)** : un dark pool par lots sur Base.
  - Ordres chiffrés côté client avec Fhenix CoFHE : sens en `ebool`, quantité en `euint64`.
  - Croisement au prix médian, exécution FIFO, soldes chiffrés, circuit constant.
  - Contrat : `packages/contracts/contracts/SealedBatchPool.sol`.
- **Mesures réelles sur Base Sepolia** (voir `docs/phase0-s1-resultats.md` et
  `packages/contracts/deployments/latency-base-sepolia.json`), pour un lot de 16 ordres :
  - exécutions correctes : 16/16 ;
  - règlement on-chain en 3,9 s ;
  - résultat lisible par chaque trader après 16,8 à 39,8 s (médiane 31,1 s), avec une latence qui
    croît d'environ 1,5 s par ordre (chemin FIFO séquentiel) ;
  - chiffrement côté client : ≈ 27 s par ordre (mesuré dans un conteneur cloud) ;
  - gas : ≈ 916 k par ordre pour le règlement, ≈ 290 k pour la soumission, soit ≈ 0,02 $ par ordre
    au gas de Base mainnet ;
  - l'estimation de gas du nœud sous-évalue les appels CoFHE, d'où des plafonds explicites.
- **Douleur visée** : sur Base (~15 Md$ par mois de volume DEX), les ordres sont visibles avant
  exécution (front-running, sandwich à 0,3–0,8 %) et les institutions fuient vers l'OTC. Le seul dark
  pool de Base, Renegade, a des failles documentées (arXiv 2609.27100) :
  - des relayers voient les ordres en clair ;
  - un participant peut abandonner après avoir vu le résultat ;
  - des sondages répétés permettent de reconstruire l'historique ;
  - le réseau tient sur 4 nœuds.

## Objectif

Résoudre **en profondeur** les sept problèmes ouverts ci-dessous (P1 à P7), jusqu'à un système
déployable sur Base mainnet. Une solution est acceptée seulement si :
- elle est **prouvée ou mesurée** ;
- elle **ne déplace pas le problème** vers un autre acteur ou une autre couche sans le dire et le
  borner.

## Règles non négociables

1. **Registre de confiance, avant/après.** Pour chaque problème, dresse le tableau :
   **acteur** (trader, opérateur, relayer, séquenceur de Base, réseau de seuil CoFHE, vérifieur
   Fhenix, oracle, teneur de marché, gouvernance) × **ce qu'il voit** × **ce qu'il peut faire** ×
   **ce qu'il faut qu'il fasse pour nuire** (seuil de collusion, coût). Tu le donnes **avant et après**
   ta solution.
   - Une solution qui retire un pouvoir à un acteur pour le donner à un autre est un
     **déplacement**, pas une résolution. Elle n'est acceptable que si le nouvel acteur est
     strictement moins puissant, plus décentralisé ou sanctionnable, et si c'est **démontré**.
2. **Pas d'esthétique.** Sont refusés :
   - les renommages ;
   - les interfaces qui masquent une fuite visible on-chain ;
   - les « l'opérateur est de confiance » ;
   - les « à auditer plus tard » ;
   - les paramètres magiques sans justification.
3. **Définitions formelles d'abord.** Pour chaque propriété de sécurité ou de confidentialité, écris :
   - une **définition précise** : jeu d'indistinguabilité, ou fonctionnalité idéale au sens du
     modèle de composabilité universelle (UC) ;
   - le **modèle d'adversaire** : passif ou actif, statique ou adaptatif, capacités réseau et
     séquenceur, collusion, budget ;
   - puis seulement la construction, et l'argument qui montre que la construction atteint la
     définition.
4. **Honnêteté sur les impossibilités.** Si une propriété est impossible dans le modèle choisi (par
   exemple cacher totalement le moment d'une transaction sur une chaîne publique), dis-le, cite le
   résultat, et donne :
   - la **meilleure borne atteignable**, **quantifiée** : taille d'ensemble d'anonymat, entropie,
     probabilité de réussite de l'adversaire ;
   - son coût.

   Ne prétends jamais « totalement résolu » ce qui ne l'est pas.
5. **Pas de backdoor.** Aucune clé d'opérateur ne doit pouvoir déchiffrer les ordres, geler les
   fonds ou choisir les gagnants.
6. **Tout ce qui est affirmé est testé.** Chaque propriété est rattachée à au moins un des éléments
   suivants :
   - un test unitaire ;
   - un test d'invariant ou de fuzzing (Foundry, Echidna ou Medusa) ;
   - une vérification formelle (Certora, Halmos ou SMTChecker) ;
   - une mesure sur Base Sepolia ;
   - une simulation reproductible.

## Référentiels à appliquer (et à citer là où ils s'appliquent)

- **Modélisation des menaces**
  - STRIDE pour la sécurité ;
  - **LINDDUN** pour la vie privée (liaison, identification, non-répudiation, détection,
    divulgation, ignorance, non-conformité) ;
  - NIST SP 800-30 (évaluation des risques) et SP 800-160 (ingénierie des systèmes sûrs).
- **Smart contracts**
  - **OWASP Smart Contract Security Verification Standard (SCSVS)** et Smart Contract Top 10 ;
  - **EEA EthTrust Security Levels** ;
  - registre SWC ;
  - bonnes pratiques Solidity (checks-effects-interactions, pas de `tx.origin`, gestion de
    l'upgradeabilité selon ERC-1967, rôles minimaux).
- **Cryptographie**
  - paramètres FHE conformes au **HomomorphicEncryption.org Security Standard** et à
    l'**ISO/IEC 18033-6** ; niveau de sécurité ≥ 128 bits ;
  - hypothèses du réseau de seuil de CoFHE (t sur n, preuves de déchiffrement correct) documentées
    depuis les sources de Fhenix, pas supposées ;
  - preuves ZK avec paramètres et setup documentés.
- **Jetons confidentiels** : **ERC-7984** (Confidential Fungible Token) et/ou FHERC20 de Fhenix.
  Justifie le choix et la compatibilité avec un wrapper d'USDC ou de WETH réels.
- **Microstructure et MEV**
  - enchères par lots fréquentes (Budish, Cramton et Shim, 2015) ;
  - littérature SoK sur le MEV et ses contre-mesures ;
  - analyse Renegade (arXiv 2609.27100) ;
  - règles des dark pools réglementés comme **étalons de conception** (non comme obligations) :
    exécution au prix médian façon Reg NMS, taille minimale, équité d'accès façon Reg ATS et
    MiFID II.
- **Oracles**
  - bonnes pratiques Chainlink et Pyth : contrôle d'ancienneté, intervalle de confiance, écart
    maximal, sources multiples, disjoncteurs ;
  - analyse de manipulation (TWAP, coût d'attaque).
- **Conformité** (analyse, pas un avis juridique) :
  - FATF Recommandation 16 (Travel Rule) ;
  - approche « Privacy Pools / association sets » (Buterin et al., 2023) ;
  - MiCA ;
  - exposition aux sanctions (OFAC).
- **Fiabilité** : objectifs SLI/SLO avec budget d'erreur ; tests de charge ; injection de pannes ;
  mode dégradé.

## Les problèmes à résoudre

Pour **chacun**, livre dans cet ordre :
1. l'énoncé précis ;
2. le modèle d'adversaire ;
3. la définition formelle visée ;
4. au moins 3 conceptions alternatives, comparées (sécurité, confiance, coût, latence,
   complexité) ;
5. le choix motivé ;
6. la spécification ;
7. l'implémentation ;
8. les preuves et tests ;
9. le registre de confiance avant/après ;
10. le risque résiduel chiffré.

### P1 — Fuites de métadonnées

**Constat** : aujourd'hui, la chaîne révèle beaucoup d'informations :
- qui soumet un ordre, et quand ;
- le nombre d'ordres par lot ;
- les participants de chaque lot (via les mises à jour d'ACL et de soldes) ;
- les dépôts et retraits en clair ;
- les profils de gas et la taille du calldata.

**Exige :**
- un inventaire exhaustif de chaque bit observable, construit en lisant le bytecode, les
  événements, le stockage, les ACL, le calldata et le gas ;
- une **non-association** entre l'identité d'un dépôt ou d'un retrait et les ordres, par exemple :
  - un pool blindé de notes et de nullificateurs, avec preuve ZK d'appartenance et de solde ;
  - un compte chiffré découplé de l'adresse ;
  - une soumission sans relayer qui verrait le contenu ; si un relayer est utilisé, il ne doit
    rien apprendre qui ne soit déjà public, et c'est à prouver ;
- une **indistinguabilité** entre ordre réel, ordre nul et ordre factice :
  - lots de taille fixe ;
  - remplissage par des ordres factices, en analysant qui les paie et qui peut les reconnaître ;
  - une analyse d'entropie du moment de soumission ;
- une **résistance au sondage** (probing) par petits ordres répétés : taille minimale, frais,
  limitation par identité anonyme, et analyse de la quantité d'information apprise par sondage ;
- **critère** : un adversaire qui observe toute la chaîne et contrôle k traders identifie le sens
  ou la taille d'un ordre honnête avec un avantage ≤ ε, où ε est donné en fonction des paramètres,
  pour une taille d'ensemble d'anonymat annoncée et mesurée.

### P2 — Confiance dans le réseau de seuil CoFHE, le vérifieur et l'oracle

**Constat** :
- la confidentialité dépend du réseau de seuil de Fhenix ;
- l'admission des entrées dépend du vérifieur Fhenix ;
- le prix dépend d'une source que l'opérateur fournit aujourd'hui.

**Exige :**
- la documentation exacte, avec sources, du modèle de confiance de CoFHE : t sur n, qui sont les
  nœuds, rotation des clés, preuves de déchiffrement correct, comportement en cas de panne ;
- la **séparation sûreté / vivacité** : même en cas de collusion ou de panne du réseau de seuil,
  **aucun fonds ne peut être volé ni redistribué**. Seules la confidentialité et la vivacité
  peuvent être atteintes, et elles doivent l'être de façon **détectable**. À prouver par des
  invariants de solvabilité ;
- une **sortie de secours** sans permission : retrait forcé après un délai si le coprocesseur ou
  l'opérateur ne répondent plus, sans backdoor et sans exposer les autres traders ;
- un **oracle sans opérateur** :
  - au moins 2 sources indépendantes (Chainlink, Pyth), avec contrôles d'ancienneté, de confiance
    et d'écart ;
  - un prix de croisement défini par une règle publique et vérifiable ;
  - l'annulation automatique du lot si les sources divergent ;
  - le coût d'une manipulation, chiffré ;
- des **alternatives de réduction de confiance** à évaluer, en disant si elles sont disponibles
  aujourd'hui sur Base :
  - multi-coprocesseur ;
  - preuves ZK du calcul FHE (vérifiabilité) ;
  - diversification (FHE + MPC) ;
  - garanties économiques ;
- **critère** : le registre de confiance montre qu'aucun acteur unique ne peut voler de fonds ni
  voir les ordres, avec les seuils de collusion chiffrés.

### P3 — Latence et passage à l'échelle

**Constat** : la latence augmente d'environ 1,5 s par ordre (FIFO séquentiel), et le chiffrement
côté client prend environ 27 s.

**Exige :**
- une **règle d'allocation parallèle** qui ne dégrade pas l'équité, par exemple :
  - prorata avec division chiffrée, ou multiplication par un inverse public ;
  - préfixes cumulés par arbre, en profondeur O(log n) ;
  - réduction par arbre des totaux ;

  avec une analyse de profondeur et de taille du circuit FHE, et une justification économique de
  l'équité (FIFO, prorata ou prix-temps) ;
- des **SLO** :
  - lot de 64 ordres : résultat lisible par le dernier trader en < 60 s au p99, sur Base Sepolia,
    sur 20 lots au moins ;
  - chiffrement client : < 5 s sur un portable standard **et** sur un serveur d'agent, à mesurer
    et profiler (génération de preuve, taille des clés, WASM ou natif, pré-calcul hors ligne) ;
- des **tests de charge** : plusieurs paires, lots concurrents, pics de gas sur Base ;
- le **comportement si le coprocesseur ralentit** : lots décalés, sans perte ni exécution
  partielle incohérente ;
- **critère** : des courbes latence/taille de lot mesurées, et un SLO tenu avec son budget
  d'erreur.

### P4 — Actifs réels et règlement

**Constat** : le prototype utilise des crédits de démo en `euint64`. Il n'a ni vrais jetons, ni
arrondis, ni frais.

**Exige :**
- l'enveloppe de vrais actifs (USDC, WETH) en jetons confidentiels (ERC-7984 ou FHERC20), avec :
  - des invariants de **solvabilité** : somme des soldes chiffrés ≤ réserves, prouvée ou vérifiée
    par invariants ;
  - la gestion des décimales et des débordements `euint64` ;
  - des arrondis toujours en faveur du pool, bornés ;
- des **frais de protocole** prélevés en chiffré, sans révéler les tailles ;
- une estimation des **frais de CoFHE sur mainnet**, obtenue auprès de Fhenix ou mesurée, et
  l'économie unitaire complète : gas L2, données L1, frais de CoFHE, oracle ;
- **critère** : des tests d'invariants de conservation (aucun jeton créé ni perdu) sur au moins
  10⁶ séquences aléatoires, et une vérification formelle des fonctions de règlement.

### P5 — Liquidité, démarrage à froid et mécanisme de marché

**Constat** : un dark pool vide ne sert à personne. Rien ne garantit la coïncidence des ordres.

**Exige :**
- une **conception du mécanisme** :
  - fréquence des lots ;
  - prix limite chiffré optionnel ;
  - taille minimale ;
  - ordres persistants sur plusieurs lots ;
  - rôle des teneurs de marché, qui fournissent l'autre côté au prix médian avec un écart borné ;
- un **routage du reliquat** vers un AMM (Aerodrome, Uniswap) **sans fuite**. Le routage révèle
  un sens et une taille : il faut le quantifier et le rendre optionnel, retardé ou agrégé ;
- une **simulation** calibrée sur des flux réels de Base :
  - ordres DCA des agents (Ethy, Axelrod…, voir `docs/phase0/`) ;
  - volumes Aerodrome ;

  qui mesure le **taux d'exécution**, le gain moyen par rapport à l'AMM, net du MEV évité, et le
  coût d'opportunité de l'attente ;
- une **analyse des stratégies adverses** : sondage, manipulation du prix de référence autour du
  lot, et un teneur de marché qui se retire sélectivement ;
- **critère** : un taux d'exécution et un gain net démontrés en simulation pour au moins un
  segment réel (par exemple le DCA d'agents), avec des hypothèses explicites.

### P6 — Conformité et abus, sans backdoor

**Constat** : un dark pool sans contrôle d'accès attire des fonds illicites et des régulateurs.

**Exige :**
- des **preuves ZK de conformité à l'entrée**, par exemple :
  - une preuve de non-appartenance à une liste de sanctions ;
  - une appartenance à un association set (Privacy Pools) ;
  - un groupe anonyme de comptes Coinbase Verified (voir `docs/conception-identifiants-zk.md`) ;

  **sans clé de déchiffrement détenue par un tiers** ;
- une analyse MiCA, FATF R.16 et OFAC : ce qui s'applique au protocole, aux interfaces, aux
  opérateurs. Marque clairement ce qui relève d'un avis juridique à obtenir ;
- **critère** : aucune fonction ne permet à qui que ce soit de lire les ordres ou de geler un
  compte individuel ; les exigences de conformité sont couvertes par des preuves côté utilisateur.

### P7 — Pouvoir de l'opérateur, gouvernance et sécurité du contrat

**Constat** : aujourd'hui, `operator` fixe le prix et le moment du règlement. C'est un pouvoir de
censure et de synchronisation.

**Exige :**
- un **règlement sans permission** :
  - n'importe qui peut déclencher le lot après l'échéance ;
  - le prix vient de l'oracle (P2) ;
  - une incitation paie le déclencheur ;
- une **résistance à la censure** : que peut faire le séquenceur de Base ? Analyse la voie de
  soumission forcée par L1 (OP Stack) et son délai ;
- l'**upgradeabilité** : aucune, ou verrouillée par timelock et gouvernance, avec possibilité de
  sortie avant tout changement ;
- **audit interne** selon OWASP SCSVS et EthTrust, un rapport par exigence, puis une vérification
  formelle des invariants critiques :
  - conservation ;
  - circuit constant (aucune branche dépendant d'un chiffré) ;
  - un ordre par identité et par lot ;
  - pas de réentrance ;
- **critère** : aucun rôle privilégié ne peut influencer un lot en cours ; tous les invariants
  sont vérifiés.

## Livrables

1. `docs/s1-modele-menaces.md` : actifs, acteurs, frontières de confiance, analyses STRIDE et
   LINDDUN, registre de confiance global.
2. `docs/s1-specification.md` : définitions formelles, constructions, arguments de sécurité, bornes
   résiduelles chiffrées, impossibilités assumées.
3. Code : contrats (`packages/contracts/contracts/`), circuits ZK éventuels, SDK client ou agent,
   scripts de mesure.
4. Tests : unitaires, invariants et fuzzing, vérification formelle ; couverture ≥ 95 % des lignes
   sur les contrats de règlement.
5. `docs/s1-mesures.md` : résultats sur Base Sepolia (latence p50/p99 par taille de lot, gas, coût
   unitaire complet), et simulation de marché avec données et hypothèses.
6. `docs/s1-risques-residuels.md` : ce qui n'est **pas** résolu, pourquoi, bornes chiffrées,
   conditions de réouverture.

## Méthode de travail

- Commence par P1, P2 et P7 : ce sont les fondations de la confiance. Viennent ensuite P4, P3, puis
  P5 et P6.
- Avant chaque choix, cherche l'état de l'art et **cite tes sources**, en datant ce que tu vérifies
  sur la documentation de Fhenix, Base, Chainlink et Pyth.
- **Mesure plutôt que supposer.** Toute hypothèse non vérifiée est marquée « HYPOTHÈSE » et reçoit
  un plan de vérification.
- Travaille par petits incréments testés. Chaque incrément se termine par un commit clair.
- **Clés et fonds** : utilise uniquement des clés testnet placées dans `.env` (jamais commitées).
  Aucun déploiement mainnet sans validation humaine explicite.

## Interdits

- Déplacer la confiance sans le dire, sans le borner et sans le justifier.
- Toute clé, rôle ou fonction qui permettrait de lire les ordres ou de saisir les fonds.
- Affirmer une propriété sans définition, sans modèle d'adversaire et sans preuve ou test.
- Inventer des chiffres, des adresses ou des paramètres : chaque valeur est mesurée, sourcée ou
  marquée comme hypothèse.
- Copier du code substantiel de dépôts tiers sous licence restrictive : cite et réimplémente.
