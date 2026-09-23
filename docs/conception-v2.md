# ZK402 — conception détaillée de la v2

> Statut : **proposition de conception**, rien n'est implémenté. À valider avant tout
> développement (voir [§ 12 Décisions ouvertes](#12-décisions-ouvertes)).
>
> Point de départ : la v1 (`packages/contracts`, `packages/web`) chiffre le **montant** en FHE
> mais laisse visibles l'**identité** du payeur, la **ressource** achetée, le **gas** et le
> **lien** entre paiement et accès HTTP. La v2 vise une confidentialité réelle, en ajoutant
> des preuves à divulgation nulle de connaissance (ZK) au-dessus de ce qui existe.

---

## 1. Objectifs

| # | Propriété | v1 | Cible v2 |
|---|---|---|---|
| O1 | Montant payé caché du public | ✅ (FHE) | ✅ |
| O2 | Identité du payeur cachée du public | ❌ | ✅ — le payeur est « un membre du pool » |
| O3 | Ressource achetée cachée du public | ❌ (1 contrat = 1 ressource) | ✅ — registre commun, ressource prouvée sans la révéler |
| O4 | Serveur incapable de relier accès et adresse | ❌ (il vérifie une signature d'adresse) | ✅ — preuve d'accès anonyme |
| O5 | Gas non payé par le wallet du payeur | ❌ | ✅ — relayer, frais prélevés dans la note |
| O6 | Pas de rejeu de la preuve HTTP | ⚠️ (nonce 5 min rejouable) | ✅ — challenge du serveur lié à la preuve |
| O7 | Vraie valeur (stablecoin) | ❌ (crédits de démo) | ✅ — USDC de test puis USDC réel |
| O8 | Montant caché **du marchand** | ⚠️ (le marchand ne déchiffre que le revenu agrégé, mais deux lectures successives révèlent chaque paiement) | ⚠️ selon la décision D1 : non avec l'option A, oui avec B |

**Non-objectifs** : anonymat au niveau réseau garanti par le protocole (il est recommandé,
§ 8), empêcher le partage de contenu une fois lu (impossible par construction), mainnet
avant audit.

---

## 2. Principe : quel outil pour quelle fuite

- **FHE** (Fhenix CoFHE) : *calculer* sur des valeurs chiffrées. Cache les **valeurs**, pas
  **qui** agit.
- **ZK** : *prouver* une affirmation (« je possède une note non dépensée d'au moins le prix de
  la ressource R ») sans rien révéler d'autre. Cache **qui**, **quoi** et **combien** si la
  valeur est dans un engagement.
- **Pool blindé** (modèle Zcash / Tornado / Semaphore / Railgun) : l'ensemble des notes forme
  l'ensemble d'anonymat. Les **engagements** masquent les notes, les **nullifiers** empêchent
  la double dépense sans dire quelle note a été dépensée.

Conséquence de conception : **le cœur de la v2 est un pool blindé ZK à notes valorisées**. Le
montant y est déjà caché par les engagements. Le rôle du FHE devient un choix (D1) :
agréger les revenus du marchand pour qu'il ne voie pas chaque paiement individuel.

---

## 3. Vue d'ensemble

```
                 ┌──────────────────────── Base (Sepolia puis mainnet) ─────────────────────────┐
                 │                                                                              │
  dépôt public   │  ShieldedPool                         ResourceRegistry                       │
  (adresse,      │   ├─ noteTree   (engagements)          └─ registryTree : H(R, prix, pkMarchand)│
  montant fixe) ─┼─► ├─ nullifiers  (dépenses)                                                   │
                 │   ├─ accessTree (droits d'accès H(s,R))                                       │
                 │   └─ PayVerifier / WithdrawVerifier (générés depuis les circuits)             │
                 │                          ▲                                                    │
                 └──────────────────────────┼────────────────────────────────────────────────────┘
                                            │ tx pay(preuve) soumise par le relayer
  Navigateur du lecteur                     │
  ┌──────────────────────────┐   preuve    ┌┴───────────┐
  │ portefeuille de notes    │────────────►│  Relayer   │  frais payés dans la preuve
  │ (chiffré, local)         │             └────────────┘
  │ prouveur Noir (WASM)     │
  └───────────┬──────────────┘
              │ GET /article  ──►  402 { scheme: "zk-shielded", challenge, registryRoot, … }
              │ GET /article + X-PAYMENT { preuve d'accès liée au challenge }
              ▼
  Serveur x402 (facilitateur) : vérifie la preuve hors chaîne contre un accessRoot récent → 200
```

---

## 4. Modèle de données

### 4.1 Clés du lecteur

| Clé | Rôle |
|---|---|
| `sk` (secret de dépense) | Autorise la dépense d'une note. Ne quitte jamais le navigateur. |
| `pk = H(sk)` | Propriétaire des notes (dans l'engagement). |
| `vk` (clé de visualisation) | Déchiffre les notes reçues (ECDH sur Grumpkin). Partageable pour audit volontaire. |
| `s_R` (secret d'accès) | Un par ressource achetée : `s_R = H(sk, R, sel)`. Dérivé, donc récupérable. |

### 4.2 Note

```
note        = { valeur: u64, propriétaire: pk, aléa: r, jeton: token }
engagement  = Poseidon2(valeur, pk, r, token)
nullifier   = Poseidon2(sk, indexFeuille, r)
```

Les notes sont en **cents** (u64), comme en v1. Le chiffré de chaque note (ECIES vers le `vk`
du destinataire) est émis en event pour que le destinataire puisse la retrouver en scannant.

### 4.3 Registre de ressources

```
feuilleRegistre = Poseidon2(R, prix, pkMarchand)     // R = H(URL canonique de la ressource)
```

Toutes les ressources de tous les marchands partagent **un seul arbre**. La preuve montre
qu'on paie *une* feuille du registre, sans dire laquelle (O3). Le prix reste public **pour le
serveur** (il l'annonce dans la 402), mais pas associé on-chain à une transaction.

### 4.4 Droit d'accès

```
feuilleAccès = Poseidon2(s_R, R)          // insérée dans accessTree lors du paiement
```

Personne ne peut relier une feuille d'accès à une ressource sans connaître `s_R`.

---

## 5. Circuits (Noir)

Recommandation : **Noir + Barretenberg (UltraHonk)** — pas de cérémonie de trusted setup par
circuit, vérificateur Solidity généré, prouveur WASM pour le navigateur. Alternative :
Circom + Groth16 (vérification on-chain moins chère, mais cérémonie de setup) → décision D3.

Tous les paiements ont **la même forme** (2 notes en entrée, 2 en sortie, notes fictives de
valeur 0 si besoin) pour qu'aucune transaction ne se distingue par sa structure.

### 5.1 `pay` — payer une ressource

| Entrées publiques | Entrées privées |
|---|---|
| `noteRoot` (racine récente de noteTree) | 2 notes d'entrée + chemins de Merkle + `sk` |
| `registryRoot` | `R`, `prix`, `pkMarchand`, chemin dans registryTree |
| `nullifiers[2]` | `montant` payé (≥ prix : pourboire possible) |
| `engagementsSortie[2]` (monnaie rendue, note marchand) | note de monnaie rendue (valeur, aléa) |
| `feuilleAccès` | `s_R` |
| `hashChiffrés` (lie les chiffrés de notes émis) | clé éphémère ECDH |
| `relayer`, `frais` | |

Contraintes :

1. Chaque note d'entrée non fictive est dans `noteTree` (racine `noteRoot`) et appartient à `pk = H(sk)`.
2. `nullifiers[i]` correctement dérivés (anti double dépense).
3. La feuille `(R, prix, pkMarchand)` est dans `registryTree`.
4. **Conservation** : `Σ entrées = monnaie + montant + frais`.
5. **Prix** : `montant ≥ prix`.
6. **Bornes** : toutes les valeurs sur 64 bits (pas de débordement modulo le corps).
7. La note marchand appartient à `pkMarchand` et vaut `montant`.
8. **Le chiffré de la note marchand est calculé dans le circuit** (ECDH Grumpkin + chiffrement
   Poseidon). Sans cette contrainte, un payeur pourrait créer une note que le marchand ne sait
   pas ouvrir : il obtiendrait l'accès sans que le marchand touche les fonds.
9. `feuilleAccès = Poseidon2(s_R, R)`.
10. `relayer` et `frais` sont des entrées publiques liées à la preuve : le relayer ne peut pas
    les modifier, un tiers ne peut pas rejouer la preuve à son profit.

### 5.2 `access` — prouver son droit d'accès au serveur

| Entrées publiques | Entrées privées |
|---|---|
| `accessRoot` (racine récente) | `s_R`, chemin dans accessTree |
| `R` (le serveur sait quelle URL est demandée) | |
| `challenge` (fourni par la 402) | |
| `nullifierSession = Poseidon2(s_R, R, époque)` | |

Contraintes : `Poseidon2(s_R, R)` est dans `accessTree` ; `nullifierSession` bien dérivé ;
`challenge` est une entrée publique (la preuve n'est valable que pour cette requête → pas de
rejeu, O6).

Le `nullifierSession` permet au serveur de **limiter** le nombre de sessions par droit d'accès
et par époque (par ex. 20 par jour), ce qui freine le partage massif d'un secret d'accès sans
révéler qui est le lecteur. Le partage d'un contenu déjà lu reste possible, comme partout.

### 5.3 `withdraw` — sortir du pool

Identique à `pay` sans registre ni accès : les notes dépensées vont vers une adresse publique.
Le montant retiré est public (sortie du pool). Recommandation : retraits en **coupures fixes**.

---

## 6. Contrats

| Contrat | Rôle |
|---|---|
| `ShieldedPool` | `deposit(engagement, coupure)`, `pay(preuve, entréesPubliques, chiffrés)`, `withdraw(...)`. Tient `noteTree`, `accessTree` (arbres de Merkle incrémentaux), l'historique des N dernières racines, l'ensemble des nullifiers. Garde le jeton ERC-20 déposé. |
| `ResourceRegistry` | `register(R, prix, pkMarchand)` → insère une feuille. Mise à jour du prix = nouvelle feuille, l'ancienne est révoquée via une liste de racines valides. |
| `PayVerifier`, `WithdrawVerifier` | Générés depuis les circuits Noir. |
| `AccessVerifier` | Optionnel on-chain (composabilité) : le serveur vérifie normalement hors chaîne. |
| `MerchantVaultFHE` | Optionnel selon D1 (§ 9). |

Events émis par `pay` : `NewCommitment(index, engagement, chiffré)` ×2, `NewAccessLeaf(index, feuille)`,
`Nullified(nullifier)` ×2. **Aucun** montant, prix, identifiant de ressource ou adresse de payeur
(la transaction est envoyée par le relayer).

Règles de sûreté : vérifier que `noteRoot`, `registryRoot` et `accessRoot` font partie des
racines connues ; refuser un nullifier déjà vu ; vérifier les chiffrés contre `hashChiffrés` ;
aucune logique d'upgrade avant audit.

---

## 7. Flux x402 v2 : scheme `zk-shielded`

### 7.1 Réponse 402

```json
{
  "x402Version": 1,
  "error": "X-PAYMENT header is required",
  "accepts": [{
    "scheme": "zk-shielded",
    "network": "base-sepolia",
    "minAmountRequired": "10",
    "resource": "https://…/article/42",
    "payTo": "<adresse ShieldedPool>",
    "asset": "<USDC de test>",
    "extra": {
      "resourceId": "0x…",          // R = H(URL canonique)
      "merchantPk": "0x…",
      "registryRoot": "0x…",
      "circuits": { "pay": "v1", "access": "v1" },
      "challenge": "0x…",           // aléa signé par le serveur, expire vite
      "epoch": 20353,
      "relayer": "https://relayer…"
    }
  }]
}
```

### 7.2 Déroulé

1. **Premier accès à R** : le navigateur choisit un montant (≥ prix), génère la preuve `pay`
   (quelques secondes en WASM) et l'envoie au relayer. Le relayer simule la transaction,
   la soumet, et se paie via `frais`.
2. Une fois la feuille d'accès incluse, le navigateur génère la preuve `access` avec le
   `challenge` de la 402 et l'envoie dans `X-PAYMENT`.
3. **Le serveur** vérifie la preuve hors chaîne, vérifie que `accessRoot` est une racine
   récente (lecture on-chain mise en cache), le `challenge` (HMAC + expiration, usage unique)
   et la limite de `nullifierSession` pour l'époque. Puis il répond 200 + `X-PAYMENT-RESPONSE`.
4. **Relectures** : seule l'étape 2 est rejouée, sans nouveau paiement.

Le serveur n'apprend jamais d'adresse, de solde, ni quelle transaction a payé.

---

## 8. Mesures hors protocole (indispensables)

| Fuite | Mesure |
|---|---|
| Adresse IP vers le serveur ou le relayer | Oblivious HTTP (RFC 9458), Tor ou mixnet. À documenter côté client. |
| Corrélation temporelle (paiement puis accès 10 s après) | Relie seulement la session à une tx anonyme. Pour mieux faire : prépayer (dépôt puis attente), délais aléatoires avant `pay`. |
| Montants de dépôt et retrait qui identifient | Coupures fixes (ex. 5 $, 20 $, 100 $). |
| Petit ensemble d'anonymat | Un seul pool pour **toutes** les ressources et **tous** les marchands. Sur testnet, l'anonymat sera faible : à dire clairement. |
| Stockage des notes | Notes chiffrées localement + sauvegarde par phrase de récupération. Perte des notes = perte des fonds. |

---

## 9. Place du FHE en v2 (décision D1)

Dans le pool ZK, le marchand **voit chaque montant** qu'il reçoit (il déchiffre ses notes),
mais **pas qui** l'a payé. Trois options :

| Option | Description | Coût / risque |
|---|---|---|
| **A. ZK seul** | Le marchand voit chaque paiement anonyme. Le FHE de la v1 est retiré. | Le plus simple et le plus robuste. Montants individuels visibles du seul marchand. |
| **B. Hybride FHE** | La note marchand est remplacée par une contribution chiffrée FHE au solde agrégé du marchand (`MerchantVaultFHE`). Le marchand ne voit que des totaux. | Il faut prouver en ZK que le chiffré FHE contient la même valeur que les notes dépensées. Ce lien ZK↔FHE n'est pas fourni clé en main par CoFHE : **travail de recherche**. Dépend aussi du réseau de seuil CoFHE (Stage 1, testnet). |
| **C. Deux modes** | v1 (FHE, adresse visible) et v2 (ZK) coexistent, le lecteur choisit. | Double maintenance, ensembles d'anonymat divisés. |

**Recommandation : A pour la v2**, B étudié en parallèle comme v2.1 si le lien ZK↔FHE devient
praticable. La partie ZK ne dépend pas du calendrier du mainnet CoFHE.

---

## 10. Modèle de menace : qui apprend quoi

| Observateur | v1 | v2 (option A) |
|---|---|---|
| Observateur de la chaîne | adresse, ressource, heure, gas | qu'une note du pool a payé *une* ressource ; dépôts et retraits (coupures fixes) |
| Serveur / marchand | adresse du payeur + « a payé ≥ prix » | « un porteur de droit valide » ; montants reçus sans lien avec un payeur |
| Relayer | — | une preuve valide et ses frais ; l'IP du client sans OHTTP/Tor |
| Opérateurs CoFHE | valeurs selon le Stage | aucun rôle (option A) |
| Réseau (FAI) | connexion au serveur | idem, sauf OHTTP/Tor |

**Hypothèses** : circuits corrects et audités (un circuit sous-contraint = création de monnaie) ;
fonction de hachage Poseidon2 sûre ; racines valides maintenues honnêtement par le contrat ;
système de preuve sûr (et setup honnête si Groth16).

---

## 11. Conformité (décision D4)

Un pool totalement opaque pose un risque réglementaire. Deux mécanismes compatibles :

- **Ensembles d'association** (modèle Privacy Pools) : un fournisseur publie la racine des
  dépôts « acceptés » ; les preuves `pay` et `withdraw` montrent en plus l'appartenance à cet
  ensemble, sans révéler quel dépôt.
- **Clés de visualisation** : le lecteur peut révéler volontairement son historique à un tiers.

---

## 12. Décisions ouvertes

| # | Question | Recommandation |
|---|---|---|
| D1 | Rôle du FHE en v2 (A / B / C, § 9) | A, puis B en recherche |
| D2 | Coupures de dépôt et de retrait | 5 $, 20 $, 100 $ en USDC de test |
| D3 | Système de preuve | Noir + UltraHonk (pas de setup) ; mesurer le gas avant de trancher contre Groth16 |
| D4 | Ensemble d'association dès la v2 | Oui mais optionnel (racine vide = désactivé) |
| D5 | Qui opère le relayer | Le facilitateur au début ; relayers indépendants ensuite |
| D6 | Limite de sessions par époque | 20 par jour et par droit d'accès |

---

## 13. Structure du dépôt visée

```
packages/
  circuits/        Noir : lib (note, merkle, poseidon, chiffrement), pay, access, withdraw ; tests nargo
  contracts/       + ShieldedPool, ResourceRegistry, verifiers générés, USDC de test ; v1 conservée
  relayer/         service Node : simulation, soumission, politique de frais
  web/             + portefeuille de notes, prouveur WASM, scheme zk-shielded (serveur et client)
docs/
  conception-v2.md (ce document)
```

---

## 14. Plan de travail

| Phase | Contenu | Critère de sortie |
|---|---|---|
| 1. Circuits | Bibliothèques, `pay`, `access`, `withdraw` ; tests nargo positifs **et négatifs** (valeur hors bornes, mauvais nullifier, montant < prix, note marchand invalide) | Tous les tests passent ; revue des contraintes |
| 2. Contrats | Pool, registre, verifiers ; tests Hardhat avec de vraies preuves | Double dépense, racine inconnue et preuve falsifiée refusées |
| 3. Relayer + facilitateur | Soumission, frais, vérification `access` hors chaîne, challenge, limite de sessions | Parcours complet en local |
| 4. Front | Portefeuille de notes (chiffré + sauvegarde), dépôt, paiement, accès | Parcours complet sur Base Sepolia |
| 5. Durcissement | Mesures de gas, OHTTP, ensembles d'association, audit externe des circuits et contrats | Rapport d'audit ; aucune valeur réelle avant |

---

## 15. Risques principaux

1. **Circuit sous-contraint** : le pire risque (création de valeur, accès gratuit). Tests
   négatifs systématiques et audit spécialisé ZK obligatoires.
2. **Perte des notes** par le lecteur : sauvegarde déterministe dérivée de la phrase de récupération.
3. **Ensemble d'anonymat faible** tant que l'usage est limité : l'afficher dans l'UI.
4. **Temps de preuve** dans le navigateur (quelques secondes) et coût de vérification on-chain :
   à mesurer tôt (phase 1-2).
5. **Réglementation** : cf. § 11 ; rester sur testnet sans cadre clair.
