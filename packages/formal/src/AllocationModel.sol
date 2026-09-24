// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @title Modèle en clair, opération par opération, du circuit FHE de règlement
/// @notice Chaque ligne reproduit une opération de SealedBatchPoolV2 (_accumulate/_fill) avec la
///         SÉMANTIQUE EXACTE des opérations CoFHE sur euint64 : add/sub/mul rebouclent modulo 2^64
///         (bloc `unchecked` sur uint64), select/min/gte sont exacts. Sert à la vérification
///         formelle (Halmos) des invariants de conservation et d'absence de débordement.
library AllocationModel {
    struct Order {
        uint8 trader;
        bool isBuy;
        uint64 qty;
    }

    function sel(bool c, uint64 a, uint64 b) internal pure returns (uint64) {
        return c ? a : b;
    }

    function min64(uint64 a, uint64 b) internal pure returns (uint64) {
        return a < b ? a : b;
    }

    function fillOne(
        uint64[] memory base,
        uint64[] memory quote,
        Order memory o,
        uint64 e,
        uint64[2] memory rem,
        uint64 price
    ) internal pure returns (uint64 fill) {
        unchecked {
            fill = min64(e, sel(o.isBuy, rem[0], rem[1]));
            uint64 fb = sel(o.isBuy, fill, 0);
            uint64 fs = fill - fb; // FHE.sub
            rem[0] = rem[0] - fb;
            rem[1] = rem[1] - fs;
            uint64 cost = fill * price; // FHE.mul : reboucle
            uint64 qb = sel(o.isBuy, cost, 0);
            uint64 qs = cost - qb;
            base[o.trader] = (base[o.trader] + fb) - fs;
            quote[o.trader] = (quote[o.trader] - qb) + qs;
        }
    }

    /// @param maxQty 0 = pas de plafond (circuit v2 d'origine) ; sinon ordre invalide si qty > maxQty.
    function settle(
        uint64[] memory base,
        uint64[] memory quote,
        Order[] memory orders,
        uint64 price,
        uint64 maxQty
    ) internal pure returns (uint64[] memory fills) {
        uint256 n = orders.length;
        uint64[] memory eff = new uint64[](n);
        fills = new uint64[](n);
        uint64 totalBuy;
        uint64 totalSell;
        unchecked {
            // Phase 1 (_accumulate)
            for (uint256 i = 0; i < n; i++) {
                Order memory o = orders[i];
                uint64 need = o.qty * price; // FHE.mul : reboucle
                bool okBuy = quote[o.trader] >= need; // FHE.gte
                bool okSell = base[o.trader] >= o.qty; // FHE.gte
                bool ok = o.isBuy ? okBuy : okSell; // FHE.select(ebool)
                if (maxQty != 0) ok = ok && (o.qty <= maxQty); // FHE.and(ok, FHE.lte(qty, MAX_QTY))
                uint64 e = sel(ok, o.qty, 0);
                uint64 buyPart = sel(o.isBuy, e, 0);
                uint64 sellPart = e - buyPart; // FHE.sub
                totalBuy = totalBuy + buyPart; // FHE.add
                totalSell = totalSell + sellPart;
                eff[i] = e;
            }
            uint64 matched = min64(totalBuy, totalSell);
            uint64[2] memory rem = [matched, matched]; // [remBuy, remSell]
            // Phase 2 (_fill)
            for (uint256 i = 0; i < n; i++) {
                fills[i] = fillOne(base, quote, orders[i], eff[i], rem, price);
            }
        }
    }
}
