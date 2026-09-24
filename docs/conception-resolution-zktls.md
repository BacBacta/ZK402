# Verdict — résolution vérifiable des marchés de prédiction sur Base (zkTLS)

> **Statut** : conception détaillée, rien n'est implémenté. Niche N°1 de
> [`niches-base-douleurs.md`](niches-base-douleurs.md).
>
> **En une phrase** : un « oracle » compatible avec le Conditional Tokens Framework (CTF) qui tranche
> un marché en quelques minutes, sur la base de **preuves zkTLS** que des sources officielles ont
> publié le résultat, attestées par **plusieurs notaires indépendants et cautionnés**. L'arbitrage
> humain ne reste qu'en dernier recours.

---

## 1. Point de départ vérifié

| Fait | Source | Conséquence |
|---|---|---|
| Limitless (Base) : carnet d'ordres + AMM, règlement en USDC, **CTF de Gnosis** | reviews Limitless, subgraphs publics | L'intégration passe par le rôle d'« oracle » du CTF |
| **Oracle Limitless = multisig Gnosis Safe** qui appelle `prepareCondition` ; **aucun événement ne porte le texte de la question** | analyse des subgraphs | Résolution opaque ; la question n'est même pas on-chain |
| Marchés crypto : Pyth, et Chainlink Data Streams depuis juin 2026 (~19 000 marchés/semaine) | reviews | Les marchés de **prix** sont déjà bien servis : on ne les vise pas |
| **Sport, politique : résolus manuellement par l'équipe sous 24 à 72 h** | reviews | C'est la cible |
| Marchés créés par les utilisateurs depuis le 2 juin 2026 | Limitless | Le volume à résoudre va croître plus vite que l'équipe |
| Secteur : 1 150+ litiges Polymarket en 5 mois de 2026 ; WSJ : la majorité des votes UMA viennent des 10 plus gros wallets | presse | La résolution par vote n'est pas la réponse |
| TLSNotary : une preuve n'est « publique » que si l'on fait confiance au notaire ; recommandation : **M-sur-N notaires indépendants**, ou notaires **cautionnés et sanctionnables** | blog TLSNotary (juin 2026) | Structure de confiance de Verdict |
| Mode proxy : 1–2 s par petite preuve, **TLS 1.2**, IP du notaire visible du site | blog TLSNotary (avril et mai 2026) | Choix de mode par source ; rotation des notaires |

---

## 2. Ce que Verdict garantit, et sur quoi il repose

**Garantie** : un marché n'est tranché que si **au moins k sources officielles distinctes**, chacune
attestée par **au moins M notaires indépendants**, ont publié une valeur qui satisfait le prédicat,
de façon **stable** dans la fenêtre prévue. Et personne, pas même l'équipe, ne peut trancher
autrement hors de la procédure de recours.

**Hypothèses de confiance** (à afficher à l'utilisateur) :
1. les sources officielles publient la vérité (d'où plusieurs sources) ;
2. moins de M notaires d'un même quorum colludent avec un tricheur (d'où la caution, la diversité des
   opérateurs, M-sur-N) ;
3. TLS et le système de certificats du web ne sont pas compromis pour ces domaines.

C'est **nettement plus fort** qu'un multisig d'équipe ou qu'un vote dominé par 10 wallets. Mais ce
n'est **pas « sans confiance »**, et le produit doit le dire.

---

## 3. La spécification de résolution (le cœur du produit)

Chaque marché est créé avec une **spécification** stockée on-chain (hash) et publiée (IPFS). Son hash
**est** l'identifiant de la question CTF : impossible de changer la règle après coup.

```yaml
question: "Le PSG bat-il l'OM le 26/10/2026 (temps réglementaire) ?"
outcomes: [OUI, NON]
sources:                      # au moins k=2 sources distinctes doivent concorder
  - template: ligue1-match-v1       # modèle audité : domaine, chemin, format de réponse
    params: { match_id: "L1-2026-0934" }
  - template: sport-fed-results-v2
    params: { competition: "L1", date: "2026-10-26", home: "PSG", away: "OM" }
extract:                      # défini par le modèle : où lire dans la réponse
  status: "FINAL"             # la source doit indiquer que le résultat est définitif
  home_goals: int
  away_goals: int
predicate: "home_goals > away_goals"   # OUI si vrai, NON sinon
window:
  earliest: "2026-10-26T23:00Z"        # pas de résolution avant (fin du match + marge)
  latest:   "2026-10-29T23:00Z"        # au-delà : recours (cf. § 6)
stability:
  attestations: 2              # deux observations concordantes par source…
  min_gap: "30m"               # …espacées d'au moins 30 min (anti-erreur transitoire, anti-piratage bref)
notaries: { M: 3, N: 5 }       # 3 notaires distincts sur 5 par attestation
fallback: "arbitre:0xABC…"     # recours désigné à la création (ex. arbitre, ou oracle optimiste)
```

**Modèles de sources** : un modèle fixe le domaine, le format de requête, et **où** se trouve la
valeur dans la réponse (motif fixe autour du champ JSON). Les modèles sont versionnés, publics, et
marqués « audités » ou non. Les créateurs de marchés choisissent parmi eux, ce qui évite les
spécifications ambiguës.

---

## 4. Flux de résolution

```
 Échéance ─► Prouveurs (n'importe qui)             Notaires (M sur N, cautionnés)
             requêtent la source officielle ◄──── assistent à la session TLS (MPC ou proxy)
             via zkTLS                              signent une attestation :
                                                   domaine, heure, octets révélés, adresse du prouveur
                    │
                    ▼  propose(questionId, attestations[])
 ┌───────────────────────────── VerdictResolver (Base) ─────────────────────────────┐
 │ 1. signatures : ≥ M notaires distincts et actifs, par attestation                 │
 │ 2. domaine et requête conformes au modèle ; heure dans la fenêtre                 │
 │ 3. extraction : les octets révélés correspondent au motif du modèle → valeurs     │
 │ 4. stabilité : 2 attestations par source, écart ≥ min_gap, valeurs identiques     │
 │ 5. quorum : ≥ k sources concordent ; le prédicat donne le résultat                │
 │ 6. état PROPOSÉ ; fenêtre de contestation (ex. 2 h)                               │
 │ 7. finalize → ConditionalTokens.reportPayouts(questionId, [1,0] ou [0,1])         │
 └───────────────────────────────────────────────────────────────────────────────────┘
```

- **Extraction on-chain simple** : les données sont publiques, donc pas besoin de les cacher. On
  **révèle** seulement la petite plage utile (ex. `"status":"FINAL","home":2,"away":1`), et le contrat
  vérifie un motif fixe. Si un format impose un calcul complexe, une preuve Noir sur l'engagement du
  transcript peut remplacer l'extraction on-chain.
- **Le prouveur est payé** (prime de résolution financée par le créateur du marché). L'adresse du
  prouveur est **incluse dans l'attestation signée**, donc personne ne peut lui voler la prime en
  recopiant sa transaction.
- **Délai** : quelques minutes à quelques heures après la publication officielle (fenêtre de stabilité
  + contestation), **contre 24 à 72 h** aujourd'hui.

---

## 5. Réseau de notaires

| Élément | Règle |
|---|---|
| Entrée | Caution en USDC (ex. 50 000 $) ; opérateurs identifiés et **divers** (juridictions, hébergeurs) |
| Quorum | M-sur-N par attestation, choisi par la spécification ; tirage aléatoire des N pour chaque résolution |
| Sanction | Si une contestation établit qu'un notaire a signé une session impossible (valeur contredite par une majorité d'autres notaires sur la même source et la même fenêtre), sa caution est confisquée, en partie au bénéfice du contestataire |
| Mode | MPC-TLS par défaut (le site ne voit que l'IP du prouveur) ; proxy (1–2 s) quand la source tolère les IP de notaires |
| Rotation | IP et opérateurs variés, pour éviter le blocage par les sites |

**Démarrage** : l'équipe opère 2 notaires, 3 à 5 opérateurs indépendants sont recrutés (acteurs de
l'infrastructure de Base, validateurs, universitaires). Ce ne sont **pas** des partenaires
commerciaux : ce sont des opérateurs rémunérés par les frais de résolution.

---

## 6. Contestations et recours

1. **Pendant la fenêtre de contestation**, quiconque peut soumettre un **jeu d'attestations
   contradictoire** (même source ou autre source autorisée, fenêtre valide) avec une caution.
2. Deux jeux valides et contradictoires signifient un conflit réel (source corrigée, source piratée,
   notaires corrompus) : **escalade** vers le recours désigné dans la spécification.
3. **Aucune preuve possible** avant `latest` (source muette, format changé) : recours également.
4. **Corrections tardives** d'une source après finalisation : sans effet (règle écrite dans la
   spécification). C'est la raison d'être de la fenêtre de stabilité.

Le recours humain devient **l'exception**, pas la règle.

---

## 7. Couverture : ce que Verdict résout et ne résout pas

| Type de marché | Couvert ? |
|---|---|
| Sport (score final, vainqueur, buteur) | ✅ si source officielle stable |
| Économie (inflation, emploi, taux directeur) | ✅ (instituts statistiques, banques centrales) |
| Élections avec résultats officiels publiés | ✅ (sites officiels ; attention aux calendriers de certification) |
| Météo, catastrophes mesurées | ✅ (services météorologiques publics) |
| Prix d'actifs | ➖ déjà servi par Pyth et Chainlink |
| « X a-t-il accepté / déclaré / fait… » (interprétation) | ❌ **hors de portée**, reste à l'arbitrage |

**Inconnue principale** : la part des marchés « sur mesure » de Limitless qui sont objectifs. **À
mesurer en phase 0**.

---

## 8. Sécurité

| Menace | Parade |
|---|---|
| Collusion d'un prouveur avec des notaires | M-sur-N tiré au hasard, caution et confiscation, plusieurs sources |
| Piratage ou erreur ponctuelle d'une source | Quorum de k sources, stabilité dans le temps, contestation |
| Détournement réseau (DNS, BGP) | TLS authentifie le domaine ; plusieurs sources sur des infrastructures distinctes |
| Changement de format d'une source | Modèles versionnés ; échec d'extraction, donc recours (jamais de résultat erroné par défaut) |
| Blocage des notaires par un site | Mode MPC (IP du prouveur), rotation, sources alternatives |
| Vol de prime de résolution | Adresse du prouveur incluse dans l'attestation |
| Résolution prématurée | `earliest` + exigence du champ « FINAL » + stabilité |
| Ambiguïté de la question | Spécification formelle + modèles audités ; le texte seul ne fait pas foi |

---

## 9. Intégration et accès au marché

| Voie | Dépendance | Détail |
|---|---|---|
| **Oracle pour tout marché CTF sur Base** | Aucune | Le résolveur **est** l'adresse oracle d'une condition CTF ; tout protocole ou créateur qui choisit cette adresse l'utilise sans autorisation |
| **Créateurs de marchés permissionless** (Limitless et suivants) | Faible à moyenne | Dépend de la possibilité, pour un créateur, de choisir l'oracle de son marché (**à vérifier** dans les contrats des marchés permissionless de Limitless) |
| **Limitless comme client** (déléguer ses résolutions sportives) | Client unique | Proposition de valeur : moins de charge manuelle, résolution plus rapide, crédibilité ; mais c'est un risque de dépendance à un seul client |
| **Démonstrateur propre** | Aucune | Marchés CTF de démonstration sur Base Sepolia, puis mainnet |

---

## 10. Modèle économique

- **Frais de résolution** par marché, payés par le créateur : une partie pour la prime du prouveur,
  une partie pour les notaires, une partie pour le protocole.
- Service de **modèles de sources** (création et audit de modèles pour de nouvelles sources, sur
  demande des places de marché).
- **Coût de revient** : preuves zkTLS (secondes de calcul), gas de vérification de M × k × 2 signatures
  sur Base (faible).

---

## 11. Plan

| Phase | Livrable | Critère de sortie |
|---|---|---|
| **0. Mesure** (2 sem.) | Classer 500 marchés « sur mesure » récents de Limitless : objectifs ou subjectifs ; source officielle identifiable ? ; délai réel de résolution | Part objective et couvrable ≥ 40 % ; liste des 20 sources les plus utiles |
| **0 bis.** | Lecture des contrats Limitless : l'oracle est-il choisissable par le créateur dans les marchés permissionless ? | Voie d'intégration confirmée |
| 1. Prototype | Modèles pour 3 sources (un sport, une statistique économique, une météo) ; preuves TLSNotary ; `VerdictResolver` compatible CTF ; tests Foundry/Hardhat | Marché de démonstration résolu de bout en bout sur Base Sepolia |
| 2. Réseau | 5 notaires (2 internes, 3 externes), caution, tirage, contestation | Contestation démontrée sur une source volontairement falsifiée |
| 3. Pilote | Marchés réels sur Base mainnet (plafonds) + proposition à Limitless | Délai médian de résolution < 3 h sur les marchés couverts |
| 4. Audit | Contrats et modèles | Rapport |

---

## 12. Décisions ouvertes

| # | Question | Recommandation |
|---|---|---|
| D1 | Recours par défaut | Arbitre désigné par le créateur ; oracle optimiste en option |
| D2 | Paramètres par défaut | k = 2 sources, M = 3 sur N = 5 notaires, stabilité 2 × 30 min, contestation 2 h |
| D3 | Mode zkTLS par défaut | MPC-TLS ; proxy pour les sources qui le tolèrent |
| D4 | Caution des notaires | 50 000 $ au démarrage, puis indexée sur la valeur des marchés tranchés |
| D5 | Gouvernance des modèles | Publication libre, label « audité » attribué après revue publique |

---

## Sources

- Limitless (structure, oracles, résolution manuelle, CTF) :
  https://oddsplays.com/reviews/limitless-exchange/ ; https://predictiontalk.org/platforms/limitless/ ;
  https://github.com/PaulieB14/limitless-subgraphs ; https://predictionmarketsindex.com/platforms/limitless/
- Résolution et finalité sur Polymarket : https://arxiv.org/pdf/2609.15368 ; https://arxiv.org/pdf/2609.15373
- Crise des oracles : https://track360.io/blog/prediction-market-oracles-resolution-settlement-operator-guide-2026 ;
  https://orochi.network/blog/oracle-manipulation-in-polymarket-2025
- TLSNotary : https://tlsnotary.org/blog/2026/06/17/public-verifiability/ ;
  https://tlsnotary.org/blog/2026/04/22/proxy-mode/ ; https://tlsnotary.org/blog/2026/05/10/blog-proxy-mode/ ;
  https://tlsnotary.org/docs/faq/
- Concurrence : https://blog.brevis.network/2026/01/26/brevis-and-apro-trust-free-oracles-and-trader-privacy-for-prediction-markets/
