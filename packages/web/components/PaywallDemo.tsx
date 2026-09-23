"use client";

import { useCallback, useState } from "react";
import { useAccount, useConnect, useDisconnect, usePublicClient, useSwitchChain, useWalletClient } from "wagmi";
import { baseSepolia } from "wagmi/chains";
import type { PublicClient, WalletClient } from "viem";
import { confidentialPaywallAbi } from "@/lib/abi/ConfidentialPaywall";
import { ensureSelfAcp, getConnectedCofheClient } from "@/lib/cofhe-browser";
import { DEMO_AMOUNTS_CENTS, EXPLORER_URL, PAYWALL_ADDRESS } from "@/lib/config";
import {
  buildAccessMessage,
  decodeHeader,
  encodeHeader,
  formatCents,
  NETWORK,
  PAYMENT_HEADER,
  PAYMENT_RESPONSE_HEADER,
  SCHEME,
  X402_VERSION,
  type ConfidentialPaymentPayload,
  type Hex,
  type PaymentRequiredResponse,
  type PaymentResponse,
} from "@/lib/x402";

type Article = { title: string; author: string; body: readonly string[] };
type LogLine = { t: number; text: string; tone?: "ok" | "err" };

const ENDPOINT = "/api/article";

export function PaywallDemo() {
  const { address, chainId, isConnected } = useAccount();
  const { connect, connectors, isPending: connecting } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChain } = useSwitchChain();
  const publicClient = usePublicClient({ chainId: baseSepolia.id });
  const { data: walletClient } = useWalletClient();

  const [challenge, setChallenge] = useState<PaymentRequiredResponse | null>(null);
  const [amount, setAmount] = useState<bigint>(DEMO_AMOUNTS_CENTS[0]);
  const [balance, setBalance] = useState<bigint | null>(null);
  const [payTx, setPayTx] = useState<Hex | null>(null);
  const [article, setArticle] = useState<Article | null>(null);
  const [receipt, setReceipt] = useState<PaymentResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);

  const push = (text: string, tone?: LogLine["tone"]) =>
    setLog((l) => [...l, { t: Date.now(), text, tone }]);

  const wrongChain = isConnected && chainId !== baseSepolia.id;
  const ready = Boolean(isConnected && !wrongChain && publicClient && walletClient && PAYWALL_ADDRESS && address);

  const run = useCallback(
    async (label: string, fn: () => Promise<void>) => {
      setBusy(label);
      try {
        await fn();
      } catch (err) {
        const msg = (err as { shortMessage?: string; message?: string })?.shortMessage ?? (err as Error)?.message;
        push(`${label} : ${msg ?? String(err)}`, "err");
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  const cofhe = () => getConnectedCofheClient(publicClient as PublicClient, walletClient as WalletClient);

  // 1. GET sans paiement → 402
  const requestResource = () =>
    run("GET /api/article", async () => {
      const res = await fetch(ENDPOINT, { cache: "no-store" });
      const body = await res.json();
      if (res.status === 402) {
        setChallenge(body as PaymentRequiredResponse);
        push(`HTTP 402 Payment Required — scheme « ${(body as PaymentRequiredResponse).accepts[0]?.scheme} »`);
      } else if (res.ok) {
        setArticle(body.article);
        push("HTTP 200 — contenu servi", "ok");
      } else {
        push(`HTTP ${res.status} — ${body.error ?? "erreur"}`, "err");
      }
    });

  // 2. Crédits de démo
  const claimFaucet = () =>
    run("Faucet", async () => {
      const hash = await walletClient!.writeContract({
        address: PAYWALL_ADDRESS!,
        abi: confidentialPaywallAbi,
        functionName: "claimFaucet",
        account: address!,
        chain: baseSepolia,
      });
      push(`claimFaucet envoyé : ${hash}`);
      await publicClient!.waitForTransactionReceipt({ hash });
      push("Crédits de démo reçus (solde chiffré)", "ok");
    });

  const revealBalance = () =>
    run("Déchiffrer mon solde", async () => {
      const client = await cofhe();
      await ensureSelfAcp(client);
      const handle = await publicClient!.readContract({
        address: PAYWALL_ADDRESS!,
        abi: confidentialPaywallAbi,
        functionName: "balanceOf",
        args: [address!],
      });
      const { FheTypes } = await import("@cofhe/sdk");
      const value = await client.decryptForView(handle, FheTypes.Uint64).execute();
      setBalance(BigInt(value as bigint));
      push(`Solde déchiffré localement : ${formatCents(BigInt(value as bigint))}`, "ok");
    });

  // 3. Paiement chiffré
  const pay = () =>
    run("Paiement chiffré", async () => {
      const client = await cofhe();
      const { Encryptable } = await import("@cofhe/sdk");
      push(`Chiffrement de ${formatCents(amount)} dans le navigateur (TFHE + preuve)…`);
      const [encAmount, proof] = await client
        .encryptInputs([Encryptable.uint64(amount)])
        .setConsumingContract(PAYWALL_ADDRESS!)
        .execute();

      const hash = await walletClient!.writeContract({
        address: PAYWALL_ADDRESS!,
        abi: confidentialPaywallAbi,
        functionName: "pay",
        args: [encAmount as Hex, proof as Hex],
        account: address!,
        chain: baseSepolia,
      });
      setPayTx(hash);
      push(`pay(handle, proof) envoyé : ${hash} — aucun montant dans la calldata`);
      await publicClient!.waitForTransactionReceipt({ hash });

      await ensureSelfAcp(client);
      const { FheTypes } = await import("@cofhe/sdk");
      const okHandle = await publicClient!.readContract({
        address: PAYWALL_ADDRESS!,
        abi: confidentialPaywallAbi,
        functionName: "lastPaymentOk",
        args: [address!],
      });
      const ok = await client.decryptForView(okHandle, FheTypes.Bool).execute();
      push(
        ok
          ? "Paiement accepté (déchiffré pour vous seul)"
          : "Paiement refusé : montant < prix ou solde insuffisant — rien n'a été débité",
        ok ? "ok" : "err",
      );
    });

  // 4. Retry avec X-PAYMENT
  const retryWithPayment = () =>
    run("GET avec X-PAYMENT", async () => {
      // Nonce frais (les nonces expirent après 5 min).
      const fresh = await fetch(ENDPOINT, { cache: "no-store" });
      if (fresh.status !== 402) {
        push(`Attendu 402, reçu ${fresh.status}`, "err");
        return;
      }
      const req = ((await fresh.json()) as PaymentRequiredResponse).accepts[0];

      const message = buildAccessMessage({ resource: req.resource, nonce: req.extra.nonce, contract: req.payTo });
      const signature = await walletClient!.signMessage({ account: address!, message });

      const payment: ConfidentialPaymentPayload = {
        x402Version: X402_VERSION,
        scheme: SCHEME,
        network: NETWORK,
        payload: { payer: address!, nonce: req.extra.nonce, signature, txHash: payTx ?? undefined },
      };
      push("Signature du nonce (preuve de contrôle de l'adresse, sans montant)");

      const res = await fetch(ENDPOINT, { headers: { [PAYMENT_HEADER]: encodeHeader(payment) }, cache: "no-store" });
      const body = await res.json();
      if (res.ok) {
        setArticle(body.article);
        const header = res.headers.get(PAYMENT_RESPONSE_HEADER);
        if (header) setReceipt(decodeHeader<PaymentResponse>(header));
        push("HTTP 200 — le serveur a déchiffré votre accès (booléen), pas votre montant", "ok");
      } else {
        push(`HTTP ${res.status} — ${body.error}`, "err");
      }
    });

  const req = challenge?.accepts[0];

  return (
    <div className="demo">
      <section className="card">
        <header className="card-head">
          <span className="step">0</span>
          <h2>Wallet</h2>
        </header>
        {!isConnected ? (
          <div className="row">
            {connectors.length === 0 && <p className="muted">Aucun wallet injecté détecté (MetaMask, Rabby…).</p>}
            {connectors.map((c) => (
              <button key={c.uid} onClick={() => connect({ connector: c })} disabled={connecting}>
                Connecter {c.name}
              </button>
            ))}
          </div>
        ) : (
          <div className="row">
            <code className="addr">{address}</code>
            {wrongChain && (
              <button onClick={() => switchChain({ chainId: baseSepolia.id })}>Basculer sur Base Sepolia</button>
            )}
            <button className="ghost" onClick={() => disconnect()}>
              Déconnecter
            </button>
          </div>
        )}
        {!PAYWALL_ADDRESS && (
          <p className="warn">
            <code>NEXT_PUBLIC_PAYWALL_ADDRESS</code> n&apos;est pas défini : déployez le contrat
            (<code>pnpm base-sepolia:deploy</code>) puis redémarrez le front.
          </p>
        )}
      </section>

      <section className="card">
        <header className="card-head">
          <span className="step">1</span>
          <h2>Demander la ressource</h2>
        </header>
        <p className="muted">
          <code>GET {ENDPOINT}</code> sans en-tête de paiement : le serveur répond 402 et décrit le paiement attendu.
        </p>
        <button onClick={requestResource} disabled={busy !== null}>
          GET {ENDPOINT}
        </button>
        {challenge && (
          <details open>
            <summary>Corps de la réponse 402</summary>
            <pre>{JSON.stringify(challenge, null, 2)}</pre>
          </details>
        )}
      </section>

      <section className="card">
        <header className="card-head">
          <span className="step">2</span>
          <h2>Crédits de démo</h2>
        </header>
        <p className="muted">
          Le contrat tient un solde chiffré en cents. Le faucet crédite 10,00 $ (montant public) ; le solde n&apos;est
          lisible que par vous.
        </p>
        <div className="row">
          <button onClick={claimFaucet} disabled={!ready || busy !== null}>
            Recevoir 10,00 $ de crédits
          </button>
          <button className="ghost" onClick={revealBalance} disabled={!ready || busy !== null}>
            Déchiffrer mon solde
          </button>
          {balance !== null && <span className="pill">{formatCents(balance)}</span>}
        </div>
      </section>

      <section className="card">
        <header className="card-head">
          <span className="step">3</span>
          <h2>Payer un montant chiffré</h2>
        </header>
        <p className="muted">
          Prix plancher annoncé : {req ? formatCents(BigInt(req.minAmountRequired)) : formatCents(10)}. Payez le prix ou
          davantage : on-chain, les deux montants sont indiscernables.
        </p>
        <div className="row" role="radiogroup" aria-label="Montant">
          {DEMO_AMOUNTS_CENTS.map((c) => (
            <label key={c.toString()} className={`choice ${amount === c ? "on" : ""}`}>
              <input type="radio" name="amount" checked={amount === c} onChange={() => setAmount(c)} />
              {formatCents(c)}
            </label>
          ))}
          <button onClick={pay} disabled={!ready || busy !== null}>
            Chiffrer et payer
          </button>
        </div>
        {payTx && (
          <p className="muted">
            Ce qu&apos;un observateur voit :{" "}
            <a href={`${EXPLORER_URL}/tx/${payTx}`} target="_blank" rel="noreferrer">
              la transaction sur Basescan
            </a>{" "}
            — votre adresse, le contrat, l&apos;heure, le gas. Pas le montant.
          </p>
        )}
      </section>

      <section className="card">
        <header className="card-head">
          <span className="step">4</span>
          <h2>Rejouer la requête avec X-PAYMENT</h2>
        </header>
        <p className="muted">
          Vous signez le nonce du serveur. Le serveur vérifie la signature, lit votre <code>ebool</code> d&apos;accès et le
          déchiffre grâce à l&apos;ACL accordée au facilitateur.
        </p>
        <button onClick={retryWithPayment} disabled={!ready || busy !== null}>
          GET {ENDPOINT} + X-PAYMENT
        </button>
        {receipt && (
          <details>
            <summary>En-tête {PAYMENT_RESPONSE_HEADER}</summary>
            <pre>{JSON.stringify(receipt, null, 2)}</pre>
          </details>
        )}
      </section>

      {article && (
        <article className="card article">
          <h2>{article.title}</h2>
          <p className="muted">{article.author}</p>
          {article.body.map((p, i) => (
            <p key={i}>{p}</p>
          ))}
        </article>
      )}

      <section className="card log" aria-live="polite">
        <header className="card-head">
          <h2>Journal</h2>
          {busy && <span className="pill busy">{busy}…</span>}
        </header>
        {log.length === 0 ? (
          <p className="muted">Les étapes s&apos;afficheront ici.</p>
        ) : (
          <ol>
            {log.map((l) => (
              <li key={l.t + l.text} className={l.tone}>
                {l.text}
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}
