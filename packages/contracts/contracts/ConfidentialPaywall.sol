// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title ConfidentialPaywall — paywall x402 dont le montant payé reste chiffré (CoFHE)
/// @notice Un contrat = une ressource. Le payeur envoie un montant chiffré (en cents
///         de crédits de démo) ; le contrat vérifie homomorphiquement
///         `montant >= prixMin` et `montant <= solde` sans jamais voir le clair.
///         L'accès obtenu est un `ebool` chiffré, lisible uniquement par le payeur et
///         par le facilitateur (le serveur HTTP qui répond 402 / 200).
///
/// @dev Ce qui reste PUBLIC (FHE ne le cache pas) : l'adresse du payeur, le fait
///      qu'il a appelé `pay`, l'horodatage, le gas, et l'adresse de ce contrat (donc
///      la ressource). Ce qui est CHIFFRÉ : le montant, le solde, le succès du
///      paiement, l'accès, le prix minimum s'il a été mis à jour via `setMinPrice`.
///
///      Circuit constant : `pay` exécute exactement la même séquence d'opérations
///      FHE quel que soit le montant (10 ¢ ou 4,02 $) ou l'issue (succès / échec).
///      Aucun `if` / `require` sur une valeur chiffrée : un paiement insuffisant ne
///      revert pas, il débite 0 et n'accorde pas l'accès.
///
///      Les crédits de démo ne sont PAS un token (pas de transfert hors du contrat).
///      Le branchement sur un FHERC20 / USDC wrappé est prévu en v2.
contract ConfidentialPaywall {
    /// @notice Crédits distribués par appel au faucet (en cents : 1000 = 10,00 $).
    uint64 public constant FAUCET_AMOUNT = 1000;
    /// @notice Nombre maximal d'appels au faucet par adresse (borne le solde, évite
    ///         tout débordement de l'addition chiffrée).
    uint8 public constant MAX_FAUCET_CLAIMS = 5;

    address public immutable owner;
    /// @notice Serveur x402 autorisé (ACL) à déchiffrer l'accès des payeurs.
    address public immutable facilitator;

    euint64 private _minPrice;
    euint64 private _zero;
    euint64 private _revenue;

    mapping(address => euint64) private _balances;
    mapping(address => ebool) private _access;
    mapping(address => ebool) private _lastPaymentOk;
    /// @dev Drapeaux en clair de présence : un handle non initialisé ne doit pas
    ///      être utilisé tel quel (`FHE.and` le traite comme `true`, par ex.).
    mapping(address => bool) private _hasAccount;

    /// @notice Nombre d'appels au faucet (public : le montant du faucet l'est aussi).
    mapping(address => uint8) public faucetClaims;

    /// @notice Émis à chaque paiement. Volontairement sans montant ni issue.
    event PaymentSubmitted(address indexed payer);
    event FaucetClaimed(address indexed account);
    event MinPriceUpdated();

    error NotOwner();
    error ZeroAddress();
    error FaucetLimitReached();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    /// @param minPriceCents Prix plancher en cents. Chiffrement trivial : la valeur
    ///        est visible dans la calldata du déploiement — c'est le prix affiché par
    ///        la réponse 402, donc public par nature. Utiliser `setMinPrice` pour un
    ///        prix confidentiel.
    /// @param facilitator_ Adresse du serveur x402 (déchiffre l'accès des payeurs).
    constructor(uint64 minPriceCents, address facilitator_) {
        if (facilitator_ == address(0)) revert ZeroAddress();
        owner = msg.sender;
        facilitator = facilitator_;

        _minPrice = FHE.asEuint64(minPriceCents);
        _zero = FHE.asEuint64(0);
        _revenue = FHE.asEuint64(0);

        FHE.allowThis(_minPrice);
        FHE.allowThis(_zero);
        FHE.allowThis(_revenue);
        FHE.allow(_minPrice, msg.sender);
        FHE.allow(_revenue, msg.sender);
    }

    // ------------------------------------------------------------------------
    // Écritures
    // ------------------------------------------------------------------------

    /// @notice Crédite FAUCET_AMOUNT cents de démo au solde chiffré de l'appelant.
    function claimFaucet() external {
        if (faucetClaims[msg.sender] >= MAX_FAUCET_CLAIMS) revert FaucetLimitReached();
        faucetClaims[msg.sender] += 1;

        _ensureAccount(msg.sender);
        euint64 balance = FHE.add(_balances[msg.sender], FHE.asEuint64(FAUCET_AMOUNT));
        _balances[msg.sender] = balance;

        FHE.allowThis(balance);
        FHE.allowSender(balance);

        emit FaucetClaimed(msg.sender);
    }

    /// @notice Paie la ressource avec un montant chiffré côté client (@cofhe/sdk).
    /// @dev Ne revert jamais sur le contenu chiffré. Débit effectif :
    ///      `ok = (montant >= prixMin) && (montant <= solde)`,
    ///      `débit = ok ? montant : 0`, `accès = accès || ok`.
    function pay(externalEuint64 encryptedAmount, bytes calldata proof) external {
        euint64 amount = FHE.asEuint64(encryptedAmount, proof);

        _ensureAccount(msg.sender);
        euint64 balance = _balances[msg.sender];

        ebool meetsPrice = FHE.gte(amount, _minPrice);
        ebool affordable = FHE.lte(amount, balance);
        ebool ok = FHE.and(meetsPrice, affordable);
        euint64 debit = FHE.select(ok, amount, _zero);

        euint64 newBalance = FHE.sub(balance, debit);
        euint64 newRevenue = FHE.add(_revenue, debit);
        ebool newAccess = FHE.or(_access[msg.sender], ok);

        _balances[msg.sender] = newBalance;
        _revenue = newRevenue;
        _access[msg.sender] = newAccess;
        _lastPaymentOk[msg.sender] = ok;

        // ACL avant l'emit (l'observateur off-chain suit l'ordre des handles).
        FHE.allowThis(newBalance);
        FHE.allowSender(newBalance);

        FHE.allowThis(newRevenue);
        FHE.allow(newRevenue, owner);

        FHE.allowThis(newAccess);
        FHE.allowSender(newAccess);
        FHE.allow(newAccess, facilitator);

        FHE.allowThis(ok);
        FHE.allowSender(ok);

        emit PaymentSubmitted(msg.sender);
    }

    /// @notice Met à jour le prix plancher avec une valeur chiffrée (non visible
    ///         on-chain). Le serveur doit alors annoncer le nouveau prix hors chaîne.
    function setMinPrice(externalEuint64 encryptedPrice, bytes calldata proof) external onlyOwner {
        euint64 price = FHE.asEuint64(encryptedPrice, proof);
        _minPrice = price;
        FHE.allowThis(price);
        FHE.allowSender(price);
        emit MinPriceUpdated();
    }

    // ------------------------------------------------------------------------
    // Lectures : ne renvoient que des handles chiffrés. Le déchiffrement exige
    // l'ACL on-chain + un ACP (permit) signé par l'adresse autorisée.
    // ------------------------------------------------------------------------

    function balanceOf(address account) external view returns (euint64) {
        return _balances[account];
    }

    function accessOf(address account) external view returns (ebool) {
        return _access[account];
    }

    function lastPaymentOk(address account) external view returns (ebool) {
        return _lastPaymentOk[account];
    }

    function minPrice() external view returns (euint64) {
        return _minPrice;
    }

    function revenue() external view returns (euint64) {
        return _revenue;
    }

    // ------------------------------------------------------------------------

    function _ensureAccount(address account) private {
        if (_hasAccount[account]) return;
        _hasAccount[account] = true;

        euint64 balance = FHE.asEuint64(0);
        ebool access = FHE.asEbool(false);
        _balances[account] = balance;
        _access[account] = access;

        FHE.allowThis(balance);
        FHE.allow(balance, account);
        FHE.allowThis(access);
        FHE.allow(access, account);
        FHE.allow(access, facilitator);
    }
}
