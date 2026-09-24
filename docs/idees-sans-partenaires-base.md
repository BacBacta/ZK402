# Base — idées ZK déployables sans partenaire (septembre 2026)

> **Critère** : lançable seul, sur Base, sans accord de Coinbase, d'un émetteur, d'un PSP, de Hinkal
> ni d'une infrastructure FHE encore absente du mainnet. On n'utilise que des données publiques de la
> chaîne et de la cryptographie open source (Noir/UltraHonk, précompilés EVM).

---

## 1. Le constat qui guide tout : détenir de la crypto est devenu un risque physique

- Les **wrench attacks** (enlèvements, séquestrations, extorsions de détenteurs) explosent : +75 %
  selon CoinDesk début 2026, ~101 M$ volés sur les quatre premiers mois selon CertiK. En France,
  77 incidents au premier semestre 2026, contre 45 sur toute l'année 2025.
- Causes citées : **doxxing volontaire** (« culture du flex »), fuites de données (administration
  fiscale, outils de déclaration fiscale crypto), renseignement en sources ouvertes.
- Or, aujourd'hui, on **doit souvent montrer son wallet** : pour prouver ses fonds (OTC,
  préventes, groupes privés), réclamer un airdrop, entrer dans une communauté réservée aux
  détenteurs, voter. Chaque fois, on relie une adresse (donc une fortune) à une identité.

**Idée directrice** : une primitive ZK unique, « **prouver quelque chose sur ses wallets sans les
révéler** », et plusieurs produits construits dessus.

---

## 2. La primitive : preuve de détention anonyme

### 2.1 Arbre d'instantané public
Un indexeur **open source** construit, à un bloc donné, un arbre de Merkle (Poseidon2) des soldes Base
pour les actifs suivis (USDC, ETH, cbBTC…) :
`feuille = H(adresse, actif, solde, clé(s) propriétaire(s) si smart wallet)`.

La racine est publiée on-chain avec une **fenêtre de contestation** : n'importe qui peut recalculer
l'arbre depuis les données publiques de la chaîne et contester une racine fausse. Il n'y a **aucun
oracle ni partenaire**, seulement un calcul reproductible. En v2, on pourra remplacer cette approche
par des preuves d'état directes (preuves de stockage).

### 2.2 Circuit (Noir)
Entrées privées : adresse(s), soldes, chemins de Merkle, signature(s).
Entrées publiques : racine, prédicat (ex. `Σ soldes ≥ X`), `challenge` du vérificateur (et `scope`
si un nullifier est nécessaire).

Contraintes :
1. **Contrôle de l'adresse** :
   - wallet classique (EOA) : vérification ECDSA secp256k1 dans le circuit, et
     `adresse = keccak(clé publique)` ;
   - Coinbase Smart Wallet (passkey) : vérification P-256 d'un propriétaire listé dans la feuille.
   Noir fournit ces deux vérifications comme primitives optimisées.
2. Feuille(s) dans l'arbre, et prédicat vrai. Plusieurs wallets peuvent être **agrégés** (jusqu'à k).
3. La preuve est **liée au `challenge`** du vérificateur : on ne peut pas la réutiliser ailleurs.
4. Optionnel : **nullifier** `H(secret, scope)` pour « une fois par personne » (claims, votes), où le
   secret est dérivé d'une signature **déterministe** d'un message fixe. Limite : les signatures
   passkey ne sont pas déterministes. Pour les smart wallets, il faut une inscription préalable
   (moins privée) ; pour les preuves de fonds, qui n'ont pas besoin de nullifier, ils fonctionnent
   directement.

### 2.3 Vérification
Dans le navigateur ou sur un serveur (hors chaîne), ou on-chain sur Base (vérificateur UltraHonk
généré). Aucun tiers ne voit l'adresse.

---

## 3. Les produits construits sur la primitive

### P1 — Preuve de fonds anonyme
- **Usage** : « je détiens ≥ 250 000 $ sur Base » pour un desk OTC, une prévente, un groupe
  d'investisseurs, un vendeur de gré à gré. Au lieu de partager son adresse, on partage **un lien de
  preuve** vérifiable en un clic, valable pour ce destinataire (challenge) et pour une durée limitée.
- **Pourquoi maintenant** : les wrench attacks rendent dangereux le fait de montrer son adresse à des
  inconnus.
- **Concurrence** : zkPass et consorts prouvent des données web2 ; Sismo a été le pionnier des
  « badges » ZK on-chain, avec une adoption restée limitée (à étudier comme précédent). Aucun outil
  trouvé centré sur la preuve de fonds on-chain sur Base.
- **Dépendance** : aucune.
- **Verdict** : ✅ **le meilleur point d'entrée**. Simple à expliquer, utile tout de suite, sans
  nullifier (donc compatible avec tous les wallets).

### P2 — Accès à une communauté réservée aux détenteurs, sans lier son wallet
- **Usage** : un bot Discord ou Telegram et un widget web. On prouve « ≥ 1 000 JETON » ou « détient
  un NFT de la collection » et on obtient le rôle, **sans que ni l'admin ni l'outil ne connaissent
  l'adresse**.
- **Concurrence** : Collab.Land et Guild.xyz. Guild masque l'adresse aux admins, mais Guild la connaît
  et la stocke. Notre différence : personne ne la connaît.
- **Dépendance** : aucune (les API Discord et Telegram sont publiques).
- **Verdict** : ✅ bon canal de distribution (chaque communauté amène ses membres). Nécessite une
  re-vérification périodique (nouvel instantané) pour les détenteurs qui vendent.
- **Attention** : sans nullifier, un même détenteur pourrait faire entrer plusieurs comptes Discord
  (une preuve par compte). P2 a donc besoin d'un nullifier par communauté, avec la même limite que
  P3/P4 pour les wallets à passkey (§ 2.2).

### P3 — Réclamation d'airdrop anonyme
- **Usage** : un projet publie sa liste d'éligibilité (arbre). L'éligible réclame **vers une adresse
  neuve** en prouvant son éligibilité (nullifier = une réclamation par feuille). Le lien entre son
  wallet historique et ses nouveaux jetons est coupé.
- **Contexte** : les airdrops passent déjà par des filtres anti-sybil (IP, graphes de wallets). P3 ne
  change pas l'éligibilité, il protège seulement le **destinataire**.
- **Limites** : nullifier fiable pour les EOA uniquement en v1 ; gas du wallet neuf à sponsoriser par
  le projet (paymaster standard ERC-4337, sans partenariat).
- **Verdict** : ⚠️ bonne fonctionnalité pour un kit de distribution, mais les projets en sont les
  clients : il faut les convaincre un par un.

### P4 — Vote pondéré par les jetons, anonyme
- **Usage** : sondage de gouvernance où l'on vote avec le poids de ses jetons à l'instantané,
  **sans révéler son adresse** (aujourd'hui, les votes sont publics, ce qui expose les gros détenteurs
  et favorise les pressions). Nullifier par scrutin.
- **Concurrence** : Snapshot (public), Shutter (vote chiffré jusqu'à la fin, mais pas anonyme après),
  MACI (anti-collusion, plus lourd).
- **Verdict** : ⚠️ utile, adoption lente (gouvernance). À garder comme troisième produit.

---

## 4. Autres idées évaluées (même critère)

| Idée | Dépendance | Verdict |
|---|---|---|
| **Lancement scellé anti-snipe** (commit-reveal + preuve ZK, ou hook Uniswap v4) | Aucune | ⚠️ Faisable seul, mais les lanceurs de Base (Clanker, Flaunch, Zora/Doppler) ont déjà des enchères hollandaises et des courbes anti-snipe : différenciation faible |
| **Réception privée par adresses furtives** | Aucune | ❌ Fluidkey le fait déjà sur Base (24 000 utilisateurs, 840 M$) |
| **Ordres stop-loss cachés** (anti chasse aux stops) | FHE sur mainnet (Fhenix fin 2026 / Inco TEE) | ⏳ Même mécanique que le Bouclier ; attendre le FHE |
| **Vote anti-collusion (MACI)** | Aucune (open source) | ⚠️ Couvert en partie par P4 |
| **Preuves d'emploi anonymes (zkEmail)** | Aucune (DKIM public) | ⚠️ Techniquement possible (bugs de contraintes corrigés en 2025 dans zkEmail) ; produit social à effet de réseau, faible lien avec Base |

---

## 5. Recommandation

**Construire la primitive « preuve de détention anonyme » et lancer P1 (preuve de fonds), puis P2
(accès communautaire).**

- **Zéro partenaire** : données publiques + cryptographie open source + déploiement permissionless.
- **Un seul circuit** (plus un variant avec nullifier) : surface d'audit réduite.
- **Une douleur actuelle et grave** : la sécurité physique des détenteurs.
- **Distribution sans partenaire** : P1 se partage par lien (viral dans l'OTC et les groupes
  d'investisseurs) ; P2 s'installe dans les communautés elles-mêmes.

### Points techniques à valider en premier (prototype d'une semaine)
1. **Temps de preuve dans le navigateur** avec ECDSA secp256k1 + keccak + Merkle de profondeur ~26
   (UltraHonk). Objectif : < 30 s sur un ordinateur portable, et mesure sur mobile.
2. **Coût de construction de l'instantané** (des millions de feuilles pour USDC sur Base) et temps de
   recalcul par un contestataire.
3. **Smart wallets** : lecture des propriétaires (passkeys) de Coinbase Smart Wallet depuis les
   events pour les inclure dans les feuilles.

### Risques
- **Sécurité du circuit** (sous-contrainte) : circuit court, tests négatifs, fuzzing, audit.
- **Racine d'instantané contestée** : l'optimisme demande au moins un contestataire honnête ; publier
  l'indexeur et des racines recalculables par tous.
- **Faible anonymat pour les très gros montants** : prouver « ≥ 50 M$ » désigne peu de wallets. Le
  produit doit afficher la **taille de l'ensemble d'anonymat** (nombre de wallets satisfaisant le
  prédicat) avant de générer la preuve.

---

## Sources

- Wrench attacks : https://www.coindesk.com/markets/2026/02/02/crypto-crime-is-getting-violent-wrench-attacks-jumped-75-in-2026 ;
  https://www.certik.com/blog/2026-wrench-attacks-overview ;
  https://cointelegraph.com/news/french-wrench-attacks-rise-to-77-as-government-promises-more-support ;
  https://www.chainalysis.com/blog/violent-crypto-wrench-attacks-2026/
- Launchpads de Base : https://trustswap.com/base/best-launchpads ;
  https://greenfieldcapital.com/2026/02/12/from-gatekeepers-to-protocols-the-case-for-on-chain-listings/
- zkEmail : https://github.com/zkemail/zk-email-verify ;
  https://wavect.io/blog/zero-knowledge-proofs-production-2026/
- Airdrops et filtres anti-sybil : https://streamflow.finance/blog/sybil-attack-problem
- Fluidkey : https://www.fluidkey.com/ ; https://www.cbinsights.com/company/fluidkey
- Guild.xyz / Collab.Land : https://docs.guild.xyz/guild/ ;
  https://docs.collab.land/help-docs/key-features/token-gate-communities/
- Sismo : https://docs.sismo.io/sismo-docs/user-faq
