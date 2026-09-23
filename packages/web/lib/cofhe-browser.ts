"use client";

import type { CofheClient } from "@cofhe/sdk";
import type { PublicClient, WalletClient } from "viem";

// Singleton navigateur, chargé à la demande (le SDK touche WASM, crypto.subtle,
// IndexedDB : jamais côté SSR). Cf. fhenix-toolkit, skill fhenix-sdk, init-singleton.
let clientPromise: Promise<CofheClient> | null = null;
let connectedKey: string | null = null;

async function loadClient(): Promise<CofheClient> {
  if (typeof window === "undefined") throw new Error("Client CoFHE : navigateur uniquement");
  clientPromise ??= (async () => {
    const [{ createCofheClient, createCofheConfig }, { baseSepolia }] = await Promise.all([
      import("@cofhe/sdk/web"),
      import("@cofhe/sdk/chains"),
    ]);
    return createCofheClient(createCofheConfig({ supportedChains: [baseSepolia] }));
  })();
  return clientPromise;
}

/** Client CoFHE connecté au wallet courant (reconnecte si compte / chaîne changent). */
export async function getConnectedCofheClient(
  publicClient: PublicClient,
  walletClient: WalletClient,
): Promise<CofheClient> {
  const client = await loadClient();
  const key = `${walletClient.account?.address}:${walletClient.chain?.id}`;
  if (connectedKey !== key || !client.connected) {
    // viem de wagmi et viem du SDK peuvent différer de version : cast à la frontière.
    await client.connect(publicClient as any, walletClient as any);
    connectedKey = key;
  }
  return client;
}

/**
 * ACP (permit) explicite, requis avant tout decryptForView. L'issuer est dérivé du
 * compte connecté (jamais codé en dur). Une seule signature EIP-712 par session.
 */
export async function ensureSelfAcp(client: CofheClient) {
  const issuer = client.getSnapshot().account;
  if (!issuer) throw new Error("Wallet non connecté au client CoFHE");
  await client.acp.getOrCreateSelfACP(undefined, undefined, {
    issuer,
    name: "fhenix402",
    expiration: Math.floor(Date.now() / 1000) + 7 * 24 * 3600, // secondes
  });
}
