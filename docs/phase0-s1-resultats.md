# Phase 0 de S1 (dark pool FHE) — coût et latence d'un lot d'ordres chiffrés (24 septembre 2026)

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

## Résultats : latence (MESURÉE sur Base Sepolia, 24 septembre 2026)

Déploiement réel : contrat `0x66f39612c36ff13da8909119b2a1d7c60c752e95` sur Base Sepolia.
16 traders distincts ; les ordres ont été chiffrés avec `@cofhe/sdk` et le vrai vérifieur Fhenix,
puis appariés par le vrai coprocesseur CoFHE. Script :
[`scripts/latency-standalone.ts`](../packages/contracts/scripts/latency-standalone.ts) ; résultats
bruts : [`deployments/latency-base-sepolia.json`](../packages/contracts/deployments/latency-base-sepolia.json).

| Étape | Mesure (lot de 16 ordres) |
|---|---|
| Chiffrement d'un ordre côté trader (2 entrées + preuves + vérifieur) | **≈ 27 s** par ordre (entre 26 et 29 s), fait **avant** le lot |
| Soumission d'un ordre | 290 k de gas (vraie vérification d'entrée comprise) |
| Règlement on-chain | **3,9 s**, 5 transactions, 14,7 M de gas au total (916 k par ordre, comme sur le fork) |
| Délai entre la fin du règlement et le moment où le trader **lit son exécution** | premier **16,8 s** · médiane **31,1 s** · p90 38,5 s · **dernier 39,8 s** |
| Exactitude | ✅ 16/16. Les 8 acheteurs (96 unités) sont exécutés en entier ; côté vendeurs, FIFO 6, 8, 10, 12, 14, 16, 18, puis **12** pour le dernier (le reste non croisé). C'est exactement le résultat attendu |

**Observations** :
- **Le délai croît de façon quasi linéaire** avec le rang de l'ordre, d'environ 1,5 s par ordre.
  C'est le chemin critique **séquentiel** prévu : les restes FIFO passent d'un ordre à l'autre, et le
  coprocesseur les calcule dans l'ordre.
- **Même avec 2 ordres, il faut 3 à 5,5 s.** C'est le coût fixe du calcul et du déchiffrement par le
  réseau de seuil.
- **Le chiffrement côté client (≈ 27 s) domine l'expérience du trader.** Il se fait avant l'envoi et ne
  retarde pas le lot, mais un agent doit anticiper. Cette mesure est faite dans un conteneur cloud :
  elle est à refaire sur un vrai poste ou un vrai serveur.

**Problèmes rencontrés et contournés (utiles pour la suite)** :
- dans le processus Hardhat, les appels du SDK vers le vérifieur échouaient par délai de connexion ;
  en script autonome (viem), ils passent ;
- l'estimation de gas du nœud **sous-évalue** les appels au TaskManager (un `settleStep` estimé à
  810 k a échoué à court de gas) : il faut des plafonds explicites.

## Verdict

| Critère | Résultat |
|---|---|
| Coût < 1 $ par ordre | ✅ **≈ 0,02 $** (gas mesuré sur Base Sepolia, converti au gas et au prix de l'ETH de Base mainnet) |
| Lot de 16 réglé en < 60 s | ✅ **39,8 s** jusqu'à la dernière exécution lisible, 31 s en médiane (le règlement on-chain seul prend 3,9 s) |
| Appariement correct et confidentiel | ✅ 16/16 sur le vrai réseau, et 8 tests sur mocks |

**S1 passe sa phase 0.** Les limites à traiter en phase 1 :
1. **La latence croît avec la taille du lot** (≈ 1,5 s par ordre). Au-delà d'environ 30 ordres, on
   dépasse la minute. Pistes :
   - des lots par paire, plafonnés à 16–24 ordres ;
   - remplacer le FIFO séquentiel par un calcul au prorata ou par arbre, plus parallèle.
2. **Chiffrement côté client ≈ 27 s** : à mesurer sur une vraie machine, et à préparer à l'avance
   (par exemple, les agents pré-chiffrent leurs ordres).
3. **Les frais de CoFHE sur mainnet** restent inconnus : à demander à Fhenix.

## Reproduire
```bash
cd packages/contracts
npx hardhat test test/SealedBatchPool.ts                                   # correction + gas des mocks
FORK_URL=https://sepolia.base.org SIZES=8,16,32 STEP=8 npx hardhat run scripts/bench-fork.ts   # gas réel
# latence réelle (clé Base Sepolia financée dans ../../.env, jamais commitée)
npx hardhat compile && set -a && . ../../.env && set +a
NODE_USE_ENV_PROXY=1 N=16 npx ts-node --transpile-only scripts/latency-standalone.ts
```
