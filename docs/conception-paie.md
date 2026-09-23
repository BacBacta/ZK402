# ZK402 Payroll — conception détaillée : paie et paiements confidentiels en USDC sur Base

> **Statut** : proposition de conception, rien n'est implémenté. À valider par des entretiens
> clients (§ 17) avant tout développement.
>
> **Pourquoi ce produit** : la confidentialité est citée comme le premier obstacle à l'adoption des
> stablecoins par les entreprises (Fireblocks, avril 2026), et la paie en stablecoins progresse
> vite. Base Ledgers (Coinbase, juin 2026) sert les grandes entreprises via un opérateur qui détient
> la custody. Zama × Bron ont aussi versé une paie confidentielle en cUSDT (ERC-7984, FHE) dès
> janvier 2026 : montants cachés, adresses visibles. Ce document vise le créneau laissé libre : **entreprises crypto-natives, DAOs,
> startups, plateformes de freelances** qui veulent une solution **non-custodiale, en libre-service,
> auditable**.
>
> **Socle réutilisé** : le pool blindé, les notes, le circuit universel `transact`, la maturité, les
> relayers et OHTTP de [`conception-v2.md`](conception-v2.md) (notée « v2 » ci-dessous). Ce document ne
> détaille que ce qui change ou s'ajoute.

---

## 1. Personas et besoins

| Persona | Besoin principal | Ce qui ne doit **pas** fuir |
|---|---|---|
| **Employeur** (CFO, ops, fondateur d'une DAO) | Payer 5 à 500 personnes en USDC chaque mois, avec approbation multisig et export comptable | La grille salariale, la liste des bénéficiaires, le montant total de la masse salariale mois par mois |
| **Salarié ou prestataire** | Recevoir sa paie, la garder ou la convertir, prouver ses revenus (bail, prêt) | Son salaire, vis-à-vis du public **et de ses collègues** ; son lien avec l'employeur |
| **Comptable / auditeur** | Voir toutes les opérations d'une période, les rapprocher, les exporter | — (il est autorisé à voir) |
| **Exchange / off-ramp** | Accepter des fonds issus du pool sans risque de conformité | — (il a besoin d'une preuve d'origine) |
| **Régulateur** | Obtenir des informations via l'employeur, sur réquisition | Pas de porte dérobée globale |

---

## 2. Exigences

### Fonctionnelles
- **F1** Paiements en lot (jusqu'à plusieurs centaines de bénéficiaires par cycle), ponctuels ou programmés.
- **F2** Approbation par plusieurs signataires (Safe) avant tout versement.
- **F3** Fiche de paie chiffrée attachée à chaque paiement (période, brut, retenues, référence).
- **F4** Réception possible **sans wallet préexistant** (lien de réclamation).
- **F5** Export comptable et audit par période, sans donner la main sur les fonds.
- **F6** Preuve de revenu sélective pour le salarié (« je gagne ≥ X par mois chez un employeur vérifié »).
- **F7** Retrait vers un wallet ou un exchange, accepté par les plateformes conformes.

### De confidentialité
- **P1** Le public ne connaît ni les bénéficiaires, ni les montants, ni la grille salariale.
- **P2** Un salarié ne voit que ses propres paiements.
- **P3** La masse salariale mensuelle d'une entreprise n'est pas déductible de ses dépôts.
- **P4** Le lien employeur → salarié n'est pas observable on-chain.

### De sûreté et de conformité
- **S1** Non-custodial : ni ZK402 ni aucun opérateur ne peut déplacer les fonds.
- **S2** Aucun fonds bloqué : sortie toujours possible, même si l'interface disparaît.
- **S3** Dépôts réservés aux organisations vérifiées (KYB), retraits prouvant l'origine des fonds.
- **S4** Toute divulgation passe par des clés que l'utilisateur contrôle.

---

## 3. Décision structurante : un pool à dépôts restreints

Un pool ouvert à tous est un mixeur généraliste. C'est le risque réglementaire le plus lourd, et la
raison pour laquelle les exchanges refusent souvent ces fonds.

**Choix recommandé (D1)** :
- **Dépôts réservés** aux organisations ayant une attestation KYB valide (§ 9.1) ;
- **Transferts internes et retraits permissionless**, avec une **preuve d'appartenance à un ensemble
  d'association** (§ 9.2) : le retrait prouve que les fonds viennent d'un employeur vérifié, sans dire
  lequel.

Conséquences :
- l'ensemble d'anonymat est constitué des **paies de toutes les organisations** (et non d'inconnus),
  ce qui reste large si plusieurs dizaines d'employeurs l'utilisent ;
- un exchange peut accepter un retrait sur la base d'une preuve vérifiable plutôt que de le refuser
  par principe ;
- ZK402 n'est pas un service de mixage ouvert au public.

---

## 4. Architecture

```
 ┌──────────────────── Console employeur (web) ───────────────────┐   ┌──────── Portefeuille salarié ─────────┐
 │ import CSV/HRIS · calcul du lot · prouveur (worker/local)      │   │ réception · fiches de paie · retrait  │
 │ approbation Safe · export comptable (clé de visualisation)     │   │ preuve de revenu · lien de réclamation│
 └──────────┬───────────────────────────────┬────────────────────┘   └───────────────┬───────────────────────┘
            │ proposition de lot (Safe)     │ preuve payroll_batch (OHTTP → relayer)    │ transact / withdraw
 ┌──────────▼───────────────────────────────▼─────────────────────────────────────────▼──────────────────────┐
 │ Base : ShieldedPool (notes, nullifiers, maturité) · PayrollAuthorizer (Safe) · OrgRegistry (KYB)           │
 │        AssociationSetRegistry · Verifiers : PayrollBatch, Transact · Poseidon2 on-chain                    │
 └────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
            ▲ events (engagements, E, mémos chiffrés)
 ┌──────────┴───────────┐     ┌─────────────────────────┐     ┌──────────────────────────────────────┐
 │ Indexeur (public)    │     │ Relayers (ouverts)      │     │ Fournisseur d'ensemble d'association │
 └──────────────────────┘     └─────────────────────────┘     └──────────────────────────────────────┘
```

---

## 5. Modèle de données (écarts par rapport à la v2)

### 5.1 Note enrichie

```
note       = (valeur: u64, jeton, étiquette, origine, précom)
précom     = H_pre(pk, aléa)
engagement = H_note(valeur, jeton, étiquette, origine, précom)
```

- **`origine`** = `H_org(pk de celui qui a dépensé les entrées)`. **Le circuit l'impose** : on ne peut
  pas fabriquer une note « venant de l'employeur E » sans dépenser des notes de E. C'est la base des
  preuves de revenu (§ 11).
- **`étiquette`** : identifiant du dépôt d'origine (modèle Privacy Pools), hérité à chaque transfert.
  Il sert aux preuves d'ensemble d'association (§ 9.2).

### 5.2 Adresse de paiement du salarié

```
adressePaie = encode("zk402:", pk, IVK)       // publique, partageable, type « IBAN privé »
```

L'employeur l'enregistre dans sa console comme il enregistrerait un IBAN. Elle ne révèle rien
on-chain : chaque paiement produit une note furtive différente (§ 5.3 de la v2).

### 5.3 Hiérarchie des clés de l'organisation

```
graineOrg
 ├─ sk_org, pk_org          dépense (utilisée seulement après approbation Safe, § 6)
 ├─ ovk_org                 clé de visualisation SORTANTE : relire tous les paiements émis
 └─ vk_org(période)         = H_vk(ovk_org, "2026-09")  → clé d'audit limitée à un mois
```

Un auditeur reçoit `vk_org(2026-Q3)` et ne voit que ce trimestre. Il ne peut rien dépenser.

### 5.4 Mémo chiffré (fiche de paie)

Chaque sortie de paie porte un **mémo** de taille fixe (512 octets, rembourré) :

```
mémo = { période, brut, retenues[], net, devise, référence, message }
chiffréSalarié = ECIES(IVK_salarié, mémo)
chiffréOrg     = ECIES(clé dérivée de vk_org(période), mémo)
```

Le circuit lie `H(chiffréSalarié ‖ chiffréOrg)` comme entrée publique, pour que le relayer ne puisse
pas substituer les mémos. **L'intégrité du montant ne dépend pas du mémo** : elle est garantie par la
note elle-même. Un mémo faux ne peut donc tromper que sur le libellé, et l'employeur le signe
implicitement en produisant la preuve.

---

## 6. Autorisation multisig (F2)

Le problème : une preuve ZK s'appuie sur une clé `sk_org`, alors que l'entreprise veut que
**plusieurs personnes** approuvent un versement.

### Option A (recommandée pour la v1) : autorisation on-chain par un Safe
1. La console calcule le lot et produit la preuve `payroll_batch`. Parmi ses entrées publiques figure
   `autorité = adresse du Safe`, liée aux notes de l'organisation via `origine`.
2. La console propose au Safe une transaction `PayrollAuthorizer.approve(hashLot)`, où
   `hashLot = H(entrées publiques de la preuve)`.
3. Une fois le seuil de signatures atteint, n'importe qui (le relayer) soumet la preuve. Le pool
   vérifie que `hashLot` a été approuvé par le Safe `autorité`.

La clé `sk_org` seule ne suffit donc pas : il faut l'approbation du Safe. Une fuite de `sk_org`
compromet la confidentialité, **pas les fonds**.

**Coût en confidentialité** : on voit on-chain que « le Safe X a exécuté un lot de paie ». C'est
limité, parce que le lot est **rembourré à une taille fixe** (§ 7) et que les montants et
bénéficiaires restent cachés.

### Option B : seuil vérifié dans le circuit
Le circuit vérifie `k` signatures ECDSA (secp256k1) ou passkeys (P-256) sur `hashLot`. Noir fournit
ces vérifications comme primitives optimisées. L'autorité reste alors privée. Le coût : des preuves
plus longues à générer, et la rotation des signataires devient une opération blindée. **À étudier
après la v1 (D2).**

---

## 7. Circuit `payroll_batch`

Un lot fait **B = 16 sorties** (taille fixe). Au-delà, plusieurs lots ; en deçà, des sorties
fictives de valeur 0 indistinguables.

### Entrées
| Publiques | Privées |
|---|---|
| `noteRoot`, `maturityIndex`, `assocRoot` | jusqu'à 4 notes d'entrée de l'organisation + chemins, `sk_org` |
| `nullifiers[4]` | pour chaque sortie `j` : `valeur_j`, `pk_j`, `IVK_j`, `e_j` |
| `engagements[16 + 1]` (paies + monnaie rendue), `E[16]` | note de monnaie rendue |
| `hashMémos`, `autorité`, `relayer`, `palierFrais` | |

### Contraintes (en plus de celles de `transact`, v2 § 6.2)
1. Toutes les entrées appartiennent à `pk_org`, et `autorité` est l'autorité enregistrée de `pk_org`
   (feuille `H(pk_org, autorité)` dans l'arbre des organisations).
2. `Σ entrées = Σ valeur_j + monnaie + frais`.
3. Chaque sortie `j` est une note furtive vers `(pk_j, IVK_j)` (v2 § 5.3), avec `origine = H_org(pk_org)`
   et l'étiquette héritée.
4. `étiquette ∈ assocRoot` (les fonds de l'organisation viennent d'un dépôt accepté).
5. Toutes les valeurs sur 64 bits, et les sommes sans dépassement du corps.

### Ce que voit la chaîne
Un lot de 16 engagements opaques, approuvé par un Safe. Ni les montants, ni les destinataires, ni le
nombre réel de bénéficiaires dans le lot.

---

## 8. Parcours

### 8.1 Mise en place de l'employeur
1. KYB auprès d'un fournisseur ; l'attestation est enregistrée dans `OrgRegistry` (§ 9.1).
2. Création de la graine organisation dans la console. `pk_org` et le Safe sont liés dans l'arbre des
   organisations.
3. Import des salariés : nom interne et adresse de paie `zk402:` (ou e-mail pour un lien de réclamation).

### 8.2 Alimentation du compte blindé (P3)
La masse salariale ne doit pas se lire dans les dépôts :
- **réserve blindée** : l'organisation garde plusieurs mois de paie dans le pool et réalimente de
  manière irrégulière ;
- **coupures fixes** (10 k$, 50 k$, 100 k$) ;
- **décorrélation temporelle** : la maturité (v2 § 6.4) interdit de dépenser un dépôt tout de suite,
  et la console recommande de déposer à distance du jour de paie.

### 8.3 Cycle de paie
1. La console calcule les nets (import CSV ou connecteur HRIS) et prépare les lots de 16.
2. Elle génère les preuves (worker dédié ou prouveur local ; objectif : moins d'une minute par lot, à
   mesurer).
3. Proposition au Safe → signatures → soumission via un relayer par OHTTP.
4. Chaque salarié reçoit une notification (e-mail ou push, **sans montant**) et voit sa fiche de paie
   dans son portefeuille.

### 8.4 Lien de réclamation (F4)
Pour un salarié sans portefeuille, la sortie est une note vers une **clé éphémère** `k`. Le lien
`https://app/claim#k` (le secret est après le `#`, il n'est jamais envoyé au serveur) permet de créer
un portefeuille et de transférer la note vers sa propre adresse. Si le lien n'est pas réclamé dans les
90 jours, l'employeur peut récupérer la note, car `k` est dérivé de `ovk_org`.

### 8.5 Du côté du salarié
- **Garder** en blindé et payer d'autres adresses `zk402:` en privé (loyer, prestataires).
- **Retirer** vers un wallet ou un exchange, avec la preuve d'origine (§ 9.2). Le portefeuille
  propose de **fractionner et d'étaler** les retraits, et d'arrondir, pour que le montant retiré ne
  soit pas exactement le salaire (§ 12).

---

## 9. Conformité

### 9.1 KYB des organisations
`OrgRegistry` accepte une organisation si elle présente une attestation valide (standard EAS sur Base)
émise par un fournisseur KYB agréé. `deposit` exige que l'expéditeur soit un Safe ou une adresse
enregistrée. La liste des fournisseurs acceptés est gouvernée avec un délai (timelock) et publiée.

### 9.2 Ensembles d'association (preuve d'origine)
Modèle Privacy Pools :
- un **fournisseur d'ensemble d'association** publie une racine des étiquettes de dépôts acceptés
  (organisations vérifiées, non sanctionnées) ;
- chaque `transact` et chaque `withdraw` prouve `étiquette ∈ assocRoot` ;
- l'exchange vérifie la preuve (ou la racine utilisée) et sait que les fonds viennent **d'un** employeur
  vérifié, sans savoir lequel ;
- si une organisation est retirée de l'ensemble, ses notes gardent une **sortie publique** vers
  l'adresse de dépôt d'origine (« ragequit ») : S2 est respecté, les fonds ne sont jamais bloqués.

### 9.3 Audit et réquisitions
- L'auditeur reçoit une clé de période `vk_org(période)` (§ 5.3) et exporte toutes les opérations avec
  les fiches de paie.
- Une réquisition passe par l'**employeur**, qui dispose de `ovk_org`. Il n'existe **aucune clé
  maîtresse** capable de lire tout le pool.
- Le salarié peut aussi divulguer lui-même ses paiements reçus (clé de visualisation entrante).

---

## 10. Contrats

| Contrat | Rôle |
|---|---|
| `ShieldedPool` | Celui de la v2, avec `deposit` restreint (§ 9.1), vérification `assocRoot`, et deux vérificateurs (`PayrollBatch`, `Transact`). |
| `PayrollAuthorizer` | Enregistre `approve(hashLot)` émis par un Safe ; le pool consomme l'approbation une seule fois. |
| `OrgRegistry` | Organisations KYB : `(pk_org, autorité Safe, attestation)` → arbre des organisations. |
| `AssociationSetRegistry` | Historique des racines publiées par les fournisseurs ; le pool accepte une racine récente. |
| `Ragequit` | Sortie publique des notes dont l'étiquette n'est plus dans l'ensemble, vers l'adresse de dépôt. |

Règles de sûreté identiques à la v2 (§ 8.1 et § 13) : vérificateurs immuables, plafonds de TVL au
lancement, pause des **dépôts** uniquement, file d'attente pour les gros retraits, tests d'invariants.

---

## 11. Preuve de revenu (F6)

Circuit `income_proof`, vérifié hors chaîne par le destinataire de la preuve (propriétaire,
banque) :

| Publiques | Privées |
|---|---|
| `noteRoot`, `orgTreeRoot`, `X` (seuil), `mois[3]`, `destinataireDeLaPreuve`, `nonce` | notes reçues + chemins, `ivk`, fiches de paie |

Contraintes : chaque note est dans l'arbre, appartient au salarié et a une `origine` qui correspond à
une organisation de l'arbre KYB. Pour chaque mois, la somme des notes est `≥ X`. La preuve est liée à
son destinataire et à un nonce, pour qu'elle ne puisse pas être réutilisée ailleurs.

Résultat : « Cette personne a reçu au moins 3 000 $ par mois sur les 3 derniers mois d'un employeur
vérifié », **sans révéler l'employeur, le salaire exact ni l'adresse**. En option, on peut révéler le
nom de l'employeur si le salarié le souhaite.

Limite honnête : la preuve atteste des **paiements reçus**, pas d'un contrat de travail. Rien
n'empêche une organisation vérifiée de verser de l'argent fictif à quelqu'un ; la valeur de la preuve
dépend du sérieux du KYB.

---

## 12. Modèle de menace

| Observateur | Ce qu'il apprend |
|---|---|
| Public | Qu'une organisation KYB dépose (coupures fixes) et que son Safe exécute des lots de taille fixe. Des retraits vers des adresses, avec preuve d'origine générique. **Pas de bénéficiaire, pas de montant par personne.** |
| Collègue | Rien des autres salaires (chacun n'a que sa clé). |
| Employeur | Ce qu'il a payé (normal). Pas ce que le salarié fait ensuite de ses fonds. |
| Auditeur | La période couverte par sa clé, rien d'autre. |
| Exchange | Le montant retiré et le fait que les fonds viennent d'un employeur vérifié. |
| Relayer / OHTTP | Comme en v2 : une preuve valide, pas d'IP. |

**Fuites résiduelles et parades** :
1. **Montant retiré = salaire** : l'exchange (et le public) voit un retrait de 4 237 $ peu après le
   jour de paie. *Parade* : le portefeuille fractionne, arrondit et étale les retraits, et encourage à
   garder un solde blindé.
2. **Pics autour du jour de paie** : de nombreux lots en fin de mois. Paradoxalement, ça **aide** :
   plus de lots simultanés, plus grand ensemble d'anonymat.
3. **Peu d'employeurs au démarrage** : si 3 organisations seulement utilisent le pool, l'origine
   d'un retrait est devinable. *Parade* : afficher la taille de l'ensemble ; privilégier un
   lancement avec une cohorte d'employeurs.
4. **Taille de l'organisation** : le nombre de lots par mois trahit un ordre de grandeur des effectifs
   (1 lot = jusqu'à 16 personnes). *Parade* : l'employeur peut ajouter des lots fictifs.
5. **Option A multisig** : le Safe de l'organisation est visible quand il paie. *Parade* : l'option B.

---

## 13. Frais et modèle économique (à valider)

- **Gas** : un lot de 16 = 1 preuve + 17 insertions. Sur Base, à mesurer, mais attendu très inférieur
  au coût d'un virement international.
- **Frais de protocole** : un montant fixe par sortie non fictive, prélevé dans la preuve (fixe pour ne
  pas créer d'empreinte).
- **Offre SaaS** autour du protocole : console employeur, connecteurs HRIS et comptables, support.
  Le protocole reste utilisable sans la console (S2).

---

## 14. Composants à construire

| Composant | Réutilise | Nouveau |
|---|---|---|
| Circuits | `transact` (v2), notes furtives, maturité | `payroll_batch`, `income_proof`, champ `origine`, preuve d'ensemble d'association |
| Contrats | `ShieldedPool`, arbres, relayers | `PayrollAuthorizer`, `OrgRegistry`, `AssociationSetRegistry`, `Ragequit`, dépôt restreint |
| Console employeur | — | Import CSV/HRIS, calcul des lots, prouveur, intégration Safe, export comptable |
| Portefeuille salarié | Portefeuille v2 (graine, PRF, notes) | Fiches de paie, lien de réclamation, retraits guidés, preuves de revenu |
| Services | Relayer, OHTTP, indexeur | Fournisseur d'ensemble d'association (ou intégration d'un existant) |

---

## 15. Décisions ouvertes

| # | Question | Recommandation |
|---|---|---|
| D1 | Dépôts restreints aux organisations KYB | **Oui** (§ 3) |
| D2 | Autorisation multisig : on-chain (A) ou dans le circuit (B) | A pour la v1, B étudiée ensuite |
| D3 | Taille de lot `B` | 16 (compromis entre temps de preuve et nombre de lots) |
| D4 | Fournisseur d'ensemble d'association : opéré par ZK402 ou intégré | Intégrer un fournisseur existant si possible ; sinon opérer avec gouvernance publique |
| D5 | Coupures de dépôt | 10 k$, 50 k$, 100 k$ |
| D6 | Système de preuve | Comme v2 : Noir/UltraHonk, à confirmer par mesure du gas et du temps de preuve d'un lot |
| D7 | Lien de réclamation : délai de récupération | 90 jours |

---

## 16. Plan de travail

| Phase | Livrable | Critère de sortie |
|---|---|---|
| 0. Validation | 10 entretiens avec des employeurs crypto-natifs payant en USDC sur Base, 5 avec des salariés, 2 avec des exchanges ou off-ramps | Au moins 3 employeurs prêts à piloter ; exigences d'audit confirmées ; position des exchanges sur la preuve d'origine |
| 1. Spécification exécutable | Modèle de référence (TypeScript) de `payroll_batch`, `transact`, `income_proof` | Vecteurs de test figés |
| 2. Circuits | Noir, tests négatifs, fuzzing différentiel, mesure du temps de preuve d'un lot de 16 | Zéro désaccord avec le modèle ; lot < 60 s sur une machine standard |
| 3. Contrats | Pool, autorisation Safe, registres, ragequit ; tests d'invariants | Couverture des chemins d'échec ; audit interne |
| 4. MVP testnet | Console (CSV → lot → Safe → versement), portefeuille salarié (réception, fiche, retrait), export CSV | Un cycle de paie complet sur Base Sepolia avec une organisation pilote |
| 5. Durcissement | Audits externes, ensemble d'association, preuves de revenu, bug bounty | Rapport d'audit ; lancement mainnet avec plafonds bas |

---

## 17. Questions pour les entretiens (phase 0)

**Employeurs** : comment payez-vous aujourd'hui (outil, chaîne, fréquence) ? Les salaires sont-ils
visibles on-chain, et quelqu'un s'en est-il servi ? Qui doit approuver un versement ? Qu'exige votre
comptable ou votre auditeur ? Accepteriez-vous un KYB ? Combien paieriez-vous par salarié et par mois ?

**Salariés** : que faites-vous de votre paie en USDC (garder, convertir, où) ? Avez-vous déjà eu besoin
de prouver vos revenus ? Seriez-vous gêné que vos collègues voient votre salaire ?

**Exchanges / off-ramps** : accepteriez-vous un dépôt venant d'un pool blindé avec une preuve
d'appartenance à un ensemble d'employeurs vérifiés ? Qu'exigeriez-vous de plus ?
