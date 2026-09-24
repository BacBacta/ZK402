// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice Sous-ensemble de l'interface AggregatorV3 de Chainlink utilisé par le pool.
interface IAggregatorV3 {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice Sous-ensemble de l'interface IPyth utilisé par le pool (réécrit, pas copié du SDK).
interface IPythMinimal {
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }

    function getPriceNoOlderThan(bytes32 id, uint256 age) external view returns (Price memory);

    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256);

    function updatePriceFeeds(bytes[] calldata updateData) external payable;
}
