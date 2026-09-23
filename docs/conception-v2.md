# ZK402 v2 — conception détaillée (révision « robuste »)

> **Statut** : proposition de conception, rien n'est implémenté. Cette révision remplace le
> premier jet (voir l'historique git). Elle part d'une analyse des faiblesses de ce premier
> jet et construit, pour chacune, un mécanisme d'ingénierie précis.
>
> **Parti pris** : la confidentialité repose sur des **preuves à divulgation nulle de
> connaissance (ZK)**. On ne fait confiance à aucun tiers pour l'exactitude des calculs, seulement
> à des hypothèses cryptographiques standard. Le FHE de la v1 reste en démo, hors du chemin critique
> (§ 16).

---

## 0. Résumé

Le lecteur dépose des fonds dans **un pool blindé commun**. Il paie un article avec **une
seule sorte de transaction ZK** (le circuit `transact`), soumise par un **relayer au choix**, via
**Oblivious HTTP**. La transaction crée pour le marchand une **note furtive** (stealth), sans
chiffré. Elle crée aussi pour le lecteur un **droit d'accès anonyme**, qu'il présente au site avec
une **preuve à nullifier limitant le débit (RLN)**. Toutes les clés vivent dans un **portefeuille
isolé** du site marchand.

| Faiblesse du premier jet | Mécanisme retenu | § |
|---|---|---|
| F1 Le site marchand sert le code qui manipule les clés | Portefeuille isolé + API fournisseur `zk402_*` + vérification du marchand par domaine | 9 |
| F2 Montant libre = empreinte, et le marchand voit chaque montant | Prix fixes + paliers de pourboire, note furtive au marchand | 5.3, 6 |
| F3 Relayer central : voit l'IP, peut censurer | Ensemble ouvert de relayers, frais par paliers, OHTTP obligatoire, repli ERC-4337 | 10 |
| F4 Corrélation temporelle dépôt → dépense | **Maturité des notes prouvée dans le circuit** + fractionnement anticipé | 6.4, 9.4 |
| F5 Ensemble d'anonymat petit | Pool unique multi-usage, transaction universelle, métrique affichée et seuils | 11 |
| F6 Circuits complexes, risque de sous-contrainte | Un seul circuit on-chain, modèle de référence, fuzzing par mutation, plafonds, audits | 13 |
| F7 Frais, limite de sessions, partage de l'accès | Frais par paliers, RLN avec **révocation automatique** si partage | 7, 10.2 |
| F8 Chiffrement de la note marchand coûteux et risqué | Suppression du chiffré : aléa dérivé par **ECDH sur la courbe embarquée** | 5.3 |
| F9 Perte des notes, stockage | Tout dérivé d'une graine, découverte sans chiffrés | 9.5 |

---

## 1. Analyse des faiblesses et de leurs causes

**F1 — Le fournisseur de code est l'adversaire.** Dans le premier jet, le prouveur tourne dans la
page servie par le marchand. Or c'est la partie qu'on veut empêcher d'apprendre des choses. Un
script modifié (volontairement ou après piratage) exfiltre `sk` : vol des fonds et
désanonymisation rétroactive de toutes les notes. *Cause : la frontière de confiance passe au
mauvais endroit.*

**F2 — Le montant libre est un identifiant.** Un pourboire de 4,02 $ est rare. Le marchand qui le
voit peut relier des visites. *Cause : l'espace des montants possibles est trop grand. Chaque bit
d'entropie du montant est un bit d'empreinte.*

**F3 — Le relayer concentre les métadonnées.** Il voit l'IP, l'heure et la preuve. Opéré par le
marchand, il relie le paiement à la session. Il peut aussi refuser des transactions. *Cause : un
point unique, et un transport qui révèle l'origine.*

**F4 — Le temps relie les événements.** Dans un pool peu actif, un dépôt suivi d'un paiement deux
minutes plus tard les relie. *Cause : rien n'impose de délai entre l'entrée dans l'ensemble
d'anonymat et sa première utilisation.*

**F5 — L'anonymat est une propriété collective.** Il vaut le nombre de notes indistinguables de la
sienne. *Cause : ensembles fragmentés (par ressource, par type de transaction, par montant) et
faible adoption.*

**F6 — La sûreté dépend de contraintes invisibles.** Un circuit sous-contraint compile, passe les
tests positifs et permet de créer de la valeur. *Cause : trois circuits on-chain, du chiffrement
dans le circuit, et une vérification uniquement positive.*

**F7 — Les petites valeurs publiques fuient.** Frais libres, compteurs de session, un secret
d'accès partageable sans conséquence. *Cause : des paramètres publics choisis par l'utilisateur et
aucune incitation à ne pas partager.*

**F8 — Livrer le reçu au marchand.** Le premier jet exigeait de chiffrer la note marchand *dans* le
circuit, sinon le marchand pouvait recevoir une note inutilisable. *Cause : transmettre un secret
(l'aléa de la note) au lieu de le faire dériver par le destinataire.*

**F9 — L'état est côté client.** Perdre ses notes, c'est perdre ses fonds. *Cause : aléas non
dérivables et découverte basée sur des chiffrés.*

---

## 2. Principes de conception

1. **Une seule forme de transaction on-chain.** Payer, fractionner, fusionner et retirer passent
   par le même circuit, avec la même forme de sorties. Moins de circuits à auditer, un ensemble
   d'anonymat non fragmenté.
2. **Rien de choisi librement par l'utilisateur n'est public.** Montants, frais et délais sont
   tirés d'ensembles petits et communs à tous.
3. **Le destinataire dérive les secrets, on ne les lui transmet pas** (adresses furtives).
4. **Frontière de confiance = le portefeuille.** Le site marchand ne voit jamais de clé ni de note.
5. **Défense en profondeur sur la sûreté.** Tests négatifs, fuzzing, plafonds de valeur, audits.
   Une pause ne peut jamais bloquer les retraits.
6. **Honnêteté sur le résiduel.** Ce qui ne peut pas être résolu par l'ingénierie est mesuré et
   affiché (§ 15).

---

## 3. Architecture

```
┌──────────── Portefeuille ZK402 (extension ou PWA sur une origine dédiée) ─────────────┐
│ graine (chiffrée par WebAuthn PRF) · notes · prouveur Noir/WASM · client OHTTP        │
│ API fournisseur : zk402_requestAccess, zk402_balance, zk402_deposit                   │
└───────▲───────────────────────────────┬───────────────────────────────┬───────────────┘
        │ requête (sans clé)            │ transact (OHTTP)              │ preuve access (OHTTP)
┌───────┴────────┐              ┌───────▼────────┐              ┌───────▼─────────────┐
│ Site marchand  │              │ Relais OHTTP A │              │ Relais OHTTP B      │
│ (page + 402)   │              └───────┬────────┘              └───────┬─────────────┘
└────────────────┘                      │                               │
                               ┌────────▼────────┐             ┌────────▼─────────────┐
                               │ Relayer (choisi │             │ Passerelle OHTTP du  │
                               │ par le client)  │             │ marchand → vérifie   │
                               └────────┬────────┘             │ la preuve RLN        │
                                        │ tx                   └──────────────────────┘
┌───────────────────────────────────────▼───────────────────────────────────────────────┐
│ Base : ShieldedPool (noteTree, accessTree, nullifiers, points de contrôle de maturité, │
│ paliers de frais, plafonds) · ResourceRegistry · TransactVerifier                      │
└───────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Primitives

| Élément | Choix | Raison |
|---|---|---|
| Système de preuve | Noir + Barretenberg (UltraHonk) | Pas de cérémonie par circuit, vérificateur Solidity généré, prouveur WASM. Alternative : Circom/Groth16 (D3). |
| Corps | BN254 (scalaire) | Natif pour UltraHonk et l'EVM. |
| Hachage | Poseidon2 | Économe en contraintes, disponible dans la bibliothèque standard de Noir. |
| Courbe pour l'ECDH | Grumpkin (courbe *embarquée* de BN254) | Ses opérations sont natives dans le circuit, donc bon marché. |
| Arbres | Merkle incrémental, profondeur 32 | 4 milliards de feuilles, chemin de taille fixe. |
| Séparation de domaine | Constante distincte en premier argument de chaque hachage | Empêche qu'une valeur d'un rôle soit réinterprétée dans un autre. |

Notation : `H_x(…) = Poseidon2(DOMAINE_x, …)`.

---

## 5. Modèle de données

### 5.1 Hiérarchie de clés (tout dérivé d'une graine)

```
graine (BIP-39)
 ├─ sk   = H_sk(graine)               clé de dépense
 ├─ nk   = H_nk(sk)                   clé de nullifier
 ├─ pk   = H_pk(sk)                   propriétaire des notes
 ├─ ivk  ∈ Fr(Grumpkin), IVK = ivk·G  clé de réception furtive (publiable)
 └─ sel  = H_sel(graine)              sel des aléas et des secrets d'accès
```

### 5.2 Note

```
note        = (valeur: u64, pk, aléa, jeton, étiquette)
précom      = H_pre(pk, aléa)
engagement  = H_note(valeur, jeton, étiquette, précom)
nullifier   = H_nf(nk, engagement, indexFeuille)
```

Lors d'un **dépôt**, le lecteur ne fournit que `précom`. Le contrat calcule
`étiquette = H_lab(pool, nonceDépôt)` et `engagement` lui-même (Poseidon2 on-chain) : le montant
et l'étiquette sont donc garantis corrects dès l'entrée, sans preuve.

- **Notes à soi** (monnaie rendue, fractionnement) : `aléa = H_rho(sel, compteur)`. Aucun chiffré
  n'est nécessaire, le portefeuille recalcule ses notes (§ 9.5).
- `étiquette` : identifiant du dépôt d'origine, hérité par les sorties à soi. Les notes furtives
  reçues par un marchand portent l'étiquette réservée `L_MARCHAND` (§ 5.3). Elle ne sert que si
  la conformité est activée (D4, § 12).

### 5.3 Note furtive vers le marchand (répond à F2 et F8)

Le payeur tire `e`, publie `E = e·G`, puis calcule dans le circuit :

```
S       = e · IVK_marchand                  (ECDH Grumpkin, dans le circuit)
aléa_m  = H_stealth(S.x, indexSortie)
note_m  = (prix + pourboire, pk_marchand, aléa_m, jeton, L_MARCHAND)
```

L'étiquette est la constante `L_MARCHAND` : le marchand n'a donc besoin d'aucune information
du payeur pour recalculer l'engagement. Le marchand calcule `S = ivk·E`, retrouve `aléa_m`, et teste les quelques valeurs possibles
(ses prix × paliers de pourboire) pour reconnaître ses notes. **Aucun chiffré n'est transmis**, donc
il n'y a rien à falsifier. Le circuit *impose* que la note marchand soit reconnaissable par son
destinataire. Un tiers ne connaît pas `ivk`, il ne peut donc ni reconnaître ni relier ces notes.

**Paliers de pourboire** : `pourboire ∈ {0 ; 1 $ ; 5 $}`. L'empreinte est au plus de log₂3 ≈ 1,6 bit,
et elle n'est visible **que du marchand**. Pour le public, toute sortie est un engagement opaque.

### 5.4 Registre de ressources

```
feuilleRegistre = H_reg(R, prix, pk_marchand, IVK_marchand, domaine)
R = H_res(URL canonique)
```

Un arbre unique pour tous les marchands. La transaction prouve l'appartenance à une feuille *sans
dire laquelle*. Le lien entre un marchand et son domaine est vérifié hors chaîne par le
portefeuille (§ 9.3).

### 5.5 Droit d'accès

```
s_R         = H_acc(sel, R)
feuilleAccès = H_leaf(s_R, R)     → insérée dans accessTree par la transaction de paiement
```

---

## 6. Circuit universel `transact`

**Un seul circuit** vérifié on-chain, pour tous les usages : payer, fractionner, fusionner,
retirer. Il a toujours 2 entrées et 3 sorties (2 notes à soi, 1 note furtive), et insère toujours
1 feuille d'accès. Les usages qui n'en ont pas besoin utilisent des valeurs fictives
indistinguables.

### 6.1 Entrées

| Publiques | Privées |
|---|---|
| `noteRoot`, `maturityIndex` | 2 notes d'entrée : valeur, aléa, étiquette, indexFeuille, chemin ; `sk` |
| `registryRoot` | `isPay` (bit) ; `R`, `prix`, `pk_m`, `IVK_m`, `domaine`, chemin registre ; `palierPourboire` |
| `nullifiers[2]` | 2 notes à soi : valeur, aléa |
| `engagements[3]`, `E[3]` | `e[3]` (scalaires éphémères) |
| `feuilleAccès` | `s_R` |
| `montantRetiré`, `destinataire` | |
| `relayer`, `palierFrais` | |

### 6.2 Contraintes

1. **Entrées** : pour chaque entrée `i`, si `valeur_i ≠ 0`, alors `engagement_i` ∈ `noteRoot` ;
   `nullifier_i = H_nf(nk, engagement_i, indexFeuille_i)`. Une entrée fictive (valeur 0) produit
   quand même un nullifier aléatoire distinct.
2. **Unicité** : `nullifiers[0] ≠ nullifiers[1]`.
3. **Maturité** : `indexFeuille_i < maturityIndex` pour toute entrée non fictive (§ 6.4).
4. **Bornes** : chaque valeur est dans [0, 2⁶⁴), vérifiée par décomposition en bits. Les sommes
   restent sous 2⁶⁶, donc pas de dépassement dans le corps.
5. **Conservation** :
   `Σ entrées = sortie₀ + sortie₁ + montantPayé + montantRetiré + frais(palierFrais)`.
6. **Paiement** (sans branchement, multiplié par `isPay`) :
   - la feuille `(R, prix, pk_m, IVK_m, domaine)` ∈ `registryRoot` quand `isPay = 1` ;
   - `montantPayé = isPay · (prix + pourboire(palierPourboire))` ;
   - la sortie 2 est la note furtive du § 5.3 vers `(pk_m, IVK_m)` ; si `isPay = 0`, c'est une note
     de valeur 0 vers une clé aléatoire, indistinguable ;
   - `feuilleAccès = H_leaf(s_R, R)` si `isPay = 1`, sinon une valeur aléatoire.
7. **Sorties à soi** : `engagement_k = H_note(valeur_k, jeton, étiquette, H_pre(pk, aléa_k))`.
8. **Liaison** : `relayer`, `destinataire`, `palierFrais` et `montantRetiré` sont des entrées
   publiques. Changer l'un d'eux invalide la preuve, donc pas de vol de frais ni de redirection.
9. **Étiquette** : les deux entrées non fictives ont la même étiquette, héritée par les sorties à
   soi ; la note furtive porte `L_MARCHAND`.

### 6.3 Ce que voit la chaîne

Deux nullifiers, trois engagements, trois points `E`, une feuille d'accès, un palier de frais et
l'adresse du relayer. Si c'est un retrait, s'ajoutent le montant (une coupure fixe) et le
destinataire. **Un paiement, un fractionnement et une fusion sont indistinguables.**

### 6.4 Maturité prouvée (répond à F4)

Le contrat enregistre des **points de contrôle** `(horodatage, tailleArbre)` au plus une fois par
heure. Il accepte `maturityIndex` seulement s'il égale la taille d'un point de contrôle d'au moins
`MATURITÉ` (paramètre de protocole, ex. 6 h, D7). Le circuit prouve que chaque note dépensée a un
index inférieur. Toute note dépensée a donc au moins `MATURITÉ` d'âge, **sans révéler laquelle**.

Le portefeuille utilise toujours le point de contrôle éligible le plus récent. Ce choix est le même
pour tous, il ne crée donc pas d'empreinte.

---

## 7. Circuit `access` (hors chaîne) : accès anonyme à débit limité

Il reprend le schéma **RLN** (Rate-Limiting Nullifier) : chaque utilisation révèle un point d'une
droite secrète. Deux utilisations de trop révèlent le secret.

### 7.1 Relation

Publiques : `accessRoot`, `R`, `époque`, `x = H_x(challenge, R)`, `y`, `nullifier`.
Privées : `s_R`, chemin, `idMessage`.

```
H_leaf(s_R, R) ∈ accessRoot
idMessage < LIMITE                         (ex. 20 sessions par époque d'un jour)
a₁        = H_a(s_R, R, époque, idMessage)
y         = s_R + a₁ · x                   (un point sur une droite)
nullifier = H_n(a₁)
```

### 7.2 Propriétés

- **Anonymat** : sessions de messages différents ou d'époques différentes non reliables (`a₁` change).
- **Pas de rejeu** : `x` dépend du `challenge` à usage unique de la 402.
- **Débit** : au plus `LIMITE` nullifiers distincts par époque.
- **Le partage est puni automatiquement** : réutiliser le même `(époque, idMessage)` donne deux
  points `(x₁, y₁)`, `(x₂, y₂)` sur la même droite. Le serveur calcule
  `a₁ = (y₁ − y₂)/(x₁ − x₂)` puis `s_R = y₁ − a₁·x₁`. Avec `s_R`, il peut calculer tous les
  nullifiers futurs de ce droit et les refuser : **le droit est révoqué**. `s_R` ne révèle ni `sk`,
  ni l'identité, ni les autres achats.
- **Pas d'empreinte** : `LIMITE` et l'époque sont les mêmes pour tous.

### 7.3 Vérification par le serveur

Il vérifie la preuve UltraHonk hors chaîne (prouveur Barretenberg sous Node), puis que `accessRoot`
est dans l'historique récent (events en cache). Il stocke ensuite `nullifier → (x, y)` pour
l'époque (Redis, avec expiration). Un nullifier déjà vu avec un autre `x` déclenche la récupération
de `s_R` et la liste noire. Un nullifier déjà vu avec le même `x` est un rejeu : refusé.

---

## 8. Contrats

### 8.1 `ShieldedPool`

| Fonction | Règles |
|---|---|
| `deposit(précom, coupure)` | `coupure` ∈ {5, 20, 100} $ ; transfert de l'ERC-20 ; le contrat calcule `étiquette` et `engagement` (§ 5.2) ; respect du plafond global (TVL) et du plafond par dépôt. |
| `transact(preuve, publiques)` | `noteRoot` et `registryRoot` dans l'historique des 100 dernières racines ; `maturityIndex` égal à un point de contrôle éligible ; nullifiers jamais vus ; `palierFrais` ∈ paliers ; `montantRetiré` ∈ {0} ∪ coupures ; vérification de la preuve ; insertions ; paiement des frais au `relayer` ; transfert du retrait. |
| `checkpoint()` | Appelé à l'intérieur de `transact` et de `deposit` au plus une fois par heure. |

Events : `Commitment(index, engagement, E)` ×3, `AccessLeaf(index, feuille)`,
`Nullifier(nf)` ×2, `Deposit(index, coupure)`, `Withdrawal(coupure, destinataire)`.

**Sûreté** :
- vérificateur immuable, pas de proxy : une nouvelle version = un nouveau pool, avec migration
  par retrait puis dépôt ;
- **pause à sens unique** : un gardien peut suspendre les *dépôts*, jamais les dépenses ni les
  retraits ;
- **file d'attente** : les retraits au-delà d'un seuil passent par un délai (ex. 24 h), pendant
  lequel un gardien peut suspendre la file si l'invariant `Σ retraits ≤ Σ dépôts − frais` est
  menacé. C'est un filet contre un bug de création de valeur, borné par le plafond de TVL.

### 8.2 `ResourceRegistry`

`register(R, prix, pk_m, IVK_m, domaine)` : ajoute une feuille. Pour changer un prix, on ajoute une
nouvelle feuille et on retire l'ancienne de l'ensemble valide. La racine valide est tenue dans un
historique, comme pour les notes.

### 8.3 Paliers de frais

Trois paliers `{F1, F2, F3}` en USDC, révisables avec un délai (timelock). Les relayers choisissent
selon le coût du gas du moment. La seule information visible est « le réseau était cher ou non »,
commune à tous au même moment.

---

## 9. Portefeuille ZK402 (répond à F1 et F9)

### 9.1 Isolation

Le portefeuille est une **extension de navigateur**, ou à défaut une PWA sur une origine dédiée
(ex. `wallet.zk402.xyz`) servie avec un hachage de build publié. Son code est open source, à
**build reproductible**, et versionné.

La graine est chiffrée par une clé issue de **WebAuthn PRF** : elle est liée à une passkey
matérielle et n'est jamais stockée en clair. Les preuves sont générées dans le contexte du
portefeuille. Le site marchand ne reçoit que le contenu final de l'en-tête `X-PAYMENT`.

### 9.2 API fournisseur (sur le modèle d'EIP-1193)

```ts
window.zk402.request({
  method: "zk402_requestAccess",
  params: { paymentRequirements /* corps de la 402 */ }
}) → { xPayment: string }        // en-tête prêt à envoyer
```

Le portefeuille : (1) vérifie le marchand (§ 9.3) ; (2) affiche « Payer 0,10 $ à *Journal X* pour
*Article Y* » ; (3) paie si aucun droit n'existe ; (4) produit la preuve `access`.

### 9.3 Vérification du marchand (anti-hameçonnage)

La 402 vient du domaine `D`. Le portefeuille récupère `https://D/.well-known/zk402.json`, qui
liste `(pk_m, IVK_m)`. Il vérifie ensuite qu'une feuille `(R, prix, pk_m, IVK_m, D)` existe dans
le registre. Une page malveillante ne peut donc ni détourner le paiement vers une autre clé, ni
gonfler le prix.

### 9.4 Gestion des notes

- **Fractionnement anticipé** : après un dépôt de 20 $, le portefeuille lance en arrière-plan des
  `transact` de fractionnement (indistinguables d'un paiement). Il dispose ainsi de plusieurs notes
  mûres de petite valeur, et deux achats successifs ne s'enchaînent pas via une même note de monnaie.
- **Délai aléatoire** avant de soumettre un paiement, borné pour rester utilisable.
- Pas de réutilisation d'un relayer ou d'un relais OHTTP pour deux actions rapprochées.

### 9.5 Récupération

Depuis la graine seule, le portefeuille :
- recalcule `aléa = H_rho(sel, i)` pour i = 0, 1, 2… et cherche les engagements correspondants ;
- retrouve ses droits d'accès via `s_R = H_acc(sel, R)` ;
- en tant que marchand, retrouve ses notes furtives en scannant les `E`.

Aucune sauvegarde de notes n'est nécessaire.

---

## 10. Réseau et relayers (répond à F3)

### 10.1 Transport

**Oblivious HTTP (RFC 9458), obligatoire** pour les deux flux :
- **Portefeuille → relayer** : le relais OHTTP voit l'IP mais pas le contenu ; la passerelle
  (le relayer) voit le contenu mais pas l'IP.
- **Portefeuille → marchand** : le marchand expose une passerelle OHTTP ; sa configuration de clés
  est publiée dans `zk402.json`.

Les relais OHTTP sont opérés par des tiers indépendants. Le portefeuille en choisit un au hasard
parmi une liste. Contre un adversaire global qui observe tout le réseau, il faut un mixnet (Nym) :
c'est une option, pas la base.

### 10.2 Relayers

- **Ensemble ouvert** : n'importe qui peut relayer. Il n'y a rien à confier au relayer : les frais
  et le destinataire sont liés à la preuve.
- **Choix aléatoire côté client** parmi les relayers qui répondent. En cas de refus, on en essaie
  un autre, ce qui rend la censurer coûteuse.
- **Simulation** avant soumission, pour que le relayer ne paie pas de gas pour une preuve invalide.
- **Repli ERC-4337** (piste) : le pool joue le rôle de paymaster et n'importe quel bundler inclut
  l'opération. À valider, car vérifier une preuve pendant la phase de validation doit respecter les
  règles d'ERC-7562 (accès au stockage, gas).

---

## 11. Ensemble d'anonymat (répond à F5)

Ce qui relève de l'ingénierie :
- **un seul pool** pour toutes les ressources, tous les marchands et tous les usages ;
- **transaction universelle** : fractionnements, fusions et paiements se mélangent ;
- **coupures fixes** aux entrées et aux sorties ;
- **conception générique** : le pool est un pool ERC-20 blindé réutilisable par d'autres
  applications ; le paywall n'en est qu'un usage, ce qui augmente l'ensemble d'anonymat.

Ce qui relève de la mesure :
- le portefeuille affiche l'**ensemble effectif** : le nombre de notes éligibles de même âge minimal ;
- sous un seuil (ex. 100), il **avertit**, et peut **bloquer** selon le réglage choisi.

Le démarrage à froid ne se résout pas par l'ingénierie. Il est dit explicitement (§ 15).

---

## 12. Conformité (optionnelle, D4)

Modèle **Privacy Pools**. Un fournisseur publie une racine `assocRoot` d'étiquettes de dépôts
acceptés. Le circuit ajoute la contrainte `étiquette ∈ assocRoot`, où `assocRoot` est une entrée
publique acceptée par le contrat.

Les notes `L_MARCHAND` sont conformes par l'enregistrement du marchand dans le registre (un
marchand est une entité identifiée). **Limite** : un payeur au dépôt douteux peut ainsi
transférer de la valeur vers un marchand. Le volume est borné par les prix fixes et les paliers,
et le marchand peut refuser de réclamer ces notes. C'est le même compromis que pour les transferts
dans Privacy Pools.

Un dépôt exclu garde une **sortie publique** (« ragequit ») vers son adresse d'origine : les fonds
ne sont jamais bloqués. Chaque lecteur peut aussi divulguer volontairement son historique grâce à
une clé de visualisation dérivée.

---

## 13. Ingénierie de la sûreté (répond à F6)

| Couche | Mesure |
|---|---|
| Spécification | La relation `transact` est écrite comme une fonction TypeScript de référence : `accept(publiques, privées) → bool`. |
| Tests positifs | Chaque usage (payer, fractionner, fusionner, retirer, entrée fictive) a un test circuit **et** un test de bout en bout avec le contrat. |
| Tests négatifs | Pour chaque contrainte du § 6.2, un témoin qui la viole seule doit être refusé. |
| Fuzzing par mutation | On génère des témoins valides, on mute un champ au hasard, et on compare circuit et modèle de référence. Tout désaccord est un bug. C'est la méthode qui détecte les sous-contraintes. |
| Invariants de contrat | Tests d'invariants : `solde du pool ≥ Σ dépôts − Σ retraits − Σ frais` ; nullifier jamais dépensé deux fois. |
| Limitation des dégâts | Plafond de TVL, plafond par dépôt, file d'attente des gros retraits, pause des dépôts seulement. |
| Revue | Deux audits indépendants (circuits et contrats), puis bug bounty sur testnet avant tout plafond relevé. |
| Déploiement | Vérificateur immuable ; nouvelle version = nouveau pool ; paramètres publiés et hachés dans la documentation. |

---

## 14. Flux x402 `zk-shielded` de bout en bout

1. `GET /article/42` → **402** avec `scheme: "zk-shielded"` et
   `extra: { R, prix, domaine, registryRoot, challenge, époque, ohttpConfigUrl }`.
2. Le site appelle `zk402_requestAccess(402)`. Le portefeuille vérifie le marchand (§ 9.3).
3. Si le lecteur n'a pas encore de droit pour `R` : `transact(isPay = 1)` avec une note mûre, via un
   relayer choisi au hasard, par OHTTP. On attend l'inclusion et la feuille d'accès.
4. Le portefeuille produit la preuve `access` (RLN) liée au `challenge`, puis renvoie `X-PAYMENT`.
5. Le site rejoue `GET /article/42` via la passerelle OHTTP du marchand. Le serveur vérifie
   (§ 7.3) et répond **200**.
6. **Relectures** : étapes 1, 2, 4 et 5 seulement, dans la limite de `LIMITE` par époque.

---

## 15. Modèle de menace et résiduel honnête

| Adversaire | Ce qu'il apprend |
|---|---|
| Observateur de la chaîne | Dépôts et retraits (adresse et coupure). Pour le reste, des transactions universelles indistinguables, un palier de frais et un relayer. |
| Marchand | Qu'un porteur de droit anonyme lit `R` ; les montants reçus (prix + palier de pourboire) sans lien avec un payeur ; le nombre de lectures, borné par RLN. |
| Relayer | Une preuve valide et ses frais. Pas d'IP grâce à OHTTP. |
| Relais OHTTP | Une IP qui parle à un relayer ou à un marchand. Pas de contenu. |
| Site marchand malveillant | Rien de plus que le marchand : pas de clé, pas de note (§ 9). |

**Ce qui reste irréductible** :
1. **Démarrage à froid** : peu d'utilisateurs = peu d'anonymat. C'est mesuré et affiché, pas résolu.
2. **Les bords du pool sont publics** : qui dépose et qui retire, en coupures fixes.
3. **Adversaire global du réseau**, qui voit tout le trafic : hors de portée sans mixnet.
4. **Collusion** entre un relais OHTTP et la passerelle en face : elle révèle l'IP. On la rend
   improbable par la diversité des opérateurs, sans pouvoir l'exclure.
5. **Hypothèses cryptographiques** : sûreté de Poseidon2, de UltraHonk et de l'ECDH sur Grumpkin.
6. **Chaîne d'approvisionnement du portefeuille** : réduite par les builds reproductibles, pas éliminée.
7. **Coût d'UX** : maturité de quelques heures après un dépôt, preuves de quelques secondes.

---

## 16. Et le FHE ?

La v2 n'en a pas besoin pour le chemin critique :
- les **montants** sont cachés par les engagements ;
- les **empreintes** sont traitées par des prix fixes et des paliers ;
- chaque **calcul** est vérifié par une preuve, alors que le FHE via CoFHE demande de faire
  confiance au réseau de seuil (Stage 1 aujourd'hui).

La v1 (FHE) reste dans le dépôt comme démonstration pédagogique. Une piste de recherche demeure :
si relier une preuve ZK à un chiffré FHE devient praticable, on pourrait masquer au marchand le
palier de pourboire, en lui donnant seulement des totaux chiffrés.

---

## 17. Décisions ouvertes

| # | Question | Recommandation |
|---|---|---|
| D1 | Retirer le FHE du chemin critique | Oui (§ 16) |
| D2 | Coupures | 5, 20, 100 $ (USDC de test) |
| D3 | Système de preuve | Noir/UltraHonk ; mesurer le gas du vérificateur dès la phase 1 et basculer vers Groth16 si c'est prohibitif |
| D4 | Conformité (ensembles d'association) | Prévue dans le circuit, désactivée par défaut sur testnet |
| D5 | Forme du portefeuille | Extension d'abord, PWA sur origine dédiée en repli |
| D6 | RLN : `LIMITE` et durée d'époque | 20 sessions par jour |
| D7 | `MATURITÉ` | 6 h (compromis entre UX et anonymat) |
| D8 | Paliers de pourboire | {0 ; 1 $ ; 5 $} |

---

## 18. Plan de travail

| Phase | Livrable | Critère de sortie |
|---|---|---|
| 1. Spécification exécutable | Modèle de référence TypeScript de `transact` et `access` ; vecteurs de test | Relations figées, revues |
| 2. Circuits | `packages/circuits` (Noir) : bibliothèques, `transact`, `access` ; tests positifs, négatifs et fuzzing différentiel ; **mesure du gas du vérificateur** | Zéro désaccord avec le modèle sur 10⁶ mutations ; décision D3 tranchée |
| 3. Contrats | `ShieldedPool`, `ResourceRegistry`, points de contrôle, paliers, plafonds, file d'attente ; tests d'invariants | Invariants tenus ; double dépense, racine périmée et note immature refusées |
| 4. Réseau | Relayer, passerelle OHTTP, vérificateur `access` côté serveur avec RLN | Parcours complet en local, révocation RLN démontrée |
| 5. Portefeuille | Extension : graine + PRF, prouveur, gestion des notes, API `zk402_*`, vérification du marchand | Parcours complet sur Base Sepolia depuis une page marchande non fiable |
| 6. Durcissement | Audits, bug bounty testnet, métriques d'anonymat | Rapport d'audit ; aucune valeur réelle avant |
