// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @notice Sous-ensemble de l'interface AggregatorV3 (Chainlink ; aussi exposée par les
///         proxys API3 Api3ReaderProxyV1).
interface IAggregatorV3 {
    function decimals() external view returns (uint8);

    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

    function getRoundData(uint80 roundId)
        external
        view
        returns (uint80, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}

/// @notice Sous-ensemble de l'interface IPyth utilisé par le pool (réécrit, pas copié du SDK).
interface IPythMinimal {
    struct Price {
        int64 price;
        uint64 conf;
        int32 expo;
        uint256 publishTime;
    }

    struct PriceFeed {
        bytes32 id;
        Price price;
        Price emaPrice;
    }

    function getPriceUnsafe(bytes32 id) external view returns (Price memory);

    function getUpdateFee(bytes[] calldata updateData) external view returns (uint256);

    /// @notice Renvoie, pour chaque id, la PREMIÈRE mise à jour signée dont publishTime est dans
    ///         [minPublishTime, maxPublishTime] (unicité : prevPublishTime < minPublishTime).
    function parsePriceFeedUpdatesUnique(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable returns (PriceFeed[] memory);
}
