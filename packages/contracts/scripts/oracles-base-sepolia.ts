// Oracles ETH/USD sur Base Sepolia (adresses vérifiées on-chain le 24 septembre 2026).
export const BASE_SEPOLIA_ORACLES = {
  chainlinkFeed: "0x4aDC67696bA383F43DD60A9e78F2C97Fbbfc7cb1", // Chainlink ETH/USD
  api3Feed: "0x5b0cf2b36a65a6BB085D501B971e4c102B9Cd473", // API3 ETH/USD (Api3ReaderProxyV1 communal)
  pyth: "0xA2aa501b19aff244D90cc15a4Cf739D2725B5729", // Pyth
  pythPriceId: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace", // ETH/USD
  chainlinkMaxAge: 3_600n, // heartbeat Chainlink ETH/USD ≤ 1 h
  api3MaxAge: 93_600n, // heartbeat API3 24 h + marge (mises à jour sur déviation entre-temps)
  pythMaxAge: 300n,
  pythWindow: 60n,
  maxDeviationBps: 100n, // 1 %
  maxConfBps: 50n, // 0,5 %
};
