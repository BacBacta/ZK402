// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title SealedBatchPool — dark pool par lots, ordres chiffrés (CoFHE), phase 0
/// @custom:security PROTOTYPE DE MESURE, VULNÉRABLE : q·prix reboucle modulo 2^64 (euint64), un
///         acheteur peut passer le contrôle de couverture et rendre son solde QUOTE « négatif »
///         (rebouclé). Corrigé dans SealedBatchPoolV2 (MAX_QTY, MAX_POOL_PRICE). Ne pas réutiliser.
/// @notice Prototype de mesure pour l'idée S1 (docs/idees-nouvelles-base-7.md).
///         Une paire (BASE/QUOTE, crédits de démo). Chaque ordre = sens chiffré
///         (ebool, true = achat) + quantité chiffrée (euint64, en unités de BASE).
///         Le lot est croisé au prix médian `price` (QUOTE par unité de BASE, en clair,
///         fourni par l'opérateur ; un oracle Chainlink/Pyth le remplacera).
///
/// @dev Circuit constant : chaque ordre exécute la même séquence d'opérations FHE,
///      quel que soit son sens, sa taille ou son exécution. Aucun branchement sur un
///      chiffré. Personne (ni l'opérateur, ni les traders) ne voit le résultat avant le
///      règlement : il n'y a pas d'étape interactive, donc pas d'« abandon sélectif ».
///
///      Ce qui reste PUBLIC : les adresses qui soumettent un ordre, le nombre d'ordres
///      par lot, le prix de croisement. Ce qui est CHIFFRÉ : sens, quantités, montants
///      exécutés, soldes, volume croisé.
///
///      Règlement en plusieurs transactions (`settleStep`) pour respecter le plafond de
///      gas par transaction : phase 1 (totaux), puis phase 2 (exécutions FIFO).
contract SealedBatchPool {
    uint64 public constant FAUCET_BASE = 1_000; // unités de BASE
    uint64 public constant FAUCET_QUOTE = 5_000_000; // unités de QUOTE
    uint256 public constant MAX_ORDERS = 64;

    struct Order {
        address trader;
        ebool isBuy;
        euint64 qty;
        euint64 eff; // quantité couverte par le solde (0 sinon)
    }

    address public immutable operator;

    mapping(address => euint64) private _base;
    mapping(address => euint64) private _quote;
    mapping(address => bool) public hasAccount;
    mapping(address => euint64) private _lastFill;
    /// @dev Un ordre par trader et par lot : sinon deux ordres pourraient engager le
    ///      même solde (le contrôle de couverture lit les soldes d'avant règlement).
    mapping(address => uint256) private _submittedInBatch; // batchId + 1

    Order[] private _orders;
    uint256 public batchId;

    // État du règlement en cours
    enum Phase {
        Open,
        Totals,
        Fills
    }
    Phase public phase;
    uint256 public cursor;
    uint64 public price;
    euint64 private _price;
    euint64 private _zero;
    euint64 private _totalBuy;
    euint64 private _totalSell;
    euint64 private _remBuy;
    euint64 private _remSell;

    event OrderSubmitted(uint256 indexed batchId, address indexed trader, uint256 index);
    event SettlementStarted(uint256 indexed batchId, uint64 price, uint256 orders);
    event BatchSettled(uint256 indexed batchId);

    error NotOperator();
    error BatchFull();
    error NotOpen();
    error NothingToSettle();
    error NoAccount();
    error AlreadySubmitted();

    modifier onlyOperator() {
        if (msg.sender != operator) revert NotOperator();
        _;
    }

    constructor(address operator_) {
        operator = operator_;
        _zero = FHE.asEuint64(0);
        FHE.allowThis(_zero);
    }

    // ---------------------------------------------------------------- comptes

    /// @notice Crédits de démo (en production : dépôt d'un FHERC20 / USDC wrappé).
    function claimFaucet() external {
        euint64 b = FHE.asEuint64(FAUCET_BASE);
        euint64 q = FHE.asEuint64(FAUCET_QUOTE);
        if (hasAccount[msg.sender]) {
            b = FHE.add(_base[msg.sender], b);
            q = FHE.add(_quote[msg.sender], q);
        }
        hasAccount[msg.sender] = true;
        _setBalances(msg.sender, b, q);
    }

    function baseBalanceOf(address a) external view returns (euint64) {
        return _base[a];
    }

    function quoteBalanceOf(address a) external view returns (euint64) {
        return _quote[a];
    }

    function lastFillOf(address a) external view returns (euint64) {
        return _lastFill[a];
    }

    function orderCount() external view returns (uint256) {
        return _orders.length;
    }

    // ---------------------------------------------------------------- ordres

    function submitOrder(
        externalEbool encIsBuy,
        bytes calldata proofSide,
        externalEuint64 encQty,
        bytes calldata proofQty
    ) external {
        _submit(FHE.asEbool(encIsBuy, proofSide), FHE.asEuint64(encQty, proofQty));
    }

    function _submit(ebool isBuy, euint64 qty) internal {
        if (phase != Phase.Open) revert NotOpen();
        if (!hasAccount[msg.sender]) revert NoAccount();
        if (_orders.length >= MAX_ORDERS) revert BatchFull();
        if (_submittedInBatch[msg.sender] == batchId + 1) revert AlreadySubmitted();
        _submittedInBatch[msg.sender] = batchId + 1;
        FHE.allowThis(isBuy);
        FHE.allowThis(qty);
        FHE.allowSender(qty);
        _orders.push(Order({trader: msg.sender, isBuy: isBuy, qty: qty, eff: _zero}));
        emit OrderSubmitted(batchId, msg.sender, _orders.length - 1);
    }

    // ---------------------------------------------------------------- règlement

    /// @notice Démarre le règlement du lot au prix `price_` (QUOTE par unité de BASE).
    function startSettlement(uint64 price_) external onlyOperator {
        if (phase != Phase.Open) revert NotOpen();
        if (_orders.length == 0) revert NothingToSettle();
        phase = Phase.Totals;
        cursor = 0;
        price = price_;
        _price = FHE.asEuint64(price_);
        _totalBuy = _zero;
        _totalSell = _zero;
        FHE.allowThis(_price);
        emit SettlementStarted(batchId, price_, _orders.length);
    }

    /// @notice Traite au plus `maxOrders` ordres de la phase courante. Renvoie true
    ///         quand le lot est entièrement réglé.
    function settleStep(uint256 maxOrders) external onlyOperator returns (bool done) {
        uint256 n = _orders.length;
        uint256 end = cursor + maxOrders;
        if (end > n) end = n;

        if (phase == Phase.Totals) {
            for (uint256 i = cursor; i < end; i++) _accumulate(i);
            cursor = end;
            if (cursor == n) {
                euint64 matched = FHE.min(_totalBuy, _totalSell);
                _remBuy = matched;
                _remSell = matched;
                FHE.allowThis(_remBuy);
                FHE.allowThis(_remSell);
                phase = Phase.Fills;
                cursor = 0;
            } else {
                FHE.allowThis(_totalBuy);
                FHE.allowThis(_totalSell);
            }
            return false;
        }
        if (phase == Phase.Fills) {
            for (uint256 i = cursor; i < end; i++) _fill(i);
            cursor = end;
            FHE.allowThis(_remBuy);
            FHE.allowThis(_remSell);
            if (cursor == n) {
                delete _orders;
                phase = Phase.Open;
                cursor = 0;
                emit BatchSettled(batchId);
                batchId++;
                return true;
            }
            return false;
        }
        revert NothingToSettle();
    }

    /// @dev Phase 1 : quantité effective (plafonnée par le solde) et totaux par sens.
    ///      8 opérations FHE par ordre.
    function _accumulate(uint256 i) internal {
        Order storage o = _orders[i];
        euint64 need = FHE.mul(o.qty, _price);
        ebool okBuy = FHE.gte(_quote[o.trader], need);
        ebool okSell = FHE.gte(_base[o.trader], o.qty);
        ebool ok = FHE.select(o.isBuy, okBuy, okSell);
        euint64 eff = FHE.select(ok, o.qty, _zero);
        euint64 buyPart = FHE.select(o.isBuy, eff, _zero);
        euint64 sellPart = FHE.sub(eff, buyPart);
        _totalBuy = FHE.add(_totalBuy, buyPart);
        _totalSell = FHE.add(_totalSell, sellPart);
        o.eff = eff;
        FHE.allowThis(eff);
    }

    /// @dev Phase 2 : exécution FIFO dans la limite du volume croisé, mise à jour des
    ///      soldes. 13 opérations FHE par ordre.
    function _fill(uint256 i) internal {
        Order storage o = _orders[i];
        euint64 rem = FHE.select(o.isBuy, _remBuy, _remSell);
        euint64 fill = FHE.min(o.eff, rem);
        euint64 fb = FHE.select(o.isBuy, fill, _zero);
        euint64 fs = FHE.sub(fill, fb);
        _remBuy = FHE.sub(_remBuy, fb);
        _remSell = FHE.sub(_remSell, fs);

        euint64 cost = FHE.mul(fill, _price);
        euint64 qb = FHE.select(o.isBuy, cost, _zero);
        euint64 qs = FHE.sub(cost, qb);

        address t = o.trader;
        euint64 b = FHE.sub(FHE.add(_base[t], fb), fs);
        euint64 q = FHE.add(FHE.sub(_quote[t], qb), qs);
        _setBalances(t, b, q);
        _lastFill[t] = fill;
        FHE.allowThis(fill);
        FHE.allow(fill, t);
    }

    function _setBalances(address t, euint64 b, euint64 q) internal {
        _base[t] = b;
        _quote[t] = q;
        FHE.allowThis(b);
        FHE.allowThis(q);
        FHE.allow(b, t);
        FHE.allow(q, t);
    }
}

/// @notice Variante de mesure : ordres chiffrés « trivialement » depuis un clair, pour
///         mesurer le coût du règlement sur un fork de Base Sepolia sans passer par le
///         service de vérification des entrées. NE JAMAIS DÉPLOYER EN PRODUCTION :
///         l'ordre est alors en clair dans le calldata.
contract SealedBatchPoolBench is SealedBatchPool {
    constructor(address operator_) SealedBatchPool(operator_) {}

    function submitOrderPlain(bool isBuy, uint64 qty) external {
        _submit(FHE.asEbool(isBuy), FHE.asEuint64(qty));
    }
}
