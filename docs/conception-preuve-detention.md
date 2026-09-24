# Preuve de détention anonyme — conception révisée

> **Statut** : conception, rien n'est implémenté. Remplace la § 2 de
> [`idees-sans-partenaires-base.md`](idees-sans-partenaires-base.md), jugée insuffisante face aux
> deux limites identifiées. Cette révision corrige aussi une **faille de sécurité** du premier jet.

---

## 0. Ce qui n'allait pas

| Problème | Nature | Gravité |
|---|---|---|
| **F. Nullifier dérivé d'une signature** | **Faille** : une signature ECDSA dépend d'un aléa (nonce). Un wallet honnête le fixe de façon déterministe, mais un attaquant qui contrôle sa clé peut produire **autant de signatures valides qu'il veut** pour le même message, donc autant de nullifiers, donc réclamer ou voter plusieurs fois. Le problème vient de l'attaquant, pas seulement des passkeys. | **Critique** |
| **L1. Rareté de la condition** | Prouver « ≥ 50 M$ » désigne les 3 wallets qui les détiennent : l'adresse est cachée, pas la rareté. | Forte |
| **L2. « Une fois par personne » avec passkey** | Les signatures passkey sont aléatoires ; pas de secret stable dérivable. | Moyenne |

---

## 1. Résoudre F et L2 : un registre d'engagements, une fois pour toutes

### 1.1 Pourquoi un registre est inévitable (et ce qu'il coûte au minimum)
Pour garantir « un nullifier par wallet », il faut une valeur **unique par wallet**. Soit :
- elle est calculable par tous à partir du wallet, et alors elle relie le nullifier au wallet :
  inacceptable ;
- elle est secrète mais **déterministe à partir de la clé** : c'est le standard PLUME (ERC-7524), que
  presque aucun wallet ne supporte, et qu'aucune passkey ne supporte ;
- elle est **publiquement liée au wallet une seule fois** : c'est un registre.

Faute de PLUME, **le registre est la seule option sûre**. Sa fuite minimale est « ce wallet a activé
le système ». Elle ne dit ni où, ni quand, ni pour quoi il s'en sert.

### 1.2 Fonctionnement
1. **Activation (une fois par wallet)** : le portefeuille tire un secret `s_W` (stocké chiffré, ou
   dérivé de la passkey via WebAuthn PRF), calcule `C_W = Poseidon(s_W)` et signe
   « j'active C_W » (EIP-712).
2. Un relayer soumet la signature **par lots, sans gas pour l'utilisateur**. Le contrat vérifie la
   signature (ECDSA pour les EOA, **ERC-1271** pour les smart wallets à passkey : la vérification a
   lieu on-chain, pas dans le circuit) et impose **un seul `C_W` par wallet** et **un seul wallet par
   `C_W`** (unicité globale : un secret ne peut pas servir à deux wallets).
3. **Réutilisable partout** : la même activation sert à toutes les preuves, communautés, airdrops et
   votes, pour toujours. Ce n'est pas une inscription par campagne.

**F est corrigée** : le nullifier devient `Poseidon(s_W, scope)`. Un `s_W` unique est **fixé on-chain
par wallet** ; signer mille fois ne change rien.
**L2 est résolue** : EOA et passkeys passent par le même chemin, car la passkey n'a besoin de signer
qu'une fois, sur une valeur qu'elle n'a pas à reproduire.

### 1.3 Rotation sans double usage
Changer de secret (perte, compromission) est permis avec un délai. Pour qu'une rotation ne donne pas de
nouveaux nullifiers dans une campagne en cours, **chaque campagne fige la racine du registre** à son
ouverture. Seuls les engagements présents dans cette racine comptent.

### 1.4 Bonus : des preuves beaucoup plus rapides
La propriété de l'adresse est vérifiée **une fois**, on-chain, à l'activation. Les preuves suivantes
ne contiennent plus ni ECDSA, ni keccak, ni P-256, **seulement du Poseidon et du Merkle**. Elles
deviennent rapides, y compris sur mobile.

### 1.5 Réduire la fuite résiduelle (« ce wallet a activé »)
- Activation proposée **à l'onboarding** du portefeuille, et pour chaque nouveau wallet : plus il y a
  d'activations, moins elles signifient.
- Soumission par lots et sans gas : pas de trace de financement, pas de pic temporel individuel.

---

## 2. Résoudre L1 : cacher la rareté, pas seulement l'adresse

### 2.1 Arbre des soldes joint au registre
À chaque instantané, l'indexeur (open source, racine contestable) construit :
`feuille = Poseidon(C_W, actif, solde)`.
**L'adresse n'apparaît plus dans l'arbre.** N'importe qui peut le recalculer (le registre est public,
les soldes aussi) et contester une racine fausse.

### 2.2 Fragmentation + agrégation dans le circuit
La rareté vient de ce qu'une grosse fortune tient dans **un** wallet énumérable. Si elle est répartie
sur plusieurs wallets de taille **ordinaire**, la question « quels wallets ont ≥ 50 M$ ? » ne renvoie
**rien**.

- Le circuit agrège jusqu'à **k = 64** wallets : il prouve la connaissance des secrets `s_Wi`, leur
  appartenance à l'arbre et `Σ soldes ≥ X`.
- L'observateur doit alors trouver **un sous-ensemble** de wallets activés dont la somme dépasse X,
  parmi des milliers de wallets de taille courante. Le nombre de combinaisons possibles est
  astronomique. **L'ensemble d'anonymat n'est plus « les wallets riches », mais « les combinaisons de
  wallets ordinaires ».**
- Le portefeuille **guide la fragmentation** vers des tailles courantes (ex. 10 k$ à 250 k$), et
  surtout **sans lien de financement** entre fragments : un envoi direct d'un wallet vers ses fragments
  serait visible (analyse de graphe). Méthodes sans partenaire : retraits depuis une plateforme
  d'échange vers chaque fragment à des moments différents (le portefeuille chaud de la plateforme est
  partagé par des millions d'utilisateurs), achats séparés, réception directe de revenus.
- Chaque fragment s'active séparément, avec son propre secret : les activations ne sont pas reliables
  entre elles.

### 2.3 Preuves à vérificateur désigné : une preuve volée ne prouve rien
Le vrai danger n'est pas seulement le vérificateur. C'est **la fuite de sa base de données** (cas du
fisc français, d'un outil fiscal en 2026) vers des criminels. On rend la preuve **non transférable** :

```
Énoncé prouvé :  (je détiens ≥ X)  OU  (je connais la clé secrète du vérificateur V)
```

- **V** est convaincu : il sait qu'il n'a pas fabriqué la preuve lui-même.
- **Un tiers** qui récupère la preuve ne peut pas savoir si V ne l'a pas fabriquée avec sa propre clé.
  Elle n'a **aucune valeur probante** pour lui.

Technique connue (preuves à vérificateur désigné, Jakobsson et al.), peu coûteuse ici : la clé de V
est sur la courbe embarquée Grumpkin, native dans Noir.

### 2.4 Seuils minimaux, calculés pour l'utilisateur
Le portefeuille propose le **seuil le plus bas qui satisfait la demande** et affiche l'anonymat obtenu
(nombre de wallets ou de combinaisons compatibles). Il refuse sous un minimum configurable.

---

## 3. Circuit final

Entrées publiques : `registryRoot` figée par la campagne, `balancesRoot`, prédicat `(actif, X)`,
`challenge`, `scope` (optionnel), `pk_V` (optionnel, mode vérificateur désigné).

Entrées privées : jusqu'à k secrets `s_Wi`, soldes, chemins de Merkle ; ou `sk_V` (branche désignée).

Contraintes :
1. **Branche principale** :
   - pour chaque i actif, `Poseidon(Poseidon(s_Wi), actif, soldeᵢ)` est dans `balancesRoot`, et
     `Poseidon(s_Wi)` est dans `registryRoot` ;
   - les i sont **distincts** (un fragment ne peut pas compter deux fois) ;
   - `Σ soldeᵢ ≥ X`, sans débordement.
2. **Branche désignée** (optionnelle) : `sk_V · G = pk_V`.
3. `branchePrincipale ∨ brancheDésignée`.
4. Si `scope` est fourni : nullifiers `Poseidon(s_Wi, scope)` publiés, un par fragment.
5. `challenge` lié à la preuve (pas de rejeu).

Circuit court et purement algébrique (Poseidon, Merkle, une opération de courbe). La surface d'audit
reste petite.

---

## 4. Contrats

| Contrat | Rôle |
|---|---|
| `ActivationRegistry` | Un `C_W` par wallet ; activation par signature EIP-712 (EOA) ou ERC-1271 (smart wallet), soumise par lots ; rotation avec délai ; historique des racines |
| `SnapshotRoots` | Publication des racines d'instantané des soldes ; fenêtre de contestation ; preuve de fraude par recalcul d'une feuille |
| `Verifier` + `ScopeRegistry` | Vérification on-chain optionnelle ; nullifiers par portée ; racine du registre figée par campagne |

---

## 5. Bilan : ce qui est résolu, ce qui reste

| Problème | Avant | Après |
|---|---|---|
| **F** (nullifiers multiples par un attaquant) | Faille critique | **Corrigée** : un secret par wallet, fixé on-chain |
| **L2** (passkeys) | Inscription par campagne, moins privée | **Résolue** : activation unique commune à tous les wallets, sans gas |
| **L1** (rareté) | Palliatif : prouver moins | **Résolue pour qui fragmente** : ensemble = combinaisons de wallets ordinaires ; preuves non transférables ; seuil minimal automatique |
| Vitesse de preuve | ECDSA et keccak dans le circuit | Poseidon seulement, mobile possible |

**Résiduel irréductible (dit honnêtement)** :
1. **L'activation est publique** : « ce wallet utilise le système ». C'est le minimum théorique sans
   PLUME (§ 1.1). Si les wallets adoptent PLUME, on pourra supprimer le registre.
2. **La fragmentation demande un effort** : sans elle, une grosse fortune dans un seul wallet reste
   rare. Le produit l'accompagne, mais ne peut pas l'imposer.
3. **Un vérificateur qui connaît déjà l'identité** (desk OTC avec KYC) apprend toujours « cette
   personne a ≥ X ». La preuve désignée empêche seulement que cette information **prouvable** fuie
   vers d'autres.
4. **Un nullifier par wallet, pas par humain** : quelqu'un avec 10 wallets éligibles a 10
   participations, exactement comme aujourd'hui. L'unicité par humain exigerait une identité (hors
   de ce produit).

---

## 6. Prototype de validation (une semaine)

1. Circuit Noir `k = 1, 8, 64` : temps de preuve navigateur et mobile.
2. Registre : activation EOA et Coinbase Smart Wallet (ERC-1271) sur Base Sepolia, soumission par lots.
3. Branche désignée : vérification qu'un tiers ne peut pas distinguer une vraie preuve d'une preuve
   forgée par V.
4. Instantané USDC Base : temps de construction et de recalcul d'une contestation.

## Références
- PLUME, nullifiers déterministes : ERC-7524 (https://eips.ethereum.org/EIPS/eip-7524)
- ERC-1271 (signatures des smart wallets) : https://eips.ethereum.org/EIPS/eip-1271
- Preuves à vérificateur désigné : Jakobsson, Sako, Impagliazzo, « Designated Verifier Proofs and
  Their Applications », EUROCRYPT 1996
- Wrench attacks et fuites de données : voir les sources de
  [`idees-sans-partenaires-base.md`](idees-sans-partenaires-base.md)
