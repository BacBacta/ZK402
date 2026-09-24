// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IAggregatorV3, IPythMinimal} from "../oracles/IOracles.sol";

/// @notice Flux AggregatorV3 factice avec historique de rounds (Chainlink) ou sans historique
///         (API3 : roundId = 0).
contract MockAggregatorV3 is IAggregatorV3 {
    struct Round {
        int256 answer;
        uint256 updatedAt;
    }

    uint8 public override decimals;
    bool public immutable withHistory;
    uint80 public latest;
    mapping(uint80 => Round) public rounds;
    uint80 public answeredOverride; // 0 = normal

    constructor(uint8 decimals_, int256 answer_, bool withHistory_) {
        decimals = decimals_;
        withHistory = withHistory_;
        _push(answer_, block.timestamp);
    }

    function push(int256 answer_, uint256 updatedAt_) external {
        _push(answer_, updatedAt_);
    }

    function _push(int256 answer_, uint256 updatedAt_) internal {
        latest = withHistory ? latest + 1 : 0;
        rounds[latest] = Round(answer_, updatedAt_);
    }

    function setAnsweredOverride(uint80 r) external {
        answeredOverride = r;
    }

    function latestRoundData() external view override returns (uint80, int256, uint256, uint256, uint80) {
        Round memory r = rounds[latest];
        uint80 answered = answeredOverride != 0 ? answeredOverride - 1 : latest;
        return (latest, r.answer, r.updatedAt, r.updatedAt, answered);
    }

    function getRoundData(uint80 id) external view override returns (uint80, int256, uint256, uint256, uint80) {
        require(withHistory && id <= latest && rounds[id].updatedAt != 0, "No data present");
        Round memory r = rounds[id];
        uint80 answered = answeredOverride != 0 ? answeredOverride - 1 : id;
        return (id, r.answer, r.updatedAt, r.updatedAt, answered);
    }
}

/// @notice Pyth factice. Encodage de test d'une mise à jour : abi.encode(int64 price, uint64 conf,
///         int32 expo, uint64 publishTime, uint64 prevPublishTime).
contract MockPyth is IPythMinimal {
    Price public stored;
    uint256 public fee = 1;

    error PriceFeedNotFoundWithinRange();

    function setStored(int64 price, uint64 conf, int32 expo, uint256 publishTime) external {
        stored = Price(price, conf, expo, publishTime);
    }

    function getPriceUnsafe(bytes32) external view override returns (Price memory) {
        return stored;
    }

    function getUpdateFee(bytes[] calldata updateData) external view override returns (uint256) {
        return fee * updateData.length;
    }

    function parsePriceFeedUpdatesUnique(
        bytes[] calldata updateData,
        bytes32[] calldata priceIds,
        uint64 minPublishTime,
        uint64 maxPublishTime
    ) external payable override returns (PriceFeed[] memory feeds) {
        require(msg.value >= fee * updateData.length, "fee");
        feeds = new PriceFeed[](priceIds.length);
        for (uint256 i = 0; i < updateData.length; i++) {
            (int64 p, uint64 c, int32 e, uint64 t, uint64 prev) =
                abi.decode(updateData[i], (int64, uint64, int32, uint64, uint64));
            if (t >= minPublishTime && t <= maxPublishTime && prev < minPublishTime) {
                Price memory pr = Price(p, c, e, t);
                feeds[0] = PriceFeed(priceIds[0], pr, pr);
                return feeds;
            }
        }
        revert PriceFeedNotFoundWithinRange();
    }
}
