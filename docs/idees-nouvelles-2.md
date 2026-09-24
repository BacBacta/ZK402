# Base — nouvelles idées ZK, série 2 (sans partenaire)

> Même critère que [`idees-sans-partenaires-base.md`](idees-sans-partenaires-base.md) : lançable seul,
> sur Base, données publiques et cryptographie open source. Idées **nouvelles** par rapport aux
> documents précédents.

---

## I1 — ZK Bounty : primes de bug payées automatiquement sur preuve d'exploit

### Douleur
- Les chercheurs en sécurité prennent le risque de ne pas être payés : la règle « pas de correctif,
  pas de paiement » laisse le projet décider seul. Le *Bug Bounty Wall of Shame* recense environ
  2,5 M$ de primes impayées (ex. 500 $ versés pour une faille exposant 14 M$). Immunefi a retiré un
  projet de sa plateforme pour 500 000 $ de primes non versées.
- À l'inverse, un projet ne peut pas vérifier une faille **sans que le chercheur la révèle**, et une
  fois révélée, le chercheur perd tout moyen de pression.
- Contexte : 972 M$ volés en 207 incidents au premier semestre 2026.

### Principe
Le chercheur **prouve qu'une faille existe sans la montrer**, et **la prime et la divulgation
s'échangent atomiquement**.

1. **Le projet publie** sur Base :
   - un **contrat d'invariant** (une fonction Solidity, par ex. `totalAssets() >= totalSupply()` ou
     « le solde de l'attaquant n'augmente pas de plus de X ») ;
   - un **séquestre** financé, avec des paliers de prime selon l'impact ;
   - sa **clé publique de divulgation**.
2. **Le chercheur** exécute en privé sa séquence de transactions dans une zkVM (SP1 ou RISC Zero avec
   un EVM de type revm), à partir de l'**état réel de Base** à un bloc B, et prouve :
   - que l'état de départ correspond au bloc B (racine d'état ancrée on-chain via l'historique des
     hash de blocs) ;
   - que l'attaquant part de conditions réalistes (solde nul hors flash loans disponibles dans l'état) ;
   - que l'invariant est **violé** après exécution, et l'**ampleur** de l'impact (qui détermine le palier) ;
   - que le **chiffré publié** contient bien la séquence d'exploit, chiffrée pour la clé du projet
     (chiffrement vérifiable, prouvé dans la même zkVM).
3. **Le contrat vérifie la preuve** et paie le chercheur **dans la même transaction** où le chiffré est
   publié. Le projet obtient l'exploit exactement quand il paie : échange équitable, sans arbitre.

### Pourquoi c'est nouveau
- La recherche existe : *zkpoex* (RISC Zero), l'article « ZK proofs of exploits in Solidity » (ACM
  SAC 2026), des prototypes de hackathon (*zkbounty*).
- **Aucune plateforme de production** trouvée ; Immunefi mise sur l'arbitrage et des coffres de
  paiement, pas sur la preuve.

### Difficultés (honnêtes)
- **Coût de preuve** d'une exécution EVM dans une zkVM : de minutes à heures sur GPU. Acceptable pour
  une prime, à mesurer.
- **Ancrage de l'état** : il faut un hash de bloc Base vérifiable on-chain (historique de hash de
  blocs, EIP-2935 si disponible sur Base, à vérifier) et des preuves de stockage pour les comptes
  touchés.
- **Qualité de l'invariant** : un projet qui écrit un invariant trop étroit ne paiera que pour ce
  cas. C'est un produit d'outillage autant que de cryptographie (modèles d'invariants par type de
  protocole : prêt, AMM, coffre).
- **Adoption par les projets** : ils perdent leur marge de négociation. Argument : attirer les
  meilleurs chercheurs (paiement garanti), et une preuve de sérieux publique (séquestre visible).
- **Réaction du projet** : dès qu'une preuve est publiée, il sait qu'une faille existe et peut mettre
  en pause, ce qui est justement l'objectif.

### Verdict
✅ **Très différenciant, sans partenaire, marché existant** (primes Immunefi : ~13,45 M$ versés au
S1 2026). Techniquement ambitieux : commencer par un prototype sur un contrat vulnérable volontaire.

---

## I2 — Coffre familial : temporisation, gardiens cachés, héritiers cachés

### Douleur (double)
1. **Coercition** : les wrench attacks explosent en 2026, et **les familles des victimes sont de
   plus en plus ciblées** (CertiK). Une victime qui peut vider son wallet en 30 secondes n'a aucun
   moyen de résister.
2. **Héritage** : la culture de l'auto-conservation crée une « bombe à retardement ». On estime 3 à
   4 M BTC perdus pour toujours. Les solutions « envoyez-nous votre seed » réintroduisent un tiers de
   confiance.

### Principe : un coffre-fort à temporisation, comme dans les banques
Un compte intelligent (smart account) détenant les fonds, avec :
- **Plafond immédiat** (ex. 1 000 $ par jour) : au-delà, tout retrait passe par un **délai** (ex. 72 h).
- **Pendant le délai**, des **gardiens** peuvent opposer un **veto**.
- **Inactivité prolongée** (ex. 12 mois sans « preuve de vie ») : ouverture de la **succession**.
- La politique est **publique et affichée** : un agresseur sait qu'il n'obtiendra rien de plus que le
  plafond. C'est l'effet dissuasif des coffres temporisés en commerce.

### Où intervient le ZK
- **Gardiens cachés** : le coffre ne stocke qu'une racine de Merkle d'engagements de gardiens. Un
  veto est une **preuve d'appartenance anonyme** (type Semaphore) avec un nullifier par demande de
  retrait. **Personne, ni l'agresseur ni le public, ne sait qui sont les gardiens** : on ne peut donc
  ni les contraindre ni les cibler.
- **Héritiers cachés** : les héritiers sont des engagements `H(secret)` ou `H(email, sel)`. À
  l'ouverture de la succession, un héritier réclame :
  - soit en prouvant qu'il connaît le secret remis (lettre scellée, notaire) ;
  - soit en prouvant, avec **zkEmail** (signatures DKIM publiques, open source), qu'il contrôle
    l'adresse e-mail désignée. **L'héritier n'a besoin d'aucun wallet à l'avance**, et **son identité
    n'est jamais publique avant sa réclamation**.
- **Preuve de vie discrète** : un simple acte signé du propriétaire ; aucun contenu révélé.

### Concurrence
- Modules Safe (délai, récupération), projets d'héritage on-chain (Afterwise, Ethernal en hackathon
  avec « héritiers scellés »), services hors chaîne (Cipherwill, Casa).
- **Différenciation** : gardiens **et** héritiers cachés par ZK, dans un produit unique pensé pour
  les familles et contre la coercition.

### Difficultés
- **UX et pédagogie** : délais, gardiens, preuves de vie. Le produit doit rester simple (réglages
  par défaut, rappels).
- **zkEmail** : des bugs de contraintes ont été corrigés en 2025 ; les clés DKIM des fournisseurs
  tournent (il faut suivre un registre de clés) ; certains fournisseurs réécrivent les e-mails.
- **Le solde du coffre est visible** : le coffre doit être une adresse **non liée** à l'identité du
  propriétaire. On peut combiner avec la preuve de détention anonyme pour prouver ses fonds sans
  exposer le coffre.
- **Juridique** : un héritage on-chain ne remplace pas un testament ; le produit doit s'articuler
  avec (lettre au notaire contenant le secret d'héritier).

### Verdict
✅ **Deux douleurs fortes et actuelles, sans partenaire**. Technique maîtrisable (Semaphore est déjà
sur Base, zkEmail est open source).

---

## Pistes examinées et écartées

| Piste | Raison |
|---|---|
| Crédit sous-collatéralisé avec historique privé | 3Jane (sur Base) fait déjà du scoring on-chain + zkTLS (VantageScore) ; Cred Protocol aussi |
| KYC par passeport ZK pour la DeFi | Concurrence installée (Self, zkPassport) |
| Preuve de performance de trading (KOL) | Gros effort (historique, flux entrants et sortants) pour une preuve facile à biaiser |
| Protection contre l'empoisonnement d'adresses et les drainers | Problème réel, mais le ZK n'y apporte rien de décisif |

---

## Recommandation

| | I1 ZK Bounty | I2 Coffre familial |
|---|---|---|
| Douleur | Primes impayées, divulgation risquée | Coercition physique + héritage |
| Client | Protocoles et chercheurs en sécurité | Particuliers et familles |
| Différenciation | Forte (aucune production) | Moyenne à forte (ZK sur gardiens et héritiers) |
| Difficulté | Élevée (zkVM, ancrage d'état) | Moyenne (Semaphore, zkEmail, smart account) |
| Premier pas | Prototype : exploit prouvé sur un contrat vulnérable de test | Prototype : coffre avec délai + veto anonyme sur Base Sepolia |

---

## Sources

- Primes impayées : https://cryptoslate.com/a-silent-security-scandal-defi-bug-bounty-wall-of-shame-shows-millions-of-unpaid-bounties/
- Immunefi (arbitrage, coffres, versements S1 2026) : https://immunefi.com/bug-bounty/ ;
  https://m3dython.com/blog/immunefi-review-2026
- Preuves d'exploit en ZK : https://github.com/ziemen4/zkpoex ; https://doi.org/10.1145/3748522.3779811 ;
  https://github.com/ar1as1/zkbounty ; https://arxiv.org/pdf/2301.01321
- Héritage : https://cryptoslate.com/bitcoins-self-custody-culture-created-an-inheritance-time-bomb-and-2026-may-be-when-it-starts-detonating/ ;
  https://www.spark.money/research/bitcoin-inheritance-planning-guide
- Solutions d'héritage existantes : https://ethglobal.com/showcase/afterwise-dez80 ;
  https://github.com/Georgefifth/ethernal ; https://www.cipherwill.com/ ;
  https://forum.safefoundation.org/t/simple-dead-man-switch-recovery-signer/7094
- Wrench attacks et familles ciblées : https://www.theblock.co/amp/post/400601/crypto-wrench-attacks-rise-victims-family-members-risk-certik
- Crédit on-chain (3Jane) : https://www.3jane.xyz/pdf/whitepaper.pdf
- zkEmail : https://github.com/zkemail/zk-email-verify
