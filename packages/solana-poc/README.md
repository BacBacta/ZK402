# Test de faisabilité Solana — preuve de réclamation Noir → Groth16

Question : notre circuit de réclamation anonyme (P1, vérifié sur Base en UltraHonk) peut-il être
vérifié sur Solana, à quel coût, et avec les mêmes garanties ?

## Chaîne d'outils (versions exactes)

| Outil | Version |
|---|---|
| Noir (`nargo`) | 1.0.0-beta.22 (exigée par Sunspot ; Base reste en beta.19) |
| `noir-lang/poseidon` | v0.3.0 (v0.2.6 ne compile plus en beta.22) |
| Sunspot (Reilabs, Noir → gnark Groth16 → programme Solana) | `main` du 25/09/2026, compilé depuis les sources — **non audité** |
| Solana CLI / validateur local | Agave 4.2.2 ; devnet en 4.3.0 |

Écarts avec le circuit Base : `u1` → `bool` (supprimé en beta.22) et **nouvelle contrainte de
liaison** (voir la faille ci-dessous).

## Reproduire

```bash
cd claim && node gen-prover.js && nargo execute            # témoin
cd target && sunspot compile claim.json && sunspot setup claim.ccs \
  && sunspot prove claim.json claim.gz claim.ccs claim.pk && sunspot verify claim.vk claim.proof claim.pw
GNARK_VERIFIER_BIN=…/sunspot/gnark-solana/crates/verifier-bin sunspot deploy claim.vk   # → claim.so
cd ../../poseidon-check && cargo build-sbf
solana program deploy …                                      # les deux programmes
RPC=http://127.0.0.1:8899 node run.js                        # ou RPC=https://api.devnet.solana.com
```

Validateur local : `solana-test-validator --deactivate-feature B8JJXCy5amZyWG9r7EnUYLwzXSXTxG7GZ1qZ1qggo83g`
(SIMD-0500, qui interdit le déploiement de programmes SBPF v0–v2, est active par défaut en
local mais **inactive sur devnet** au 25/09/2026 : sans ce drapeau, le local diffère de devnet).

## Résultats (validateur local Agave 4.2.2, 25 septembre 2026) — `results-local.json`

| Mesure | Résultat |
|---|---|
| Poseidon natif Solana (`sol_poseidon`) = Poseidon du circuit | **Identique** : H(1,2) circomlib, feuille, racine de profondeur 20 et nullificateur |
| Coût de 22 hachages Poseidon natifs (chemin 20 + feuille + nullificateur) | ≈ 19 200 CU (≈ 870 CU par hachage) |
| Vérification Groth16 on-chain (5 entrées publiques) | **178 648 CU** sur 1 400 000 (13 %) |
| Taille : preuve / témoin public / transaction | 324 o / 172 o / **706 o** (tient dans une transaction classique de 1 232 o) |
| Frais de la transaction | 5 000 lamports (frais de base, sans priorité) |
| Génération de la preuve Groth16 (serveur) | ≈ 0,75 s ; mise en place 1,8 s ; clé de preuve 5,8 Mo |
| Preuve altérée | refusée |
| Chaque entrée publique modifiée (root, nullifier, recipient, relayer, fee) | **refusée (5/5)** après correction |

## Résultats sur Solana devnet (Agave 4.3.0, 25 septembre 2026) — `results-devnet.json`

Mêmes résultats qu'en local, sur le vrai réseau :

| Mesure | Devnet |
|---|---|
| Programme vérifieur | `FM8VTpzpYqd1XJyWycRuSSDng44wp21Cm6UjuYLY2V7L` |
| Programme de contrôle Poseidon | `7XVNVBqDuZgzmXJUrFtszCnYhVnb8criRTHAJ5K2isTR` |
| Poseidon natif = circuit | **Identique** (H(1,2), racine, nullificateur) |
| Vérification de la preuve valide | ✅ **178 648 CU**, 706 o, 5 000 lamports, confirmée en ≈ 0,5 s ([transaction](https://explorer.solana.com/tx/5bYzZo1KrgDZsRhdf17SQfygGHoSoh5uwJqF59zRtbGVUKbpkskWaF5s1gKgdgUgjSm7ZhVeWtFs8otkbeMdFqzu?cluster=devnet)) |
| 5 entrées publiques modifiées, une par une | **refusées (5/5)** |
| Preuve altérée | refusée |
| Coût du déploiement (loyer des deux programmes) | ≈ 0,56 SOL devnet |

## Faille trouvée et corrigée : entrées publiques non liées en Groth16

Premier essai : une preuve valide restait **acceptée avec `recipient`, `relayer` ou `fee`
modifiés** (root et nullifier étaient bien refusés). Un tiers qui intercepte la transaction
pouvait donc détourner la réclamation vers sa propre adresse.

Cause : le circuit « liait » ces entrées par une égalité tautologique
(`recipient * relayer + fee == recipient * relayer + fee`), que le compilateur supprime. Une
entrée publique qui n'apparaît dans **aucune** contrainte a un terme nul dans la clé de
vérification Groth16 : elle n'est pas liée. En UltraHonk (Base), toutes les entrées publiques
sont liées par construction, et le test Hardhat anti-détournement passait.

Correction : `assert(hash_2([hash_2([recipient, relayer]), fee]) != 0)` (vraie contrainte).
Après correction, les 5 modifications sont refusées. **Recommandation** : appliquer la même
correction au circuit Base par défense en profondeur, et tester systématiquement la
modification de chaque entrée publique pour tout nouveau circuit.

## Réserves

- Sunspot n'est pas audité ; sa mise en place (`setup`) est **dangereuse** (déchet toxique non
  détruit) : une cérémonie par circuit est obligatoire avant toute mise en production.
- Pas encore testé : nullificateurs en comptes compressés (Light Protocol), USDC, relayeur,
  transactions v1.
