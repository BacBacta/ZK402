# S1 — Modèle de menaces (incrément 1 : fondations P1, P2, P7)

> Livrable 1 du programme [`prompt-s1-points-ouverts.md`](prompt-s1-points-ouverts.md).
> Méthode : STRIDE (sécurité) + LINDDUN (vie privée), NIST SP 800-30 (risque).
> Faits vérifiés le **24 septembre 2026**. Toute valeur non vérifiée est marquée **HYPOTHÈSE**.

---

## 1. Faits d'infrastructure vérifiés (sources)

| Composant | Fait | Source |
|---|---|---|
| **Déchiffrement CoFHE** | Fait **aujourd'hui** par **Teecryptor** : *une seule* VM Intel TDX (GCP Confidential Space). La clé FHE y est reconstruite au démarrage à partir de **parts Shamir détenues par des partenaires**, chacun ne livrant sa part qu'à une image attestée. Le « Threshold Network » est une **feuille de route**, pas l'état actuel. | dépôt `FhenixProtocol/teecryptor` ; PR de documentation n° 73 (fusionnée le 3 septembre 2026) |
| **Périmètre de sécurité de Teecryptor (phase 1)** | Seule garantie : « la clé secrète FHE ne se matérialise que dans l'image attestée ». **Hors périmètre** : canaux auxiliaires TEE, compromission de l'invité, collusion des partenaires, intégrité de bout en bout des résultats, rotation des clés, haute disponibilité. | `teecryptor/SECURITY-OVERVIEW.md` |
| **Vérifieur d'entrées** | Service Fhenix qui signe l'admissibilité des chiffrés d'entrée (`testnet-cofhe-vrf.fhenix.zone`) ; la signature est vérifiée par le TaskManager on-chain. | SDK `@cofhe/sdk` 0.7.1 ; mesures |
| **TaskManager CoFHE sur Base Sepolia** | `0xeA30c4B8b44078Bbf8a6ef5b9f1eC1626C7848D9` (proxy ERC-1967) | on-chain |
| **Chainlink ETH/USD, Base Sepolia** | `0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1`, `description() = "ETH / USD"`, 8 décimales, dernière mise à jour il y a moins de 10 min lors de la lecture | lecture on-chain |
| **Pyth, Base Sepolia** | `0xA2aa501b19aff244D90cc15a4Cf739D2725B5729` (proxy) ; flux ETH/USD `0xff61…0ace` | documentation Pyth ; code on-chain présent |
| **Séquenceur de Base** | Centralisé. L'inclusion forcée via L1 (dépôt OP Stack) est garantie avec un délai **≤ 12 h** (fenêtre de séquençage). | documentation Optimism, L2BEAT |
| **Standard de jeton confidentiel** | ERC-7984 est au stade **DRAFT** ; implémentation OpenZeppelin ciblant Zama fhEVM. Fhenix est membre de la Confidential Token Association. Côté CoFHE : FHERC20. | EIP-7984, documentation OpenZeppelin |

**Conséquence majeure** : la **confidentialité de tout le système CoFHE** (pas seulement la
nôtre) repose aujourd'hui sur **un seul TEE**, plus la non-collusion des détenteurs de parts. Il n'y
a pas de seuil t-sur-n à l'exécution. Cette limite ne peut pas être levée par notre protocole. Elle
peut seulement être **bornée** et **rendue explicite** (voir § 5 et la spécification).

---

## 2. Actifs à protéger

| Actif | Propriété | Priorité |
|---|---|---|
| A1. Fonds des traders (réserves du pool) | **Intégrité et solvabilité** : aucun vol, aucune création | Critique |
| A2. Contenu des ordres (sens, taille, limite) | **Confidentialité avant exécution** | Critique (c'est la raison d'être du produit) |
| A3. Exécutions et soldes | Confidentialité après exécution | Haute |
| A4. Lien identité ↔ activité (qui trade, quand, combien de fois) | Non-association | Haute |
| A5. Équité de l'appariement | Intégrité : prix de référence correct, allocation conforme à la règle | Haute |
| A6. Disponibilité | Vivacité : les lots se règlent, les retraits aboutissent | Haute |

---

## 3. Acteurs et registre de confiance — AVANT (contrat v1 `SealedBatchPool`)

| Acteur | Ce qu'il voit | Ce qu'il peut faire | Pour nuire, il lui faut |
|---|---|---|---|
| **Opérateur** (`operator`) | Pareil que le public | **Fixer le prix de croisement** ; **choisir le moment** du règlement ; ne pas régler (censure du lot) | Rien : c'est un **pouvoir unilatéral** (P7) |
| **Séquenceur de Base** | Transactions en clair (calldata = chiffrés + preuves) ; ordre d'arrivée | Réordonner ou retarder, censurer ≤ 12 h | Être le séquenceur (Coinbase) |
| **Teecryptor (Fhenix)** | **Tout en clair s'il est compromis** : il détient la clé FHE complète | Déchiffrer n'importe quel chiffré ; **signer de faux clairs** | Compromission du TEE (canal auxiliaire, faille TDX) **ou** collusion des partenaires de parts **ou** image malveillante approuvée |
| **Vérifieur d'entrées** | Les chiffrés soumis et leurs métadonnées | Admettre des entrées non conformes, refuser (censure) | Compromission du service |
| **Coprocesseur CoFHE** | Chiffrés, graphe des opérations | Calculer faux, ne pas calculer (vivacité) | Compromission du service |
| **Public / autres traders** | Adresse de chaque soumetteur, horodatage, nombre d'ordres par lot, participants du lot, gas | Sonder, analyser les métadonnées | Rien (tout est public) |
| **Oracle** | — | Inexistant en v1 : c'est l'opérateur qui fournit le prix | — |

---

## 4. STRIDE (sécurité), par composant

| Menace | Composant | Scénario | v1 | Traitement (incrément 1) |
|---|---|---|---|---|
| **S**poofing | Soumission | Rejouer le chiffré d'un autre trader | Bloqué par l'ACL et la signature du vérifieur liée à l'expéditeur et au contrat | Conservé ; documenté comme dépendant du vérifieur |
| **T**ampering | Prix | L'opérateur choisit un prix favorable à un complice | **Ouvert** | Oracle à deux sources (Chainlink + Pyth), contrôles d'ancienneté et d'écart, **sans opérateur** |
| **T**ampering | Déchiffrement | Teecryptor signe un faux clair de retrait → vol | Non applicable en v1 (pas de retrait) | **Borne de débit sur les réserves** (disjoncteur sans permission) : voir la spécification, § P2 |
| **R**epudiation | Règlement | Contester un résultat | Événements on-chain | Conservé |
| **I**nformation disclosure | Ordres | Voir sens et taille | Chiffré | Conservé ; dépend de Teecryptor (§ 1) |
| **I**nformation disclosure | Métadonnées | Qui trade, quand, participants | **Ouvert** | P1 : inventaire + conception (spécification) |
| **D**enial of service | Lot | L'opérateur ne règle pas | **Ouvert** | Règlement **sans permission** après échéance |
| **D**enial of service | Lot | Remplir le lot d'ordres parasites (MAX_ORDERS) | **Ouvert** | Frais de soumission et plafond par identité ; analyse dans la spécification |
| **E**levation of privilege | Rôles | `operator` à vie, immuable | **Ouvert** | **Suppression du rôle** |

## 5. LINDDUN (vie privée) — inventaire des fuites observables (v1)

Construit en lisant le contrat, ses événements, son stockage public et les appels ACL.

| # | Observable on-chain | Catégorie LINDDUN | Donnée révélée |
|---|---|---|---|
| L1 | `msg.sender` de `submitOrder` | Linking, Identifying | **Qui** participe à quel lot |
| L2 | `OrderSubmitted(batchId, trader, index)` | Linking | Identique à L1, plus le rang FIFO (qui influe sur l'exécution) |
| L3 | Horodatage et bloc de soumission | Detecting | **Quand** ; corrélable à l'activité externe (CEX, autres DEX) |
| L4 | `orderCount()` et nombre d'événements par lot | Detecting | Taille du lot, donc activité |
| L5 | `claimFaucet` / futurs dépôts et retraits en clair | Identifying, Linking | **Montants entrant et sortant en clair** par adresse ; borne le volume tradé |
| L6 | `FHE.allow(fill, trader)` et mise à jour des soldes pour chaque ordre | Linking | Confirme la participation (mais **pas** le montant : un circuit constant touche tous les ordres) |
| L7 | Gas des transactions | Detecting | Constant par ordre (circuit constant) → **pas de fuite** du sens ni de la taille : vérifié (≈ 289 k par soumission, quel que soit l'ordre) |
| L8 | Taille du calldata | Detecting | Constante (deux chiffrés de types fixes) → **pas de fuite** |
| L9 | Handles chiffrés | — | Opaques ; pas de fuite, sauf compromission de Teecryptor |
| L10 | Prix de croisement | Disclosure | Public par conception (règle publique) ; ne révèle rien sur les ordres |
| L11 | Retrait après un lot | Linking | Un retrait en clair juste après le lot relie l'adresse à une **exécution probable** |

**Classement** :
- **inhérent aux chaînes publiques** (on ne peut que le borner) : L3 (existence et moment d'une
  transaction) ;
- **traitable par conception** : L1, L2, L4, L5, L6, L11 ;
- **déjà traité** : L7, L8, L9.

---

## 6. Registre de confiance — APRÈS l'incrément 1 (contrat v2 `SealedBatchPoolV2`)

| Acteur | Ce qu'il voit | Ce qu'il peut faire | Pour nuire, il lui faut | Changement |
|---|---|---|---|---|
| **Opérateur** | — | **Rien** : le rôle est supprimé | — | ✅ Pouvoir supprimé, **non déplacé** : le prix va à une règle publique sur deux oracles, le moment à une échéance on-chain, le déclenchement à n'importe qui |
| **Déclencheur (n'importe qui)** | Public | Appeler `settle` **après** l'échéance, au prix calculé par le contrat | Rien : ne choisit ni le prix ni l'ordre | Nouveau, **sans pouvoir discrétionnaire** |
| **Oracles** (Chainlink, Pyth) | Public | Fournir un prix | Corrompre **les deux** au-delà de l'écart toléré, **ou** en rendre un indisponible (le lot est alors reporté, jamais réglé à un mauvais prix) | Nouveau : **2 sources indépendantes**, écart borné, ancienneté bornée. Le pouvoir est **plus faible et partagé** que celui de l'opérateur v1 |
| **Séquenceur de Base** | Identique | Retarder ≤ 12 h ; il ne peut **pas** choisir le prix (dérivé de l'oracle au moment du règlement) | Être le séquenceur | Inchangé (limite de la plateforme ; documenté) |
| **Teecryptor** | Tout, s'il est compromis | Déchiffrer ; signer de faux clairs | Idem v1 | **Borné, pas résolu** : aucune fonction v2 ne dépend d'un clair signé. Pour les retraits (incrément P4) : disjoncteur de débit sur les réserves (spécification § P2) |
| **Public** | L1 à L4, L6 (inchangé pour cet incrément) | Idem | — | **P1 est spécifié** mais pas encore implémenté (incrément 2) |

---

## 7. Risques résiduels à l'issue de l'incrément 1 (NIST SP 800-30 : probabilité × impact)

| Risque | Probabilité | Impact | Statut |
|---|---|---|---|
| Compromission de Teecryptor (canal auxiliaire TDX, collusion des partenaires) → fin de la confidentialité de **tous** les ordres passés et futurs | Faible à moyenne (TEE unique, canaux auxiliaires hors périmètre) | Critique (A2, A3) | **Non résoluble par notre protocole.** Borné : pas de clair signé sur le chemin des fonds en v2 ; plan : migrer vers le réseau de seuil dès sa disponibilité, avec ce critère d'adoption documenté |
| Métadonnées L1 à L6, L11 | Certaine | Haute (A4) | Conception dans la spécification, § P1 ; implémentation à l'incrément 2 |
| Oracles divergents ou indisponibles → lots reportés | Faible | Moyenne (A6) | Accepté : on préfère **reporter** plutôt que régler à un mauvais prix |
| Censure par le séquenceur ≤ 12 h | Faible | Moyenne (A6) | Inhérent à Base ; un lot n'a pas d'échéance dure côté trader (annulation possible) |
