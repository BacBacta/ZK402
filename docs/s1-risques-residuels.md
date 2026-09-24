# S1 — Mesures et risques résiduels (état au 24 septembre 2026, incréments 1 et 2)

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

## 1 bis. Ce que l'incrément 2 a livré

| Problème | Livré | Preuve / test |
|---|---|---|
| **R4** Pyth périmé ou indisponible | **3ᵉ oracle : API3** (Api3ReaderProxyV1 ETH/USD `0x5b0c…d473`, vérifié on-chain). Règle **2 sur 3** + médiane | Tests : source aberrante écartée, fonctionnement à 2 sources, 6 causes de report. **Base Sepolia** : 2 lots réels réglés au prix Chainlink + API3 (Pyth périmé écarté), exécutions exactes (7 et 7), contrat `0x79555beB3a5D1a87e38aB4CE21DCdC0a948aBf04` |
| **R5** Choix du moment de déclenchement | Prix évalué **à l'instant de clôture t_k** : indice de round Chainlink vérifié (revert s'il est faux), API3 et Pyth-stocké acceptés seulement si datés ≤ t_k, Pyth poussé = première publication dans [t_k, t_k + 60 s] | Tests : oracles +50 % après la clôture → pas pris en compte ; indice trop ancien ou trop récent → revert ; mise à jour Pyth hors fenêtre ignorée. **Résidu R5′ ≤ maxDeviationBps / 2** (0,5 %) |
| **Intégrité arithmétique** (nouveau, trouvé par l'analyse formelle) | Faille de **création monétaire par rebouclage de q·prix** (euint64 modulo 2⁶⁴) **démontrée** sur la v1 (solde de l'attaquant ≈ 1,8 × 10¹⁹) et **corrigée** en v2 : `MAX_QTY = 10¹²` (contrôle chiffré), `MAX_POOL_PRICE = 10⁶` | Test d'attaque v1 (réussit) et v2 (échoue). Halmos retrouve seul des contre-exemples sur le modèle non corrigé. v2 corrigée redéployée : `0xb482aEBd8A35Ef7E329642bF2bf0A56AC683c14B` |
| **R12** Vérification formelle | Modèle opération par opération du circuit (`packages/formal/src/AllocationModel.sol`, sémantique euint64 exacte), vérifié par **Halmos** pour **toutes** les entrées | Voir le tableau ci-dessous |

**Résultats de la vérification formelle** (version corrigée ; lots de 3 ordres de 3 traders pour les propriétés globales, un ordre quelconque pour les lemmes) :

| Propriété | Méthode | Résultat |
|---|---|---|
| Volume acheté exécuté = volume vendu exécuté | globale | ✅ prouvé |
| L'acheteur paie exactement fill × prix | globale | ✅ prouvé |
| Conservation de BASE | globale | ✅ prouvé |
| Aucun solde BASE rebouclé | globale | ✅ prouvé |
| Conservation de QUOTE | globale | ⏱ délai dépassé (multiplications 64 bits) → **preuve par lemmes** ci-dessous |
| L2 : coût fill × prix exact (pas de rebouclage) | lemme | ✅ prouvé |
| L5 : un ordre retenu est exactement couvert ; eff ∈ {0, q} | lemme | ✅ prouvé |
| L3 : acheteur : QUOTE −fill·p exact, BASE +fill | lemme | ✅ prouvé |
| L4 : vendeur : BASE −fill, QUOTE +fill·p exact (hypothèse : QUOTE < 2⁶², comme les preuves globales) | lemme | ✅ prouvé |

**Conclusion** : la conservation de QUOTE est **établie par composition** des lemmes L2 à L5
(tous prouvés) et de l'égalité Σfb = Σfs (prouvée). **Composition** : comme L2 à L5 tiennent, chaque mise à jour de solde est exacte (sans rebouclage) ;
donc ΣQUOTE' = ΣQUOTE − p·Σfb + p·Σfs = ΣQUOTE, puisque Σfb = Σfs (prouvé).

**Limites de la preuve** :
- elle porte sur le **modèle** du circuit, pas sur le bytecode FHE lui-même ; la correspondance
  modèle ↔ contrat est ligne à ligne et **vérifiée empiriquement** (80 scénarios aléatoires) ;
- elle suppose l'offre totale bornée (< 2⁶²), ce que garantiront les réserves réelles (P4) ;
- les propriétés globales sont prouvées pour 3 ordres (déroulement de boucle borné) ; les lemmes,
  eux, valent pour n'importe quel ordre, donc pour tout N par induction sur les ordres.

## 2. Risques résiduels (ce qui n'est PAS résolu)

| # | Risque | Pourquoi ce n'est pas résolu | Borne actuelle | Condition de réouverture / plan |
|---|---|---|---|---|
| R1 | **Déchiffreur unique (Teecryptor, un seul TEE Intel TDX)** : s'il est compromis, tous les ordres sont lisibles | Hors de portée de tout protocole construit sur CoFHE : le déchiffreur détient la clé complète | Aucune borne cryptographique sur la confidentialité. **Fonds** : aucun chemin v2 ne dépend d'un clair signé | Migrer vers le réseau de seuil de Fhenix dès qu'il fournit des preuves de déchiffrement correct vérifiables. Réévaluer Zama (seuil MPC) comme alternative |
| R2 | **Métadonnées** L1 à L4, L6, L11 (qui, quand, combien d'ordres) | P1 est spécifié, pas implémenté | Le contenu des ordres reste caché ; l'identité et le moment ne le sont pas | **Incrément 2** : pool blindé Noir + pseudonymes + lots de taille fixe |
| R3 | **Le moment de soumission** est visible | **Inhérent** à une chaîne publique | Avec une allocation au prorata (P3), ce moment n'a plus d'effet économique | Incrément 3 (P3) |
| R4 | ~~Pyth périmé, API Hermes sous clé~~ | **Résolu (incrément 2)** : règle 2 sur 3 avec API3. Pyth reste utilisable si quelqu'un pousse une mise à jour signée | Vivacité assurée par Chainlink + API3 | Clé Hermes optionnelle pour réactiver Pyth |
| R5 | ~~Choix du moment de déclenchement~~ | **Résolu (incrément 2)** : prix évalué à t_k | Résidu R5′ : le déclencheur peut influer sur la validité d'API3 ou de Pyth-stocké → **≤ 0,5 %** du prix | Supprimable avec un historique on-chain pour API3 ou avec des mises à jour Pyth datées |
| R6 | **Censure par le séquenceur de Base** ≤ 12 h | Inhérent à Base (séquenceur centralisé, inclusion forcée L1) | Pas de perte : les ordres restent dans leur lot | Documenté ; aucune échéance dure côté trader |
| R7 | **Latence qui croît avec la taille du lot** (≈ 1,5 s par ordre, FIFO séquentiel) | P3 non traité | 39,8 s pour 16 ordres (mesuré) | Incrément 3 : allocation parallèle |
| R8 | **Crédits de démo**, pas d'actifs réels ; frais CoFHE mainnet inconnus | P4 non traité | — | Incrément 4 : FHERC20 ou ERC-7984 (brouillon), retraits en deux temps + disjoncteur |
| R9 | **Liquidité** | P5 non traité | — | Incrément 5 : simulation sur les flux des agents de Base |
| R10 | **Conformité** | P6 non traité | — | Incrément 6 : preuves ZK côté utilisateur, sans clé tierce |
| R11 | **Parasitage de lot** : remplir les 64 places d'ordres parasites | Une identité = un ordre, mais les identités ne coûtent rien | Coût ≈ 1,2 M de gas par place (≈ 0,02 $) : **faible** | Incrément 2 : frais de soumission et/ou note du pool blindé avec solde minimal |
| R12 | ~~Pas de vérification formelle~~ | **Traité (incrément 2)** sur le modèle du circuit (Halmos) | Correspondance modèle ↔ contrat vérifiée par tests, pas par preuve | Plus tard : équivalence prouvée (génération du contrat depuis le modèle, ou vérification du bytecode) |
| R13 | **v1 vulnérable** (rebouclage) déployée sur Base Sepolia (crédits de démo uniquement) | Prototype de mesure | Aucun fonds réel ; contrat marqué « ne pas réutiliser » | Ne jamais réutiliser la v1 |
| R14 | v2 `0x7955…Bf04` déployée **avant** le correctif anti-rebouclage | Historique | Crédits de démo uniquement | Utiliser `0xb482…c14B` (corrigée) |

## 3. Écarts constatés entre la documentation et la réalité (à retenir)

- La documentation de Fhenix présentait le « Threshold Network » comme le déchiffreur. La PR n° 73
  (3 septembre 2026) a corrigé : c'est **Teecryptor** (TEE unique). Toute analyse antérieure qui
  supposait un seuil t-sur-n est **fausse**.
- L'estimation de gas des nœuds Base sous-évalue les appels au TaskManager CoFHE : il faut des
  plafonds explicites.
- Le SDK `@cofhe/sdk` échoue dans le processus Hardhat en réseau réel (connexion au vérifieur),
  mais fonctionne en script autonome.
