# PrivatePay — payer un marchand en USDC sur Base sans lui montrer son portefeuille

> **Statut** : proposition de conception, rien n'est implémenté. Idée N2 de
> [`nouvelles-idees-base.md`](nouvelles-idees-base.md).
>
> **En une phrase** : un SDK pour wallets et pages de paiement qui règle les achats depuis un **solde
> blindé** (Hinkal) plutôt que depuis le wallet public. Le marchand est payé et reçoit une preuve,
> sans connaître ni ton solde ni ton historique.
>
> **Promesse honnête** : « le marchand connaît votre adresse de livraison, pas votre fortune ».

---

## 1. Le problème

Payer en USDC depuis son wallet (checkout Shopify en USDC sur Base, liens de paiement, Base Pay) :
- **le marchand voit tout le wallet** : solde, autres achats, revenus, contreparties. Il peut
  segmenter ses clients par fortune ;
- **le public voit l'achat** : « ce wallet a payé 87,43 $ à ce marchand ». Si le wallet est lié à une
  identité (ENS, exchange, réseau social), l'historique d'achats devient public ;
- **le marchand s'expose aussi** : ses encaissements, donc son chiffre d'affaires, sont lisibles par
  ses concurrents s'il encaisse sur une adresse fixe.

**Signaux de demande** :
- paiement en USDC sur Base intégré à Shopify Payments (via Stripe) ;
- transferts USDC sans gas sur Base ;
- Polygon a jugé utile d'intégrer des paiements privés (avec Hinkal) directement dans son wallet.

---

## 2. Ce qu'offre Hinkal (et ses limites)

Constaté dans l'intégration publique `wdk-hinkal-demo` (Base mainnet) :
- `privateSend(token, recipient, amount)` fonctionne **en deux temps** :
  1. un **dépôt on-chain depuis le wallet de l'expéditeur** (public) ;
  2. un **retrait blindé vers le destinataire**, planifié et exécuté par un relayer (frais prélevés sur
     le montant) ;
- récupération des fonds « bloqués » si le second temps échoue ;
- contrôle KYT (Chainalysis) avant exécution, preuves Groth16, audits multiples.

**Conséquence** : avec `privateSend` utilisé *au moment du paiement*, un montant unique (87,43 $) et un
délai court relient le dépôt public du client au retrait vers le marchand. **La confidentialité ne
tient que si le solde est blindé à l'avance**, découplé des paiements.

---

## 3. Principe : un solde blindé, alimenté à l'avance

```
  (1) Recharge, à l'avance, en montants ronds          (2) Paiement, plus tard
  Wallet public ──100 USDC──► Solde blindé (Hinkal) ──87,43 USDC──► Adresse de paiement de la commande
       visible                    invisible                 visible : « le pool a payé 87,43 $ »
                                                            (pas « ce wallet a payé »)
```

Le public voit que *quelqu'un* du pool a payé 87,43 $ au marchand. Le marchand voit un paiement
venant du pool, rattaché à sa commande. Aucun des deux ne voit le wallet du client.

---

## 4. Architecture

```
 ┌──────────────── Wallet du client (SDK PrivatePay) ─────────────────┐
 │ solde blindé (fournisseur : Hinkal ; interface abstraite)          │
 │ politique de recharge (montants ronds, délai minimal)              │
 │ exécution du paiement → retrait blindé vers l'adresse de commande  │
 │ génération du reçu (référence commande + tx)                       │
 └──────────────┬───────────────────────────────────────▲─────────────┘
                │ demande de paiement (EIP-681 étendu)  │ reçu, statut
 ┌──────────────▼──────────────┐              ┌─────────┴──────────────┐
 │ Checkout du marchand / PSP  │◄── webhook ──│ Service de réconciliation│
 │ adresse de paiement UNIQUE  │              │ (surveille les adresses │
 │ par commande                │              │  de commande sur Base)  │
 └─────────────────────────────┘              └────────────────────────┘
```

### 4.1 Pourquoi une adresse par commande
Le paiement arrive depuis le contrat du pool, pas depuis le wallet du client. Le marchand ne peut donc
pas rapprocher la commande par l'adresse de l'expéditeur. Une **adresse de réception unique par
commande** (dérivée d'une clé maître du marchand, ou contrat de dépôt CREATE2 par commande) :
- permet un rapprochement automatique (montant + adresse) ;
- cache au public le chiffre d'affaires du marchand : les encaissements sont éparpillés, puis
  consolidés (idéalement eux aussi via un solde blindé).

### 4.2 Demande de paiement
Extension d'un lien de paiement standard (EIP-681) :
```
ethereum:<USDC>@8453/transfer?address=<adresse_commande>&uint256=87430000
  &privatepay=1&order=<id>&expires=<ts>&refund=<méthode>
```
Le SDK la lit, affiche « Payer 87,43 $ à *Boutique X* en privé » et exécute le retrait blindé.

### 4.3 Reçu
Le reçu contient la référence de commande, le hash de la transaction de retrait et le montant. Le
marchand le vérifie on-chain (paiement du bon montant vers l'adresse de commande avant expiration).
**Aucune preuve ZK supplémentaire n'est nécessaire** : l'adresse unique suffit à l'attribution.

### 4.4 Remboursements
Le client fournit au paiement une **adresse de remboursement à usage unique** (générée par son wallet).
Le marchand rembourse dessus, et le SDK re-blinde automatiquement les fonds reçus après un délai. On
ne réutilise jamais l'adresse du wallet principal.

---

## 5. Politique de confidentialité du SDK (le cœur du produit)

| Règle | Pourquoi |
|---|---|
| **Recharges en montants ronds** (20, 50, 100, 500 $) | Un montant de recharge ne doit pas correspondre à un achat |
| **Délai minimal** entre une recharge et le premier paiement (ex. 12 h), affiché à l'utilisateur | Casse la corrélation temporelle |
| **Jamais de `privateSend` direct** au moment de l'achat si le solde blindé est insuffisant : le SDK propose de recharger et prévient que ce paiement-ci sera moins privé | Honnêteté sur le cas dégradé |
| **Indicateur de confidentialité** par paiement (bon / moyen / faible), selon l'âge et la taille du solde, et l'activité du pool | L'utilisateur sait ce qu'il obtient |
| **Adresses de remboursement à usage unique** | Pas de lien retour vers le wallet principal |
| **Frais du relayer inclus dans l'affichage** | Pas de surprise ; le relayer prélève sur le montant blindé |

---

## 6. Modèle de menace

| Observateur | Apprend | N'apprend pas |
|---|---|---|
| Marchand | Montant, heure, adresse de livraison (commerce physique), éventuellement e-mail | Le wallet, le solde, les autres achats |
| Public | Qu'une adresse de commande a reçu 87,43 $ depuis le pool | Qui a payé ; quel marchand (si les adresses de commande ne sont pas publiquement associées) |
| Hinkal / relayer | Ce que voit Hinkal (dépend de son architecture ; KYT sur les flux) | — |
| PSP (Stripe…) | Ce qu'il voit déjà du marchand | Le wallet client |

**Résiduel** :
- **montants rares** et petits volumes de pool : le rapprochement recharge/paiement reste possible
  statistiquement (d'où l'indicateur) ;
- **l'identité réelle** reste connue du marchand dès qu'il livre physiquement ;
- **dépendance à Hinkal** : disponibilité, politique KYT, évolutions de l'API.

---

## 7. Conformité

- Contrôle KYT de Hinkal sur chaque flux (déjà en place).
- Le marchand reçoit des fonds d'un protocole **audité et filtré par KYT**. La question clé est de
  savoir si les PSP (Stripe, Coinbase Commerce) et leurs outils de filtrage accepteront ces paiements
  sans les bloquer. **C'est le premier point à valider** (§ 10).
- Le client peut exporter son historique (clé de visualisation Hinkal ou export du SDK) pour sa
  comptabilité.

---

## 8. Intégrations cibles

| Intégration | Ce qu'il faut | Difficulté |
|---|---|---|
| **Wallets** (Base App, Rabby, Zerion…) | SDK + écran « Payer en privé » + gestion du solde blindé | Moyenne ; dépend de leur volonté d'intégrer Hinkal |
| **Liens de paiement et checkouts crypto-natifs** | Adresse par commande + webhook de réconciliation | Faible |
| **Shopify via Stripe** | Savoir si le flux USDC de Stripe accepte un paiement venant d'un tiers (le pool) vers une adresse de commande | **Inconnue, à vérifier** : le flux peut exiger une signature ou une autorisation du wallet payeur |
| **Base Pay** | Même question (le flux peut reposer sur le compte Base du payeur) | Inconnue |

---

## 9. Modèle économique

- Commission faible par paiement (ex. 0,1 à 0,3 %), en plus des frais du relayer Hinkal.
- Offre marchands : adresses de commande, réconciliation, consolidation discrète des encaissements.
- Partage de revenus possible avec Hinkal (partenaire d'infrastructure, pas concurrent).

---

## 10. Plan

| Phase | Livrable | Critère de sortie |
|---|---|---|
| 0. Validation (2–3 sem.) | Contact Hinkal (API, partenariat, frais, flux de retrait vers un tiers) ; test des flux Stripe USDC, Base Pay et Coinbase Commerce avec un paiement venant d'un contrat ; 10 entretiens clients et 5 marchands | Au moins un checkout compatible ; intérêt de Hinkal ; signal utilisateur |
| 1. SDK minimal | Solde blindé (Hinkal), recharge ronde, paiement vers adresse de commande, reçu, indicateur de confidentialité | Paiement réel sur Base Sepolia puis mainnet (petits montants) |
| 2. Côté marchand | Générateur d'adresses de commande, réconciliation, webhook, remboursements | Boutique pilote |
| 3. Distribution | Intégration dans un wallet partenaire | Premiers utilisateurs réels |

---

## 11. Décisions ouvertes

| # | Question | Recommandation |
|---|---|---|
| D1 | Fournisseur de solde blindé | Hinkal (seul en production sur Base) derrière une interface abstraite |
| D2 | Adresse par commande : dérivée d'une clé ou contrat CREATE2 | Contrat CREATE2 (pas de clé à gérer par adresse, consolidation atomique) |
| D3 | Délai minimal recharge → paiement | 12 h par défaut, réglable avec l'indicateur |
| D4 | Premier canal | Liens de paiement et checkouts crypto-natifs (contrôle total), avant Shopify et Base Pay |

## Sources

- Hinkal : https://hinkal.io/ ; intégration Base : https://github.com/Hinkal-Protocol/wdk-hinkal-demo
- Polygon — paiements privés : https://polygon.technology/blog/private-payments-are-live-on-polygon
- Shopify × USDC sur Base :
  https://www.coinbase.com/blog/coinbase-and-shopify-bring-usdc-payments-on-base-to-millions-of-merchants-worldwide
- USDC sans gas sur Base :
  https://eco.com/support/en/articles/15183708-how-to-send-usdc-networks-fees-and-wallet-steps-in-2026
- EIP-681 (liens de paiement) : https://eips.ethereum.org/EIPS/eip-681
