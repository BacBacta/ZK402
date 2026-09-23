import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "crypto";

// Nonces sans état : `<expiration>.<aléa>.<hmac>`. Le serveur n'a rien à stocker ;
// un nonce ne vaut que pour une ressource et expire vite.

const TTL_SECONDS = 300;

let devSecret: Buffer | null = null;
function secret(): Buffer {
  const env = process.env.X402_NONCE_SECRET;
  if (env) return Buffer.from(env, "utf8");
  if (process.env.NODE_ENV === "production") {
    throw new Error("X402_NONCE_SECRET manquant");
  }
  devSecret ??= randomBytes(32);
  return devSecret;
}

const mac = (resource: string, body: string) =>
  createHmac("sha256", secret()).update(`${resource}|${body}`).digest("base64url");

export function issueNonce(resource: string): { nonce: string; expiresAt: number } {
  const expiresAt = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  const body = `${expiresAt}.${randomBytes(16).toString("base64url")}`;
  return { nonce: `${body}.${mac(resource, body)}`, expiresAt };
}

export function verifyNonce(resource: string, nonce: string): { ok: true } | { ok: false; reason: string } {
  const parts = nonce.split(".");
  if (parts.length !== 3) return { ok: false, reason: "nonce malformé" };
  const [exp, rand, sig] = parts;
  const expected = Buffer.from(mac(resource, `${exp}.${rand}`));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) {
    return { ok: false, reason: "nonce invalide" };
  }
  if (Number(exp) < Math.floor(Date.now() / 1000)) return { ok: false, reason: "nonce expiré" };
  return { ok: true };
}
