// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {PoseidonT3} from "poseidon-solidity/PoseidonT3.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IClaimVerifier {
    function verify(bytes calldata proof, bytes32[] calldata publicInputs) external view returns (bool);
}

interface IPoolCredit {
    function credit(address account, uint64 baseAmount, uint64 quoteAmount) external;
}

/// @title ShieldedEntry — entrée blindée du dark pool (S1, incrément 3, P1)
/// @notice Casse le lien entre l'adresse qui DÉPOSE et le pseudonyme qui TRADE.
///
///   1. Dépôt PUBLIC d'un montant fixe (classe c) par une adresse A, qui insère un engagement
///      C = H(nk, secret) dans l'arbre de Merkle de la classe c. Le dépôt inclut une petite
///      « allocation de gas » (stipend) en ETH.
///   2. Réclamation ANONYME : une preuve ZK (circuit Noir `packages/circuits/claim`, UltraHonk)
///      établit « je connais une note de l'arbre » sans dire laquelle, et publie son
///      nullificateur (anti double-dépense). Le pool crédite le solde CHIFFRÉ d'un pseudonyme P
///      (adresse neuve) et le contrat envoie à P l'allocation de gas : P peut ensuite trader
///      sans jamais avoir reçu d'ETH de A. La réclamation peut être envoyée par n'importe quel
///      relayeur, rémunéré sur l'allocation ; il n'apprend rien d'autre que les entrées publiques
///      (destinataire, frais), liées à la preuve et donc non détournables.
///
///   3. Sortie (P4) : un pseudonyme convertit un palier de son solde chiffré en NOUVELLE note
///      (pool.requestNoteOut / finalizeNoteOut → insertFromPool). Cette note peut ensuite être :
///      - réclamée vers un NOUVEAU pseudonyme (rotation, `claim`) ;
///      - retirée en actif réel vers n'importe quelle adresse (`exit`), avec la même preuve ZK :
///        le lien pseudonyme → destinataire est caché dans l'ensemble des notes de la classe.
///   4. Disjoncteur de débit (P2.b) : les sorties d'actifs réels sont plafonnées par fenêtre
///      de WINDOW secondes à max(maxOutflowBps × réserves, un palier) ; au-delà, elles sont
///      mises en file d'attente (aucune perte, exécution sans permission plus tard). Borne le
///      rythme de fuite si le déchiffreur (Teecryptor) signait un faux résultat.
/// @dev Ensemble d'anonymat d'une réclamation ou d'une sortie = notes de la même classe insérées
///      avant elle (dépôts + sorties du pool). Aucun rôle privilégié, aucune mise à jour possible. Hachage : Poseidon BN254 compatible
///      circomlib (identique au circuit Noir, vérifié par un vecteur de référence).
contract ShieldedEntry {
    using SafeERC20 for IERC20;

    /// @notice Ordre du corps scalaire de BN254 (les engagements et entrées publiques y vivent).
    uint256 public constant SNARK_FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;
    uint32 public constant DEPTH = 20;
    uint32 public constant ROOT_HISTORY = 64;

    struct NoteClass {
        bool isBase; // true : dépôt en ETH natif crédité en BASE ; false : jeton QUOTE crédité en QUOTE
        uint256 depositAmount; // montant réel déposé (wei ou unités du jeton)
        uint64 poolAmount; // montant crédité dans le pool (unités du pool)
    }

    struct Tree {
        uint32 nextIndex;
        uint32 currentRootIndex;
        uint256[DEPTH] filledSubtrees;
        uint256[ROOT_HISTORY] roots;
    }

    uint256 public constant WINDOW = 1 days;

    IPoolCredit public immutable pool;
    /// @notice Part maximale des réserves d'un actif pouvant sortir par fenêtre (points de base).
    uint256 public immutable maxOutflowBps;
    IClaimVerifier public immutable verifier;
    IERC20 public immutable quoteToken;
    uint256 public immutable stipend;
    /// @notice L'allocation exprimée en unités BASE du pool (stipend = stipendBaseUnits × wei par unité).
    ///         Permet de financer l'allocation d'une note créée par le pool en débitant le solde
    ///         CHIFFRÉ en BASE du pseudonyme, sans qu'il ait besoin d'ETH extérieur (non-association).
    uint64 public immutable stipendBaseUnits;

    NoteClass[] internal _classes;
    Tree[] internal _trees;
    uint256[DEPTH + 1] public zeros;
    mapping(bytes32 => bool) public nullifierSpent;

    // Comptabilité des réserves réelles, par actif (0 = ETH natif / BASE, 1 = jeton QUOTE).
    uint256[2] public reserves;
    uint256[2] public maxClassAmount;

    struct Flow {
        uint256 windowStart;
        uint256 used;
        uint256 cap;
    }

    Flow[2] public flows;

    struct QueuedExit {
        uint8 cls;
        address recipient;
        address relayer;
        uint256 fee;
    }

    QueuedExit[] public exitQueue;
    uint256 public exitQueueHead;
    uint256 private _lock = 1;

    /// @notice Montants dus (actif 0 = ETH, 1 = jeton) quand un transfert direct a échoué :
    ///         un destinataire qui refuse un paiement ne bloque jamais la file (retrait « pull »).
    mapping(uint8 => mapping(address => uint256)) public owed;
    /// @notice Gas maximal transmis lors d'un paiement direct (anti-épuisement du gas).
    uint256 public constant PAY_GAS = 50_000;

    /// @dev Verrou de réentrance : toutes les fonctions qui transfèrent de la valeur.
    modifier nonReentrant() {
        if (_lock != 1) revert Reentrancy();
        _lock = 2;
        _;
        _lock = 1;
    }

    event Deposit(uint8 indexed cls, uint256 indexed commitment, uint32 leafIndex, uint256 root);
    event Claim(uint8 indexed cls, bytes32 indexed nullifier, address indexed recipient, address relayer, uint256 fee);
    event NoteFromPool(uint8 indexed cls, uint256 indexed commitment, uint32 leafIndex, uint256 root);
    event Exit(uint8 indexed cls, bytes32 indexed nullifier, address indexed recipient, address relayer, uint256 fee);
    event ExitQueued(uint256 indexed position, uint8 cls, address recipient);
    event ExitPaid(uint8 indexed cls, address indexed recipient, uint256 amount);
    event Owed(uint8 indexed asset, address indexed to, uint256 amount);

    error BadClass();
    error BadValue();
    error BadCommitment();
    error TreeFull();
    error UnknownRoot();
    error NullifierSpent();
    error BadFee();
    error InvalidProof();
    error TransferFailed();
    error BadParams();
    error OnlyPool();
    error Reentrancy();

    constructor(
        address pool_,
        address verifier_,
        address quoteToken_,
        uint256 stipend_,
        uint256 maxOutflowBps_,
        uint64 stipendBaseUnits_,
        NoteClass[] memory classes_
    ) {
        if (
            pool_ == address(0) || verifier_ == address(0) || classes_.length == 0 || classes_.length > 16
                || maxOutflowBps_ == 0 || maxOutflowBps_ > 10_000
        ) {
            revert BadParams();
        }
        pool = IPoolCredit(pool_);
        verifier = IClaimVerifier(verifier_);
        quoteToken = IERC20(quoteToken_);
        stipend = stipend_;
        maxOutflowBps = maxOutflowBps_;
        stipendBaseUnits = stipendBaseUnits_;
        uint256 z = 0;
        for (uint32 i = 0; i <= DEPTH; i++) {
            zeros[i] = z;
            if (i < DEPTH) z = PoseidonT3.hash([z, z]);
        }
        for (uint256 c = 0; c < classes_.length; c++) {
            if (classes_[c].poolAmount == 0 || classes_[c].depositAmount == 0) revert BadParams();
            if (!classes_[c].isBase && quoteToken_ == address(0)) revert BadParams();
            // Cohérence des unités : allocation = stipendBaseUnits × (wei par unité BASE).
            if (classes_[c].isBase && classes_[c].depositAmount * stipendBaseUnits_ != stipend_ * classes_[c].poolAmount) {
                revert BadParams();
            }
            _classes.push(classes_[c]);
            uint8 a = classes_[c].isBase ? 0 : 1;
            if (classes_[c].depositAmount > maxClassAmount[a]) maxClassAmount[a] = classes_[c].depositAmount;
            _trees.push();
            Tree storage t = _trees[c];
            for (uint32 i = 0; i < DEPTH; i++) t.filledSubtrees[i] = zeros[i];
            t.roots[0] = zeros[DEPTH];
        }
    }

    // ------------------------------------------------------------------ lecture

    function classCount() external view returns (uint256) {
        return _classes.length;
    }

    function classOf(uint8 cls) external view returns (NoteClass memory) {
        return _classes[cls];
    }

    function classInfo(uint8 cls) external view returns (bool isBase, uint64 poolAmount) {
        if (cls >= _classes.length) revert BadClass();
        NoteClass memory c = _classes[cls];
        return (c.isBase, c.poolAmount);
    }

    function exitQueueLength() external view returns (uint256) {
        return exitQueue.length - exitQueueHead;
    }

    function currentRoot(uint8 cls) public view returns (uint256) {
        Tree storage t = _trees[cls];
        return t.roots[t.currentRootIndex];
    }

    function nextIndex(uint8 cls) external view returns (uint32) {
        return _trees[cls].nextIndex;
    }

    function isKnownRoot(uint8 cls, uint256 root) public view returns (bool) {
        if (root == 0) return false;
        Tree storage t = _trees[cls];
        uint32 i = t.currentRootIndex;
        for (uint32 k = 0; k < ROOT_HISTORY; k++) {
            if (t.roots[i] == root) return true;
            i = i == 0 ? ROOT_HISTORY - 1 : i - 1;
        }
        return false;
    }

    // ------------------------------------------------------------------ dépôt (public)

    /// @notice Dépose une note de la classe `cls`. Pour une classe BASE : msg.value = montant +
    ///         stipend. Pour une classe QUOTE : msg.value = stipend et approbation du jeton.
    function deposit(uint8 cls, uint256 commitment) external payable nonReentrant {
        if (cls >= _classes.length) revert BadClass();
        if (commitment == 0 || commitment >= SNARK_FIELD) revert BadCommitment();
        NoteClass memory c = _classes[cls];
        if (c.isBase) {
            if (msg.value != c.depositAmount + stipend) revert BadValue();
        } else {
            if (msg.value != stipend) revert BadValue();
            quoteToken.safeTransferFrom(msg.sender, address(this), c.depositAmount);
        }
        reserves[c.isBase ? 0 : 1] += c.depositAmount;
        (uint32 idx, uint256 root) = _insert(_trees[cls], commitment);
        emit Deposit(cls, commitment, idx, root);
    }

    /// @notice Insère une note créée par le pool à partir d'un solde chiffré débité (P4). La
    ///         valeur de la note passe d'un solde du pool à la note (réserves inchangées) ;
    ///         l'allocation de la note, débitée en BASE chiffré, passe des réserves ETH à la
    ///         garantie des allocations (reserves[0] −= stipend).
    function insertFromPool(uint8 cls, uint256 commitment) external nonReentrant {
        if (msg.sender != address(pool)) revert OnlyPool();
        if (cls >= _classes.length) revert BadClass();
        if (commitment == 0 || commitment >= SNARK_FIELD) revert BadCommitment();
        reserves[0] -= stipend;
        (uint32 idx, uint256 root) = _insert(_trees[cls], commitment);
        emit NoteFromPool(cls, commitment, idx, root);
    }

    function _insert(Tree storage t, uint256 leaf) internal returns (uint32 idx, uint256 root) {
        idx = t.nextIndex;
        if (idx >= uint32(1) << DEPTH) revert TreeFull();
        uint256 node = leaf;
        uint32 i = idx;
        for (uint32 level = 0; level < DEPTH; level++) {
            if (i & 1 == 0) {
                t.filledSubtrees[level] = node;
                node = PoseidonT3.hash([node, zeros[level]]);
            } else {
                node = PoseidonT3.hash([t.filledSubtrees[level], node]);
            }
            i >>= 1;
        }
        uint32 r = (t.currentRootIndex + 1) % ROOT_HISTORY;
        t.currentRootIndex = r;
        t.roots[r] = node;
        t.nextIndex = idx + 1;
        root = node;
    }

    // ------------------------------------------------------------------ réclamation (anonyme)

    /// @notice Réclame une note de manière anonyme au profit du pseudonyme `recipient`.
    ///         Peut être appelée par n'importe qui (relayeur) : la preuve lie recipient, relayer
    ///         et fee. Le relayeur reçoit `fee` (≤ stipend), le pseudonyme reçoit stipend − fee
    ///         en ETH (pour son gas) et son solde CHIFFRÉ est crédité dans le pool.
    function claim(
        uint8 cls,
        bytes calldata proof,
        uint256 root,
        bytes32 nullifier,
        address recipient,
        address relayer,
        uint256 fee
    ) external nonReentrant {
        if (fee > stipend) revert BadFee();
        _spend(cls, proof, root, nullifier, recipient, relayer, fee);
        NoteClass memory c = _classes[cls];
        if (c.isBase) pool.credit(recipient, c.poolAmount, 0);
        else pool.credit(recipient, 0, c.poolAmount);
        emit Claim(cls, nullifier, recipient, relayer, fee);

        _payOut(0, recipient, stipend - fee);
        _payOut(0, relayer, fee);
    }

    /// @notice Retire une note en ACTIF RÉEL vers `recipient`, de manière anonyme (même preuve
    ///         que `claim`). `fee` est prélevé sur le montant de la note (dans l'actif de la
    ///         classe) au profit du relayeur. L'allocation de gas de la note est versée au
    ///         destinataire. Soumis au disjoncteur : au-delà du plafond de la fenêtre, la sortie
    ///         est mise en file d'attente (payée plus tard par `processExitQueue`).
    function exit(
        uint8 cls,
        bytes calldata proof,
        uint256 root,
        bytes32 nullifier,
        address recipient,
        address relayer,
        uint256 fee
    ) external nonReentrant {
        if (cls < _classes.length && fee > _classes[cls].depositAmount) revert BadFee();
        _spend(cls, proof, root, nullifier, recipient, relayer, fee);
        emit Exit(cls, nullifier, recipient, relayer, fee);
        QueuedExit memory q = QueuedExit(cls, recipient, relayer, fee);
        bool payNow = _reserveCapacity(q);
        if (!payNow) {
            exitQueue.push(q);
            emit ExitQueued(exitQueue.length - 1, cls, recipient);
        }
        // Effets terminés : transferts en dernier (checks-effects-interactions).
        _payOut(0, recipient, stipend);
        if (payNow) _pay(q);
    }

    /// @notice Paie jusqu'à `maxCount` sorties en attente, dans l'ordre, tant que le plafond de la
    ///         fenêtre le permet. N'importe qui peut l'appeler.
    function processExitQueue(uint256 maxCount) external nonReentrant returns (uint256 paid) {
        while (paid < maxCount && exitQueueHead < exitQueue.length) {
            QueuedExit memory q = exitQueue[exitQueueHead];
            if (!_reserveCapacity(q)) break;
            delete exitQueue[exitQueueHead];
            exitQueueHead++; // avancer AVANT de payer
            paid++;
            _pay(q);
        }
    }

    function _spend(
        uint8 cls,
        bytes calldata proof,
        uint256 root,
        bytes32 nullifier,
        address recipient,
        address relayer,
        uint256 fee
    ) internal {
        if (cls >= _classes.length) revert BadClass();
        if (!isKnownRoot(cls, root)) revert UnknownRoot();
        if (nullifierSpent[nullifier]) revert NullifierSpent();
        if (uint256(nullifier) >= SNARK_FIELD) revert BadCommitment();
        bytes32[] memory inputs = new bytes32[](5);
        inputs[0] = bytes32(root);
        inputs[1] = nullifier;
        inputs[2] = bytes32(uint256(uint160(recipient)));
        inputs[3] = bytes32(uint256(uint160(relayer)));
        inputs[4] = bytes32(fee);
        if (!verifier.verify(proof, inputs)) revert InvalidProof();
        nullifierSpent[nullifier] = true;
    }

    /// @dev Réserve la capacité de la fenêtre courante pour une sortie et met à jour les
    ///      réserves (effets). Renvoie false si le plafond est atteint (la sortie attendra).
    function _reserveCapacity(QueuedExit memory q) internal returns (bool) {
        NoteClass memory c = _classes[q.cls];
        uint8 a = c.isBase ? 0 : 1;
        Flow storage f = flows[a];
        if (block.timestamp >= f.windowStart + WINDOW) {
            f.windowStart = block.timestamp;
            f.used = 0;
            uint256 byBps = reserves[a] * maxOutflowBps / 10_000;
            f.cap = byBps > maxClassAmount[a] ? byBps : maxClassAmount[a];
        }
        if (f.used + c.depositAmount > f.cap) return false;
        f.used += c.depositAmount;
        reserves[a] -= c.depositAmount;
        return true;
    }

    /// @dev Transferts d'une sortie dont la capacité a été réservée (interactions).
    function _pay(QueuedExit memory q) internal {
        NoteClass memory c = _classes[q.cls];
        uint256 net = c.depositAmount - q.fee;
        uint8 a = c.isBase ? 0 : 1;
        _payOut(a, q.recipient, net);
        _payOut(a, q.relayer, q.fee);
        emit ExitPaid(q.cls, q.recipient, net);
    }

    /// @notice Récupère un montant dû après un paiement direct échoué.
    function withdrawOwed(uint8 asset) external nonReentrant {
        uint256 amount = owed[asset][msg.sender];
        owed[asset][msg.sender] = 0;
        if (asset == 0) {
            (bool ok,) = msg.sender.call{value: amount}("");
            if (!ok) revert TransferFailed();
        } else {
            quoteToken.safeTransfer(msg.sender, amount);
        }
    }

    /// @dev Paiement direct avec gas plafonné ; en cas d'échec, le montant devient une créance.
    function _payOut(uint8 asset, address to, uint256 amount) internal {
        if (amount == 0) return;
        bool ok;
        if (asset == 0) {
            (ok,) = to.call{value: amount, gas: PAY_GAS}("");
        } else {
            bytes memory ret;
            (ok, ret) = address(quoteToken).call{gas: 2 * PAY_GAS}(abi.encodeCall(IERC20.transfer, (to, amount)));
            ok = ok && (ret.length == 0 || abi.decode(ret, (bool)));
        }
        if (!ok) {
            owed[asset][to] += amount;
            emit Owed(asset, to, amount);
        }
    }
}
