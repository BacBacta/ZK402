# Base — niches porteuses, douleurs documentées, solutions ZK/FHE (recentrage)

> **Critères stricts** :
> 1. niche **en croissance sur Base** (chiffres) ;
> 2. douleur **documentée** par des sources, pas supposée ;
> 3. **pas entièrement résolue** par l'existant ;
> 4. ZK ou FHE au **cœur** de la solution, pas en décoration.
>
> Toute niche qui échoue à un critère est notée comme telle.

---

## Tableau de synthèse

| Niche sur Base | Croissance | Douleur documentée | Déjà résolu ? | Rôle ZK/FHE | Verdict |
|---|---|---|---|---|---|
| **Marchés de prédiction** (Limitless) | « Plus grand marché de prédiction de Base », > 1 Md$ de volume cumulé ; marchés créés par les utilisateurs depuis le 2 juin 2026 | Sport et politique **résolus manuellement par l'équipe** ; crise des oracles dans le secteur (1 150+ litiges Polymarket en 5 mois ; enquête du WSJ, mai 2026 : plus de la moitié des votes UMA viennent des 10 plus gros wallets) | **Non** : prix = Pyth/Chainlink ; le reste = équipe ou vote | **Central** (zkTLS) | ✅ **N°1** |
| **Distributions de jetons en « saison Base »** | Token Base exploré pour T2–T4 2026 (estimations de 12 à 34 Md$) ; farming massif ; chaque app de Base lance points et airdrops | Lassitude des points opaques, règles changées en cours de route, filtres anti-sybil secrets et incontestables | **Non** : Merkl calcule hors chaîne, ses « campagnes privées » sont de l'obscurité sans preuve | **Central** (calcul prouvé + formule scellée) | ✅ **N°2** |
| **Lancements de jetons** (Clanker, Zora, Flaunch) | Clanker : 2,7 Md$ de volume cumulé | Snipers : lancement de Jesse Pollak, ~26 % de l'offre et ~1,3 M$ pris par deux bots ; en 2026, « partir du principe que snipers, faux volume et dumps font partie du marché » | **Partiellement** : enchères hollandaises (Doppler), taxes anti-sniper dégressives | Moyen (offres scellées) | ⚠️ N°3 |
| **Prêts Coinbase via Morpho** | 3,62 Md$ de collatéral, 53 000 emprunteurs | Semaine du 6 février 2026 : **170 M$ liquidés**, ~3 300 utilisateurs ; alertes au mieux toutes les 30 min contre des bots en quelques secondes | **Partiellement** : pré-liquidations Morpho (désendettement automatique), DeFi Saver ; Coinbase « évalue d'autres protections » | **Faible** : la douleur est un **délai de réaction**, qui se résout par l'**automatisation**, pas par le ZK. Les clients sont dans l'app Coinbase (canal fermé). | ❌ pour un projet ZK/FHE |
| **Paie et B2B en stablecoins** | Paie en stablecoins en forte hausse ; Shopify en USDC sur Base | Fireblocks : la confidentialité est le premier obstacle institutionnel | **Partiellement** : Base Ledgers (grandes entreprises, avec opérateur), Hinkal (transferts privés), Zama × Bron | Central | ⚠️ Concurrence qui s'installe |
| **Paiements x402 d'agents** | 85 % du volume x402 sur Base | Visibilité des fournisseurs des agents | — | Central | ❌ Demande réelle trop faible (~28 000 $/jour, dont la moitié artificielle) |

---

## N°1 — Résolution vérifiable pour les marchés de prédiction de Base

### Pourquoi c'est la meilleure niche
- **Croissance sur Base** : Limitless se présente comme le plus grand marché de prédiction de Base
  (> 1 Md$ de volume cumulé selon ses propres chiffres) et vient d'ouvrir la création de marchés à
  tous (2 juin 2026). Avec des marchés créés par n'importe qui, **la résolution manuelle par l'équipe
  ne passe pas à l'échelle**.
- **Douleur documentée** : résolution centralisée pour le sport et la politique chez Limitless ;
  manipulations et litiges massifs chez le leader du secteur (UMA/Polymarket).
- **Non résolue sur Base** : les oracles de prix couvrent les marchés financiers ; pour le reste,
  c'est l'équipe ou un vote. Brevis × APRO proposent du zkTLS pour les marchés de prédiction **sur
  BNB Chain**, pas sur Base.
- **Le ZK est le cœur** : une preuve zkTLS remplace l'arbitre humain pour tout marché dont la
  réponse est publiée par une source officielle.

### Rappel du mécanisme (voir J1 dans [`idees-nouvelles-3.md`](idees-nouvelles-3.md))
Spécification de résolution à la création (sources officielles, champ, prédicat, quorum), puis preuve
zkTLS de la source à l'échéance, puis résolution automatique. L'arbitrage humain ne reste qu'en
dernier recours.

### Clients directs (pas des partenaires)
- les **créateurs de marchés** sur Limitless (et les futures places permissionless de Base), qui ont
  intérêt à des marchés « auto-résolus » plus crédibles, donc plus liquides ;
- les **places de marché** elles-mêmes, qui réduisent leur charge de résolution et leur risque de
  réputation.

### Limites
Marchés subjectifs hors de portée ; confiance déplacée vers la source ; notaires zkTLS à multiplier
(mode proxy de TLSNotary : 1 à 2 s par preuve ; « ZK ≠ sans confiance »).

---

## N°2 — Distributions équitables et prouvées pour la saison Base

- Mécanisme « Scellé » (voir K1 dans [`idees-nouvelles-4.md`](idees-nouvelles-4.md)) : formule
  scellée avant la campagne, calcul prouvé en zkVM, contraintes publiques, révélation sous caution.
- Complément anti-sybil sans doxxing : groupes anonymes adossés à Coinbase Verifications (voir
  [`conception-identifiants-zk.md`](conception-identifiants-zk.md)) ou registre d'activation (voir
  [`conception-preuve-detention.md`](conception-preuve-detention.md)).
- **Pourquoi maintenant** : l'attente d'un token Base pousse tout l'écosystème à distribuer des points
  et des jetons pour capter l'activité. La confiance dans ces distributions est au plus bas.

---

## N°3 — Ouvertures de marché scellées contre les snipers

- Douleur publique et spécifique à Base (Flashblocks, lancement de Jesse Pollak).
- **Partiellement résolue** : enchères hollandaises de Doppler (qui équipe Zora), taxes anti-sniper.
- Apport possible : une **fenêtre d'offres scellées** (commit-reveal avec caution, FHE plus tard)
  avant l'ouverture de la courbe, sous forme de *hook* Uniswap v4 réutilisable par les lanceurs. La
  différenciation est plus faible que N°1 et N°2.

---

## Écartées au regard des critères

- **Prêts Coinbase/Morpho** : douleur majeure et documentée, mais c'est un problème de **réactivité**
  que l'automatisation résout (pré-liquidations Morpho, DeFi Saver, protections annoncées par
  Coinbase). Le ZK/FHE n'y est pas central, et les emprunteurs sont captifs de l'app Coinbase.
- **x402** : pas de demande réelle aujourd'hui.
- **Paie B2B** : pertinente, mais Base Ledgers, Hinkal et Zama × Bron réduisent l'espace.

---

## Sources

- Limitless : https://predictionmarketsindex.com/platforms/limitless/ ;
  https://dappradar.com/blog/the-ultimate-guide-to-defi-prediction-markets-with-limitless-on-base ;
  https://github.com/Ricosworks1/blockchain-payment-flow-analysis/releases/tag/market-update-prediction-market-oracle-crisis-sept-2026
- Crise des oracles (UMA, enquête WSJ, litiges) :
  https://track360.io/blog/prediction-market-oracles-resolution-settlement-operator-guide-2026 ;
  https://orochi.network/blog/oracle-manipulation-in-polymarket-2025
- Brevis × APRO : https://blog.brevis.network/2026/01/26/brevis-and-apro-trust-free-oracles-and-trader-privacy-for-prediction-markets/
- Token Base : https://www.coindesk.com/business/2025/09/15/base-explores-issuing-native-token-says-creator-jesse-pollak ;
  https://www.theblock.co/post/370668/coinbase-incubated-base-network-beginning-to-explore-native-token-creator-jesse-pollak-says ;
  https://blog.mexc.com/base-network-token-farming-guide-2026-how-to-build-on-chain-history-before-coinbases-l2-potentially-distributes/
- Lancements et snipers : https://coinbureau.com/analysis/best-memecoin-launchpads ; https://trustswap.com/base/best-launchpads ;
  https://finance.yahoo.com/news/flashblocks-let-bots-front-run-111149882.html
- Liquidations Coinbase/Morpho : https://becausebitcoin.com/post/coinbase-defi-loans-record-liquidations-btc-eth-slide-morpho-analysis ;
  https://morpho.org/blog/introducing-pre-liquidations-enhanced-loan-management-on-morpho ;
  https://www.theblock.co/news/defi/2026-09-22-coinbase-fixed-rate-bitcoin-loans-morpho-midnight-416050
- x402 : https://www.coindesk.com/markets/2026/03/11/coinbase-backed-ai-payments-protocol-wants-to-fix-micropayment-but-demand-is-just-not-there-yet
