import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import "@cofhe/hardhat-plugin";
import * as dotenv from "dotenv";
import * as path from "path";
import "./tasks";

// .env local au package, puis .env à la racine du monorepo.
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, "../../.env") });

const accounts = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  cofhe: {
    logMocks: false,
    gasWarning: true,
  },
  solidity: {
    version: "0.8.28",
    settings: {
      evmVersion: "cancun",
      optimizer: { enabled: true, runs: 200 },
    },
  },
  defaultNetwork: "hardhat",
  networks: {
    hardhat: {
      accounts: { count: 40 },
      blockGasLimit: 1_000_000_000,
      // Mesure sur fork (phase 0 de S1) : FORK_URL=https://sepolia.base.org
      ...(process.env.FORK_URL
        ? { chainId: 84532, forking: { url: process.env.FORK_URL, enabled: true } }
        : {}),
      allowUnlimitedContractSize: false,
    },
    // localcofhe, eth-sepolia et arb-sepolia sont injectés par @cofhe/hardhat-plugin.
    // Base Sepolia doit être déclaré à la main.
    "base-sepolia": {
      url: process.env.BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
      accounts,
      chainId: 84532,
      gasMultiplier: 1.2,
      timeout: 60_000,
    },
  },
  etherscan: {
    apiKey: {
      "base-sepolia": process.env.BASESCAN_API_KEY || "",
    },
  },
};

export default config;
