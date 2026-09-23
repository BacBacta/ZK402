// `injected` depuis "wagmi" (et non le barrel "wagmi/connectors", qui embarque
// WalletConnect, Coinbase, Base Account… et leurs dépendances optionnelles).
import { createConfig, http, injected } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import { BASE_SEPOLIA_RPC_URL } from "./config";

export const wagmiConfig = createConfig({
  chains: [baseSepolia],
  connectors: [injected()],
  transports: { [baseSepolia.id]: http(BASE_SEPOLIA_RPC_URL) },
  ssr: true,
});

declare module "wagmi" {
  interface Register {
    config: typeof wagmiConfig;
  }
}
