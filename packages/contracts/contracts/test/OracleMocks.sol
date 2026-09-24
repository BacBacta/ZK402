// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IAggregatorV3, IPythMinimal} from "../oracles/IOracles.sol";

/// @notice Oracle Chainlink factice pour les tests (prix et horodatage réglables).
contract MockAggregatorV3 is IAggregatorV3 {
    uint8 public override decimals;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId = 1;
    uint80 public answeredInRound = 1;

    constructor(uint8 decimals_, int256 answer_) {
        decimals = decimals_;
        answer = answer_;
        updatedAt = block.timestamp;
    }

    function set(int256 answer_, uint256 updatedAt_) external {
        answer = answer_;
        updatedAt = updatedAt_;
        roundId++;
        answeredInRound = roundId;
    }

    function setAnsweredInRound(uint80 r) external {
        answeredInRound = r;
    }

    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, answeredInRound);
    }
}

/// @notice Pyth factice : prix réglable ; getPriceNoOlderThan revert si trop ancien (comme Pyth).
contract MockPyth is IPythMinimal {
    Price public current;
    uint256 public fee = 1;

    error StalePrice();

    function set(int64 price, uint64 conf, int32 expo, uint256 publishTime) external {
        current = Price(price, conf, expo, publishTime);
    }

    function getPriceNoOlderThan(bytes32, uint256 age) external view override returns (Price memory) {
        if (current.publishTime + age < block.timestamp) revert StalePrice();
        return current;
    }

    function getUpdateFee(bytes[] calldata updateData) external view override returns (uint256) {
        return fee * updateData.length;
    }

    /// @dev Encodage de test : chaque élément = abi.encode(int64 price, uint64 conf, int32 expo).
    function updatePriceFeeds(bytes[] calldata updateData) external payable override {
        require(msg.value >= fee * updateData.length, "fee");
        for (uint256 i = 0; i < updateData.length; i++) {
            (int64 p, uint64 c, int32 e) = abi.decode(updateData[i], (int64, uint64, int32));
            current = Price(p, c, e, block.timestamp);
        }
    }
}
