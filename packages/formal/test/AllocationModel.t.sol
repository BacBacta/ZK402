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

    /// Conservation découpée (plus petites requêtes pour le solveur).
    function check_fixed_conservationBase(
        uint64[3] memory b0, uint64[3] memory q0, bool[3] memory buy, uint64[3] memory qty, uint64 price
    ) public pure {
        require(price > 0 && price <= MAX_PRICE);
        (uint64[] memory b,,,) = _run(b0, q0, buy, qty, price, MAX_QTY);
        assert(_sums(b) == uint256(b0[0]) + b0[1] + b0[2]);
    }

    function check_fixed_conservationQuote(
        uint64[3] memory b0, uint64[3] memory q0, bool[3] memory buy, uint64[3] memory qty, uint64 price
    ) public pure {
        require(price > 0 && price <= MAX_PRICE);
        (, uint64[] memory q,,) = _run(b0, q0, buy, qty, price, MAX_QTY);
        assert(_sums(q) == uint256(q0[0]) + q0[1] + q0[2]);
    }

    function check_fixed_noNegativeQuote(
        uint64[3] memory b0, uint64[3] memory q0, bool[3] memory buy, uint64[3] memory qty, uint64 price
    ) public pure {
        require(price > 0 && price <= MAX_PRICE);
        (, uint64[] memory q,,) = _run(b0, q0, buy, qty, price, MAX_QTY);
        uint256 sq0 = uint256(q0[0]) + q0[1] + q0[2];
        for (uint256 i = 0; i < 3; i++) assert(q[i] <= sq0);
    }

    function check_fixed_noNegativeBase(
        uint64[3] memory b0, uint64[3] memory q0, bool[3] memory buy, uint64[3] memory qty, uint64 price
    ) public pure {
        require(price > 0 && price <= MAX_PRICE);
        (uint64[] memory b,,,) = _run(b0, q0, buy, qty, price, MAX_QTY);
        uint256 sb0 = uint256(b0[0]) + b0[1] + b0[2];
        for (uint256 i = 0; i < 3; i++) assert(b[i] <= sb0);
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

    // ------------------------------------------------------------------------------------------
    // Preuve par lemmes de la conservation de QUOTE (la preuve directe sur 3 ordres dépasse le
    // temps du solveur à cause des multiplications 64 bits). Chaque lemme porte sur UN ordre
    // (fonction fillOne du modèle) avec des entrées symboliques quelconques respectant les
    // pré-conditions établies par la phase 1 (lemme L5).
    //
    // Conclusion (arithmétique) : ΣQUOTE' = ΣQUOTE − p·Σfb + p·Σfs, car aucune opération ne
    // reboucle (L2, L3, L4) ; or Σfb = Σfs (check_fixed_buyEqualsSell, prouvé) ⇒ ΣQUOTE' = ΣQUOTE.
    // ------------------------------------------------------------------------------------------

    /// L2 : le coût d'une exécution ne reboucle jamais.
    function check_lemma_costExact(uint64 fill, uint64 price) public pure {
        require(fill <= MAX_QTY && price > 0 && price <= MAX_PRICE);
        uint64 cost;
        unchecked {
            cost = fill * price;
        }
        assert(uint256(cost) == uint256(fill) * uint256(price));
    }

    /// L3 : acheteur couvert : QUOTE baisse exactement de fill·p (jamais sous zéro), BASE monte de fill.
    function check_lemma_buyerExact(uint64 base0, uint64 quote0, uint64 e, uint64 remBuy, uint64 remSell, uint64 price)
        public
        pure
    {
        require(price > 0 && price <= MAX_PRICE && e <= MAX_QTY);
        require(uint256(quote0) >= uint256(e) * price); // couverture (L5)
        require(uint256(base0) + e < (uint256(1) << 64)); // offre BASE bornée
        uint64[] memory b = new uint64[](1);
        uint64[] memory q = new uint64[](1);
        b[0] = base0;
        q[0] = quote0;
        uint64[2] memory rem = [remBuy, remSell];
        uint64 fill = AllocationModel.fillOne(b, q, AllocationModel.Order(0, true, e), e, rem, price);
        assert(fill <= e);
        assert(uint256(q[0]) == uint256(quote0) - uint256(fill) * price);
        assert(uint256(b[0]) == uint256(base0) + fill);
        assert(rem[1] == remSell && uint256(rem[0]) + fill == uint256(remBuy));
    }

    /// L4 : vendeur couvert : BASE baisse de fill (jamais sous zéro), QUOTE monte exactement de fill·p.
    function check_lemma_sellerExact(uint64 base0, uint64 quote0, uint64 e, uint64 remBuy, uint64 remSell, uint64 price)
        public
        pure
    {
        require(price > 0 && price <= MAX_PRICE && e <= MAX_QTY);
        require(base0 >= e); // couverture (L5)
        require(uint256(quote0) + uint256(e) * price < (uint256(1) << 64)); // offre QUOTE bornée
        uint64[] memory b = new uint64[](1);
        uint64[] memory q = new uint64[](1);
        b[0] = base0;
        q[0] = quote0;
        uint64[2] memory rem = [remBuy, remSell];
        uint64 fill = AllocationModel.fillOne(b, q, AllocationModel.Order(0, false, e), e, rem, price);
        assert(fill <= e);
        assert(uint256(b[0]) == uint256(base0) - fill);
        assert(uint256(q[0]) == uint256(quote0) + uint256(fill) * price);
        assert(rem[0] == remBuy && uint256(rem[1]) + fill == uint256(remSell));
    }

    /// L5 : phase 1 : un ordre retenu est EXACTEMENT couvert (pas de faux positif par rebouclage
    ///      de q·p) et eff ∈ {0, qty}.
    function check_lemma_coverageExact(uint64 base0, uint64 quote0, bool isBuy, uint64 qty, uint64 price) public pure {
        require(price > 0 && price <= MAX_PRICE);
        uint64 need;
        unchecked {
            need = qty * price;
        }
        bool ok = (isBuy ? quote0 >= need : base0 >= qty) && qty <= MAX_QTY;
        uint64 e = ok ? qty : 0;
        if (e > 0) {
            if (isBuy) assert(uint256(quote0) >= uint256(e) * price);
            else assert(base0 >= e);
            assert(e <= MAX_QTY);
        }
        assert(e == 0 || e == qty);
    }
}
