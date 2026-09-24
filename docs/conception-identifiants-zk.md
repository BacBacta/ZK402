# ZK Verified — conception détaillée : prouver qu'on est vérifié par Coinbase, sans se doxxer

> **Statut** : proposition de conception, rien n'est implémenté. Étage 1 de la plateforme décrite dans
> [`opportunites-zk-fhe-base.md`](opportunites-zk-fhe-base.md) (§ 5).
>
> **En une phrase** : un détenteur d'une attestation **Coinbase Verifications** l'enregistre une fois,
> puis prouve de façon anonyme « je suis un compte vérifié (non-US, de l'UE…) » dans n'importe quelle
> app de Base. Une seule action par personne et par campagne, sans lien avec son adresse.

---

## 1. Faits de départ (vérifiés)

| Fait | Source | Conséquence |
|---|---|---|
| Attestations EAS émises par Coinbase sur Base : **Verified Account** (booléen), **Verified Country** (code ISO 3166-1 alpha-2), **Verified Coinbase One** | dépôt `coinbase/verifications` | Trois familles de groupes possibles. |
| Vérification on-chain : `CoinbaseIndexer.getAttestationUid(adresse, schéma)` puis `EAS.getAttestation(uid)` ; contrôle de révocation et d'expiration | idem (`AttestationAccessControl`, `AttestationVerifier`) | Le registre peut **vérifier lui-même** l'éligibilité, sans oracle. |
| Adresses sur Base mainnet : Indexer `0x2c7e…619C`, Attester `0x3574…d7EE`, EAS `0x4200…0021` (predeploy) | idem | Intégration directe. |
| Identifiants de schémas mainnet : Account `0xf8b0…0de9`, Country `0x1801…a065`, Coinbase One `0x254b…f9f4` | idem | Paramètres du registre. |
| **Avertissement de Coinbase** : les attestations sont « informatives » et **ne doivent pas servir à des fins légales, de conformité ou contractuelles** ; leur statut peut être en retard sur celui du compte | idem | ZK Verified est un outil **anti-sybil et de filtrage d'accès**, **pas** un outil de conformité KYC. |
| Une vérification peut être liée à **jusqu'à 3 adresses** ; révocation possible **24 h** après l'attestation ; réémission automatique si le pays ou le statut change | aide Coinbase (via recherche, page non accessible directement : **à confirmer**) | Borne anti-sybil : au plus 3 identités par personne et par campagne (§ 6). |
| **Semaphore v4** est déployé sur Base mainnet et Base Sepolia (`Semaphore` `0x8A1f…693D`, `SemaphoreVerifier` `0x4DeC…31f8`) | docs.semaphore.pse.dev | On réutilise un protocole ZK éprouvé au lieu d'écrire nos propres circuits. |

**Conséquence sur la cartographie** : l'usage « éligibilité Reg S pour les actions tokenisées » (O4) ne
peut **pas** reposer légalement sur ces attestations. Il ne reste possible qu'avec l'accord explicite
de Coinbase.

---

## 2. Principe de conception : ne pas réécrire la cryptographie

Le risque n°1 d'un projet ZK est un circuit mal contraint. Semaphore v4 fournit exactement la
primitive nécessaire : appartenance anonyme à un groupe + nullifier par portée. Il a un vérificateur
déployé sur Base, des bibliothèques JS et une cérémonie de setup Groth16 déjà réalisée.

**Notre valeur ajoutée n'est pas le circuit**. Elle tient en quatre points :
1. **la gestion des groupes adossée aux attestations Coinbase** : inscription vérifiée on-chain,
   élagage sans permission des attestations révoquées ;
2. **les règles anti-sybil propres à Coinbase** (3 adresses, révocation puis ré-attestation) ;
3. **la confidentialité de bout en bout** : wallet neuf, gas sponsorisé, âge minimal de racine ;
4. **un SDK** qui rend l'intégration triviale pour les apps de Base.

Aucun circuit sur mesure en v1. Les prédicats (non-US, UE…) sont exprimés par des **groupes**, pas par
des contraintes.

---

## 3. Architecture

```
          Utilisateur
   ┌────────────────────────────────┐
   │ wallet attesté (Coinbase)      │── 1. register(idc, groupes) ─────────────┐
   │ identité Semaphore (secret)    │                                           ▼
   │ wallet neuf pour agir          │                        ┌─────────────────────────────────┐
   └──────────────┬─────────────────┘                        │ ZkVerifiedRegistry (Base)       │
                  │ 2. preuve Semaphore (dans le navigateur) │  ├ vérifie l'attestation :      │
                  │    message = action (ex. destinataire)   │  │  CoinbaseIndexer → EAS        │
                  ▼                                          │  ├ admin des groupes Semaphore  │
   ┌────────────────────────────────┐                        │  │  ACCOUNT, NON_US, EU, CB_ONE… │
   │ App / campagne                 │                        │  └ prune(adresse) si révoquée  │
   │  ├ on-chain : ZkVerifiedGate   │◄── 3. verify(campagne, preuve) ── racines + SemaphoreVerifier
   │  └ off-chain : SDK serveur     │                        └─────────────────────────────────┘
   └────────────────────────────────┘
        gas sponsorisé (paymaster CDP ou relayer) : le wallet neuf n'a pas besoin d'ETH
```

---

## 4. Contrats

### 4.1 `ZkVerifiedRegistry`

Il est l'**administrateur** de plusieurs groupes Semaphore v4.

| Groupe | Condition d'entrée (vérifiée on-chain à l'inscription) |
|---|---|
| `ACCOUNT` | Attestation *Verified Account* valide |
| `NON_US` | *Verified Account* + *Verified Country* ≠ `US` |
| `EU` | *Verified Account* + pays ∈ liste UE (constante) |
| `CB_ONE` | *Verified Coinbase One* valide |
| `COUNTRY_xx` | Créé **seulement** si la taille prévisible du groupe est suffisante (§ 7.3) |

```solidity
function register(uint256 identityCommitment, uint256 groupsMask) external;
//  pour chaque groupe demandé : vérifie l'attestation de msg.sender (indexer + EAS,
//  non révoquée, non expirée, bon schéma, bon attester), puis addMember(groupe, idc).
//  Une adresse ne peut avoir qu'UNE identité par groupe (mapping adresse → idc).

function rotate(uint256 newIdc, uint256[] calldata siblings) external;
//  remplace l'identité de msg.sender (perte ou compromission du secret) :
//  updateMember(ancien → nouveau). Délai de 7 jours entre deux rotations.

function prune(address account, uint256 groupId, uint256[] calldata siblings) external;
//  SANS PERMISSION : si l'attestation de `account` est révoquée, expirée ou ne satisfait
//  plus la condition du groupe (pays changé), removeMember. Petite prime prélevée sur
//  un fonds de maintenance pour inciter les keepers.
```

**Pourquoi une identité par adresse** : sinon, une seule adresse attestée pourrait inscrire un nombre
illimité d'identités.

**Pourquoi un élagage sans permission** : l'état de l'attestation est public et vérifiable par le
contrat ; il n'y a donc aucun besoin d'un opérateur de confiance pour retirer un membre.

### 4.2 `ZkVerifiedGate`

C'est le vérificateur pour les apps. Il appelle directement le `SemaphoreVerifier` déployé.

```solidity
struct Campaign {
    uint256 groupId;      // ex. NON_US
    uint256 scope;        // identifiant unique de la campagne → nullifier dédié
    uint256 snapshotRoot; // racine figée à l'ouverture (0 = racine glissante)
    uint64  minRootAge;   // âge minimal de la racine utilisée (racine glissante)
    uint64  start; uint64 end;
}

function createCampaign(Campaign calldata c) external returns (uint256 id);
function verify(uint256 campaignId, SemaphoreProof calldata p) external returns (bool);
//  - p.scope == campaign.scope ;
//  - racine : == snapshotRoot, OU racine connue du groupe et âgée d'au moins minRootAge ;
//  - nullifier jamais vu pour cette campagne (puis marqué) ;
//  - SemaphoreVerifier.verifyProof(...) ;
//  - p.message est rendu à l'app appelante (ex. adresse de réception de l'airdrop).
```

Modificateur pour les intégrateurs : `onlyZkVerified(campaignId, proof)`.

---

## 5. Parcours utilisateur

1. **Inscription** (une fois, environ 1 minute) : l'utilisateur connecte le wallet qui porte son
   attestation Coinbase et choisit ses groupes. L'identité Semaphore est créée **localement** :
   - wallet classique (EOA) : dérivée d'une signature déterministe d'un message fixe, donc récupérable ;
   - Coinbase Smart Wallet (passkey) : les signatures ne sont pas déterministes, donc on utilise un
     secret aléatoire, chiffré par l'extension WebAuthn PRF et sauvegardé.

   Puis une transaction `register(idc, groupes)`.
2. **Attente** : les campagnes à racine glissante exigent une racine d'au moins `minRootAge` (ex. 6 h).
   Les inscriptions d'une même période se mélangent (§ 7.2).
3. **Utilisation** : sur l'app, l'utilisateur agit depuis un **wallet neuf** (ou un smart wallet
   dédié). Le navigateur génère la preuve Semaphore (quelques secondes) avec `message = action`
   (destinataire, vote…) et `scope = campagne`. La transaction est sponsorisée (paymaster CDP ou
   relayer) : pas besoin de financer le wallet neuf, donc pas de lien par le financement.

---

## 6. Résistance aux sybils

| Attaque | Parade | Borne résiduelle |
|---|---|---|
| Une adresse inscrit plusieurs identités | Une identité par adresse et par groupe | — |
| Un compte Coinbase atteste plusieurs adresses | Aucune dédoublonnage on-chain possible (l'attestation ne porte pas d'identifiant de compte) | **≤ 3 identités par personne** (limite Coinbase, à confirmer) |
| Révocation, ré-attestation sur une nouvelle adresse, nouvelle inscription | L'ancienne feuille est élaguée ; **les campagnes sensibles utilisent une racine figée** (`snapshotRoot`) à l'ouverture | ≤ 3 par personne **et par campagne** |
| Même personne, même campagne, plusieurs fois | Nullifier `H(scope, secret)` unique par campagne | 1 par identité |
| Vente ou location d'une identité | Inhérent à tout identifiant anonyme : impossible de distinguer le titulaire d'un acheteur | Le vendeur ne vend que **ses** ≤ 3 places par campagne |
| Retard de révocation chez Coinbase | Hors de notre contrôle (avertissement Coinbase) | Fenêtre de décalage d'une durée inconnue |

**Message produit honnête** : « au plus 3 participations par personne vérifiée et par campagne ».
C'est beaucoup mieux que l'absence de contrôle, mais ce n'est pas « 1 humain = 1 voix ». Si c'est
nécessaire, on peut combiner avec d'autres groupes (par ex. `CB_ONE`, plus coûteux à obtenir).

---

## 7. Confidentialité

### 7.1 Ce qui est public et ce qui ne l'est pas

| Public | Caché |
|---|---|
| Qu'une adresse attestée s'est **inscrite** dans tel groupe (et donc son pays, déjà public via l'attestation) | **Où, quand et pour quoi** elle utilise son identité |
| La taille de chaque groupe | Le lien entre deux campagnes (nullifiers différents) |
| Pour une campagne : le nombre de participations, les nullifiers, les messages (ex. destinataires) | Quel membre du groupe se cache derrière chaque participation |

### 7.2 Corrélations et parades

1. **Inscription suivie d'une utilisation immédiate** : parade `minRootAge` ou racine figée. Les
   nouveaux inscrits n'apparaissent dans une racine utilisable qu'avec un lot d'autres.
2. **Même wallet pour s'inscrire et agir** : c'est l'erreur qui annule tout. Le SDK **refuse** qu'une
   preuve ait pour message l'adresse attestée elle-même, et impose un wallet neuf avec gas sponsorisé.
3. **Financement du wallet neuf** : gas sponsorisé ; le SDK déconseille tout transfert direct depuis
   le wallet attesté.
4. **IP et métadonnées réseau** : vérification hors chaîne possible via OHTTP (même approche que la v2).
5. **Horodatage** : pour une participation hors chaîne, le serveur ne voit qu'une preuve. On-chain,
   les délais aléatoires côté SDK réduisent la corrélation avec l'activité du wallet attesté.

### 7.3 Petits groupes
Un groupe `COUNTRY_LU` avec 40 membres offre peu d'anonymat. Règles :
- le SDK affiche la **taille réelle** du groupe à l'utilisateur et à l'intégrateur ;
- `createCampaign` **refuse** un groupe de moins de `k = 500` membres (paramètre public) ;
- on privilégie des groupes larges (`ACCOUNT`, `NON_US`, `EU`).

---

## 8. SDK et intégration

| Paquet | Contenu |
|---|---|
| `@zkverified/sdk` (navigateur) | Création et récupération de l'identité, inscription, génération de preuve, garde-fous (wallet neuf obligatoire, âge de racine, taille du groupe). |
| `@zkverified/react` | `useZkVerified()`, bouton « Prouver que je suis vérifié », états de chargement. |
| `@zkverified/server` | Vérification hors chaîne (Node) pour les usages web2 : formulaire d'airdrop, accès à un Discord ou Telegram, bêta privée. Stockage des nullifiers par campagne. |
| `ZkVerifiedGate` + modificateur Solidity | Intégration on-chain en quelques lignes. |

Exemple d'intégration on-chain (airdrop anti-sybil) :

```solidity
function claim(SemaphoreProof calldata p) external {
    gate.verify(CAMPAIGN_ID, p);                       // revert si invalide ou déjà utilisé
    address to = address(uint160(p.message));          // destinataire lié à la preuve
    token.transfer(to, AMOUNT);
}
```

---

## 9. Premiers cas d'usage (MVP)

| Cas | Groupe | Pourquoi c'est un bon premier client |
|---|---|---|
| **Airdrop ou distribution anti-sybil** | `ACCOUNT` ou `NON_US` | Douleur permanente ; intégration simple (vérifier une preuve, envoyer des jetons). |
| **Sondage ou vote communautaire anonyme** (1 personne vérifiée = ≤ 3 voix) | `ACCOUNT` | Démontre l'anonymat ; aucun enjeu financier pour commencer. |
| **Accès réservé** (bêta, communauté, allowlist de mint) | tout groupe | Vérification hors chaîne ; aucun contrat à écrire pour l'intégrateur. |
| **Lancements scellés (étage 2)** | `ACCOUNT` | Une offre par personne vérifiée : c'est la brique anti-sybil de l'étage 2. |

---

## 10. Concurrence et différenciation

| Solution | Principe | Différence avec ZK Verified |
|---|---|---|
| Vérification directe de l'attestation (`AttestationAccessControl` de Coinbase) | L'app lit l'attestation de `msg.sender` | **Doxxe** l'utilisateur : c'est ce qu'on corrige. |
| Semaphore seul | Groupes anonymes génériques | Aucune gestion de groupes adossée à Coinbase : c'est notre couche. |
| World ID, Self, zkPass, zkMe… | Preuve d'humanité ou de KYC par leur propre vérification | Nouvel enrôlement nécessaire (orbe, passeport, documents). Ici, **plus de 100 M de clients Coinbase** peuvent s'inscrire en une minute, sans nouveau KYC. |
| Gitcoin Passport / Human Passport | Score agrégé de « stamps » | Non anonyme par défaut ; notre brique pourrait devenir un « stamp » anonyme. |

Différenciation : **natif Base, zéro nouvel enrôlement, anonyme, sans opérateur**.

---

## 11. Modèle économique (à valider)

- **Le cœur reste un bien commun** (registre, portail, SDK open source) : plus il y a d'inscrits, plus
  l'anonymat de chacun est grand. Rendre l'inscription payante nuirait au produit.
- **Services payants** : tableau de bord de campagnes, gas sponsorisé géré, vérification hors chaîne
  hébergée, statistiques agrégées respectueuses de la vie privée, support d'intégration.

---

## 12. Risques

| Risque | Gravité | Réponse |
|---|---|---|
| **Conditions d'utilisation de Coinbase** : l'usage de leurs attestations par un tiers est-il permis ? | Élevée | Contacter Coinbase (formulaire « Build with Coinbase Verifications ») **avant** le lancement. |
| **Coinbase modifie ou arrête le service** (schémas, indexer) | Moyenne | Registre paramétrable par schéma ; groupes multi-sources possibles plus tard (autres attesteurs). |
| **Coinbase lance sa propre version anonyme** | Moyenne | Rester compatible ; notre valeur est aussi dans le SDK et les produits des étages 2 et 3. |
| **Petit ensemble d'anonymat au démarrage** | Moyenne | Seuil `k`, groupes larges, campagne de lancement pour amorcer les inscriptions. |
| **Erreur d'usage** (agir depuis le wallet attesté) | Élevée pour la personne | Garde-fous du SDK (§ 7.2), pédagogie dans l'interface. |
| Faille dans Semaphore | Faible | Protocole de référence de PSE, largement utilisé ; suivre ses mises à jour. |

---

## 13. Plan de travail

| Phase | Livrable | Critère de sortie |
|---|---|---|
| 0. Validation (2 sem.) | Contact Coinbase (conditions, limite de 3 adresses) ; 10 entretiens avec des apps Base (airdrops, lanceurs, communautés) | Feu vert ou refus explicite de Coinbase ; ≥ 3 intégrateurs pilotes |
| 1. Contrats (2–3 sem.) | `ZkVerifiedRegistry`, `ZkVerifiedGate` ; tests sur un **fork de Base mainnet** (on usurpe des adresses réellement attestées, lecture seule) | Inscription, élagage, racine figée, double participation refusée, adresse non attestée refusée |
| 2. SDK (2 sem.) | Navigateur + React + serveur, garde-fous | Parcours complet sur Base Sepolia ; preuve < 5 s sur mobile récent |
| 3. Pilotes (4 sem.) | 1 airdrop, 1 vote, 1 accès réservé avec des partenaires | Retours intégrateurs ; mesure de la taille des groupes |
| 4. Audit et mainnet | Audit des deux contrats (Semaphore est réutilisé tel quel) | Rapport ; lancement avec campagne d'inscription |

---

## Sources

- Coinbase Verifications (contrats, schémas, avertissement) : https://github.com/coinbase/verifications
- Aide Coinbase — vérification on-chain (3 adresses, révocation après 24 h ; page non accessible
  directement, information obtenue via recherche, **à confirmer**) :
  https://help.coinbase.com/en/coinbase/getting-started/verify-my-account/onchain-verification ;
  https://docs.verifiedpools.com/developers/verifications
- Semaphore v4, contrats déployés (dont Base) : https://docs.semaphore.pse.dev/deployed-contracts
- Blockworks — lancement de Coinbase Verifications sur Base :
  https://blockworks.com/news/coinbase-identity-verification-kyc
