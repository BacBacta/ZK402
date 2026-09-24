# Nouvelles idées ZK, série 4 — analyse approfondie

> Critère inchangé : lançable seul (les clients ne sont pas des partenaires), cryptographie open
> source. Domaines jamais explorés : distributions de jetons et programmes de points, assurance
> paramétrique, coffres à stratégie hors chaîne, preuves de localisation.

---

# K1 — « Scellé » : points et airdrops à formule scellée, calcul prouvé

## 1. Le problème, précisément

Les programmes de points et les airdrops ont un défaut structurel : **le projet est juge et partie**.

| Aujourd'hui | Conséquence |
|---|---|
| La formule reste **secrète** jusqu'à la distribution (pour ne pas être « farmée ») | Les utilisateurs participent « à l'aveugle » ; lassitude des points documentée en 2026 |
| Le projet calcule **hors chaîne**, puis publie une racine de Merkle | Personne ne peut vérifier que tout le monde a été traité selon la même règle |
| Les règles peuvent **changer en cours de route** (taux de conversion, exclusions) | Accusations d'exclusions ciblées, d'initiés favorisés, de changements rétroactifs |
| Les filtres anti-sybil doivent rester secrets | Mais leur secret rend toute contestation impossible |

Le succès de la distribution de Hyperliquid est d'ailleurs attribué à une distribution perçue comme
plus honnête que les systèmes de points opaques. Les projets de 2026 font face à des attentes plus
fortes de transparence.

**Concurrence vérifiée** :
- **Merkl** (référence sur Base) calcule les récompenses hors chaîne. Ses « campagnes privées »
  (février 2026) sont de la **confidentialité par obscurité** : la campagne est masquée de l'app et de
  l'API, sans preuve ni recours.
- Galxe, Layer3 et les scripts maison fonctionnent aussi sans preuve.

**Aucune solution à calcul prouvé trouvée.**

## 2. L'idée en une phrase

Le projet **scelle sa formule** (engagement cryptographique) **avant** la campagne, garde son contenu
secret pendant la campagne (anti-farming), puis **prouve en ZK** que chaque allocation résulte de
**cette** formule appliquée aux **vraies** données de Base. Il la **révèle** ensuite, sous peine de
perdre une caution.

On obtient les deux propriétés qui s'opposent aujourd'hui :
- **secret pendant** la campagne : les farmers ne connaissent pas les critères ;
- **impossible de tricher après** : pas de changement rétroactif, pas d'ajout manuel, même règle
  pour tous.

## 3. Mécanisme

```
 J0  Scellement          J0 → Jn  Campagne            Jn  Calcul prouvé             Jn+30  Révélation
 ─────────────           ────────────────            ──────────────────            ──────────────────
 commit(formule, sel)    activité normale             zkVM : évaluateur public      formule + sel publiés
 contraintes publiques   sur Base                     exécute la formule secrète    → n'importe qui
 caution de révélation   (formule inconnue)           sur le jeu de données D       recalcule tout
 pool P, plafonds                                     → racine des allocations      → caution rendue
                                                      → preuve vérifiée on-chain    (sinon : caution
                                                      → réclamations ouvertes        aux bénéficiaires)
```

### 3.1 Évaluateur public, formule privée
- Un **évaluateur** unique, open source et audité, compilé pour une zkVM (SP1 ou RISC Zero). Son code
  est public ; son identifiant (clé de vérification) est fixe.
- La **formule** est une **donnée d'entrée privée**, écrite dans un petit langage déclaratif :
  - **filtres** (contrats, événements, fenêtre temporelle) ;
  - **agrégats par wallet** (volume, nombre de jours actifs, durée de détention, montants apportés) ;
  - **règles anti-sybil** (âge minimal, seuils, regroupement par source de financement) ;
  - **transformations** (paliers, racines, logarithmes, plafonds) ;
  - **normalisation** vers le pool P.
- Sortie publique : `commit = H(formule ‖ sel)`. Elle doit égaler l'engagement publié au jour J0.

Pourquoi ce choix plutôt que « un programme zkVM par formule » : l'utilisateur n'a qu'un seul code
à auditer. Une fois révélée, la formule est lisible par un humain, et pas enfouie dans un binaire.

### 3.2 Contraintes publiques, vérifiées même quand la formule est secrète
Publiées au J0 et **vérifiées par le circuit** :
- `Σ allocations = P` (pas de jetons qui disparaissent ou apparaissent) ;
- plafond par wallet ;
- **liste d'exclusion déclarée** (équipe, trésorerie, market makers) : allocation nulle ;
- **allocations hors formule** (équipe, partenaires) : ligne séparée, publique, avec montant fixe.
  C'est la seule façon d'attribuer « à la main », et elle est visible par tous.

### 3.3 Le jeu de données D
- D = liste canonique des événements Base pertinents (événements des contrats ciblés, transferts pour
  l'anti-sybil) entre deux blocs.
- `racine(D)` est publiée. D est **entièrement reconstructible** par n'importe qui, puisque ce sont
  des données publiques de la chaîne, grâce à l'indexeur open source.
- **Contestation** : pendant une fenêtre, quiconque peut prouver qu'un événement manque ou est en
  trop (preuve d'inclusion de reçu contre un hash de bloc Base). Si la contestation réussit, la
  distribution est suspendue et le contestataire récompensé sur la caution.
- Évolution possible : prouver l'authenticité de D dans la zkVM elle-même (plus cher).

### 3.4 Distribution et révélation
- Le **contrat distributeur** vérifie la preuve (sortie : racine des allocations, `commit`,
  `racine(D)`, P, identifiant de campagne), puis ouvre les réclamations Merkle **standard**
  (compatible avec les interfaces existantes).
- **Caution de révélation** : à J+30 (paramètre), le projet publie formule et sel ; le contrat vérifie
  `H(formule ‖ sel) = commit`. Sinon, la caution est répartie entre les bénéficiaires. Un projet peut
  choisir de **ne jamais révéler** (pour garder ses filtres anti-sybil) : c'est alors affiché
  clairement (« formule scellée, non révélée »), et les garanties 3.2 tiennent toujours.

### 3.5 Programmes de points récurrents
- Une **saison** = un engagement de formule. Chaque semaine : preuve de l'époque, et racine des points
  cumulés.
- La formule **ne peut pas changer en cours de saison** : c'est la réponse directe aux changements
  rétroactifs de règles.
- La conversion points → jetons est elle-même scellée au début de la saison.

## 4. Ce que ça garantit, et ce que ça ne garantit pas

| Garanti | Non garanti |
|---|---|
| Même règle pour tous, fixée avant la campagne | Que la règle soit « juste » (visible seulement à la révélation, donc sanction de réputation) |
| Aucun ajout ou retrait manuel hors des lignes publiques | Les critères hors chaîne (Discord, KYC) : seulement via des jeux de données signés et engagés au J0, en faisant confiance au signataire |
| Somme exacte, plafonds, exclusions respectés | L'efficacité réelle des filtres anti-sybil |
| Données = vraie activité de Base (contestable) | — |

## 5. Faisabilité et coûts
- **Calcul prouvé** : quelques millions d'événements dans une zkVM, c'est des heures de GPU pour une
  distribution ponctuelle, acceptable. À mesurer sur un airdrop réel de Base (données publiques).
- **Vérification on-chain** : une preuve compacte (enveloppe Groth16), coût fixe.
- **Anti-sybil par graphe de financement** : c'est le module le plus coûteux ; il peut être
  pré-calculé et engagé comme un sous-jeu de données contestable.

## 6. Modèle économique
- **Clients** : tout projet de Base qui lance un jeton ou un programme de points. Ce ne sont pas des
  partenaires : ils achètent un service.
- **Tarification** : forfait par campagne ou petit pourcentage de la distribution, plus un hébergement
  optionnel du calcul.
- **Évaluateur open source** : la confiance repose sur le code public ; la valeur vendue est l'outil
  (langage de formules, simulateur, indexeur, calcul, interface de réclamation).
- **Argument de vente** : un badge public « distribution scellée et prouvée », qui attire les
  utilisateurs lassés des points opaques.

## 7. Risques
| Risque | Réponse |
|---|---|
| Les projets préfèrent garder la main | Cibler ceux pour qui la crédibilité est un actif (lancements communautaires) ; le badge crée une pression concurrentielle |
| Bug de l'évaluateur | Code court, tests différentiels contre une implémentation de référence, audit |
| Langage de formules trop limité | Commencer par les motifs les plus courants (volume, détention, ancienneté, paliers), puis étendre |
| Coût de preuve | Mesurer tôt ; réseau de prouveurs ou GPU loués |

## 8. Plan
| Phase | Livrable |
|---|---|
| 0 | Rejouer un airdrop passé de Base avec une formule reconstituée, pour mesurer le coût de preuve et la faisabilité |
| 1 | Langage de formules v1 + évaluateur SP1 + indexeur + contrat distributeur (Base Sepolia) |
| 2 | Simulateur pour les projets (« quelle distribution obtiendrais-je ? ») + interface de réclamation |
| 3 | Premier projet pilote sur Base mainnet |

---

# K3 — Assurance retard de vol, prouvée par zkTLS et confidentielle (secondaire)

- **Principe** : on achète une couverture pour un vol **engagé** (numéro et date cachés dans un
  engagement, au moins 24 h avant le départ). En cas de retard, on paie sur **preuve zkTLS** du statut
  du vol, tirée d'une source publique (site de la compagnie ou d'un service de suivi), sans oracle
  partenaire. Personne ne sait **quel vol** vous prenez (vos déplacements restent privés).
- **Technique** : le mode proxy de TLSNotary (avril 2026) produit une preuve en 1 à 2 s pour une petite
  requête. Mais « ZK ≠ sans confiance » : il faut plusieurs notaires indépendants.
- **Demande** : réelle mais **modeste** on-chain (produit de référence : environ 10 000 polices et
  13 M$ couverts). La distribution grand public passe par les agences de voyage et les compagnies,
  ce qui crée une dépendance.
- **Verdict** : ⚠️ techniquement élégant, marché de niche. À garder comme démonstrateur zkTLS.

---

# Écartées après analyse

| Piste | Raison |
|---|---|
| **Preuve de mandat pour coffres à stratégie hors chaîne** (réponse à Stream Finance, 93 M$ perdus, 285 M$ de contagion) | Besoin très réel, mais **Accountable** (preuves privées d'actifs et de passifs par zkTLS) et **DIA ZK** (réserves et NAV par zkTLS) occupent le terrain. Reste une niche : le **coupe-circuit on-chain** (dépôts suspendus automatiquement sans preuve fraîche), mieux proposée comme module à ces acteurs. Limite de fond : on ne prouve que les comptes qu'on montre. |
| **Preuves de localisation pour DePIN** | Fraude réelle, mais écosystème surtout sur Solana, dépendance au matériel, et les signaux satellites authentifiés n'empêchent pas le rejeu. |

---

## Sources

- Lassitude des points, attentes de transparence :
  https://airdropalert.com/blogs/what-are-airdrop-points/ ;
  https://airdropalert.com/blogs/how-airdrop-allocations-calculated/ ;
  https://www.coingecko.com/learn/new-crypto-airdrop-rewards
- Merkl (calcul hors chaîne, campagnes privées) : https://docs.merkl.xyz/merkl-mechanisms/technical-overview ;
  https://merkl.xyz/blog/monthly-recap-february-2026-private-campaigns-metamask-airdrop-and-more
- Stream Finance / Elixir : https://pharos.watch/learn/case-studies/stream-elixir-contagion-2025/ ;
  https://blockeden.xyz/blog/2025/11/08/m-defi-contagion/
- Accountable : https://aegis.accountable.capital/ ; DIA ZK : https://www.diadata.org/blog/post/dia-zk-verifiable-offchain-data/
- TLSNotary (mode proxy, vérifiabilité publique) : https://tlsnotary.org/blog/2026/04/22/proxy-mode/ ;
  https://tlsnotary.org/blog/2026/05/10/blog-proxy-mode/ ;
  https://tlsnotary.org/blog/2026/06/17/public-verifiability/
- Assurance paramétrique : https://plisio.net/blog/blockchain-insurance ;
  https://www.mordorintelligence.com/industry-reports/blockchain-market-in-the-insurance-industry
- DePIN : https://pen-caforr.org/2026/04/15/depin-2026-helium-hivemapper-and-the-15b-decentralized-infrastructure-boom/ ;
  https://www.kucoin.com/blog/en-wingbits-deep-dive-the-aerospace-grade-depin-revolution-2026-edition
