# Nouvelles idées ZK, série 3 (sans partenaire)

> Même critère que les séries précédentes : lançable seul, cryptographie open source, pas d'accord
> préalable d'un tiers. Domaines jamais explorés jusqu'ici : oracles, fiscalité, provenance des
> contenus.

---

## J1 — Résolution vérifiable des marchés de prédiction (zkTLS)

### Douleur (mesurée)
- Polymarket a enregistré **plus de 1 150 marchés contestés sur les cinq premiers mois de 2026**,
  soit déjà plus que sur toute l'année 2025.
- La résolution par **vote de jetons** (oracle optimiste UMA) a été manipulée :
  - « Accord Ukraine-Trump sur les minerais » résolu *Oui* sans accord, avec 5 M d'UMA votés par un
    seul acteur via trois comptes, et **7 M$ versés** sur une fausse résolution ;
  - « Déclassification des dossiers OVNI » résolu *Oui* sans publication.
- Environ 60 % des votants UMA actifs sont liés à des comptes Polymarket, et un litige sur cinq
  implique un votant ayant un intérêt financier dans le marché qu'il tranche.
- Sur Base, des places comme Limitless (~62 000 traders actifs par mois) ont besoin de résolutions
  fiables.

### Principe : remplacer le vote par une preuve de la source
1. **À la création du marché**, on publie une **spécification de résolution** :
   - sources autorisées (domaines officiels : fédération sportive, institut statistique, commission
     électorale…) ;
   - chemin précis dans la réponse (champ JSON, sélecteur, expression régulière) ;
   - prédicat (« score_A > score_B », « taux ≥ 4,5 % ») ;
   - fenêtre temporelle et **quorum** (ex. 2 sources sur 3).
2. **À l'échéance**, n'importe qui soumet une **preuve zkTLS** : « le serveur authentique de ce domaine
   a renvoyé cette valeur à cette heure ». Le contrat vérifie la preuve et le prédicat.
3. **Résolution automatique** si le quorum est atteint. Le vote ou l'arbitrage n'intervient **qu'en
   dernier recours** (aucune preuve possible, sources contradictoires).

### Choix techniques
- **zkTLS** (TLSNotary, open source, bien public porté par l'Ethereum Foundation) : un « notaire »
  participe à la session TLS par calcul multipartite. Pour ne pas dépendre d'un notaire unique : un
  **ensemble de notaires indépendants**, avec plusieurs signatures exigées, ou des notaires
  multipartites (approche de TACEO).
- **Pas besoin de l'accord des sites** : une preuve web s'obtient comme une visite normale.
- **Quorum de sources** : si une source est piratée ou se trompe, les autres la contredisent.

### Limites honnêtes
- **Marchés subjectifs** (« X a-t-il accepté un accord ? ») : aucune source ne dit « oui » sans
  ambiguïté. J1 couvre les marchés **objectifs** (sport, économie, prix, résultats officiels). Ils
  représentent l'essentiel du volume, pas la totalité des litiges.
- **On déplace la confiance vers la source** : si le site officiel se trompe, la résolution se trompe
  (d'où le quorum).
- **Techniques** : TLSNotary supporte TLS 1.2, TLS 1.3 est prévu ; les sites changent de format ;
  certains bloquent les requêtes automatisées. Il faut maintenir une bibliothèque de « modèles de
  sources ».
- **Concurrence** : Chainlink, UMA ; **Brevis × APRO** annoncent des oracles « sans confiance » avec
  zkTLS pour les marchés de prédiction **sur BNB Chain** (janvier 2026). Rien de trouvé sur Base.

### Verdict
✅ **Douleur chiffrée et aiguë, sans partenaire**, les places de marché et créateurs de marchés sont
des clients. Premier pas : un marché de démonstration sur Base Sepolia résolu par preuve zkTLS d'un
résultat sportif officiel, avec un quorum de deux sources.

---

## J2 — Fiscalité crypto sans fuite de données (locale + ZK)

### Douleur (mesurée)
- **Waltio**, outil fiscal crypto français, a vu les données de **~50 000 utilisateurs** volées en
  janvier 2026 (e-mail, gains et pertes 2024, soldes au 31/12/2024). Les pirates (ShinyHunters) ont
  réclamé une rançon et affirment un lien avec des enlèvements, affirmation non confirmée. Enquête du
  parquet de Paris.
- Plus tôt, une fuite à l'**administration fiscale** française aurait alimenté les agressions.
- **DAC8** (échange automatique d'informations crypto dans l'UE, en vigueur depuis 2026) multiplie
  les endroits où ces données circulent.
- Un logiciel fiscal en ligne concentre exactement ce que cherchent les criminels : **identité +
  fortune + adresses**.

### Principe
1. **Calcul 100 % local** : le logiciel lit la chaîne publique et les exports des plateformes **sur
   l'appareil de l'utilisateur**. Il calcule plus-values et formulaires (ex. 2086 et 3916-bis en
   France) **sans jamais envoyer adresses ni soldes à un serveur**. Synchronisation éventuelle
   chiffrée de bout en bout.
2. **Attestation ZK pour le comptable ou le conseiller** : une preuve que « les totaux déclarés
   découlent correctement des transactions de wallets que je contrôle » (réutilise la primitive de
   [`conception-preuve-detention.md`](conception-preuve-detention.md) : registre d'activation,
   agrégation). Le professionnel vérifie la cohérence **sans recevoir la liste des adresses**.
3. **Preuve de fonds** pour une banque ou un notaire (origine des fonds lors d'un achat immobilier),
   avec la même primitive, à vérificateur désigné pour qu'une fuite ne serve à rien.

### Limites honnêtes
- **Le cœur de la valeur est le calcul local, pas le ZK** : le ZK est un plus pour les
  professionnels, pas la raison d'acheter.
- **L'administration fiscale** reçoit ce qu'elle exige (totaux, comptes à l'étranger), et peut
  demander le détail lors d'un contrôle. On ne contourne rien, on **réduit le nombre d'endroits où les
  données dorment**.
- **Pas propre à Base** : c'est un produit multi-chaînes (Base peut en être la vitrine et l'ancrage
  des attestations).
- **Concurrence** : nombreux logiciels fiscaux (Waltio, Koinly, CoinTracking…), tous en mode serveur.
  La différenciation est l'**architecture**.
- **Fiscalité** : il faut maintenir les règles par pays (exigeant, mais sans partenaire).

### Verdict
✅ **Douleur forte en France et dans l'UE, marché existant, différenciation claire**. ⚠️ Le ZK y
est secondaire, et l'ancrage sur Base est faible.

---

## J3 — Provenance des images avec rédaction ZK (journalistes, lanceurs d'alerte) — écartée

- **Idée** : prouver qu'une photo vient d'un appareil authentique (C2PA) et n'a subi que des
  retouches permises, **sans révéler** l'auteur, l'appareil ni la position GPS exacte. Recherche
  active en 2026 (articles sur la « rédaction douce » par ZK, anonymat de provenance).
- **Pourquoi écartée** :
  - dépend des fabricants d'appareils et des plateformes (adoption de C2PA) : **forte dépendance** ;
  - une analyse indépendante de 2026 conclut que C2PA n'atteint pas ses objectifs de sécurité ;
  - lien faible avec Base.

---

## Synthèse

| | J1 Résolution zkTLS | J2 Fiscalité locale + ZK |
|---|---|---|
| Douleur | 1 150+ litiges en 5 mois, manipulation par des baleines | Fuite Waltio (50 000 utilisateurs), agressions |
| Dépendance | Aucune (sites publics, notaires indépendants) | Aucune |
| Rôle du ZK | **Central** (preuve de la source) | Secondaire (attestations) |
| Lien avec Base | Fort (places de prédiction sur Base) | Faible (multi-chaînes) |
| Concurrence | Chainlink, UMA, Brevis × APRO (BNB) | Logiciels fiscaux en ligne |

## Sources

- Litiges Polymarket et manipulation UMA :
  https://coinmarketcap.com/academy/article/polymarket-reports-unprecedented-governance-attack-by-uma-whale-on-bet-resolution ;
  https://orochi.network/blog/oracle-manipulation-in-polymarket-2025 ;
  https://www.oddsshopper.com/articles/prediction-markets/uma-oracle-polymarket-disputes ;
  https://polymarkets.co.il/en/guide/uma-disputes/
- Brevis × APRO : https://blog.brevis.network/2026/01/26/brevis-and-apro-trust-free-oracles-and-trader-privacy-for-prediction-markets/
- zkTLS / TLSNotary : https://tlsnotary.org/docs/faq/ ; https://tlsnotary.org/blog/2025/08/31/benchmarks/ ;
  https://core.taceo.io/articles/mpc-zktls/ ; https://crypto.news/what-is-zktls-web-proofs-explained/
- Fuite Waltio : https://www.dlnews.com/articles/regulation/hackers-extort-french-crypto-firm-waltio/ ;
  https://databreaches.net/2026/01/24/frances-waltio-faces-ransom-threat-from-notorious-hacker-collective/ ;
  https://www.forbes.com/sites/digital-assets/2026/02/14/france-crypto-kidnappings-leaks-and-zero-convictions-fuel-the-crisis/ ;
  https://cointracking.info/blog/crypto-tax-data-privacy-french-leak/
- Provenance ZK : https://arxiv.org/abs/2608.07063 ; https://eprint.iacr.org/2026/1914.pdf ;
  https://arxiv.org/html/2604.24890v1
