# fhenix402

Prototype éducatif de **micropaiements x402 confidentiels** sur **Base Sepolia**, dans l'esprit de
[Fhenix402](https://www.fhenix.io/blog/fhenix402) : une ressource web répond `HTTP 402 Payment Required`,
le client paie on-chain, et **le montant reste chiffré** (FHE via le coprocesseur CoFHE de Fhenix).

> Ce n'est ni un clone de fhenix402.vercel.app, ni le facilitateur CDP x402 (USDC public), ni un
> produit mainnet. CoFHE est en testnet ; les crédits de démo n'ont aucune valeur.

## Le flux

```
Client (wallet Base Sepolia)
  │ GET /api/article
  ▼
Next.js ──► 402 { x402Version: 1, accepts: [{ scheme: "confidential-exact", payTo, minAmountRequired: "10",
  │                 extra: { confidential: true, fhe: "cofhe", nonce, facilitator, … } }] }
  ▼
Le client chiffre le montant dans le navigateur (@cofhe/sdk)
  │ ConfidentialPaywall.pay(handle, proof)
  ▼
On-chain (CoFHE) : ok = (montant ≥ prix) ∧ (montant ≤ solde)      ← jamais en clair
                   débit = select(ok, montant, 0) ; accès = accès ∨ ok
  ▼
Le client signe le nonce → GET /api/article + X-PAYMENT
  ▼
Le serveur (facilitateur) vérifie la signature, lit l'ebool d'accès du payeur et le déchiffre
grâce à l'ACL accordée par le contrat → 200 + contenu + X-PAYMENT-RESPONSE
```

Montants d'essai : **10 ¢ (0,10 $)** et **402 ¢ (4,02 $)**. Ils exécutent exactement le même circuit
FHE : un observateur ne peut pas les distinguer, ni savoir si le paiement a été accepté.

## Ce qui est privé, ce qui ne l'est pas

| Chiffré (FHE)                              | Public (FHE ne le cache pas)                                  |
| ------------------------------------------ | ------------------------------------------------------------- |
| Montant payé                               | Adresse du payeur, adresse du contrat (donc la ressource)     |
| Solde de crédits de chaque utilisateur     | Le fait d'avoir appelé `pay()` / `claimFaucet()`, l'heure     |
| Issue du paiement (`lastPaymentOk`)        | Le gas consommé, le graphe d'appels                           |
| Accès à la ressource (`ebool`)             | Le prix plancher initial (calldata du déploiement, et la 402) |
| Revenu cumulé (lisible par l'owner seul)   | Le montant du faucet (constante 10,00 $) et le nombre d'appels |
| Prix mis à jour via `setMinPrice` (chiffré) | Le premier `pay()` d'une adresse (initialisation du compte)   |

**Confidentialité ≠ anonymat.** Le modèle de comptes d'Ethereum reste visible. Le serveur, lui, apprend
« cette adresse a payé au moins le prix », jamais « combien ».

### Limites documentées (non résolues « magiquement »)

- **Privacy Stages** : le testnet CoFHE est au [Stage 1](https://www.fhenix.io/blog/the-different-stages-of-privacy-a-taxonomy)
  (roues d'entraînement). Ne pas présenter ceci comme « personne ne pourra jamais lire ».
- **Coprocesseur** : le calcul FHE a lieu hors chaîne ; il n'est pas nécessairement prouvé ZK. Les
  ciphertexts sont malléables, d'où l'ACL (`FHE.allow*`) sur chaque handle stocké.
- **Infra Fhenix402** ([billet](https://www.fhenix.io/blog/fhenix402)) : approbations chiffrées, coût du
  gas FHE et UX non-crypto ne sont pas encore prêts. Ici : pas d'`approve` du tout (le solde vit dans le
  contrat), et le payeur paie son gas en clair (fuite de métadonnées assumée).
- **FHERC20** (v2) : `balanceOf` y est un indicateur 0–0,9999 (fuite d'activité), pas d'allowance ERC-20
  (opérateurs à courte échéance à la place), et un transfert insuffisant transfère 0 sans revert — il faut
  toujours utiliser l'`euint` retourné. Le même principe est appliqué ici : `pay()` ne revert jamais sur
  le contenu chiffré, il débite 0.
- **Rejeu HTTP** : les nonces sont sans état (HMAC + expiration 5 min). Un `X-PAYMENT` intercepté peut être
  rejoué pendant sa validité — il ne donne accès qu'au contenu que l'attaquant intercepterait de toute façon.
- **Une ressource = un contrat** : pas d'identifiant de ressource dans les events, mais l'adresse du
  contrat identifie la ressource.

## Structure

```
packages/
  contracts/   Hardhat + @cofhe/hardhat-plugin
    contracts/ConfidentialPaywall.sol
    test/ConfidentialPaywall.ts         15 tests sur mocks CoFHE
    tasks/                              deploy-paywall, faucet-paywall, pay-paywall
  web/         Next.js 15 (App Router) + wagmi/viem + @cofhe/sdk
    app/api/article/route.ts            endpoint 402 / 200 (scheme confidential-exact)
    lib/x402.ts                         types et encodage x402
    lib/server/facilitator.ts           déchiffrement de l'accès (ACP du facilitateur)
    components/PaywallDemo.tsx          parcours complet dans le navigateur
```

### Le contrat `ConfidentialPaywall`

- `claimFaucet()` : +1000 cents chiffrés (max 5 appels par adresse).
- `pay(externalEuint64, bytes proof)` : circuit constant, sans `if`/`require` sur une valeur chiffrée.
- `accessOf`, `balanceOf`, `lastPaymentOk`, `minPrice`, `revenue` : ne renvoient que des **handles** ;
  pas de `hasAccess` en clair.
- ACL : solde → payeur ; accès → payeur + facilitateur ; revenu → owner ; tout → le contrat (`allowThis`),
  posées **avant** l'`emit`.
- Events : `PaymentSubmitted(payer)` — ni montant, ni issue, ni identifiant de ressource.

### La variante x402 `confidential-exact`

On garde l'enveloppe x402 v1 (corps 402 `{ x402Version, error, accepts[] }`, en-têtes `X-PAYMENT` et
`X-PAYMENT-RESPONSE` en base64 JSON) mais pas le scheme `exact` USDC de Coinbase :

- `maxAmountRequired` (montant exact) est remplacé par `minAmountRequired` (prix plancher public) ;
- `X-PAYMENT` ne contient **aucun montant** : `{ payer, nonce, signature, txHash? }`, où `signature` est une
  signature EIP-191 du nonce serveur (EOA, ERC-1271 et ERC-6492 acceptés via viem) ;
- la vérification repose sur l'`ebool` d'accès chiffré, pas sur un `Transfer.value`.

## Installation

Prérequis : Node ≥ 20, pnpm 10.

```bash
pnpm install
pnpm test          # compile + 15 tests Hardhat sur mocks CoFHE
pnpm typecheck
```

## Déploiement sur Base Sepolia

Nécessite une clé **de testnet** avec un peu d'ETH Base Sepolia.

```bash
cp .env.example .env              # PRIVATE_KEY, FACILITATOR_ADDRESS (optionnel)
pnpm base-sepolia:deploy          # écrit packages/contracts/deployments/base-sepolia.json
```

Tâches CLI utiles (même réseau) :

```bash
pnpm --filter @fhenix402/contracts base-sepolia:faucet
pnpm --filter @fhenix402/contracts exec hardhat pay-paywall --amount 402 --network base-sepolia
```

## Front

```bash
cp packages/web/.env.example packages/web/.env.local
# NEXT_PUBLIC_PAYWALL_ADDRESS : adresse déployée
# FACILITATOR_PRIVATE_KEY     : clé dont l'adresse = facilitateur du contrat (aucun fonds requis)
# X402_NONCE_SECRET           : openssl rand -hex 32
pnpm dev                          # http://localhost:3000
```

Parcours : connecter un wallet injecté sur Base Sepolia → `GET` (402) → faucet → payer 0,10 $ ou 4,02 $
(chiffré dans le navigateur) → rejouer avec `X-PAYMENT` → article.

Si l'ABI change : `pnpm export-abi` régénère `packages/web/lib/abi/ConfidentialPaywall.ts`.

## Notes d'implémentation

Le code suit les règles du [fhenix-toolkit](https://cofhe-docs.fhenix.zone/get-started/build-with-ai/ai-assistant) :
`FHE.select` au lieu de brancher sur un `ebool`, `allowThis` après chaque écriture chiffrée, ACL avant
les events, état chiffré initialisé explicitement (un handle non initialisé vaut `true` dans `FHE.and`),
ACP explicites côté SDK avec l'`issuer` dérivé du compte connecté, expiration en secondes, client
CoFHE chargé uniquement dans le navigateur, `transpilePackages: ["@cofhe/sdk"]` côté Next.js.

Seul écart : `node-tfhe` (dépendance de `@cofhe/sdk/node`) est déclaré en `serverExternalPackages`,
car son `.wasm` est lu via `fs` à côté de son propre fichier et n'est pas copié par webpack. Le SDK
lui-même reste transpilé, comme le recommande le toolkit.

Les tests tournent sur les **mocks** CoFHE : gas, latence et strictesse de l'ACL diffèrent du testnet.
Ils ne remplacent pas un essai réel sur Base Sepolia.

## Pistes v2

La conception détaillée de la v2 (pool blindé ZK, accès anonyme, relayer) est dans
[`docs/conception-v2.md`](docs/conception-v2.md).

Son application au cas d'usage où la demande est la plus forte — paie et paiements confidentiels
en USDC pour les entreprises crypto-natives — est détaillée dans
[`docs/conception-paie.md`](docs/conception-paie.md).


- Remplacer les crédits de démo par un FHERC20 (ou USDC wrappé) et des opérateurs à courte échéance.
- Relais de gas / paymaster pour éviter que le payeur expose son wallet de gas.
- Plusieurs ressources par contrat sans identifiant public (ex. identifiant chiffré).
