import { ClientDemo } from "@/components/ClientDemo";

export default function Home() {
  return (
    <main>
      <header className="hero">
        <p className="eyebrow">Prototype éducatif · Base Sepolia · CoFHE testnet</p>
        <h1>fhenix402</h1>
        <p className="lede">
          Un paywall <strong>HTTP 402</strong> où le montant payé reste <strong>chiffré</strong> de bout en bout. Le
          contrat compare votre paiement au prix sans jamais le voir ; le serveur n&apos;apprend qu&apos;un booléen.
        </p>
      </header>

      <section className="split">
        <div>
          <h3>Chiffré</h3>
          <ul>
            <li>Le montant payé (10 ¢ ou 4,02 $)</li>
            <li>Votre solde de crédits</li>
            <li>L&apos;issue du paiement et votre accès</li>
          </ul>
        </div>
        <div>
          <h3>Public</h3>
          <ul>
            <li>Votre adresse et le contrat (donc la ressource)</li>
            <li>L&apos;heure, le gas, le fait d&apos;avoir appelé pay()</li>
            <li>Le prix plancher annoncé par la 402</li>
          </ul>
        </div>
      </section>

      <ClientDemo />

      <footer className="foot">
        Confidentialité ≠ anonymat. Testnet uniquement (Privacy Stage 1). Crédits de démo sans valeur.
      </footer>
    </main>
  );
}
