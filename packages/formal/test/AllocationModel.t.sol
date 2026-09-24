// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {AllocationModel} from "../src/AllocationModel.sol";

/// @notice Propriétés vérifiées SYMBOLIQUEMENT par Halmos (pour toutes les valeurs d'entrée) sur
///         3 ordres de 3 traders distincts (un ordre par trader et par lot, comme le contrat).
///         Soldes bornés par l'offre totale (< 2^62) ; prix public borné.
contract AllocationModelTest {
    uint64 constant SUPPLY_BOUND = uint64(1) << 62;

    function _run(
        uint64[3] memory b0,
        uint64[3] memory q0,
        bool[3] memory buy,
        uint64[3] memory qty,
        uint64 price,
        uint64 maxQty
    ) internal pure returns (uint64[] memory b, uint64[] memory q, uint64[] memory fills, AllocationModel.Order[] memory o) {
        b = new uint64[](3);
        q = new uint64[](3);
        o = new AllocationModel.Order[](3);
        uint256 sb;
        uint256 sq;
        for (uint8 i = 0; i < 3; i++) {
            b[i] = b0[i];
            q[i] = q0[i];
            sb += b0[i];
            sq += q0[i];
            o[i] = AllocationModel.Order(i, buy[i], qty[i]);
        }
        // Hypothèses : offre totale bornée (pas de débordement par accumulation de soldes).
        require(sb < SUPPLY_BOUND && sq < SUPPLY_BOUND);
        fills = AllocationModel.settle(b, q, o, price, maxQty);
    }

    function _sums(uint64[] memory x) internal pure returns (uint256 s) {
        for (uint256 i = 0; i < x.length; i++) s += x[i];
    }

    /// Circuit v2 d'origine (sans plafond de quantité) : un acheteur ne doit jamais recevoir
    /// de BASE sans payer fill × prix en QUOTE (valeur non rebouclée).
    function check_v2_buyerPaysFullPrice(
        uint64[3] memory b0, uint64[3] memory q0, bool[3] memory buy, uint64[3] memory qty, uint64 price
    ) public pure {
        require(price > 0 && price <= 1e6);
        (, uint64[] memory q, uint64[] memory fills, AllocationModel.Order[] memory o) = _run(b0, q0, buy, qty, price, 0);
        for (uint256 i = 0; i < 3; i++) {
            if (o[i].isBuy && fills[i] > 0) {
                // payé = q0 - q (doit égaler fill × prix en arithmétique exacte)
                assert(uint256(q0[i]) - uint256(q[i]) == uint256(fills[i]) * uint256(price));
            }
        }
    }

    /// Circuit corrigé : qty ≤ MAX_QTY et prix ≤ MAX_PRICE avec MAX_QTY × MAX_PRICE < 2^64.
    uint64 constant MAX_QTY = 1e12;
    uint64 constant MAX_PRICE = 1e6;

    function check_fixed_buyerPaysFullPrice(
        uint64[3] memory b0, uint64[3] memory q0, bool[3] memory buy, uint64[3] memory qty, uint64 price
    ) public pure {
        require(price > 0 && price <= MAX_PRICE);
        (, uint64[] memory q, uint64[] memory fills, AllocationModel.Order[] memory o) = _run(b0, q0, buy, qty, price, MAX_QTY);
        for (uint256 i = 0; i < 3; i++) {
            if (o[i].isBuy && fills[i] > 0) {
                assert(uint256(q0[i]) - uint256(q[i]) == uint256(fills[i]) * uint256(price));
            }
        }
    }

    /// Conservation exacte de BASE et de QUOTE, et absence de solde « négatif » (rebouclé),
    /// pour le circuit corrigé.
    function check_fixed_conservationAndNoWrap(
        uint64[3] memory b0, uint64[3] memory q0, bool[3] memory buy, uint64[3] memory qty, uint64 price
    ) public pure {
        require(price > 0 && price <= MAX_PRICE);
        (uint64[] memory b, uint64[] memory q, uint64[] memory fills, AllocationModel.Order[] memory o) =
            _run(b0, q0, buy, qty, price, MAX_QTY);
        uint256 sb0 = uint256(b0[0]) + b0[1] + b0[2];
        uint256 sq0 = uint256(q0[0]) + q0[1] + q0[2];
        assert(_sums(b) == sb0);
        assert(_sums(q) == sq0);
        for (uint256 i = 0; i < 3; i++) {
            // aucun solde ne dépasse l'offre totale (un rebouclage produirait ~2^64)
            assert(b[i] <= sb0 && q[i] <= sq0);
            // exécution ≤ quantité demandée
            assert(fills[i] <= o[i].qty);
        }
    }

    /// Équilibre : volume acheté exécuté = volume vendu exécuté (circuit corrigé).
    function check_fixed_buyEqualsSell(
        uint64[3] memory b0, uint64[3] memory q0, bool[3] memory buy, uint64[3] memory qty, uint64 price
    ) public pure {
        require(price > 0 && price <= MAX_PRICE);
        (,, uint64[] memory fills, AllocationModel.Order[] memory o) = _run(b0, q0, buy, qty, price, MAX_QTY);
        uint256 fb;
        uint256 fs;
        for (uint256 i = 0; i < 3; i++) {
            if (o[i].isBuy) fb += fills[i];
            else fs += fills[i];
        }
        assert(fb == fs);
    }
}
