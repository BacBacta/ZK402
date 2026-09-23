"use client";

import dynamic from "next/dynamic";

// Le composant manipule le wallet et le SDK CoFHE : rendu client uniquement.
export const ClientDemo = dynamic(() => import("./PaywallDemo").then((m) => m.PaywallDemo), {
  ssr: false,
  loading: () => <p className="muted">Chargement…</p>,
});
