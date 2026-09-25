// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @notice Micro-banc du coprocesseur CoFHE (P3) : débit par LARGEUR d'entier et par opération,
///         et test de parallélisme (opérations indépendantes vs chaînées). Les calculs partent
///         d'un VRAI chiffré d'utilisateur (pas de raccourci possible sur les chiffrés triviaux).
contract FheBench {
    euint16 public seed16;
    euint32 public seed32;
    euint64 public seed64;
    bytes32[] public last;
    /// @dev Rend chaque constante unique d'une exécution à l'autre : les identifiants de chiffrés
    ///      sont déterministes, un opérande répété serait servi depuis le cache du coprocesseur.
    uint256 public nonce;

    event Run(uint8 width, uint8 op, bool chained, uint16 k, bytes32[] handles);

    /// @notice Enregistre les graines (une seule preuve pour les trois largeurs).
    function setSeeds(externalEuint16 s16, externalEuint32 s32, externalEuint64 s64, bytes calldata sig) external {
        UnsignedEncryptedInput[] memory inputs = new UnsignedEncryptedInput[](3);
        inputs[0] = UnsignedEncryptedInput(uint256(externalEuint16.unwrap(s16)), 0, Utils.EUINT16_TFHE);
        inputs[1] = UnsignedEncryptedInput(uint256(externalEuint32.unwrap(s32)), 0, Utils.EUINT32_TFHE);
        inputs[2] = UnsignedEncryptedInput(uint256(externalEuint64.unwrap(s64)), 0, Utils.EUINT64_TFHE);
        bytes32[] memory h = Impl.verifyBatchInputs(inputs, sig);
        seed16 = euint16.wrap(h[0]);
        seed32 = euint32.wrap(h[1]);
        seed64 = euint64.wrap(h[2]);
        FHE.allowThis(seed16);
        FHE.allowThis(seed32);
        FHE.allowThis(seed64);
    }

    /// @param op 0 = add, 1 = min, 2 = mul, 3 = gte+select (motif du règlement)
    /// @param chained true : k opérations dépendantes (x ← x op c) ; false : k opérations
    ///        indépendantes (seed op c_i), résultats publiés séparément.
    function run(uint8 width, uint8 op, bool chained, uint16 k) external {
        delete last;
        nonce++;
        if (width == 16) _run16(op, chained, k);
        else if (width == 32) _run32(op, chained, k);
        else _run64(op, chained, k);
        emit Run(width, op, chained, k, last);
    }

    function _run16(uint8 op, bool chained, uint16 k) internal {
        euint16 x = seed16;
        for (uint16 i = 0; i < k; i++) {
            euint16 a = chained ? x : seed16;
            euint16 c = FHE.asEuint16(uint256(i) + 2 + (nonce % 97) * 100);
            euint16 r;
            if (op == 0) r = FHE.add(a, c);
            else if (op == 1) r = FHE.min(a, c);
            else if (op == 2) r = FHE.mul(a, c);
            else r = FHE.select(FHE.gte(a, c), FHE.sub(a, c), c);
            if (chained) x = r;
            else _publish(euint16.unwrap(r));
        }
        if (chained) _publish(euint16.unwrap(x));
    }

    function _run32(uint8 op, bool chained, uint16 k) internal {
        euint32 x = seed32;
        for (uint16 i = 0; i < k; i++) {
            euint32 a = chained ? x : seed32;
            euint32 c = FHE.asEuint32(uint256(i) + 2 + (nonce % 97) * 100);
            euint32 r;
            if (op == 0) r = FHE.add(a, c);
            else if (op == 1) r = FHE.min(a, c);
            else if (op == 2) r = FHE.mul(a, c);
            else r = FHE.select(FHE.gte(a, c), FHE.sub(a, c), c);
            if (chained) x = r;
            else _publish(euint32.unwrap(r));
        }
        if (chained) _publish(euint32.unwrap(x));
    }

    function _run64(uint8 op, bool chained, uint16 k) internal {
        euint64 x = seed64;
        for (uint16 i = 0; i < k; i++) {
            euint64 a = chained ? x : seed64;
            euint64 c = FHE.asEuint64(uint256(i) + 2 + (nonce % 97) * 100);
            euint64 r;
            if (op == 0) r = FHE.add(a, c);
            else if (op == 1) r = FHE.min(a, c);
            else if (op == 2) r = FHE.mul(a, c);
            else r = FHE.select(FHE.gte(a, c), FHE.sub(a, c), c);
            if (chained) x = r;
            else _publish(euint64.unwrap(r));
        }
        if (chained) _publish(euint64.unwrap(x));
    }

    function _publish(bytes32 h) internal {
        FHE.allowThis(euint64.wrap(h));
        FHE.allowPublic(euint64.wrap(h));
        last.push(h);
    }
}
