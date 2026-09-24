# Phase 0 de S1 (dark pool FHE) — coût d'un lot d'ordres chiffrés (24 septembre 2026)

> **Question** : un lot d'ordres chiffrés peut-il être apparié par CoFHE sur Base à un coût et avec
> une latence acceptables ?
>
> **Critère fixé** ([`idees-nouvelles-base-7.md`](idees-nouvelles-base-7.md)) : un lot de 16 ordres
> réglé en **moins de 60 s**, pour **moins de 1 $ par ordre**.

## Ce qui a été construit
- **Contrat** [`SealedBatchPool.sol`](../packages/contracts/contracts/SealedBatchPool.sol) :
  - ordres chiffrés (sens en `ebool`, quantité en `euint64`) ;
  - croisement par lots au prix médian (prix en clair, fourni par un oracle ou l'opérateur) ;
  - exécution FIFO, soldes chiffrés, circuit constant (aucun branchement sur un chiffré) ;
  - règlement en plusieurs transactions (`settleStep`), pour respecter le plafond de gas par
    transaction.
- **Tests** ([`test/SealedBatchPool.ts`](../packages/contracts/test/SealedBatchPool.ts), mocks
  CoFHE) : **8 tests passent**, et les 23 tests du package aussi. Ils vérifient que :
  - le croisement FIFO est exact (acheteurs 30 + 50, vendeurs 40 + 10 → 50 croisés) et que les
    soldes sont conservés ;
  - un ordre non couvert par le solde n'est pas exécuté, sans revert (aucune fuite par échec) ;
  - chaque trader déchiffre **sa** propre exécution, mais **pas** celle des autres ;
  - un deuxième ordre du même trader dans un lot est refusé, pour empêcher d'engager deux fois le
    même solde ;
  - seul l'opérateur peut régler.
- **Mesure sur fork de Base Sepolia**
  ([`scripts/bench-fork.ts`](../packages/contracts/scripts/bench-fork.ts)) avec le **vrai
  TaskManager CoFHE** (`0xeA30…48D9`, déployé sur Base Sepolia). Aucune clé ni aucun fonds ne sont
  nécessaires.

## Résultats : gas (mesuré)

**Fork de Base Sepolia, vrai TaskManager :**

| Lot | Règlement total | **Règlement par ordre** | Soumission par ordre | Transactions de règlement | Maximum par transaction |
|---|---|---|---|---|---|
| 8 ordres | 7,7 M | **966 k** | 286 k | 4 (pas de 4) | 2,4 M |
| 16 ordres | 14,6 M | **913 k** | 282 k | 4 (pas de 8) | 4,6 M |
| 32 ordres | 29,0 M | **905 k** | 270 k | 8 (pas de 8) | 4,6 M |

- **Le coût est linéaire** : environ **0,9 M de gas par ordre** pour le règlement, et environ
  **1,2 M** en comptant la soumission.
- **À titre de comparaison**, les mocks donnent ~2,6 M par ordre : ils surestiment d'un facteur 3
  environ. C'est pourquoi la mesure sur fork compte.
- **La soumission est mesurée avec des chiffrés « triviaux »**, créés depuis un clair dans le
  contrat de mesure. La vérification d'une vraie preuve d'entrée (`asEuint64(externe, preuve)`)
  ajoutera un peu de gas.

## Conversion en dollars (Base mainnet, relevé le 24 septembre 2026)
- Prix du gas : **0,006 gwei**. Prix de l'ETH : **2 642 $**. Limite de gas d'un bloc : **400 M**.

| Scénario | Coût par ordre (soumission + règlement) |
|---|---|
| Gas actuel | **≈ 0,019 $** |
| Gas × 10 (congestion) | ≈ 0,19 $ |
| Gas × 100 (pic extrême) | ≈ 1,87 $ |

✅ **Critère de coût atteint avec une marge d'environ 50×** dans les conditions actuelles.

**Deux réserves** :
1. les **frais propres au coprocesseur CoFHE** sur mainnet (s'il y en a) ne sont pas inclus : **à
   demander à Fhenix** ;
2. les frais de données L1 d'une transaction Base s'ajoutent, mais ils sont faibles ici (calldata
   court).

**Capacité** : un lot de 32 ordres (règlement 29 M + soumissions 8,6 M ≈ 38 M) occupe environ 10 %
d'un bloc de Base. Le plafond de gas par transaction se respecte en réglant 8 ordres par
transaction (4,6 M chacune).

## Résultats : latence (NON mesurée)
- **Un fork ne peut pas mesurer la latence** : le calcul FHE est fait **hors chaîne** par le
  coprocesseur, qui observe la vraie chaîne. Il faut un déploiement réel sur Base Sepolia, donc une
  **clé testnet financée**. Aucune n'a été fournie, et je n'en ai pas inventé.
- **Ce qu'on sait déjà** :
  - **côté chaîne**, le règlement d'un lot de 16 ordres tient en 4 transactions, soit un ou deux
    blocs (2 à 4 s) ;
  - **aucun déchiffrement n'est nécessaire pour régler** : les soldes restent chiffrés. Le
    déchiffrement n'intervient que pour que chacun lise son exécution (`decryptForView`, hors
    chaîne) ou pour un retrait ;
  - **côté coprocesseur**, le chemin critique est **séquentiel** : totaux cumulés, puis restes FIFO.
    Il compte environ 5 opérations dépendantes par ordre, soit **~80 pour 16 ordres**. Les
    opérations indépendantes (`mul`, `gte`) peuvent tourner en parallèle.
- **Estimation, à confirmer** : 5 à 10 s si le coprocesseur parallélise les branches
  indépendantes, jusqu'à environ 60 s s'il exécute tout en série. Hypothèse : de l'ordre de 100 à
  200 ms par opération 64 bits en TFHE sur CPU, un ordre de grandeur qu'il faut vérifier sur la
  vraie infrastructure.
- **Si c'est trop lent**, deux leviers :
  - des lots plus petits (8 ordres, par paire) ;
  - remplacer le FIFO séquentiel par un calcul au prorata. C'est plus parallèle, mais il faut une
    division chiffrée, qui est plus coûteuse.

## Verdict

| Critère | Résultat |
|---|---|
| Coût < 1 $ par ordre | ✅ **≈ 0,02 $** (mesuré sur fork, gas actuel de Base mainnet) |
| Lot de 16 réglé en < 60 s | ⏳ **Non mesuré.** Côté chaîne ≈ 2 à 4 s ; côté coprocesseur, estimé de 5 à 60 s |
| Logique d'appariement correcte et confidentielle | ✅ 8 tests sur mocks |

**L'idée S1 passe la moitié « coût » de la phase 0 avec une large marge.** Le risque restant est la
**latence du coprocesseur**. Pour la mesurer :
1. fournir une clé Base Sepolia financée (dans `.env`, jamais commitée) ;
2. déployer `SealedBatchPool` ;
3. soumettre 16 vrais ordres chiffrés (`encryptInputs`) ;
4. chronométrer le délai jusqu'à ce que chaque trader puisse déchiffrer son exécution
   (`decryptForView`).

## Reproduire
```bash
cd packages/contracts
npx hardhat test test/SealedBatchPool.ts                                   # correction + gas des mocks
FORK_URL=https://sepolia.base.org SIZES=8,16,32 STEP=8 npx hardhat run scripts/bench-fork.ts   # gas réel
```
