// Variante confidentielle de x402 : scheme "confidential-exact".
//
// On garde l'enveloppe x402 v1 (réponse 402 { x402Version, error, accepts[] },
// en-têtes X-PAYMENT / X-PAYMENT-RESPONSE en base64 JSON) mais pas le scheme
// "exact" USDC de Coinbase : ici aucun montant ne circule en clair, ni dans la
// requête HTTP ni on-chain. Le paiement est une transaction `pay(handle, proof)`
// vers ConfidentialPaywall ; la preuve HTTP n'est qu'une signature du payeur
// sur un nonce serveur. Le serveur déchiffre ensuite l'`ebool` d'accès du payeur
// (ACL on-chain accordée au facilitateur), jamais le montant.
//
// Écart assumé avec x402 v1 : `maxAmountRequired` (montant exact) est remplacé
// par `minAmountRequired` (prix plancher public). Le montant réellement payé
// (10 ¢, 4,02 $, pourboire…) reste chiffré.

export const X402_VERSION = 1 as const;
export const SCHEME = "confidential-exact" as const;
export const NETWORK = "base-sepolia" as const;
export const CHAIN_ID = 84532 as const;
export const PAYMENT_HEADER = "X-PAYMENT";
export const PAYMENT_RESPONSE_HEADER = "X-PAYMENT-RESPONSE";

export type Hex = `0x${string}`;

export interface ConfidentialPaymentRequirements {
  scheme: typeof SCHEME;
  network: typeof NETWORK;
  /** Prix plancher public, en unités atomiques de l'asset (cents). */
  minAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  /** Contrat ConfidentialPaywall à appeler. */
  payTo: Hex;
  maxTimeoutSeconds: number;
  /** Crédits de démo internes au contrat (v2 : FHERC20 / USDC wrappé). */
  asset: string;
  extra: {
    confidential: true;
    fhe: "cofhe";
    chainId: typeof CHAIN_ID;
    decimals: 2;
    method: "pay(bytes32,bytes)";
    /** Adresse autorisée (ACL) à déchiffrer l'accès. */
    facilitator: Hex | null;
    /** Nonce à signer par le payeur, lié à la ressource. */
    nonce: string;
    nonceExpiresAt: number;
  };
}

export interface PaymentRequiredResponse {
  x402Version: typeof X402_VERSION;
  error: string;
  accepts: ConfidentialPaymentRequirements[];
}

export interface ConfidentialPaymentPayload {
  x402Version: typeof X402_VERSION;
  scheme: typeof SCHEME;
  network: typeof NETWORK;
  payload: {
    payer: Hex;
    nonce: string;
    /** Signature EIP-191 de `buildAccessMessage(...)`. */
    signature: Hex;
    /** Informatif : tx `pay` du client, non requise pour la vérification. */
    txHash?: Hex;
  };
}

export interface PaymentResponse {
  success: boolean;
  scheme: typeof SCHEME;
  network: typeof NETWORK;
  payer: Hex;
  txHash?: Hex;
}

/** Message signé par le payeur pour prouver qu'il contrôle l'adresse. */
export function buildAccessMessage(p: { resource: string; nonce: string; contract: string }): string {
  return [
    "fhenix402 — accès à une ressource x402 confidentielle",
    `resource: ${p.resource}`,
    `contract: ${p.contract.toLowerCase()}`,
    `chainId: ${CHAIN_ID}`,
    `nonce: ${p.nonce}`,
  ].join("\n");
}

function toBase64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

function fromBase64(s: string): string {
  const bin = atob(s);
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
}

export function encodeHeader(value: unknown): string {
  return toBase64(JSON.stringify(value));
}

export function decodeHeader<T>(header: string): T {
  return JSON.parse(fromBase64(header)) as T;
}

export const formatCents = (cents: bigint | number) =>
  `$${(Number(cents) / 100).toFixed(2)}`;
