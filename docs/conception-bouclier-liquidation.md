# Bouclier — marché de prêt à positions chiffrées (FHE) sur Base

> **Statut** : proposition de conception, rien n'est implémenté. Idée N1 de
> [`nouvelles-idees-base.md`](nouvelles-idees-base.md).
>
> **En une phrase** : emprunter de l'USDC contre du bitcoin **sans que personne ne connaisse ton prix
> de liquidation**. Le contrat vérifie la santé de ton prêt sur des valeurs chiffrées et ne révèle
> qu'un « oui, liquidable » au moment où c'est vrai.

---

## 1. Le problème

Sur un marché de prêt public (Morpho, Aave…), chaque position expose son collatéral, sa dette et donc
son **prix de liquidation exact**.

- **Chasse aux liquidations** : un acteur qui connaît un amas de liquidations à 58 200 $ a intérêt à
  pousser le prix jusque-là, surtout sur des marchés peu profonds ou en période de stress.
- **Ciblage des grosses positions** : les baleines sont suivies et leurs seuils sont connus.
- **Exposition patrimoniale** : l'emprunteur révèle son levier et sa fortune.

**Taille du marché visé** : les prêts adossés au bitcoin de Coinbase via Morpho sur Base, soit
~3,62 Md$ de collatéral, ~1,57 Md$ prêtés, ~53 000 emprunteurs (mi-septembre 2026), avec des
liquidations record en février 2026.

**Ce que le bouclier empêche, et ce qu'il n'empêche pas** : il empêche le **ciblage** (connaître qui
tombe à quel prix). Il n'empêche **pas** les liquidations dues à une vraie baisse du marché.

---

## 2. Principes de conception

1. **Marché isolé** à la Morpho : un actif en collatéral (cbBTC), un actif prêté (USDC), un oracle
   (Chainlink BTC/USD), un LLTV fixe.
2. **Positions chiffrées, agrégats publics** : collatéral et dette de chaque emprunteur sont chiffrés
   (FHE). Les totaux du marché (dépôts, emprunts, utilisation, taux) restent publics, car les
   prêteurs en ont besoin et ils ne révèlent rien d'individuel.
3. **Aucun branchement sur une valeur chiffrée** (règles du fhenix-toolkit) : un emprunt excessif
   n'échoue pas, il est ramené à 0 par `FHE.select`.
4. **Révéler le minimum, au dernier moment** : 1 bit (« liquidable ? ») à chaque vérification, et la
   position complète **seulement** quand elle est effectivement liquidable.
5. **Confidentialité aussi aux bords** : les entrées et sorties passent par des jetons confidentiels
   (ERC-7984) pour que les montants ne fuient pas lors des transferts.

---

## 3. Architecture

```
  Emprunteur                                     Prêteurs
  cbBTC ──wrap──► cBTC (ERC-7984, solde chiffré)  USDC ──deposit──► pool (public, parts de prêteur)
                      │ supplyCollateral(enc)                         │
                      ▼                                               ▼
  ┌──────────────────────────── ShieldMarket (Base) ─────────────────────────────┐
  │ par emprunteur : collat (euint64, chiffré), parts de dette (euint128, chiffré)│
  │ agrégats publics : totalBorrowAssets, totalBorrowShares, totalSupply, taux   │
  │ index de dette public I = totalBorrowAssets / totalBorrowShares (virgule fixe)│
  │ oracle Chainlink BTC/USD (public)                                            │
  └───────▲───────────────────────────────┬──────────────────────────────────────┘
          │ borrow(enc) → cUSDC            │ checkHealth(emprunteurs[]) par des keepers
          │                                ▼
   cUSDC ──unwrap (plus tard)──► USDC    ebool « liquidable » → déchiffré par le réseau de seuil
                                          → si vrai : révélation de la position → liquidation publique
```

---

## 4. Modèle de données et arithmétique chiffrée

### 4.1 Représentation
| Variable | Type | Unité |
|---|---|---|
| `collat[u]` | `euint64` | satoshis (8 déc.) : 21 M BTC < 2⁵¹ |
| `debtShares[u]` | `euint128` | parts de dette (modèle Morpho : la dette croît via l'index, pas via les parts) |
| `I` | `uint256` public | index de dette en virgule fixe (ex. 2⁶⁴ = 1,0) |
| `P` | `uint256` public | prix BTC en micro-USDC par satoshi, mis à l'échelle (virgule fixe) |
| `LLTV` | constante | ex. 7 700 pb (plus prudent que 86 %, cf. § 8) |

### 4.2 Test de santé sans division chiffrée
La division chiffrée est très coûteuse ; la multiplication par une **constante publique** l'est
beaucoup moins, et les décalages (`FHE.shr`) sont bon marché. On calcule :

```
dette      = (debtShares × I) >> 64                  // I public : multiplication par un clair
capacité   = (collat × ⌊P × LLTV / 10 000⌋) >> k     // P et LLTV publics, pré-multipliés en clair
liquidable = FHE.lt(capacité, dette)                  // ebool
```

- Tous les produits restent sous 2¹²⁸ grâce aux échelles choisies (à borner formellement dans la
  spécification, avec des tests aux valeurs extrêmes).
- **Coût** : 2 multiplications par un clair, 2 décalages, 1 comparaison par position et par
  vérification.

### 4.3 Opérations utilisateur (toutes à entrée chiffrée)
| Opération | Logique (sans `require` sur le chiffré) |
|---|---|
| `supplyCollateral(encAmt)` | Transfert confidentiel cBTC → marché ; `collat += reçu` (on utilise le montant **effectivement reçu** renvoyé par le jeton, qui peut être 0). |
| `borrow(encAmt)` | `ok = santéAprès(collat, dette + encAmt)` ; `montant = select(ok, encAmt, 0)` ; parts += montant / I (voir 4.4) ; transfert confidentiel cUSDC. Agrégats publics mis à jour **par lots** (§ 5.3). |
| `repay(encAmt)` | `montant = min(encAmt, dette)` ; parts −= … ; transfert cUSDC entrant. |
| `withdrawCollateral(encAmt)` | `ok = santéAprès(collat − encAmt, dette)` ; `montant = select(ok, encAmt, 0)`. |

### 4.4 Conversion montant → parts
`parts = montant / I` demanderait une division chiffrée. Parade : **l'utilisateur fournit les parts**
en entrée chiffrée (calcul fait en clair dans son navigateur, où il connaît `montant` et `I`), et le
contrat vérifie par multiplication :
`ok = (parts × I) >> 64 ≥ montant` (arrondi en faveur du protocole), puis `select`.

---

## 5. Liquidation

### 5.1 Vérification de santé (ouverte à tous, payée par l'appelant)
```
checkHealth(address[] emprunteurs)
  pour chaque u :
    si le prix a bougé de moins de Δ = 0,5 % depuis le dernier check de u, et depuis moins de T = 10 min → ignorer
    flag[u] = liquidable(u) ; FHE.allowPublic(flag[u])      // 1 bit publiable
```
La limitation « Δ ou T » borne le nombre de bits révélés par position (§ 7).

### 5.2 Déroulé (deux déchiffrements asynchrones)
1. Le keeper récupère `flag[u]` et le fait déchiffrer par le réseau de seuil
   (`decryptForTx(...).withoutACP()`), ce qui donne `(valeur, signature)`.
2. `reveal(u, valeur, signature)` : le contrat vérifie la signature du résultat. **Si `faux`**, rien
   d'autre ne se passe. **Si `vrai`**, `allowPublic(collat[u])` et `allowPublic(debtShares[u])`.
3. Le keeper fait déchiffrer les deux valeurs, puis appelle `liquidate(u, collat, parts, signatures,
   montantRembourse)`.
4. Le contrat vérifie les signatures, **recalcule la santé en clair au prix courant** (le prix a pu
   remonter entre-temps), puis exécute une liquidation classique : remboursement en USDC, saisie de
   `collatéral × bonus` (formule de Morpho `min(1,15 ; 1/(0,3·LLTV + 0,7))`, soit ~7 % pour un LLTV de 77 %).

### 5.3 Conséquences assumées
- **Une position révélée reste révélée** (`allowPublic` est irréversible). Si le prix remonte avant la
  liquidation, l'emprunteur perd sa confidentialité passée. Il la retrouve pour les montants futurs,
  mais un observateur connaît alors son point de départ.
- **Latence** : deux allers-retours vers le réseau de seuil (quelques secondes chacun sur testnet ;
  à mesurer). D'où un LLTV plus prudent que celui de Morpho (§ 8).

---

## 6. Confidentialité aux bords : les jetons confidentiels

| Bord | Fuite sans précaution | Parade |
|---|---|---|
| Dépôt de collatéral | Montant de cbBTC visible au *wrap* | Le *wrap* en cBTC est découplé dans le temps de l'utilisation ; wrap en coupures rondes ; un solde cBTC peut servir à plusieurs actions |
| Emprunt | USDC sortant visible | Le prêt est versé en **cUSDC** (solde chiffré) ; *unwrap* plus tard, en montants arrondis |
| Remboursement | USDC entrant visible | Remboursement en cUSDC |
| Identité de l'emprunteur | Visible (adresse qui agit) | Assumé : le bouclier cache les **montants et seuils**, pas **qui** emprunte. Combinable avec un wallet frais financé via Hinkal. |

Jetons : wrappers ERC-7984 (norme OpenZeppelin/Zama) ou FHERC20 de Fhenix selon la pile retenue (D1).

---

## 7. Ce qui fuit encore (budget de fuite)

1. **1 bit par vérification** : « sain au prix P ». Suite de réponses « sain » quand le prix baisse
   → l'observateur apprend « le seuil est sous P ». Borné par la limitation Δ/T : environ 144
   vérifications par jour au rythme T, davantage seulement lors de fortes variations, et la plupart
   ne disent que « sain ». **Le seuil n'est révélé qu'au moment où il est franchi.**
2. **Agrégats publics** : un emprunt de 5 M$ fait bouger `totalBorrowAssets` de 5 M$. Parade :
   mise à jour des agrégats **par lots** (toutes les N minutes, somme chiffrée puis déchiffrée), qui
   noie les opérations individuelles dans le lot.
3. **Bords** (§ 6) et **identité** : visibles par conception.
4. **Gas** : les opérations FHE ont un coût quasi constant, indépendant des montants.

---

## 8. Risques et garde-fous

| Risque | Garde-fou |
|---|---|
| **Liveness du réseau de seuil** : sans déchiffrement, aucune liquidation n'est possible, donc **créances irrécouvrables** | LLTV prudent (≈ 77 % contre 86 % chez Morpho), plafond de TVL au lancement, fonds de réserve financé par une part des intérêts, gel des nouveaux emprunts si le réseau ne répond plus depuis X minutes |
| Latence de liquidation (deux déchiffrements) | LLTV prudent ; bonus de liquidation suffisant ; keepers multiples |
| Débordement arithmétique chiffré | Bornes formelles sur les échelles ; plafond par position ; tests aux valeurs extrêmes |
| Spam de `checkHealth` | Payé par l'appelant ; limitation Δ/T ; seuls les checks utiles sont récompensés (par le bonus) |
| Oracle | Chainlink BTC/USD avec contrôle de fraîcheur, comme Morpho |
| Confiance cryptographique | CoFHE : réseau de seuil au **Stage 1**. Inco Lightning : **TEE** (confiance matérielle). À dire clairement aux utilisateurs. |
| Circuit sous-contraint / logique FHE | Tests des deux branches de chaque `select`, tests multi-transactions (ACL), audit spécialisé FHE |

---

## 9. Pile technique et maturité

| Option | Base mainnet | Confiance | Usage |
|---|---|---|---|
| **Fhenix CoFHE** | Testnet (mainnet annoncé fin 2026) | Réseau de seuil (Stage 1) | **Prototype** : on a déjà la chaîne d'outils dans ce dépôt (v1) |
| **Inco Lightning** | En production d'après Inco (à confirmer) | TEE | Pilote mainnet possible si l'on accepte la confiance matérielle |
| Zama | Présence sur Base non confirmée | Réseau de seuil + coprocesseurs | À surveiller |

---

## 10. Go-to-market

- **Cible 1** : emprunteurs importants (> 100 k$) pour qui le ciblage coûte cher, et fonds et trésoreries
  qui empruntent contre du BTC.
- **Cible 2** : intégrateurs (wallets, néo-banques crypto) qui veulent proposer un « prêt discret ».
- **Liquidité prêteuse** : rendement légèrement supérieur à Morpho pour compenser un LLTV plus prudent
  et le risque technique ; plafonds progressifs.
- **Partenariat possible** : Morpho (marché hors du standard Morpho Blue, mais complémentaire),
  Coinbase (canal de distribution des prêts BTC).

---

## 11. Plan

| Phase | Livrable | Critère de sortie |
|---|---|---|
| 0. Validation | Entretiens avec 10 gros emprunteurs ou desks ; avis de Morpho | Intérêt confirmé ; LLTV acceptable pour eux |
| 1. Prototype (Base Sepolia, CoFHE) | Wrappers cBTC et cUSDC, `ShieldMarket`, keeper, tests Hardhat mocks | Emprunt, remboursement, check, révélation, liquidation de bout en bout |
| 2. Mesures | Gas, latence des deux déchiffrements, débit de checks | Latence compatible avec le LLTV choisi |
| 3. Durcissement | Budget de fuite chiffré, lots d'agrégats, réserve, audit | Rapport d'audit |
| 4. Pilote mainnet | Selon la pile disponible (CoFHE mainnet ou Inco) avec plafonds bas | Premier marché cbBTC/USDC |

---

## 12. Décisions ouvertes

| # | Question | Recommandation |
|---|---|---|
| D1 | Pile FHE : CoFHE ou Inco | Prototype CoFHE ; mainnet selon disponibilité et acceptation de la confiance TEE |
| D2 | LLTV | ~77 %, à ajuster après mesure de latence |
| D3 | Paramètres Δ / T de vérification | 0,5 % / 10 min |
| D4 | Agrégats par lots | Oui, toutes les 10 min |
| D5 | Versement en cUSDC obligatoire | Oui (sinon le montant emprunté fuit au versement) |

## Sources

- Prêts bitcoin Coinbase × Morpho (volumes, seuil 86 %) :
  https://www.theblock.co/news/defi/2026-09-22-coinbase-fixed-rate-bitcoin-loans-morpho-midnight-416050 ;
  https://decrypt.co/379091/borrow-against-bitcoin-fixed-rate-coinbase-morpho
- Règles FHE (select, ACL, pas de division chiffrée) : fhenix-toolkit ; flux de déchiffrement public :
  `cofhe-hardhat-starter` (utilisé en v1 dans ce dépôt)
- ERC-7984 : https://docs.openzeppelin.com/confidential-contracts/token
- Inco Lightning sur Base :
  https://mpost.io/inco-lightning-launches-on-base-expanding-smart-contract-privacy-with-encrypted-computation-and-data-protection/
