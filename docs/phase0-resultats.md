# Phase 0 — mesures sur données publiques (24 septembre 2026)

> Objectif : vérifier avec des données réelles les deux hypothèses de marché avant tout prototype.
> - **Verdict** (résolution zkTLS, voir [`conception-resolution-zktls.md`](conception-resolution-zktls.md)) :
>   au moins 40 % des marchés résolus à la main doivent être objectifs et couvrables.
> - **Preuve de livraison** (évaluateurs prouvés pour ACP, voir A1 dans
>   [`idees-nouvelles-base-5.md`](idees-nouvelles-base-5.md)) : au moins 30 % des jobs ou de la valeur
>   doivent être vérifiables par preuve.
>
> Données brutes, scripts et classements : [`phase0/`](phase0/).

---

## 1. Limitless : marchés actifs

### Source
- API publique `https://api.limitless.exchange/markets/active` : **429 marchés actifs**, récupérés
  intégralement.
- `/markets/resolved` exige une authentification. **Les délais de résolution ne sont donc pas encore
  mesurés.**

### Répartition par mode de résolution (champ `automationType`)

| Mode | Marchés | Volume cumulé | Part du volume | Ce que c'est |
|---|---|---|---|---|
| `lumy` | 29 | 342 k$ | 37 % | Marchés de prix (BTC/ETH à 5 min, etc.), résolus automatiquement par le **TWAP Chainlink** |
| `sports` | 150 | **2,7 k$** | 0,3 % | Matchs (football, esports, tennis, cricket) résolus automatiquement par un **flux de données sportives** (identifiants de ligue, série et événement dans les métadonnées) |
| `manual` | 250 | 577 k$ | 63 % | Résolus par l'équipe |
| **Total** | **429** | **922 k$** | | |

### Découverte principale : les marchés « manuels » sont surtout des copies de Polymarket
- **208 des 250 marchés manuels** (416 k$, 72 % du volume manuel) portent le drapeau
  `isPolyArbitrage`. Ce sont des **répliques de marchés Polymarket**. Leur résolution suit très
  probablement celle de Polymarket, donc le vote UMA (à confirmer).
- Seuls **42 marchés manuels sont propres à Limitless** (161 k$). Ils citent souvent leur source :
  - **FotMob** (48 mentions) pour les qualifications de la CAN 2027 ;
  - X/Twitter, CoinGecko, Liquipedia, HLTV, Reuters, la Fed.

### Classement des 250 marchés manuels
Classement par mots-clés sur les titres, avec vérification manuelle des cas limites
(`phase0/limitless_manual.csv`) :
- **A** : objectif, avec une source structurée (score, publication statistique, décision de taux,
  prix, résultat électoral officiel) ;
- **B** : objectif, mais la source est une annonce ou la presse (lancement de token, rachat,
  démission, loi signée) ;
- **C** : subjectif ou ambigu (« Que dira Trump ? », « détroit effectivement fermé », invasion,
  chute d'un régime).

| Classe | Marchés | Volume | Part du volume manuel | Dont propres à Limitless |
|---|---|---|---|---|
| **A** — couvrable en zkTLS | 166 | 407 k$ | **71 %** | 34 marchés, 77 k$ |
| **B** — couvrable avec une source d'annonce officielle, avec plus de risque | 56 | 54 k$ | 9 % | 6 marchés, 5 k$ |
| **C** — hors de portée | 28 | 116 k$ | 20 % | 2 marchés, 79 k$ |

### Verdict de la phase 0 (Limitless)
- ✅ **Critère formel atteint** : 71 % du volume manuel est objectif et couvrable (seuil : 40 %).
- ⚠️ **Mais trois constats changent la lecture** :
  1. **Petite taille absolue** : 922 k$ de volume cumulé sur tous les marchés actifs. La part
     couvrable **propre à Limitless** ne pèse que **77 k$**.
  2. **L'essentiel du manuel est de la réplique Polymarket.** La douleur de résolution y est
     **héritée d'UMA**. Elle se traite chez Polymarket, pas chez Limitless.
  3. **Le sport est déjà automatisé** par un flux de données. zkTLS apporterait la **vérifiabilité**
     (le flux est une confiance centrale), pas l'automatisation. Or ce segment ne pèse que 2,7 k$.
- **Conclusion** : *Verdict* garde du sens techniquement, mais **Limitless seul n'est pas un marché
  suffisant**. La cible réelle est la couche de résolution des marchés objectifs **de Polymarket**
  (hors Base), ou les **créateurs permissionless** sur Base, dont le volume reste à observer.

### Points encore ouverts
- Mesurer les délais de résolution : événements `ConditionResolution` du CTF sur Base, rapprochés
  des dates d'échéance.
- Confirmer que les répliques Polymarket copient bien sa résolution.
- Mesurer le volume des marchés créés par les utilisateurs depuis le 2 juin 2026. Aujourd'hui,
  **427 des 429 marchés actifs sont créés par Limitless.**

---

## 2. Virtuals ACP : agents et jobs

### Source
- API publique `https://acpx.virtuals.io/api/agents` : **44 052 agents** référencés. J'ai pris les
  **500 premiers par nombre de jobs réussis**, soit **2,35 M jobs**, 3,8 M$ de revenus et 430 M$ de
  volume brut.
- L'API des jobs individuels est fermée (403). **Le classement se fait donc au niveau de l'agent**,
  d'après ses offres. C'est une approximation (`phase0/acp_top500.csv`).

### Catégories de vérifiabilité

| Catégorie | Vérification possible | Agents | Jobs | Revenus | Volume brut |
|---|---|---|---|---|---|
| **Action on-chain** (swap, trading, perps, dépôt, jeux on-chain) | Lecture de l'état on-chain, **sans ZK** | 78 | **58,9 %** | 28,4 % | 99,3 % |
| **Récupération de données** (API, prix, météo, whois, scraping) | **zkTLS** | 29 | 3,5 % | 3,5 % | ~0 % |
| **Calcul déterministe** (indicateurs, backtests, calculatrices) | **zkVM** | 13 | 0,9 % | 0,3 % | ~0 % |
| **Analyse LLM** (recherche, « alpha », vérification de faits, audits) | Non (jugement) | 319 | 27,4 % | 36,6 % | 0,4 % |
| **Création** (vidéo, image, musique) | Non | 24 | 6,0 % | 29,5 % | 0,3 % |
| Gonflement de métriques (« boost », achats mutuels) | — | 8 | 0,7 % | 0,3 % | 0 % |
| Autres ou inclassables | — | 29 | 2,6 % | 1,5 % | 0 % |

**Sans Ethy AI** (1,14 M jobs à lui seul, soit 48 % du top 500) :
- action on-chain : 20 % des jobs ;
- données et calcul : 8,5 % ;
- analyse LLM : 53 % ;
- création : 12 % des jobs, mais 35 % des revenus.

### Verdict de la phase 0 (ACP)
- ❌ **Critère non atteint pour un produit ZK.** La part vérifiable **par ZK** (données + calcul)
  représente **4 à 9 % des jobs et moins de 4 % des revenus**, loin des 30 % visés.
- La grande catégorie vérifiable, **l'action on-chain** (59 % des jobs, 99 % de la valeur déplacée),
  **se vérifie directement on-chain**. Elle n'a pas besoin de ZK. Un évaluateur « action on-chain »
  reste un bon produit simple, mais ce n'est pas un projet ZK/FHE.
- Les agents « données » et « calcul » du top 500 ont des profils suspects : ~5 500 jobs chacun
  pour ~50 $ de revenus, soit environ un centime par job. Cela ressemble à du **remplissage de
  métriques**, ce qui rejoint le débat sur la crédibilité de l'aGDP.
- La valeur réelle (revenus) se trouve dans l'**analyse** et la **création**, précisément là où
  aucune preuve n'est possible.
- **Conclusion** : l'idée A1 (« Preuve de livraison ») **est écartée** comme projet ZK. Seule
  subsiste une variante sans ZK (évaluateur on-chain), hors de nos critères.

---

## 3. Synthèse

| Hypothèse | Critère | Mesure | Décision |
|---|---|---|---|
| Verdict sur Limitless | ≥ 40 % des marchés manuels objectifs | 71 % du volume manuel, mais 77 k$ propres à Limitless ; le reste réplique Polymarket | ⚠️ **Techniquement valide, marché trop petit sur Base aujourd'hui** |
| Preuve de livraison (ACP) | ≥ 30 % des jobs vérifiables par ZK | 4 à 9 % des jobs, < 4 % des revenus | ❌ **Écartée** |

**Ce que la phase 0 nous apprend** : sur Base, la demande réelle se trouve dans les **actions
on-chain** (swaps, trading), qui n'ont pas besoin de ZK pour être vérifiées. Les problèmes de
confiance « résolus par une preuve » restent de petits segments. Pour *Verdict*, le prochain pas
utile serait de mesurer Polymarket : part des marchés objectifs contestés chez UMA et délais. Mais
ce marché n'est **pas sur Base**.

## Méthode et limites
- Les classements se font par mots-clés, avec une correction manuelle des plus gros agents et
  marchés. Une erreur de quelques points ne change pas les conclusions : les écarts aux seuils sont
  larges.
- Volumes Limitless : champ `volumeFormatted` (volume cumulé des marchés **actifs** seulement).
- ACP : métriques par agent (`successfulJobCount`, `revenue`, `grossAgenticAmount`). La répartition
  par offre n'est pas publique.
- Pour reproduire : télécharger les données avec les deux API citées, puis lancer les scripts de
  [`phase0/`](phase0/). Ils lisent `active.json` et `acp_agents_top500.json` dans le répertoire
  courant.
