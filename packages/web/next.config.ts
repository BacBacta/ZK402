import type { NextConfig } from "next";

// Recette Next.js recommandée par le fhenix-toolkit (skill fhenix-sdk, bundler-config) :
// transpiler @cofhe/sdk, ne PAS l'externaliser côté serveur (tfhe est ESM-only).
const nextConfig: NextConfig = {
  transpilePackages: ["@cofhe/sdk"],
  // node-tfhe (dépendance de @cofhe/sdk/node) lit son .wasm via fs à côté de son
  // propre fichier : on le laisse à Node plutôt que de le bundler. Le SDK, lui,
  // reste transpilé.
  serverExternalPackages: ["node-tfhe"],
  webpack: (config, { isServer }) => {
    if (!isServer) {
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, net: false, tls: false };
    }
    config.experiments = { ...config.experiments, asyncWebAssembly: true, topLevelAwait: true };
    // Dépendances optionnelles de WalletConnect / MetaMask SDK non utilisées ici.
    config.externals = [...(config.externals ?? []), "pino-pretty", "lokijs", "encoding"];
    return config;
  },
};

export default nextConfig;
