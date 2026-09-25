// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice Équivalence (Halmos, pour TOUTES les entrées) entre l'allocation FIFO séquentielle
///         (circuit d'origine) et l'allocation par sommes préfixes (scan, incrément P3) :
///           FIFO   : rem_side ← M ; fill_i = min(eff_i, rem_side) ; rem_side −= fill_i
///           Scan   : fill_i = min(eff_i, max(0, M − Σ_{j<i, même sens} eff_j))
///         Sémantique euint64 (rebouclage modulo 2^64) avec eff_i ≤ MAX_QTY et au plus 4 ordres
///         (borne de la taille des lots : 64 · 10^12 < 2^64, pas de rebouclage des préfixes).
contract ScanEquivalenceTest {
    uint64 constant MAX_QTY = 1e12;

    function _min(uint64 a, uint64 b) internal pure returns (uint64) {
        return a < b ? a : b;
    }

    function check_scanEqualsFifo(uint64[4] memory eff, bool[4] memory isBuy) public pure {
        uint64 tb;
        uint64 ts;
        for (uint256 i = 0; i < 4; i++) {
            require(eff[i] <= MAX_QTY);
            unchecked {
                if (isBuy[i]) tb += eff[i];
                else ts += eff[i];
            }
        }
        uint64 m = _min(tb, ts);

        // FIFO séquentiel
        uint64[4] memory fifo;
        uint64 remB = m;
        uint64 remS = m;
        for (uint256 i = 0; i < 4; i++) {
            uint64 rem = isBuy[i] ? remB : remS;
            uint64 f = _min(eff[i], rem);
            fifo[i] = f;
            unchecked {
                if (isBuy[i]) remB -= f;
                else remS -= f;
            }
        }

        // Scan : préfixes exclusifs par sens
        uint64 pb;
        uint64 ps;
        for (uint256 i = 0; i < 4; i++) {
            uint64 prefix = isBuy[i] ? pb : ps;
            uint64 rem;
            unchecked {
                rem = m >= prefix ? m - prefix : 0;
            }
            uint64 f = _min(eff[i], rem);
            assert(f == fifo[i]);
            unchecked {
                if (isBuy[i]) pb += eff[i];
                else ps += eff[i];
            }
        }
    }
}
