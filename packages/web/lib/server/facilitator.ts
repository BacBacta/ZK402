import "server-only";
import { createPublicClient, createWalletClient, http, zeroHash } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import { FheTypes } from "@cofhe/sdk";
import type { CofheClient } from "@cofhe/sdk";
import { createCofheClient, createCofheConfig } from "@cofhe/sdk/node";
import { baseSepolia as cofheBaseSepolia } from "@cofhe/sdk/chains";
import { confidentialPaywallAbi } from "../abi/ConfidentialPaywall";
import { BASE_SEPOLIA_RPC_URL } from "../config";
import type { Hex } from "../x402";

// Le facilitateur est le serveur x402 lui-même. Le contrat lui accorde l'ACL sur
// l'ebool d'accès de chaque payeur (FHE.allow(access, facilitator)) : il peut
// donc savoir « X a payé au moins le prix », jamais « X a payé combien ».

export const publicClient = createPublicClient({
  chain: baseSepolia,
  transport: http(BASE_SEPOLIA_RPC_URL),
});

/** Adresse dérivée de FACILITATOR_PRIVATE_KEY (null si non configurée). */
export function getFacilitatorAddress(): Hex | null {
  const pk = process.env.FACILITATOR_PRIVATE_KEY as Hex | undefined;
  if (!pk) return null;
  try {
    return privateKeyToAccount(pk).address;
  } catch {
    return null;
  }
}

const checkedPaywalls = new Set<string>();

/** Erreur explicite si la clé serveur n'est pas le facilitateur du contrat. */
async function assertIsFacilitator(paywall: Hex) {
  if (checkedPaywalls.has(paywall)) return;
  const onChain = (await publicClient.readContract({
    address: paywall,
    abi: confidentialPaywallAbi,
    functionName: "facilitator",
  })) as Hex;
  const local = getFacilitatorAddress();
  if (!local || onChain.toLowerCase() !== local.toLowerCase()) {
    throw new Error(
      `FACILITATOR_PRIVATE_KEY (${local ?? "absente"}) ne correspond pas au facilitateur du contrat (${onChain}).`,
    );
  }
  checkedPaywalls.add(paywall);
}

let clientPromise: Promise<CofheClient> | null = null;

function getFacilitatorClient(): Promise<CofheClient> {
  clientPromise ??= (async () => {
    const pk = process.env.FACILITATOR_PRIVATE_KEY as Hex | undefined;
    if (!pk) throw new Error("FACILITATOR_PRIVATE_KEY manquant côté serveur");
    const account = privateKeyToAccount(pk);
    const walletClient = createWalletClient({ account, chain: baseSepolia, transport: http(BASE_SEPOLIA_RPC_URL) });

    const client = createCofheClient(
      createCofheConfig({
        environment: "node",
        supportedChains: [cofheBaseSepolia],
        // Pas de cache disque des clés FHE (compatible serverless) : le
        // facilitateur ne fait que déchiffrer, il n'encrypte jamais.
        fheKeyStorage: null,
      }));
    // viem du SDK et viem de l'app peuvent différer de version : types proches, cast.
    await client.connect(publicClient as any, walletClient as any);
    // ACP (permit) explicite : signature EIP-712 hors chaîne, sans gas.
    await client.acp.getOrCreateSelfACP(undefined, undefined, {
      issuer: account.address,
      name: "fhenix402-facilitator",
    });
    return client;
  })().catch((err) => {
    clientPromise = null;
    throw err;
  });
  return clientPromise;
}

// L'accès est monotone (FHE.or) : un `true` ne redevient jamais `false`.
const grantedCache = new Set<string>();

export async function hasConfidentialAccess(paywall: Hex, payer: Hex): Promise<boolean> {
  const key = `${paywall}:${payer}`.toLowerCase();
  if (grantedCache.has(key)) return true;

  const handle = (await publicClient.readContract({
    address: paywall,
    abi: confidentialPaywallAbi,
    functionName: "accessOf",
    args: [payer],
  })) as Hex;
  if (handle === zeroHash) return false; // jamais payé

  await assertIsFacilitator(paywall);
  const client = await getFacilitatorClient();
  const granted = Boolean(await client.decryptForView(handle, FheTypes.Bool).execute());
  if (granted) grantedCache.add(key);
  return granted;
}
