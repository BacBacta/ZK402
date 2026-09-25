# Circuits ZK (Noir)

## `claim` — réclamation anonyme d'une note du pool blindé (S1, P1)

Prouve « je connais une note de l'arbre de Merkle de racine `root` » et publie son nullificateur,
sans révéler laquelle. Entrées publiques liées : `root`, `nullifier`, `recipient`, `relayer`, `fee`.

- Hachage : Poseidon BN254 compatible circomlib (`noir-lang/poseidon` v0.2.6) = `PoseidonT3`
  on-chain (`poseidon-solidity`), vérifié par le vecteur de référence Poseidon(1, 2).
- Taille : 20 551 portes UltraHonk (profondeur d'arbre 20, soit 1 048 576 notes par classe).
- Outils : `nargo` 1.0.0-beta.19, `bb` 4.0.0-nightly.20260120 (paire compatible officielle).

Régénérer le vérifieur Solidity (à faire à CHAQUE modification du circuit) :

```bash
cd packages/circuits/claim
nargo compile
bb write_vk -b target/claim.json -o target -t evm
bb write_solidity_verifier -k target/vk -o ../../contracts/contracts/zk/ClaimVerifier.sol -t evm
```

`target/claim.json` et `target/vk` sont versionnés : les tests génèrent des preuves avec
`nargo execute` + `bb prove -t evm` (voir `packages/contracts/test/helpers/zk.ts`), et elles doivent
correspondre exactement au vérifieur déployé.
