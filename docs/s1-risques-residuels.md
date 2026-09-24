# S1 — Mesures et risques résiduels (état au 24 septembre 2026, incrément 1)

> Livrables 5 et 6 du programme [`prompt-s1-points-ouverts.md`](prompt-s1-points-ouverts.md).
> Modèle de menaces : [`s1-modele-menaces.md`](s1-modele-menaces.md). Spécification :
> [`s1-specification.md`](s1-specification.md).

## 1. Ce que l'incrément 1 a livré

| Problème | Livré | Preuve / test |
|---|---|---|
| **P7** Pouvoir de l'opérateur | `SealedBatchPoolV2.sol` : **aucun rôle** ; lots à échéance on-chain ; `startSettlement` et `settleStep` **sans permission** ; lots réglés strictement dans l'ordre ; un lot vide est passé | Tests : ABI sans fonction privilégiée ; règlement par un compte quelconque ; refus avant échéance ; ordre des lots |
| **P2.a** Oracle | Règle publique R : Chainlink (prix > 0, round complet, ancienneté) + Pyth (ancienneté, confiance), écart ≤ `maxDeviationBps` (plafonné à 10 % par construction), prix = moyenne ; **report** du lot si la règle échoue ; mise à jour Pyth poussée par le déclencheur, excédent remboursé | 6 tests de report (un par cause) ; test du prix moyen ; test du remboursement. **Sur Base Sepolia** (`0x6cA6cb91D942c002Ff57A39411F7dF5c5436af07`) : Chainlink lu (2 688,02 $), Pyth périmé → `reason = 3`, donc lot **reporté** et non réglé |
| **P2.b** Sûreté des fonds vs déchiffreur | Aucun chemin de v2 ne transfère des fonds sur la base d'un clair signé. Mécanisme de retrait (délai + disjoncteur de débit) **spécifié** pour P4 | Revue du code ; spécification § P2.b |
| **Exactitude et conservation** | Invariants : conservation de BASE et de QUOTE, exécutions identiques au modèle de référence FIFO, pas d'exécution au-delà de la couverture, pas de solde négatif | **80 scénarios aléatoires** (2 à 8 traders, 1 à 2 lots, ordres couverts ou non, pas de règlement aléatoire) : 80/80. Suite complète : 48 tests, tous passants |
| **P1** Métadonnées | Inventaire L1 à L11 ; définition IND-META ; construction retenue (pool blindé + pseudonymes + lots de taille fixe) | Spécification § P1 (**pas encore implémenté**) |

## 2. Risques résiduels (ce qui n'est PAS résolu)

| # | Risque | Pourquoi ce n'est pas résolu | Borne actuelle | Condition de réouverture / plan |
|---|---|---|---|---|
| R1 | **Déchiffreur unique (Teecryptor, un seul TEE Intel TDX)** : s'il est compromis, tous les ordres sont lisibles | Hors de portée de tout protocole construit sur CoFHE : le déchiffreur détient la clé complète | Aucune borne cryptographique sur la confidentialité. **Fonds** : aucun chemin v2 ne dépend d'un clair signé | Migrer vers le réseau de seuil de Fhenix dès qu'il fournit des preuves de déchiffrement correct vérifiables. Réévaluer Zama (seuil MPC) comme alternative |
| R2 | **Métadonnées** L1 à L4, L6, L11 (qui, quand, combien d'ordres) | P1 est spécifié, pas implémenté | Le contenu des ordres reste caché ; l'identité et le moment ne le sont pas | **Incrément 2** : pool blindé Noir + pseudonymes + lots de taille fixe |
| R3 | **Le moment de soumission** est visible | **Inhérent** à une chaîne publique | Avec une allocation au prorata (P3), ce moment n'a plus d'effet économique | Incrément 3 (P3) |
| R4 | **Pyth sur Base Sepolia est périmé** (≈ 15 jours) et l'API Hermes exige une **clé** (401) | Dépendance externe | Les lots sont **reportés**, jamais réglés à un mauvais prix : sûreté préservée, vivacité perdue | Obtenir une clé Hermes (action humaine) **ou** ajouter une 3e source et passer la règle en « 2 sur 3 » |
| R5 | **Choix du bloc de déclenchement** dans [t_k, t_k + Δ] | Le prix est lu au moment du déclenchement | Borné par la volatilité sur Δ et par l'écart maximal entre oracles | Incrément 2 : prix **figé à t_k** via l'historique des rounds Chainlink |
| R6 | **Censure par le séquenceur de Base** ≤ 12 h | Inhérent à Base (séquenceur centralisé, inclusion forcée L1) | Pas de perte : les ordres restent dans leur lot | Documenté ; aucune échéance dure côté trader |
| R7 | **Latence qui croît avec la taille du lot** (≈ 1,5 s par ordre, FIFO séquentiel) | P3 non traité | 39,8 s pour 16 ordres (mesuré) | Incrément 3 : allocation parallèle |
| R8 | **Crédits de démo**, pas d'actifs réels ; frais CoFHE mainnet inconnus | P4 non traité | — | Incrément 4 : FHERC20 ou ERC-7984 (brouillon), retraits en deux temps + disjoncteur |
| R9 | **Liquidité** | P5 non traité | — | Incrément 5 : simulation sur les flux des agents de Base |
| R10 | **Conformité** | P6 non traité | — | Incrément 6 : preuves ZK côté utilisateur, sans clé tierce |
| R11 | **Parasitage de lot** : remplir les 64 places d'ordres parasites | Une identité = un ordre, mais les identités ne coûtent rien | Coût ≈ 1,2 M de gas par place (≈ 0,02 $) : **faible** | Incrément 2 : frais de soumission et/ou note du pool blindé avec solde minimal |
| R12 | **Pas de vérification formelle** (Certora, Halmos) ; les tests de propriétés tournent sur des mocks | Pas encore fait | 80 scénarios aléatoires + tests ciblés | Incrément 2 : invariants de conservation en vérification formelle |

## 3. Écarts constatés entre la documentation et la réalité (à retenir)

- La documentation de Fhenix présentait le « Threshold Network » comme le déchiffreur. La PR n° 73
  (3 septembre 2026) a corrigé : c'est **Teecryptor** (TEE unique). Toute analyse antérieure qui
  supposait un seuil t-sur-n est **fausse**.
- L'estimation de gas des nœuds Base sous-évalue les appels au TaskManager CoFHE : il faut des
  plafonds explicites.
- Le SDK `@cofhe/sdk` échoue dans le processus Hardhat en réseau réel (connexion au vérifieur),
  mais fonctionne en script autonome.
