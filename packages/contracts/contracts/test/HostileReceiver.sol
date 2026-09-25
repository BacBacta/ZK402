// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

interface IExitQueue {
    function processExitQueue(uint256 maxCount) external returns (uint256);
}

/// @notice Destinataire hostile : tente une réentrance dans la file de sortie, puis refuse l'ETH.
contract HostileReceiver {
    IExitQueue public immutable entry;
    uint256 public attempts;

    constructor(address entry_) {
        entry = IExitQueue(entry_);
    }

    receive() external payable {
        attempts++;
        entry.processExitQueue(10); // doit échouer (verrou) → le paiement échoue → créance
    }
}
