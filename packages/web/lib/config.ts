import { isAddress } from "viem";
import type { Hex } from "./x402";

const rawAddress = process.env.NEXT_PUBLIC_PAYWALL_ADDRESS ?? "";

/** Adresse de ConfidentialPaywall, ou null si le contrat n'est pas encore déployé. */
export const PAYWALL_ADDRESS: Hex | null = isAddress(rawAddress) ? (rawAddress as Hex) : null;

export const BASE_SEPOLIA_RPC_URL =
  process.env.NEXT_PUBLIC_BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org";

/** Prix plancher annoncé dans la 402 (doit correspondre au déploiement). */
export const MIN_PRICE_CENTS = 10n;

/** Montants d'essai : indistinguables on-chain (circuit constant). */
export const DEMO_AMOUNTS_CENTS = [10n, 402n] as const;

export const EXPLORER_URL = "https://sepolia.basescan.org";
