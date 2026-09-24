// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IAggregatorV3, IPythMinimal} from "./oracles/IOracles.sol";

/// @title SealedBatchPoolV2 — dark pool par lots, ordres chiffrés (CoFHE), sans opérateur
/// @notice Incrément 1 du programme docs/prompt-s1-points-ouverts.md (P7 + P2.a).
///         Spécification : docs/s1-specification.md.
///
///         Changements par rapport à la v1 :
///         - AUCUN rôle privilégié (pas d'operator/owner/pause/proxy) : P7.3.
///         - Lots à échéance on-chain : le lot k ferme à GENESIS + (k+1)·BATCH_DURATION.
///         - Règlement déclenchable par N'IMPORTE QUI après l'échéance : P7.4.
///         - Prix = règle publique sur deux oracles indépendants (Chainlink + Pyth) avec
///           contrôles d'ancienneté, de confiance et d'écart ; si la règle échoue, le lot est
///           REPORTÉ, jamais réglé à un prix invalide : P7.1, P2.a.
///         - Aucun chemin où un clair signé par le déchiffreur déclenche un transfert (P2.b).
///
/// @dev Circuit constant conservé : même séquence d'opérations FHE pour chaque ordre.
///      Fuites encore présentes (traitées par P1, incrément 2) : adresse du soumetteur,
///      instant, nombre d'ordres par lot.
contract SealedBatchPoolV2 {
    // ------------------------------------------------------------------ paramètres
    uint64 public constant FAUCET_BASE = 1_000;
    uint64 public constant FAUCET_QUOTE = 5_000_000;
    uint256 public constant MAX_ORDERS = 64;

    IAggregatorV3 public immutable chainlinkFeed;
    IPythMinimal public immutable pyth;
    bytes32 public immutable pythPriceId;
    /// @notice Ancienneté maximale d'un prix d'oracle (secondes).
    uint256 public immutable maxStaleness;
    /// @notice Écart maximal toléré entre les deux oracles (points de base).
    uint256 public immutable maxDeviationBps;
    /// @notice Intervalle de confiance Pyth maximal, relatif au prix (points de base).
    uint256 public immutable maxConfBps;
    /// @notice Prix (8 décimales, USD par unité d'actif) → unités de QUOTE par unité de BASE.
    uint256 public immutable priceDivisor;
    uint64 public immutable genesis;
    uint64 public immutable batchDuration;

    // ------------------------------------------------------------------ état
    struct Order {
        address trader;
        ebool isBuy;
        euint64 qty;
        euint64 eff;
    }

    mapping(address => euint64) private _base;
    mapping(address => euint64) private _quote;
    mapping(address => euint64) private _lastFill;
    mapping(address => bool) public hasAccount;
    /// @dev batchId + 1 du dernier lot où le trader a soumis (un ordre par lot et par trader).
    mapping(address => uint256) private _submittedBatchPlus1;
    mapping(uint256 => Order[]) private _orders;

    /// @notice Prochain lot à régler (les lots se règlent strictement dans l'ordre).
    uint256 public nextToSettle;

    enum Phase {
        Idle,
        Totals,
        Fills
    }
    Phase public phase;
    uint256 public cursor;
    uint64 public settlementPrice;
    euint64 private _price;
    euint64 private _zero;
    euint64 private _totalBuy;
    euint64 private _totalSell;
    euint64 private _remBuy;
    euint64 private _remSell;

    // ------------------------------------------------------------------ événements / erreurs
    event OrderSubmitted(uint256 indexed batchId, address indexed trader, uint256 index);
    event SettlementStarted(uint256 indexed batchId, uint64 price, uint256 orders, int256 chainlink8, int256 pyth8);
    event BatchSettled(uint256 indexed batchId);
    event BatchSkippedEmpty(uint256 indexed batchId);
    event BatchPostponed(uint256 indexed batchId, uint8 reason);

    // Codes de report (BatchPostponed.reason)
    uint8 public constant R_CHAINLINK_INVALID = 1;
    uint8 public constant R_CHAINLINK_STALE = 2;
    uint8 public constant R_PYTH_INVALID = 3;
    uint8 public constant R_PYTH_CONFIDENCE = 4;
    uint8 public constant R_DEVIATION = 5;
    uint8 public constant R_PRICE_ZERO = 6;

    error BatchFull();
    error NoAccount();
    error AlreadySubmitted();
    error BatchNotClosed();
    error SettlementInProgress();
    error NoSettlementInProgress();
    error BadParams();
    error RefundFailed();

    constructor(
        address chainlinkFeed_,
        address pyth_,
        bytes32 pythPriceId_,
        uint256 maxStaleness_,
        uint256 maxDeviationBps_,
        uint256 maxConfBps_,
        uint256 priceDivisor_,
        uint64 batchDuration_
    ) {
        if (
            chainlinkFeed_ == address(0) || pyth_ == address(0) || maxStaleness_ == 0 || maxDeviationBps_ == 0
                || maxDeviationBps_ > 1_000 || maxConfBps_ == 0 || priceDivisor_ == 0 || batchDuration_ == 0
        ) revert BadParams();
        chainlinkFeed = IAggregatorV3(chainlinkFeed_);
        pyth = IPythMinimal(pyth_);
        pythPriceId = pythPriceId_;
        maxStaleness = maxStaleness_;
        maxDeviationBps = maxDeviationBps_;
        maxConfBps = maxConfBps_;
        priceDivisor = priceDivisor_;
        batchDuration = batchDuration_;
        genesis = uint64(block.timestamp);
        _zero = FHE.asEuint64(0);
        FHE.allowThis(_zero);
    }

    // ------------------------------------------------------------------ lots

    /// @notice Lot qui accepte actuellement des ordres.
    function currentBatch() public view returns (uint256) {
        return (block.timestamp - genesis) / batchDuration;
    }

    /// @notice Instant de fermeture du lot `k`.
    function batchDeadline(uint256 k) public view returns (uint256) {
        return uint256(genesis) + (k + 1) * uint256(batchDuration);
    }

    function orderCount(uint256 k) external view returns (uint256) {
        return _orders[k].length;
    }

    // ------------------------------------------------------------------ comptes (démo)

    /// @notice Crédits de démo. Remplacé par des dépôts d'actifs réels à l'incrément P4.
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

    // ------------------------------------------------------------------ ordres

    function submitOrder(
        externalEbool encIsBuy,
        bytes calldata proofSide,
        externalEuint64 encQty,
        bytes calldata proofQty
    ) external {
        _submit(FHE.asEbool(encIsBuy, proofSide), FHE.asEuint64(encQty, proofQty));
    }

    function _submit(ebool isBuy, euint64 qty) internal {
        if (!hasAccount[msg.sender]) revert NoAccount();
        uint256 k = currentBatch();
        if (_orders[k].length >= MAX_ORDERS) revert BatchFull();
        if (_submittedBatchPlus1[msg.sender] == k + 1) revert AlreadySubmitted();
        _submittedBatchPlus1[msg.sender] = k + 1;
        FHE.allowThis(isBuy);
        FHE.allowThis(qty);
        FHE.allowSender(qty);
        _orders[k].push(Order({trader: msg.sender, isBuy: isBuy, qty: qty, eff: _zero}));
        emit OrderSubmitted(k, msg.sender, _orders[k].length - 1);
    }

    // ------------------------------------------------------------------ prix (règle publique R)

    /// @notice Évalue la règle d'oracle R. Renvoie (ok, raison, prix du pool, prix CL 8 déc., prix Pyth 8 déc.).
    function evaluatePrice()
        public
        view
        returns (bool ok, uint8 reason, uint64 poolPrice, int256 cl8, int256 py8)
    {
        // Chainlink
        (uint80 roundId, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = chainlinkFeed.latestRoundData();
        if (answer <= 0 || answeredInRound < roundId) return (false, R_CHAINLINK_INVALID, 0, 0, 0);
        if (updatedAt + maxStaleness < block.timestamp) return (false, R_CHAINLINK_STALE, 0, 0, 0);
        cl8 = _to8(answer, chainlinkFeed.decimals());

        // Pyth (getPriceNoOlderThan revert si trop ancien : on l'attrape)
        try pyth.getPriceNoOlderThan(pythPriceId, maxStaleness) returns (IPythMinimal.Price memory p) {
            if (p.price <= 0) return (false, R_PYTH_INVALID, 0, cl8, 0);
            if (uint256(p.conf) * 10_000 > uint256(int256(p.price)) * maxConfBps) {
                return (false, R_PYTH_CONFIDENCE, 0, cl8, 0);
            }
            py8 = _expoTo8(int256(p.price), p.expo);
        } catch {
            return (false, R_PYTH_INVALID, 0, cl8, 0);
        }
        if (py8 <= 0) return (false, R_PYTH_INVALID, 0, cl8, py8);

        // Écart
        uint256 a = uint256(cl8);
        uint256 b = uint256(py8);
        uint256 lo = a < b ? a : b;
        uint256 diff = a > b ? a - b : b - a;
        if (diff * 10_000 > lo * maxDeviationBps) return (false, R_DEVIATION, 0, cl8, py8);

        uint256 mid = (a + b) / 2;
        uint256 pp = mid / priceDivisor;
        if (pp == 0 || pp > type(uint64).max) return (false, R_PRICE_ZERO, 0, cl8, py8);
        return (true, 0, uint64(pp), cl8, py8);
    }

    function _to8(int256 v, uint8 dec) internal pure returns (int256) {
        if (dec == 8) return v;
        if (dec > 8) return v / int256(10 ** (dec - 8));
        return v * int256(10 ** (8 - dec));
    }

    function _expoTo8(int256 v, int32 expo) internal pure returns (int256) {
        // valeur réelle = v · 10^expo ; en 8 décimales : v · 10^(expo + 8)
        int256 e = int256(expo) + 8;
        if (e == 0) return v;
        if (e > 0) return v * int256(10 ** uint256(e));
        return v / int256(10 ** uint256(-e));
    }

    // ------------------------------------------------------------------ règlement (sans permission)

    /// @notice Démarre le règlement du prochain lot fermé. N'importe qui peut l'appeler.
    ///         `pythUpdate` (optionnel) : données signées Pyth poussées avant lecture ; le
    ///         déclencheur paie les frais Pyth, l'excédent lui est remboursé.
    /// @return started true si le règlement a démarré ; false si lot vide (passé) ou reporté.
    function startSettlement(bytes[] calldata pythUpdate) external payable returns (bool started) {
        if (phase != Phase.Idle) revert SettlementInProgress();
        uint256 k = nextToSettle;
        if (block.timestamp < batchDeadline(k)) revert BatchNotClosed();

        uint256 spent;
        if (pythUpdate.length > 0) {
            spent = pyth.getUpdateFee(pythUpdate);
            pyth.updatePriceFeeds{value: spent}(pythUpdate);
        }
        if (msg.value > spent) {
            (bool okRefund,) = msg.sender.call{value: msg.value - spent}("");
            if (!okRefund) revert RefundFailed();
        }

        if (_orders[k].length == 0) {
            nextToSettle = k + 1;
            emit BatchSkippedEmpty(k);
            return false;
        }

        (bool ok, uint8 reason, uint64 p, int256 cl8, int256 py8) = evaluatePrice();
        if (!ok) {
            emit BatchPostponed(k, reason);
            return false;
        }

        phase = Phase.Totals;
        cursor = 0;
        settlementPrice = p;
        _price = FHE.asEuint64(p);
        FHE.allowThis(_price);
        _totalBuy = _zero;
        _totalSell = _zero;
        emit SettlementStarted(k, p, _orders[k].length, cl8, py8);
        return true;
    }

    /// @notice Fait progresser le règlement en cours d'au plus `maxOrders` ordres.
    ///         N'importe qui peut l'appeler. Renvoie true quand le lot est réglé.
    function settleStep(uint256 maxOrders) external returns (bool done) {
        if (phase == Phase.Idle) revert NoSettlementInProgress();
        uint256 k = nextToSettle;
        Order[] storage orders = _orders[k];
        uint256 n = orders.length;
        uint256 end = cursor + maxOrders;
        if (end > n) end = n;

        if (phase == Phase.Totals) {
            for (uint256 i = cursor; i < end; i++) _accumulate(orders[i]);
            cursor = end;
            FHE.allowThis(_totalBuy);
            FHE.allowThis(_totalSell);
            if (cursor == n) {
                euint64 matched = FHE.min(_totalBuy, _totalSell);
                _remBuy = matched;
                _remSell = matched;
                FHE.allowThis(_remBuy);
                FHE.allowThis(_remSell);
                phase = Phase.Fills;
                cursor = 0;
            }
            return false;
        }

        for (uint256 i = cursor; i < end; i++) _fill(orders[i]);
        cursor = end;
        FHE.allowThis(_remBuy);
        FHE.allowThis(_remSell);
        if (cursor == n) {
            delete _orders[k];
            phase = Phase.Idle;
            cursor = 0;
            nextToSettle = k + 1;
            emit BatchSettled(k);
            return true;
        }
        return false;
    }

    function _accumulate(Order storage o) internal {
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

    function _fill(Order storage o) internal {
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
