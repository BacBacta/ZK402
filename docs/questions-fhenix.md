# Questions pour l'équipe Fhenix (CoFHE)

> Contexte à leur donner : nous construisons un **dark pool par lots sur Base** avec CoFHE (ordres
> chiffrés, appariement FHE, soldes chiffrés), testé sur Base Sepolia. Nos mesures sont dans
> [`s1-microbanc-cofhe.md`](s1-microbanc-cofhe.md) et [`phase0-s1-resultats.md`](phase0-s1-resultats.md).
> Une version anglaise, prête à envoyer, se trouve en bas de page.

## A. Performance et capacité (bloquant pour le produit)

1. **Multiplication 64 bits** : nous mesurons ≈ 1 `FHE.mul(euint64, euint64)` par seconde sur
   Base Sepolia, **sans parallélisme** même pour des opérations indépendantes dans une même
   transaction (20 → 19,5 s ; 40 → 32 s). En 16 bits, c'est ≈ 8 fois plus rapide. Est-ce une
   limite du **testnet** ? Quel débit prévoir sur **mainnet** ?
2. **Parallélisme** : les tâches sont-elles exécutées dans une **file globale** (tous contrats
   confondus), par contrat, ou par transaction ? Deux contrats différents se ralentissent-ils
   mutuellement ?
3. **Multiplication par une constante publique** : TFHE sait multiplier un chiffré par un scalaire
   en clair bien plus vite qu'un chiffré par un chiffré. L'API `FHE.sol` n'expose que
   `mul(chiffré, chiffré)`, la constante étant alors chiffrée trivialement. Existe-t-il, ou
   est-il prévu, un `mul` scalaire optimisé ? Le coprocesseur optimise-t-il déjà les opérandes
   triviaux ?
4. **Accélération GPU / feuille de route** : dates et gains attendus ? Existe-t-il un SLA de
   latence ?
5. **Zones de sécurité** (`securityZone`) : sont-elles traitées par des exécuteurs distincts, et
   donc en parallèle ? Peut-on s'en servir pour répartir la charge ?
5 bis. **Priorité dans la file** : sur notre pool, des multiplications soumises juste après des
   calculs légers retardent le déchiffrement de ces derniers (32 ordres : 35 s au lieu de 14,6 s).
   Les déchiffrements attendent-ils derrière tous les calculs en file ? Peut-on donner une
   priorité, ou existe-t-il une file séparée pour les déchiffrements ?
6. **Identifiants déterministes et cache** : nous avons observé que des opérations identiques
   sont servies depuis un cache. Est-ce voulu ? Le fait que deux calculs soient identiques
   est-il observable par un tiers ?

## B. Coûts

7. **Frais sur mainnet** : y a-t-il des frais par opération FHE ou par déchiffrement en plus du
   gas du TaskManager ? Barème ?
8. **Gas du TaskManager** : ≈ 44 k gas par opération mesurés. Des optimisations sont-elles
   prévues (lots de tâches) ?

## C. Confiance et sécurité (bloquant pour un lancement mainnet)

9. **Teecryptor** : la documentation (PR n° 73, 3 septembre 2026) indique qu'une **seule** VM Intel
   TDX déchiffre, avec une clé reconstruite à partir de parts Shamir. Combien de partenaires, quel
   seuil, qui sont-ils ? Quel est le plan de rotation des clés ?
10. **Réseau de seuil** : quand sera-t-il en production ? Fournira-t-il des **preuves de
    déchiffrement correct** vérifiables on-chain ? Notre disjoncteur de sorties n'est qu'une
    borne : nous voulons l'éliminer.
11. **Vérifieur d'entrées** : quelles garanties en cas de compromission ? Existe-t-il un plan pour
    le décentraliser ?
12. **Audits** : quels audits publiés couvrent `FHE.sol`, le TaskManager et Teecryptor ?

## D. Outils

13. **SDK dans Hardhat** : en réseau réel, `@cofhe/sdk` échoue dans le processus Hardhat (délai
    de connexion au vérifieur). Il fonctionne en script autonome. Problème connu ?
14. **Chiffrement côté client** : ≈ 16 s par ordre (deux valeurs, une preuve) sous Node dans un
    conteneur cloud. Existe-t-il un prouveur natif ou multi-cœur, ou un service de preuve ?
    Quelle est la cible de latence ?
15. **Estimation de gas** : `eth_estimateGas` sous-évalue les appels au TaskManager (un
    `settleStep` estimé à 810 k a échoué à court de gas). Recommandation ?
16. **Plafond de gas par transaction** (≈ 16,7 M, EIP-7825) : y a-t-il des limites propres au
    TaskManager (nombre de tâches par transaction) ?

---

## Version anglaise (à envoyer)

> Hi Fhenix team — we're building a sealed-batch dark pool on Base using CoFHE (encrypted orders,
> FHE matching, encrypted balances), live-tested on Base Sepolia. A few questions from our
> measurements:
>
> 1. We measure ~1 `FHE.mul(euint64, euint64)`/s on Base Sepolia with no parallelism, even for
>    independent ops in one tx (20 → 19.5 s, 40 → 32 s); 16-bit muls are ~8x faster. Is this a
>    testnet limit? What throughput should we expect on mainnet?
> 2. Are tasks processed in a global queue (across all contracts), per contract, or per tx?
> 3. Is there, or will there be, an optimized ciphertext × plaintext-scalar multiplication?
>    Does the coprocessor already shortcut trivially-encrypted operands?
> 4. GPU acceleration: timeline and expected gains? Any latency SLA?
> 5. Are security zones executed by separate workers (usable to spread load)?
> 5b. Queue priority: heavy muls submitted right after cheap ops delay the decryption of those
>     cheap results (32 orders: 35 s vs 14.6 s when the muls are held back). Do decryptions wait
>     behind all queued compute? Is there a priority or a separate decryption queue?
> 6. Deterministic handles are served from a cache for identical ops. Intended? Is it
>    observable by third parties?
> 7. Mainnet fees per FHE op or per decryption, beyond TaskManager gas?
> 8. Any planned TaskManager gas optimizations (we see ~44k gas/op)?
> 9. Teecryptor: how many share-holding partners, which threshold, who are they, and what is the
>    key-rotation plan?
> 10. Threshold network: production date, and will it provide on-chain-verifiable proofs of
>     correct decryption?
> 11. Input verifier: guarantees if compromised, and decentralization plans?
> 12. Which published audits cover FHE.sol, the TaskManager and Teecryptor?
> 13. `@cofhe/sdk` fails inside the Hardhat process on live networks (verifier connect timeouts)
>     but works standalone. Known issue?
> 14. Client-side encryption takes ~16 s per order (2 values, 1 proof) in Node. Is there a
>     native/multi-core prover or a proving service?
> 15. `eth_estimateGas` underestimates TaskManager-heavy calls. Recommended practice?
> 16. Any TaskManager-specific per-tx limits (task count), beyond the ~16.7M tx gas cap?
