# Robinhood Chain — vérifications techniques (24 septembre 2026)

Vérifications faites directement contre le RPC public mainnet (`https://rpc.mainnet.chain.robinhood.com`,
chain ID 4663), complétées par des sources publiques.

## 1. Les Stock Tokens sont-ils librement transférables ?

**Réponse : oui par défaut, mais sous liste noire et avec des pouvoirs forts de l'émetteur.**

| Vérification | Méthode | Résultat |
|---|---|---|
| Contrat NVDA | Recherche + `name()` | `0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec` → « NVIDIA • Robinhood Token » |
| Architecture | Slot beacon EIP-1967 | Proxy *beacon* ; beacon et registre = `0xe10b6f6b275de231345c20d14ab812db62151b00` ; implémentation `0xb35490d6f9163de4f80d88dc75c3516eb64c5ae2` |
| Fonctions de l'implémentation | Extraction des sélecteurs du bytecode + base de signatures openchain | ERC-20 + permit, `mint`, `burn`, **`adminBurn(address,uint256)`**, **`pause()` / `unpause()`**, `pauseOracle()`, `updateMultiplier(...)` (ERC-8056), `ACCESS_CONTROLLED_REGISTRY()` |
| Contrôles appelés par le token | Sélecteurs externes dans le bytecode | **`isBlocked(address)`** avec l'erreur `Blocked(address)`, `hasRole(bytes32,address)`, `IsPaused()` |
| Liste blanche ? | Simulation (`eth_call`) d'un `transfer` depuis deux vrais détenteurs vers une **adresse neuve aléatoire** | **Succès** (retour `true`) : il n'y a pas de liste blanche |
| État actuel | `paused()`, `isBlocked(adresse neuve)` | `false`, `false` |

Source concordante (xroot.dev) : le modificateur `onlyNotBlocked` s'applique à l'émetteur **et** au
destinataire ; un **registre unique** gère la mise à jour du code (beacon), la liste noire et la pause
globale de **tous** les Stock Tokens.

**Rapporté mais non vérifié par nous** (xroot.dev) : un *précompilé de filtrage des transactions* au
niveau du protocole aurait filtré environ 6 000 transactions depuis le lancement (~150 par jour),
selon des critères non documentés.

## 2. Peut-on vérifier des preuves ZK sur Robinhood Chain ?

| Vérification | Résultat |
|---|---|
| Précompilé `ecPairing` (0x08) | Fonctionne (`0x…01` sur une entrée vide) : **Groth16 et PLONK/UltraHonk sont vérifiables** |
| Précompilé `ecAdd` (0x06) | Fonctionne |
| Stylus (`ArbWasm.stylusVersion()`) | **Actif (version 3)** : contrats Rust/WASM possibles, utiles pour des hachages ZK moins chers |
| Semaphore v4 (adresse déterministe `0x8A1f…693D`) | **Non déployé** ; le déployeur CREATE2 standard (`0x4e59…956C`) existe, donc un déploiement aux mêmes adresses est possible |
| Coprocesseurs ZK (Brevis, Axiom, Herodotus, Lagrange…) | **Aucune intégration trouvée** avec Robinhood Chain |
| P-256 (RIP-7212, passkeys) | Non vérifié |

## 3. CoFHE (Fhenix) sur Robinhood Chain ?

- CoFHE est sur **testnet** (Ethereum Sepolia, Arbitrum Sepolia, Base Sepolia). Le **mainnet est
  annoncé pour fin 2026**.
- **Aucune annonce** de déploiement sur Robinhood Chain.
- Contexte favorable : Tandem (Offchain Labs, l'équipe d'Arbitrum) a investi dans Fhenix, et
  Robinhood Chain est construite sur la technologie Arbitrum.

## Conséquences pour les idées de projets

| Idée | Impact des vérifications |
|---|---|
| Portefeuille d'actions confidentiel (wrapper FHE) | Techniquement possible (pas de liste blanche). **Mais** l'émetteur peut mettre en liste noire, geler ou `adminBurn` l'adresse du wrapper : un seul utilisateur sanctionné à l'intérieur pourrait faire bloquer tout le pool. Il faut donc une conformité intégrée (contrôle `isBlocked` à l'entrée et à la sortie, clés de visualisation) et **l'accord de l'émetteur**. Dépend aussi de CoFHE sur la chaîne (au mieux après fin 2026). |
| Launchpad équitable | Faisable **maintenant** sans FHE (commit-reveal ou chiffrement à seuil, vérificateurs ZK possibles). Pas de dépendance à l'émetteur. |
| Track record ZK de traders | **Plus difficile que prévu** : aucun coprocesseur ZK ne supporte la chaîne ; il faudrait des preuves d'état maison (zkVM + racines d'état postées sur Ethereum). |
| Tout produit de confidentialité | Le séquenceur peut filtrer des transactions (s'il est confirmé) : risque de **censorship** d'un pool blindé. À clarifier avec Robinhood avant tout lancement. |

## Sources

- RPC et explorateur : https://docs.robinhood.com/chain/connecting ; https://robinhoodchain.blockscout.com/
- Docs Stock Tokens : https://docs.robinhood.com/chain/stock-tokens/ ;
  https://docs.robinhood.com/chain/building-with-stock-tokens/
- Token NVDA : https://robinhoodchain.blockscout.com/token/0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec
- xroot.dev — « Three things the docs don't say » : https://xroot.dev/blog/robinhood-chain-read-directly
- Beosin — analyse du contrat Stock Token :
  https://beosin.com/resources/robinhood-chain-stock-token-practice-code-analysis-on-token-contract-and-blockchain-protocol
- Fhenix CoFHE (statut, mainnet fin 2026) :
  https://www.kucoin.com/news/articles/fhe-in-2026-computing-on-encrypted-data-and-the-projects-making-private-blockchains-a-reality
- Semaphore, contrats déployés : https://docs.semaphore.pse.dev/deployed-contracts
