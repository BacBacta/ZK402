// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {IAggregatorV3, IPythMinimal} from "./oracles/IOracles.sol";

/// @notice Vue de l'entrée blindée utilisée par le pool pour les sorties vers une note (P4).
interface IShieldedEntryForPool {
    function stipendBaseUnits() external view returns (uint64);

    function classInfo(uint8 cls) external view returns (bool isBase, uint64 poolAmount);

    function insertFromPool(uint8 cls, uint256 commitment) external;
}

/// @title SealedBatchPoolV2 — dark pool par lots, ordres chiffrés (CoFHE), sans opérateur
/// @notice Incréments 1 et 2 du programme docs/prompt-s1-points-ouverts.md (P7 + P2.a).
///         Spécification : docs/s1-specification.md.
///
///         Changements par rapport à la v1 :
///         - AUCUN rôle privilégié (pas d'operator/owner/pause/proxy) : P7.3.
///         - Lots à échéance on-chain : le lot k ferme à GENESIS + (k+1)·BATCH_DURATION.
///         - Règlement déclenchable par N'IMPORTE QUI après l'échéance : P7.4.
///         - Prix = règle publique « 2 sur 3 » sur trois oracles indépendants (Chainlink, Pyth,
///           API3), évaluée À L'INSTANT DE CLÔTURE t_k (et non au moment du déclenchement) :
///           le déclencheur ne choisit ni le prix ni l'instant d'observation (P7.1, P7.2, R5).
///           Si moins de deux sources valides concordent, le lot est REPORTÉ (P2.a).
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
    /// @notice Bornes anti-rebouclage : les opérations euint64 de CoFHE rebouclent modulo 2^64.
    ///         Sans borne, un acheteur peut choisir q tel que q·prix ≡ petit (mod 2^64), passer le
    ///         contrôle de couverture et payer presque rien (contre-exemple trouvé par Halmos,
    ///         packages/formal). Avec MAX_QTY · MAX_POOL_PRICE < 2^64, q·prix ne reboucle jamais.
    uint64 public constant MAX_QTY = 1e12;
    uint64 public constant MAX_POOL_PRICE = 1e6;

    IAggregatorV3 public immutable chainlinkFeed; // avec historique de rounds
    IAggregatorV3 public immutable api3Feed; // Api3ReaderProxyV1 (sans historique)
    IPythMinimal public immutable pyth;
    bytes32 public immutable pythPriceId;
    /// @notice Ancienneté maximale acceptée à l'instant t_k, par source (secondes) : dépend du
    ///         heartbeat de chaque réseau (API3 se met à jour sur déviation + heartbeat long).
    uint256 public immutable chainlinkMaxAge;
    uint256 public immutable api3MaxAge;
    uint256 public immutable pythMaxAge;
    /// @notice Fenêtre après t_k dans laquelle doit tomber la mise à jour Pyth « unique ».
    uint64 public immutable pythWindow;
    /// @notice Écart maximal toléré entre deux sources concordantes (points de base).
    uint256 public immutable maxDeviationBps;
    /// @notice Intervalle de confiance Pyth maximal, relatif au prix (points de base).
    uint256 public immutable maxConfBps;
    /// @notice Prix (8 décimales, USD par unité d'actif) → unités de QUOTE par unité de BASE.
    uint256 public immutable priceDivisor;
    /// @notice Contrat d'entrée blindée (ShieldedEntry) seul autorisé à créditer des soldes.
    ///         address(0) = mode démo (faucet actif, pas d'entrée blindée).
    address public immutable entry;
    /// @notice Frais par ordre (wei), anti-spam ; versés à celui qui TERMINE le règlement du lot.
    uint256 public immutable submitFee;
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
    /// @notice Frais accumulés par lot (payés au finisseur du règlement).
    mapping(uint256 => uint256) public batchFees;

    /// @notice Demandes de sortie vers une note (P4) : débit chiffré en attente de la publication
    ///         du résultat déchiffré de `ok` (solde suffisant ?).
    struct NoteOut {
        address owner;
        uint8 cls;
        uint256 commitment;
        ebool ok;
    }

    mapping(uint256 => NoteOut) public noteOuts;
    uint256 public nextNoteOut;

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
    euint64 private _maxQty;
    euint64 private _totalBuy;
    euint64 private _totalSell;
    euint64 private _remBuy;
    euint64 private _remSell;

    // ------------------------------------------------------------------ événements / erreurs
    event OrderSubmitted(uint256 indexed batchId, address indexed trader, uint256 index);
    event SettlementStarted(
        uint256 indexed batchId, uint64 price, uint256 orders, int256 chainlink8, int256 pyth8, int256 api38
    );
    event BatchSettled(uint256 indexed batchId);
    event BatchSkippedEmpty(uint256 indexed batchId);
    event BatchPostponed(uint256 indexed batchId, uint8 reason);
    event Credited(address indexed account);
    event KeeperPaid(uint256 indexed batchId, address indexed keeper, uint256 amount);
    event NoteOutRequested(uint256 indexed id, address indexed owner, uint8 cls, uint256 commitment, bytes32 okHandle);
    event NoteOutFinalized(uint256 indexed id, bool ok);

    // Validité par source (bits) et codes de report (BatchPostponed.reason)
    uint8 public constant R_NOT_ENOUGH_SOURCES = 1; // moins de 2 sources valides
    uint8 public constant R_NO_AGREEMENT = 2; // pas deux sources dans l'écart toléré
    uint8 public constant R_PRICE_OUT_OF_RANGE = 3; // prix nul ou > MAX_POOL_PRICE

    error BatchFull();
    error NoAccount();
    error AlreadySubmitted();
    error BatchNotClosed();
    error SettlementInProgress();
    error NoSettlementInProgress();
    error BadParams();
    error RefundFailed();
    error BadChainlinkHint();
    error OnlyEntry();
    error FaucetDisabled();
    error BadFeeValue();
    error NoEntry();
    error UnknownNoteOut();
    error BadDecryption();

    struct OracleConfig {
        address chainlinkFeed;
        address api3Feed;
        address pyth;
        bytes32 pythPriceId;
        uint256 chainlinkMaxAge;
        uint256 api3MaxAge;
        uint256 pythMaxAge;
        uint64 pythWindow;
        uint256 maxDeviationBps;
        uint256 maxConfBps;
    }

    constructor(
        OracleConfig memory o,
        uint256 priceDivisor_,
        uint64 batchDuration_,
        address entry_,
        uint256 submitFee_
    ) {
        if (
            o.chainlinkFeed == address(0) || o.api3Feed == address(0) || o.pyth == address(0)
                || o.chainlinkMaxAge == 0 || o.api3MaxAge == 0 || o.pythMaxAge == 0 || o.pythWindow == 0
                || o.maxDeviationBps == 0 || o.maxDeviationBps > 1_000 || o.maxConfBps == 0 || priceDivisor_ == 0
                || batchDuration_ == 0
        ) revert BadParams();
        chainlinkFeed = IAggregatorV3(o.chainlinkFeed);
        api3Feed = IAggregatorV3(o.api3Feed);
        pyth = IPythMinimal(o.pyth);
        pythPriceId = o.pythPriceId;
        chainlinkMaxAge = o.chainlinkMaxAge;
        api3MaxAge = o.api3MaxAge;
        pythMaxAge = o.pythMaxAge;
        pythWindow = o.pythWindow;
        maxDeviationBps = o.maxDeviationBps;
        maxConfBps = o.maxConfBps;
        priceDivisor = priceDivisor_;
        batchDuration = batchDuration_;
        entry = entry_;
        submitFee = submitFee_;
        genesis = uint64(block.timestamp);
        _zero = FHE.asEuint64(0);
        FHE.allowThis(_zero);
        _maxQty = FHE.asEuint64(MAX_QTY);
        FHE.allowThis(_maxQty);
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
        if (entry != address(0)) revert FaucetDisabled();
        euint64 b = FHE.asEuint64(FAUCET_BASE);
        euint64 q = FHE.asEuint64(FAUCET_QUOTE);
        if (hasAccount[msg.sender]) {
            b = FHE.add(_base[msg.sender], b);
            q = FHE.add(_quote[msg.sender], q);
        }
        hasAccount[msg.sender] = true;
        _setBalances(msg.sender, b, q);
    }

    /// @notice Crédit d'un pseudonyme par l'entrée blindée (réclamation anonyme d'une note).
    ///         Le montant crédité est celui de la classe de note (public par construction : les
    ///         classes sont des paliers fixes, ce qui maximise l'ensemble d'anonymat).
    function credit(address account, uint64 baseAmount, uint64 quoteAmount) external {
        if (msg.sender != entry || entry == address(0)) revert OnlyEntry();
        euint64 b = FHE.asEuint64(baseAmount);
        euint64 q = FHE.asEuint64(quoteAmount);
        if (hasAccount[account]) {
            b = FHE.add(_base[account], b);
            q = FHE.add(_quote[account], q);
        }
        hasAccount[account] = true;
        _setBalances(account, b, q);
        emit Credited(account);
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

    // ------------------------------------------------------------------ sorties (P4)

    /// @notice Convertit un palier `cls` du solde CHIFFRÉ de l'appelant en une nouvelle note
    ///         (engagement `commitment`) de l'entrée blindée. L'allocation de gas de la note est
    ///         prélevée sur le solde CHIFFRÉ en BASE (s unités) : aucun ETH extérieur n'est requis,
    ///         donc aucun lien avec une autre adresse. Circuit constant :
    ///           ok = (BASE ≥ s + d si palier BASE) ou (QUOTE ≥ d et BASE ≥ s si palier QUOTE)
    ///           débits = select(ok, …, 0).
    ///         `ok` est rendu déchiffrable publiquement ; `finalizeNoteOut` publie son résultat signé.
    /// @dev Interdit pendant un règlement : un débit entre le contrôle de couverture et
    ///      l'exécution pourrait faire reboucler un solde.
    function requestNoteOut(uint8 cls, uint256 commitment) external returns (uint256 id) {
        if (entry == address(0)) revert NoEntry();
        if (phase != Phase.Idle) revert SettlementInProgress();
        if (!hasAccount[msg.sender]) revert NoAccount();
        IShieldedEntryForPool e = IShieldedEntryForPool(entry);
        (bool isBase, uint64 amount) = e.classInfo(cls);
        uint64 s = e.stipendBaseUnits();

        euint64 bBal = _base[msg.sender];
        euint64 qBal = _quote[msg.sender];
        euint64 baseNeed = FHE.asEuint64(isBase ? amount + s : s);
        euint64 quoteNeed = FHE.asEuint64(isBase ? 0 : amount);
        ebool ok = FHE.and(FHE.gte(bBal, baseNeed), FHE.gte(qBal, quoteNeed));
        _setBalances(
            msg.sender,
            FHE.sub(bBal, FHE.select(ok, baseNeed, _zero)),
            FHE.sub(qBal, FHE.select(ok, quoteNeed, _zero))
        );
        FHE.allowThis(ok);
        FHE.allowPublic(ok);

        id = nextNoteOut++;
        noteOuts[id] = NoteOut(msg.sender, cls, commitment, ok);
        emit NoteOutRequested(id, msg.sender, cls, commitment, ebool.unwrap(ok));
    }

    /// @notice Finalise une sortie vers une note avec le résultat déchiffré SIGNÉ de `ok`.
    ///         N'importe qui peut l'appeler. ok = vrai : la note est insérée dans l'arbre de
    ///         l'entrée ; ok = faux : rien n'a été débité.
    function finalizeNoteOut(uint256 id, bool okPlain, bytes calldata signature) external {
        NoteOut memory n = noteOuts[id];
        if (n.owner == address(0)) revert UnknownNoteOut();
        if (!FHE.verifyDecryptResultSafe(n.ok, okPlain, signature)) revert BadDecryption();
        delete noteOuts[id];
        emit NoteOutFinalized(id, okPlain);
        if (okPlain) IShieldedEntryForPool(entry).insertFromPool(n.cls, n.commitment);
    }

    // ------------------------------------------------------------------ ordres

    function submitOrder(
        externalEbool encIsBuy,
        bytes calldata proofSide,
        externalEuint64 encQty,
        bytes calldata proofQty
    ) external payable {
        _submit(FHE.asEbool(encIsBuy, proofSide), FHE.asEuint64(encQty, proofQty));
    }

    function _submit(ebool isBuy, euint64 qty) internal {
        if (!hasAccount[msg.sender]) revert NoAccount();
        if (msg.value != submitFee) revert BadFeeValue();
        uint256 k = currentBatch();
        batchFees[k] += msg.value;
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
    //
    // R(t) : valeur de chaque source « à l'instant t » (t = clôture du lot), puis 2 sur 3.
    //  - Chainlink : le round `hint` fourni par le déclencheur doit être le DERNIER round tel que
    //    updatedAt ≤ t (vérifié : updatedAt(hint) ≤ t et, s'il existe, updatedAt(hint+1) > t).
    //    Valeur unique : le déclencheur ne peut pas choisir un autre round.
    //  - API3 (sans historique) : valeur courante acceptée seulement si updatedAt ≤ t (sinon la
    //    valeur « à t » est inconnue → source invalide).
    //  - Pyth : (a) mise à jour signée poussée par le déclencheur : PREMIÈRE publication dans
    //    [t, t + pythWindow] (parsePriceFeedUpdatesUnique) ; ou (b) valeur stockée si
    //    publishTime ≤ t. Confiance ≤ maxConfBps.
    //  - Chaque valeur doit avoir un âge ≤ maxAge de sa source, mesuré à t.
    //  - Au moins 2 sources valides ; prix = médiane ; au moins deux sources (dont la médiane)
    //    à ≤ maxDeviationBps l'une de l'autre.

    /// @notice Valeur Chainlink à l'instant t (8 décimales). 0 si invalide ; revert si l'indice
    ///         `hint` n'est pas le bon round (le déclencheur ne peut pas tricher sur le round).
    function chainlinkAt(uint256 t, uint80 hint) public view returns (int256) {
        (uint80 latestId,,,,) = chainlinkFeed.latestRoundData();
        (, int256 answer,, uint256 updatedAt, uint80 answeredInRound) = chainlinkFeed.getRoundData(hint);
        if (updatedAt == 0 || updatedAt > t) revert BadChainlinkHint();
        if (hint < latestId) {
            (,,, uint256 nextUpdatedAt,) = chainlinkFeed.getRoundData(hint + 1);
            if (nextUpdatedAt != 0 && nextUpdatedAt <= t) revert BadChainlinkHint();
        }
        if (answer <= 0 || answeredInRound < hint || updatedAt + chainlinkMaxAge < t) return 0;
        return _to8(answer, chainlinkFeed.decimals());
    }

    /// @notice Valeur API3 à l'instant t (8 décimales), 0 si inconnue ou invalide.
    function api3At(uint256 t) public view returns (int256) {
        (, int256 answer,, uint256 updatedAt,) = api3Feed.latestRoundData();
        if (answer <= 0 || updatedAt == 0 || updatedAt > t || updatedAt + api3MaxAge < t) return 0;
        return _to8(answer, api3Feed.decimals());
    }

    function _pythStoredAt(uint256 t) internal view returns (int256) {
        try pyth.getPriceUnsafe(pythPriceId) returns (IPythMinimal.Price memory p) {
            if (p.publishTime > t || p.publishTime + pythMaxAge < t) return 0;
            return _pythTo8(p);
        } catch {
            return 0;
        }
    }

    function _pythTo8(IPythMinimal.Price memory p) internal view returns (int256) {
        if (p.price <= 0) return 0;
        if (uint256(p.conf) * 10_000 > uint256(int256(p.price)) * maxConfBps) return 0;
        return _expoTo8(int256(p.price), p.expo);
    }

    /// @notice Agrège trois valeurs (0 = invalide) selon la règle 2 sur 3.
    function aggregate(int256 a, int256 b, int256 c) public view returns (bool ok, uint8 reason, uint64 poolPrice) {
        uint256[3] memory v;
        uint256 n;
        if (a > 0) v[n++] = uint256(a);
        if (b > 0) v[n++] = uint256(b);
        if (c > 0) v[n++] = uint256(c);
        if (n < 2) return (false, R_NOT_ENOUGH_SOURCES, 0);
        uint256 mid;
        if (n == 2) {
            if (!_close(v[0], v[1])) return (false, R_NO_AGREEMENT, 0);
            mid = (v[0] + v[1]) / 2;
        } else {
            // tri de 3 valeurs
            if (v[0] > v[1]) (v[0], v[1]) = (v[1], v[0]);
            if (v[1] > v[2]) (v[1], v[2]) = (v[2], v[1]);
            if (v[0] > v[1]) (v[0], v[1]) = (v[1], v[0]);
            mid = v[1];
            if (!_close(v[0], mid) && !_close(mid, v[2])) return (false, R_NO_AGREEMENT, 0);
        }
        uint256 pp = mid / priceDivisor;
        if (pp == 0 || pp > MAX_POOL_PRICE) return (false, R_PRICE_OUT_OF_RANGE, 0);
        return (true, 0, uint64(pp));
    }

    function _close(uint256 x, uint256 y) internal view returns (bool) {
        uint256 lo = x < y ? x : y;
        uint256 diff = x > y ? x - y : y - x;
        return diff * 10_000 <= lo * maxDeviationBps;
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
    /// @param chainlinkRoundHint Dernier round Chainlink tel que updatedAt ≤ t_k (vérifié ; un
    ///        mauvais indice fait revert, il ne peut pas changer le prix).
    /// @param pythUpdate Optionnel : mise(s) à jour Pyth signées couvrant [t_k, t_k + pythWindow].
    ///        Frais Pyth payés par le déclencheur, excédent remboursé.
    /// @return started true si le règlement a démarré ; false si lot vide (passé) ou reporté.
    function startSettlement(uint80 chainlinkRoundHint, bytes[] calldata pythUpdate)
        external
        payable
        returns (bool started)
    {
        if (phase != Phase.Idle) revert SettlementInProgress();
        uint256 k = nextToSettle;
        uint256 t = batchDeadline(k);
        if (block.timestamp < t) revert BatchNotClosed();

        if (_orders[k].length == 0) {
            _refund(0);
            nextToSettle = k + 1;
            emit BatchSkippedEmpty(k);
            return false;
        }

        int256 py8;
        uint256 spent;
        if (pythUpdate.length > 0) {
            spent = pyth.getUpdateFee(pythUpdate);
            bytes32[] memory ids = new bytes32[](1);
            ids[0] = pythPriceId;
            try pyth.parsePriceFeedUpdatesUnique{value: spent}(pythUpdate, ids, uint64(t), uint64(t) + pythWindow)
            returns (IPythMinimal.PriceFeed[] memory feeds) {
                py8 = _pythTo8(feeds[0].price);
            } catch {
                spent = 0;
                py8 = _pythStoredAt(t);
            }
        } else {
            py8 = _pythStoredAt(t);
        }
        _refund(spent);

        int256 cl8 = chainlinkAt(t, chainlinkRoundHint);
        int256 a8 = api3At(t);
        (bool ok, uint8 reason, uint64 p) = aggregate(cl8, py8, a8);
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
        emit SettlementStarted(k, p, _orders[k].length, cl8, py8, a8);
        return true;
    }

    function _refund(uint256 spent) internal {
        if (msg.value > spent) {
            (bool okRefund,) = msg.sender.call{value: msg.value - spent}("");
            if (!okRefund) revert RefundFailed();
        }
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
            uint256 fees = batchFees[k];
            batchFees[k] = 0;
            emit BatchSettled(k);
            if (fees > 0) {
                (bool okPay,) = msg.sender.call{value: fees}("");
                if (!okPay) revert RefundFailed();
                emit KeeperPaid(k, msg.sender, fees);
            }
            return true;
        }
        return false;
    }

    function _accumulate(Order storage o) internal {
        euint64 need = FHE.mul(o.qty, _price);
        ebool okBuy = FHE.gte(_quote[o.trader], need);
        ebool okSell = FHE.gte(_base[o.trader], o.qty);
        ebool ok = FHE.and(FHE.select(o.isBuy, okBuy, okSell), FHE.lte(o.qty, _maxQty));
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
