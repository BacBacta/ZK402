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
/// @dev Ensemble d'anonymat d'une réclamation = notes de la même classe déposées avant elle.
///      Aucun rôle privilégié, aucune mise à jour possible. Hachage : Poseidon BN254 compatible
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

    IPoolCredit public immutable pool;
    IClaimVerifier public immutable verifier;
    IERC20 public immutable quoteToken;
    uint256 public immutable stipend;

    NoteClass[] internal _classes;
    Tree[] internal _trees;
    uint256[DEPTH + 1] public zeros;
    mapping(bytes32 => bool) public nullifierSpent;

    event Deposit(uint8 indexed cls, uint256 indexed commitment, uint32 leafIndex, uint256 root);
    event Claim(uint8 indexed cls, bytes32 indexed nullifier, address indexed recipient, address relayer, uint256 fee);

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

    constructor(address pool_, address verifier_, address quoteToken_, uint256 stipend_, NoteClass[] memory classes_) {
        if (pool_ == address(0) || verifier_ == address(0) || classes_.length == 0 || classes_.length > 16) {
            revert BadParams();
        }
        pool = IPoolCredit(pool_);
        verifier = IClaimVerifier(verifier_);
        quoteToken = IERC20(quoteToken_);
        stipend = stipend_;
        uint256 z = 0;
        for (uint32 i = 0; i <= DEPTH; i++) {
            zeros[i] = z;
            if (i < DEPTH) z = PoseidonT3.hash([z, z]);
        }
        for (uint256 c = 0; c < classes_.length; c++) {
            if (classes_[c].poolAmount == 0 || classes_[c].depositAmount == 0) revert BadParams();
            if (!classes_[c].isBase && quoteToken_ == address(0)) revert BadParams();
            _classes.push(classes_[c]);
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
    function deposit(uint8 cls, uint256 commitment) external payable {
        if (cls >= _classes.length) revert BadClass();
        if (commitment == 0 || commitment >= SNARK_FIELD) revert BadCommitment();
        NoteClass memory c = _classes[cls];
        if (c.isBase) {
            if (msg.value != c.depositAmount + stipend) revert BadValue();
        } else {
            if (msg.value != stipend) revert BadValue();
            quoteToken.safeTransferFrom(msg.sender, address(this), c.depositAmount);
        }
        (uint32 idx, uint256 root) = _insert(_trees[cls], commitment);
        emit Deposit(cls, commitment, idx, root);
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
    ) external {
        if (cls >= _classes.length) revert BadClass();
        if (!isKnownRoot(cls, root)) revert UnknownRoot();
        if (nullifierSpent[nullifier]) revert NullifierSpent();
        if (fee > stipend) revert BadFee();
        if (uint256(nullifier) >= SNARK_FIELD) revert BadCommitment();

        bytes32[] memory inputs = new bytes32[](5);
        inputs[0] = bytes32(root);
        inputs[1] = nullifier;
        inputs[2] = bytes32(uint256(uint160(recipient)));
        inputs[3] = bytes32(uint256(uint160(relayer)));
        inputs[4] = bytes32(fee);
        if (!verifier.verify(proof, inputs)) revert InvalidProof();

        nullifierSpent[nullifier] = true;
        NoteClass memory c = _classes[cls];
        if (c.isBase) pool.credit(recipient, c.poolAmount, 0);
        else pool.credit(recipient, 0, c.poolAmount);
        emit Claim(cls, nullifier, recipient, relayer, fee);

        _send(recipient, stipend - fee);
        if (fee > 0) _send(relayer, fee);
    }

    function _send(address to, uint256 amount) internal {
        if (amount == 0) return;
        (bool ok,) = to.call{value: amount}("");
        if (!ok) revert TransferFailed();
    }
}
