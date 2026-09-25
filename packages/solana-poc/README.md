# Test de faisabilité Solana — preuve de réclamation Noir → Groth16

Question : notre circuit de réclamation anonyme (P1, vérifié sur Base en UltraHonk) peut-il être
vérifié sur Solana, à quel coût, et avec les mêmes garanties ?

## Chaîne d'outils (versions exactes)

| Outil | Version |
|---|---|
| Noir (`nargo`) | 1.0.0-beta.22 (exigée par Sunspot ; Base reste en beta.19) |
| `noir-lang/poseidon` | v0.3.0 (v0.2.6 ne compile plus en beta.22) |
| Sunspot (Reilabs, Noir → gnark Groth16 → programme Solana) | `main` du 25/09/2026, compilé depuis les sources — **non audité** |
| Solana CLI / validateur local | Agave 4.2.2 ; devnet en 4.3.0 |

Écarts avec le circuit Base : `u1` → `bool` (supprimé en beta.22) et **nouvelle contrainte de
liaison** (voir la faille ci-dessous).

## Reproduire

```bash
cd claim && node gen-prover.js && nargo execute            # témoin
cd target && sunspot compile claim.json && sunspot setup claim.ccs \
  && sunspot prove claim.json claim.gz claim.ccs claim.pk && sunspot verify claim.vk claim.proof claim.pw
GNARK_VERIFIER_BIN=…/sunspot/gnark-solana/crates/verifier-bin sunspot deploy claim.vk   # → claim.so
cd ../../poseidon-check && cargo build-sbf
solana program deploy …                                      # les deux programmes
RPC=http://127.0.0.1:8899 node run.js                        # ou RPC=https://api.devnet.solana.com
```

Validateur local : `solana-test-validator --deactivate-feature B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g`
(SIMD-0500, qui interdit le déploiement de programmes SBPF v0–v2, est active par défaut en
local mais **inactive sur devnet** au 25/09/2026 : sans ce drapeau, le local diffère de devnet).

## Résultats (validateur local Agave 4.2.2, 25 septembre 2026) — `results-local.json`

| Mesure | Résultat |
|---|---|
| Poseidon natif Solana (`sol_poseidon`) = Poseidon du circuit | **Identique** : H(1,2) circomlib, feuille, racine de profondeur 20 et nullificateur |
| Coût de 22 hachages Poseidon natifs (chemin 20 + feuille + nullificateur) | ≈ 19 200 CU (≈ 870 CU par hachage) |
| Vérification Groth16 on-chain (5 entrées publiques) | **178 648 CU** sur 1 400 000 (13 %) |
| Taille : preuve / témoin public / transaction | 324 o / 172 o / **706 o** (tient dans une transaction classique de 1 232 o) |
| Frais de la transaction | 5 000 lamports (frais de base, sans priorité) |
| Génération de la preuve Groth16 (serveur) | ≈ 0,75 s ; mise en place 1,8 s ; clé de preuve 5,8 Mo |
| Preuve altérée | refusée |
| Chaque entrée publique modifiée (root, nullifier, recipient, relayer, fee) | **refusée (5/5)** après correction |

## Résultats sur Solana devnet (Agave 4.3.0, 25 septembre 2026) — `results-devnet.json`

Mêmes résultats qu'en local, sur le vrai réseau :

| Mesure | Devnet |
|---|---|
| Programme vérifieur | `FM8VTpzpYqd1XJyWycRuSSDng44wp21Cm6UjuYLY2V7L` |
| Programme de contrôle Poseidon | `7XVNVBqDuZgzmXJUrFtszCnYhVnb8criRTHAJ5K2isTR` |
| Poseidon natif = circuit | **Identique** (H(1,2), racine, nullificateur) |
| Vérification de la preuve valide | ✅ **178 648 CU**, 706 o, 5 000 lamports, confirmée en ≈ 0,5 s ([transaction](https://explorer.solana.com/tx/5bYzZo1KrgDZsRhdf17SQfygGHoSoh5uwJqF59zRtbGVUKbpkskWaF5s1gKgdgUgjSm7ZhVeWtFs8otkbeMdFqzu?cluster=devnet)) |
| 5 entrées publiques modifiées, une par une | **refusées (5/5)** |
| Preuve altérée | refusée |
| Coût du déploiement (loyer des deux programmes) | ≈ 0,56 SOL devnet |

## Dépense complète : preuve + nullificateur compressé (Light Protocol) — `spend/`, `spend.js`

Programme `spend` (Anchor) : **une seule instruction** qui (1) vérifie la preuve Groth16, (2) lit
le nullificateur **dans les entrées publiques prouvées** (et pas dans un argument libre), (3) crée
un compte compressé Light à l'adresse `derive(["nullifier", nullificateur])`. Si l'adresse
existe déjà, le programme système Light rejette la transaction : c'est l'anti-double-dépense,
sans loyer permanent.

Environnement local : `light test-validator --no-use-surfpool` (validateur, indexeur Photon
0.51.2 compilé depuis les sources, prouveur Light compilé depuis `main` : le binaire publié
2.0.7 cherche ses clés sur un stockage Google supprimé, les clés sont désormais sur
`d1wbn9ra8wjh7t.cloudfront.net`).

### Résultats locaux (25 septembre 2026) — `results-spend-local.json`

| Mesure | Résultat |
|---|---|
| Dépense valide | ✅ **359 814 CU** (26 % du plafond) ; **1 122 octets** : tient dans une transaction classique, sans table d'adresses |
| Répartition approximative | ≈ 178 600 CU de vérification Groth16 + ≈ 181 000 CU pour la création du nullificateur (CPI Light, preuve de non-existence) |
| Destinataire modifié | ✅ refusé (« Preuve invalide »), avant toute écriture |
| Double dépense, 1ʳᵉ barrière | ✅ l'indexeur refuse de fournir une preuve de non-existence (« address already exists ») |
| Double dépense, 2ᵉ barrière | ✅ rejeu de l'ancienne instruction refusé **on-chain** par le programme système Light (erreur 0x3779) |
| Coût du nullificateur | ≈ 10 000 lamports (frais des arbres Light), **non bloqués**, en plus des 5 000 lamports de frais de base |
| Comparaison | nullificateur en compte classique : ≈ 0,001 SOL bloqué à vie (≈ 1 000 000 lamports), **≈ 100 fois plus** |

Coût total d'une dépense ≈ 15 000 lamports ≈ **0,0017 $** (SOL à ≈ 116 $, cours approximatif).

### Résultats sur Solana devnet (25 septembre 2026) — `results-spend-devnet.json`

Programme `9KYiaHzahJoob44pnj8WuNKxBnavXUn13AJyDdjtZsKy` (loyer ≈ 0,87 SOL) ; RPC Helius devnet
(API ZK Compression ; le RPC public de devnet ne la fournit pas). Arbres Light **V2** : la sortie
doit viser la **file** (`queue`) de l'arbre d'état V2, sinon le programme Light rejette
(`StateMerkleTreeAccountDiscriminatorMismatch`, 0x179a).

| Mesure | Devnet |
|---|---|
| Dépense valide | ✅ **324 805 CU**, **1 122 octets**, sans table d'adresses ([transaction](https://explorer.solana.com/tx/4Q2nTiQkWQVT4kepYBdeVz8ZUGojqkbEvGX1bAox25PAnQwEipvUgoBFvhERAvtaAcP8c1BdSRGfEqJvHaCyjo74?cluster=devnet)) |
| Nullificateur indexé par Helius | ✅ oui |
| Destinataire modifié | ✅ refusé (« Preuve invalide ») |
| Double dépense : preuve de non-existence | ✅ refusée par l'indexeur (« address already exists ») |
| Double dépense : rejeu on-chain | ✅ refusé par le programme Light (0x3779) |
| Coût d'une dépense | 5 000 lamports de frais + ≈ 10 000 lamports pour le nullificateur ≈ **15 000 lamports ≈ 0,0017 $** |

L'écart avec le local (359 814 CU) vient de l'arbre d'état : V1 en local, V2 (par lots, moins
coûteux à l'insertion) sur devnet.

## Pool complet : dépôt SPL + arbre on-chain + vérification de la racine — `pool/`, `pool.js`

Programme `pool` (Anchor, compte `Pool` en zero-copy) :
- `initialize(coupure)` : pool pour un jeton SPL (USDC ou autre) ; le coffre est un compte de
  jetons dont le propriétaire est le PDA du pool ;
- `deposit(engagement)` : transfère la coupure vers le coffre et insère l'engagement dans
  l'arbre de Merkle incrémental on-chain (Poseidon natif, profondeur 20, 30 racines d'historique) ;
- `spend` : contrôles bon marché d'abord (mint des comptes, **racine connue**, **destinataire et
  relayeur payés = ceux de la preuve**, frais ≤ coupure), puis preuve Groth16, nullificateur
  compressé Light, et paiement `coupure − frais` / `frais` depuis le coffre.

Un compte Solana est représenté dans le corps BN254 par ses 31 derniers octets. Test avec un
jeton de test à 6 décimales (comme l'USDC) : le vrai USDC devnet exige le faucet de Circle ; le
programme accepte tout jeton SPL classique.

### Résultats locaux (25 septembre 2026) — `results-pool-local.json`

| Test | Résultat |
|---|---|
| `initialize` / `deposit` | ✅ 30 212 CU / **≈ 26 300 CU par dépôt** (transfert + 20 hachages Poseidon), 382 o |
| Racine on-chain = racine recalculée hors chaîne (2 dépôts) | ✅ identique |
| Preuve valide mais pour une autre racine | ✅ refusée (`UnknownRoot`, 13 633 CU : refus avant la vérification de la preuve) |
| Bonne preuve, paiement vers un autre compte que le destinataire prouvé | ✅ refusé (`RecipientMismatch`) |
| Dépense valide | ✅ **399 474 CU**, 920 o (transaction v0 avec table d'adresses) ; destinataire **0,99**, relayeur **+0,01**, coffre 2 → 1 |
| Double dépense (rejeu) | ✅ refusée (Light 0x3779) |
| Génération de la preuve (serveur) | ≈ 0,8 s |

### Résultats sur Solana devnet (25 septembre 2026) — `results-pool-devnet.json`

Programme `DMBrPRJ7H5hPaJ14T5sVfKQavD71PrkmXFiRDh32S2V8` (loyer ≈ 1,47 SOL), RPC Helius devnet.

| Test | Devnet |
|---|---|
| `initialize` / `deposit` | ✅ 28 712 CU / ≈ 26 300 CU par dépôt |
| Racine on-chain = racine hors chaîne | ✅ identique |
| Racine inconnue | ✅ refusée (`UnknownRoot`) |
| Destinataire substitué | ✅ refusé (`RecipientMismatch`) |
| Dépense valide | ✅ **364 472 CU**, 951 o ; destinataire 0,99, relayeur +0,01, coffre 2 → 1 ([transaction](https://explorer.solana.com/tx/hY5sAG6Q3E62Hw1jyi4ewbqAUezZn4stiwzhse53w9cATsYb1q4UGYtBAmZL1oyCrUFiwwZTCP2b3494Qzij52y?cluster=devnet)) |
| Double dépense | ✅ refusée (Light 0x3779) |

Coût du script complet ≈ 0,023 SOL, surtout le loyer (unique) du jeton de test, des comptes de
jetons, du compte `Pool` et de la table d'adresses ; une dépense seule reste ≈ 15 000 lamports.

Taille du programme : 289 Ko (profil `opt-level = "z"`, LTO) → ≈ 1,47 SOL de loyer sur devnet.
Piège rencontré : copier le compte `Pool` (2,4 Ko) sur la pile provoquait un accès mémoire
invalide (pile de 4 Ko par appel) ; seuls les champs utiles sont lus.

## Relayeur — `relayer.js`, `relay-test.js`

Service HTTP (`GET /info`, `POST /relay`). L'utilisateur envoie seulement
`{ proof, publicWitness, recipientOwner }` : **aucune signature, aucun SOL**. Le relayeur
vérifie que la preuve le désigne et que les frais prouvés atteignent son minimum, dérive le
compte de jetons du destinataire (créé au besoin) et vérifie qu'il est celui de la preuve,
obtient la preuve de non-existence du nullificateur, **simule** la transaction, puis seulement
la signe et paie. La preuve lie le relayeur et ses frais : un autre relayeur ne peut pas
détourner les frais, ni personne le destinataire.

### Résultats sur Solana devnet (25 septembre 2026) — `results-relay-devnet.json`

Scénario : pool neuf, 3 dépôts (dont 1 par le déposant testé), destinataire = adresse neuve
jamais financée, relayeur = clé neuve.

| Requête | Réponse | Payé par le relayeur |
|---|---|---|
| Frais prouvés sous le minimum | 400 « frais 19999 < minimum 20000 » | **0** |
| Preuve désignant un autre relayeur | 400 « la preuve ne désigne pas ce relayeur » | **0** |
| Preuve altérée | 422 « simulation refusée : Preuve invalide » | **0** |
| Retrait valide | ✅ 200 ([transaction](https://explorer.solana.com/tx/22bVdsJuXxqkK5evYGtagVJAwhP3YLQCxguortay5yjwiqcA9X8N4cjWoJukYxL7h2mudYicougEutATv1v3Km2G?cluster=devnet)) : 382 527 CU, 1 057 o | 1 503 444 lamports |
| Double dépense (même requête) | 409 « nullificateur déjà utilisé » | **0** |

Vérifications sur la transaction de retrait :
- payeur = le relayeur ; **ni le portefeuille du déposant ni son compte de jetons n'y
  apparaissent** ;
- destinataire : 0,98 jeton reçu, **0 SOL** (il n'a jamais eu besoin de SOL) ;
- relayeur : 0,02 jeton de frais.

Coût du relayeur par retrait : 5 000 (frais) + ≈ 10 000 (nullificateur) = ≈ 15 000 lamports si
le compte du destinataire existe ; **+ 1 488 440 lamports** (loyer devnet d'un compte de jetons,
≈ 0,17 $) s'il faut le créer. Des frais de 0,02 $ ne couvrent donc pas la création du compte :
le relayeur devra demander un supplément dans ce cas, ou exiger un compte existant.

Limites (test) : pas de limitation de débit, pas de file d'attente ; l'adresse IP de
l'utilisateur est visible du relayeur (passer par Tor ou un relais réseau).

## Branchement x402 : schéma « shielded-note » — `x402.js`, `x402-test.js`

Un agent paie une API HTTP avec une note du pool, selon le déroulé x402 : le vendeur répond
**402** avec ses exigences (`accepts[]` : `scheme`, `network`, `asset`, `payTo`, `amount`,
`extra` = programme, pool, coupure, frais, compte du facilitateur) ; l'agent rejoue la requête
avec `X-PAYMENT` = base64(JSON `{ x402Version, scheme, network, payload }`) où `payload` contient
la preuve et le témoin public, **sans signature ni adresse de l'agent** ; le vendeur appelle le
facilitateur (`/verify` : contrôles + simulation, rien n'est payé ; puis `/settle` : envoi) et
sert la ressource avec `X-PAYMENT-RESPONSE`. Le facilitateur est le relayeur : il paie les frais
Solana et touche les frais prouvés.

La preuve est liée au vendeur (`recipient` = compte de jetons de `payTo`) et au facilitateur
(`relayer`, `fee`) : un paiement fait pour un vendeur ne peut pas être encaissé par un autre.
Le schéma « shielded-note » est propre à ce prototype ; la forme des messages suit x402.

**Limite** : une note paie un montant fixe (coupure − frais). Des montants libres avec rendu de
monnaie exigent un circuit « join-split » (2 notes en entrée, 2 en sortie).

### Résultats sur Solana devnet (25 septembre 2026) — `results-x402-devnet.json`

Scénario : pool neuf, 4 dépôts (2 notes de l'agent, 2 d'autres utilisateurs), deux vendeurs
(A : `/weather`, B : `/price`) dont les adresses n'ont jamais eu de SOL, un facilitateur.

| Étape | Résultat |
|---|---|
| Agent → A, payé avec la note 1 | ✅ **200** `{"city":"Paris","tempC":17}` + `X-PAYMENT-RESPONSE` ([transaction](https://explorer.solana.com/tx/4u8gSVan3S4MZfE3xj9ZjLu1X12wx3K1G3UmqkSeHogZo9TEzzYzCe3hsTMzNXGwAG73GM5118Q48s1U3DCuY8ze?cluster=devnet)) |
| Rejeu du même `X-PAYMENT` → A | ✅ **402** « nullificateur déjà utilisé » |
| Paiement construit pour B, présenté à A | ✅ **402** « le paiement ne va pas au vendeur » — et la note n'est **pas** brûlée |
| Ce même paiement → B | ✅ **200** `{"pair":"SOL/USD","price":116}` ([transaction](https://explorer.solana.com/tx/4APuuLYd5DcDEEgXovXyKAuWhJevcWXngeksZNt5FKkWwKw1HDuKPtkVaJd6qhzsiXquAynQGiYSiykqkPwS5kqt?cluster=devnet)) |
| Soldes | A : 0,98 ; B : 0,98 ; facilitateur : 0,04 |
| Portefeuille de l'agent dans les transactions de paiement | ✅ **absent** |
| Génération de la preuve côté agent | 1,3 à 1,7 s |

## Join-split 2 → 2 : montants libres et rendu de monnaie — `joinsplit/`, `jspool/`, `joinsplit-test.js`

**Note** : `C = H(H(nk, secret), montant)` ; **nullificateur** : `H(nk, C)`.

**Circuit** (`joinsplit/src/main.nr`, ≈ 16 000 portes ACIR, 9 entrées publiques) :
- appartenance à l'arbre de chaque entrée de montant > 0 (une entrée de montant 0 est fictive) ;
- nullificateurs corrects et distincts ;
- engagements de sortie corrects ;
- **conservation** `entrées = sorties + withdraw + fee` ;
- montants en `u64`, donc pas de montant négatif ni de débordement ;
- liaison de `recipient`, `relayer` et `fee`.

Tests Noir : partage avec note fictive ✅, création de monnaie refusée ✅, fausse note refusée ✅.

**Programme** (`jspool`, `H9YGaz5zPS1LXAjhDFnpj88UQGYbDoy64UQJtXBVnzno` sur devnet) :
- `deposit(inner, montant)` calcule `C = H(inner, montant)` **on-chain** : une note ne peut pas
  valoir plus que ce qui a été déposé ;
- `transact` vérifie :
  - que la racine est connue ;
  - que le destinataire et le relayeur payés sont ceux de la preuve ;
  - la preuve elle-même ;
- `transact` crée ensuite 2 nullificateurs compressés Light dans un seul appel, insère les 2
  engagements de sortie et paie `withdraw` au destinataire et `fee` au relayeur.

### Résultats sur Solana devnet (25 septembre 2026) — `results-joinsplit-devnet.json`

Dépôts : 1,00 (autre utilisateur), **A = 1,00** et **B = 0,50** (agent), 2,00 (autre utilisateur).

| Opération | Résultat |
|---|---|
| Racine on-chain = racine hors chaîne (après les dépôts, Tx1, Tx2) | ✅ 3/3 |
| **Tx1 : paiement avec monnaie**. A (1,00) → 0,23 au vendeur + 0,02 de frais + note C de monnaie (0,75) + note vide | ✅ **736 847 CU**, 1 112 o ([transaction](https://explorer.solana.com/tx/5Ko2grDJM9cbpdSSoPV1aqqy6Te8DZSxmz5j5g69MVo8EqtZpPj5ZqrtEMWZdfSoUXn2A2ZMhaWFNTHJLAXCu8HN?cluster=devnet)) |
| Rejeu exact de Tx1 (double dépense) | ✅ refusé on-chain (Light 0x3779) |
| Nouvelle preuve qui re-dépense A | ✅ refusée par l'indexeur (« address already exists ») |
| Montant retiré gonflé (entrée publique modifiée) | ✅ refusé (« Preuve invalide ») |
| **Tx2 : fusion + paiement**. B (0,50) + C (0,75) → 0,03 au vendeur + 0,02 de frais + D (1,00) + E (0,20) | ✅ 736 919 CU, 1 112 o |
| Soldes | vendeur **0,26**, relayeur **0,04**, coffre **4,20** = attendus exactement |

**Coûts**
- Preuve join-split : **388 octets**. Les contrôles de plage `u64` ajoutent un engagement
  BSB22 gnark de +64 o.
- Génération de la preuve sur serveur : **≈ 1,2 s**, plus l'exécution Noir.
- Vérification on-chain : **≈ 736 000 CU sur 1 400 000**. C'est deux fois la version à coupure
  fixe : 9 entrées publiques, l'engagement BSB22, 2 nullificateurs, 2 insertions dans l'arbre.

**Reste à faire**

## x402 au prix exact avec le join-split — `relayer-js.js`, `shielded-wallet.js`, `x402-js-test.js`

Schéma `shielded-joinsplit`. L'agent dépose une fois, puis paie des API à des **prix
arbitraires**. Le paiement public vaut **exactement** le prix, et la monnaie reste privée dans
le pool.

**Portefeuille** (`shielded-wallet.js`) :
- reconstruit l'arbre à partir des **événements on-chain** du programme (`Deposited`,
  `Transacted`) et vérifie la racine contre le compte `Pool` ;
- localise ses notes et repère les notes dépensées (nullificateurs publiés) ;
- choisit 1 ou 2 notes, construit la preuve et garde la monnaie rendue.

**Facilitateur** (`relayer-js.js`) : mêmes contrôles que le relayeur, plus deux :
- paiement public **= prix exact** demandé par le vendeur ;
- compte de jetons du vendeur **existant**. Le créer dans la même transaction la ferait
  dépasser 1 232 octets (mesuré : 1 251) ; le vendeur le crée une fois pour toutes.

### Résultats sur Solana devnet (25 septembre 2026) — `results-x402-joinsplit-devnet.json`

L'agent dépose **1,00** une seule fois ; d'autres utilisateurs déposent 2,00 et 0,70.

| Étape | Résultat |
|---|---|
| Synchronisation par événements (3 feuilles) | ✅ racine = racine on-chain |
| Agent → A `/weather`, **prix 0,137** | ✅ **200** ([transaction](https://explorer.solana.com/tx/ysVjopSCZ8XYSdGmzXriJTzNpxFWvWt1yBBWzxLMs7jkaKxyp1qsRRVycSUBcy7XtXyL1EDFsaarbR8E6h2frLR?cluster=devnet)) ; monnaie privée **0,858** ; 3,3 s de bout en bout (preuve 1,7 s) |
| Rejeu du même paiement | ✅ 402 « note déjà dépensée » |
| Sous-paiement (0,100 au lieu de 0,137) | ✅ 402 « montant payé ≠ prix » |
| Paiement fait pour B, présenté à A | ✅ 402 « ne va pas au vendeur » |
| Même paiement → B `/price`, **prix 0,042**, payé **avec la monnaie de A** | ✅ **200** ([transaction](https://explorer.solana.com/tx/5xoo4XCMLegYviMC4XnPaV5MYFvKGVHP9VmbuaKVnJBgNuhjJyVR8aRbCzw2Uxsosa18vBkWvphzgBeomVKTJHdX?cluster=devnet)) |
| Vendeur sans compte de jetons | ✅ 402 propre, note non brûlée |
| Soldes | A **0,137**, B **0,042**, facilitateur **0,010**, coffre **3,511**, solde privé agent **0,811**, jetons publics de l'agent **0** : tous égaux aux attendus |
| Portefeuille de l'agent dans les paiements | ✅ absent |
| Coût par paiement | ≈ 736 700 CU ; 5 000 lamports de frais + ≈ 20 000 pour 2 nullificateurs |

## Remise des notes : adresses privées et notes chiffrées — `notes-test.js`

**Notes v2 avec propriétaire** (circuit et programme `jspool` mis à jour sur devnet) :
- chaque portefeuille a une clé de dépense secrète `sk`, une clé publique `pk = H(sk, 0)` et
  une paire X25519 de réception ; adresse privée `zk402:` + hex(pk) + hex(clé X25519) ;
- note : `C = H(H(pk, blinding), montant)` ; nullificateur : `H(sk, C)`. Seul le détenteur de
  `sk` peut dépenser. L'émetteur d'une note pour autrui ne peut **ni la dépenser, ni savoir
  quand elle est dépensée**. Test Noir `test_sender_cannot_spend_recipient_note` ✅ ;
- `transact` publie un message chiffré (≤ 128 o) dans l'événement `Transacted`.

**Chiffrement** : clé éphémère X25519, HKDF-SHA256, ChaCha20-Poly1305. Le `blinding` n'est
pas transmis : les deux parties le dérivent du secret partagé. Seul le montant est chiffré,
d'où un message de **56 octets**. Avec 87 octets (blinding transmis), la transaction faisait
1 233 o, **un octet au-dessus** de la limite de 1 232.

**Réception** : le portefeuille parcourt les événements du pool et essaie de déchiffrer chaque
message. Une note n'est acceptée que si l'engagement recalculé est **celui publié dans la
même transaction**, donc présent dans l'arbre. Le destinataire n'a pas à croire l'émetteur.

### Résultats sur Solana devnet (25 septembre 2026) — `results-notes-devnet.json`

| Étape | Résultat |
|---|---|
| Alice → Bob **0,30 en note privée** (aucun montant public) | ✅ [transaction](https://explorer.solana.com/tx/hHdkpmi716DjH8CATjypLqDFwvijJVXYfS84uF4He4MCHJdA2wb4cJ46GShXxQAb3Mjfk6uKsHrcMS6QWgpRToV?cluster=devnet) : **1 202 o** (message 56 o), 734 983 CU, preuve ≈ 2 s |
| Synchronisations | Bob trouve **0,30** ; Alice garde **0,695** de monnaie ; Carol (observatrice) : **0** |
| Alice tente de dépenser la note de Bob | ✅ impossible (« note absente de l'arbre » : mauvaise clé) |
| Message mensonger (note réelle de 0,01, message annonçant 5,00) | ✅ Bob l'**écarte** (engagement recalculé ≠ engagement publié) |
| Bob dépense la note reçue : 0,10 payé au vendeur au prix exact | ✅ [transaction](https://explorer.solana.com/tx/5pqa2AkyZh6su6VgEBCDrRx1d1hSMaNuGv7xc7xKKx5YwkzN9v8uP68rNMFue64DpL4KVFdqGrXTxZuDNMyYcmNp?cluster=devnet) |
| Soldes finaux | Alice **0,680**, Bob **0,195**, Carol 0, vendeur 0,10, relayeur 0,015, coffre 3,385 : **tous égaux aux attendus** |

Bob n'a jamais eu de SOL ni de compte on-chain avant de dépenser : il a reçu, détecté et
dépensé sa note uniquement via le relayeur. Le test x402 au prix exact
(`x402-js-test.js`) repasse à l'identique avec les notes v2.

Remarque : `joinsplit-test.js` et `results-joinsplit-devnet.json` utilisent le format de notes
v1 (`H(H(nk, secret), montant)`) ; le programme `jspool` de devnet est désormais en v2.

## Faille trouvée et corrigée : entrées publiques non liées en Groth16

Premier essai : une preuve valide restait **acceptée avec `recipient`, `relayer` ou `fee`
modifiés** (root et nullifier étaient bien refusés). Un tiers qui intercepte la transaction
pouvait donc détourner la réclamation vers sa propre adresse.

Cause : le circuit « liait » ces entrées par une égalité tautologique
(`recipient * relayer + fee == recipient * relayer + fee`), que le compilateur supprime. Une
entrée publique qui n'apparaît dans **aucune** contrainte a un terme nul dans la clé de
vérification Groth16 : elle n'est pas liée. En UltraHonk (Base), toutes les entrées publiques
sont liées par construction, et le test Hardhat anti-détournement passait.

Correction : `assert(hash_2([hash_2([recipient, relayer]), fee]) != 0)` (vraie contrainte).
Après correction, les 5 modifications sont refusées. **Recommandation** : appliquer la même
correction au circuit Base par défense en profondeur, et tester systématiquement la
modification de chaque entrée publique pour tout nouveau circuit.

## Réserves

- Sunspot n'est pas audité ; sa mise en place (`setup`) est **dangereuse** (déchet toxique non
  détruit) : une cérémonie par circuit est obligatoire avant toute mise en production.
- Pas encore testé : vérification de la racine contre l'arbre du pool, transfert USDC, relayeur.
