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
