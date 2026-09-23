import { NextRequest, NextResponse } from "next/server";
import { isAddress, isHex } from "viem";
import { ARTICLE } from "@/lib/article";
import { MIN_PRICE_CENTS, PAYWALL_ADDRESS } from "@/lib/config";
import { getFacilitatorAddress, hasConfidentialAccess, publicClient } from "@/lib/server/facilitator";
import { issueNonce, verifyNonce } from "@/lib/server/nonce";
import {
  buildAccessMessage,
  CHAIN_ID,
  decodeHeader,
  encodeHeader,
  NETWORK,
  PAYMENT_HEADER,
  PAYMENT_RESPONSE_HEADER,
  SCHEME,
  X402_VERSION,
  type ConfidentialPaymentPayload,
  type ConfidentialPaymentRequirements,
  type Hex,
  type PaymentRequiredResponse,
  type PaymentResponse,
} from "@/lib/x402";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const RESOURCE_PATH = "/api/article";

function resourceUrl(req: NextRequest) {
  return new URL(RESOURCE_PATH, req.nextUrl.origin).toString();
}

function paymentRequired(req: NextRequest, paywall: Hex, error: string) {
  const resource = resourceUrl(req);
  const { nonce, expiresAt } = issueNonce(resource);

  const requirements: ConfidentialPaymentRequirements = {
    scheme: SCHEME,
    network: NETWORK,
    minAmountRequired: MIN_PRICE_CENTS.toString(),
    resource,
    description: ARTICLE.title,
    mimeType: "application/json",
    payTo: paywall,
    maxTimeoutSeconds: 300,
    asset: "fhenix402-demo-credits",
    extra: {
      confidential: true,
      fhe: "cofhe",
      chainId: CHAIN_ID,
      decimals: 2,
      method: "pay(bytes32,bytes)",
      facilitator: getFacilitatorAddress(),
      nonce,
      nonceExpiresAt: expiresAt,
    },
  };
  const body: PaymentRequiredResponse = { x402Version: X402_VERSION, error, accepts: [requirements] };
  return NextResponse.json(body, { status: 402, headers: { "Cache-Control": "no-store" } });
}

export async function GET(req: NextRequest) {
  if (!PAYWALL_ADDRESS) {
    return NextResponse.json(
      {
        error: "Paywall non configuré : déployez ConfidentialPaywall puis renseignez NEXT_PUBLIC_PAYWALL_ADDRESS.",
      },
      { status: 503 },
    );
  }

  const header = req.headers.get(PAYMENT_HEADER);
  if (!header) return paymentRequired(req, PAYWALL_ADDRESS, `${PAYMENT_HEADER} header is required`);

  let payment: ConfidentialPaymentPayload;
  try {
    payment = decodeHeader<ConfidentialPaymentPayload>(header);
  } catch {
    return paymentRequired(req, PAYWALL_ADDRESS, `${PAYMENT_HEADER} illisible`);
  }

  const p = payment?.payload;
  if (
    payment?.x402Version !== X402_VERSION ||
    payment.scheme !== SCHEME ||
    payment.network !== NETWORK ||
    !p ||
    !isAddress(p.payer ?? "") ||
    !isHex(p.signature ?? "") ||
    typeof p.nonce !== "string"
  ) {
    return paymentRequired(req, PAYWALL_ADDRESS, "payload x402 invalide");
  }

  const resource = resourceUrl(req);
  const nonceCheck = verifyNonce(resource, p.nonce);
  if (!nonceCheck.ok) return paymentRequired(req, PAYWALL_ADDRESS, nonceCheck.reason);

  // Preuve de contrôle de l'adresse (EOA, ERC-1271 et ERC-6492 via viem).
  const signatureOk = await publicClient
    .verifyMessage({
      address: p.payer,
      message: buildAccessMessage({ resource, nonce: p.nonce, contract: PAYWALL_ADDRESS }),
      signature: p.signature,
    })
    .catch(() => false);
  if (!signatureOk) return paymentRequired(req, PAYWALL_ADDRESS, "signature du payeur invalide");

  let granted: boolean;
  try {
    granted = await hasConfidentialAccess(PAYWALL_ADDRESS, p.payer);
  } catch (err) {
    console.error("[x402] déchiffrement de l'accès impossible", err);
    return NextResponse.json(
      { error: "Facilitateur indisponible (déchiffrement CoFHE)", detail: String((err as Error)?.message ?? err) },
      { status: 502 },
    );
  }
  if (!granted) {
    return paymentRequired(req, PAYWALL_ADDRESS, "aucun paiement suffisant trouvé pour cette adresse");
  }

  const receipt: PaymentResponse = {
    success: true,
    scheme: SCHEME,
    network: NETWORK,
    payer: p.payer,
    txHash: p.txHash,
  };
  return NextResponse.json(
    { resource, article: ARTICLE },
    {
      status: 200,
      headers: {
        [PAYMENT_RESPONSE_HEADER]: encodeHeader(receipt),
        "Access-Control-Expose-Headers": PAYMENT_RESPONSE_HEADER,
        "Cache-Control": "private, no-store",
      },
    },
  );
}
