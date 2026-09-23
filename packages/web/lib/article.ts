import "server-only";

// Contenu protégé par le paywall (texte original du prototype).
export const ARTICLE = {
  title: "Payer sans montrer combien : notes sur un paywall x402 chiffré",
  author: "Prototype fhenix402",
  body: [
    "HTTP 402 Payment Required existe depuis 1997 et n'a presque jamais servi. x402 lui donne enfin un protocole : le serveur répond 402 avec la liste des moyens de paiement acceptés, le client paie, puis rejoue la requête avec une preuve de paiement dans l'en-tête X-PAYMENT.",
    "Sur une blockchain publique, ce paiement laisse une trace : qui a payé, qui a été payé, et combien. Pour un micropaiement de 10 cents, le montant paraît anodin. Mais la suite de montants dessine un profil — ce que vous lisez, à quelle fréquence, quel prix vous acceptez de payer, si vous laissez un pourboire.",
    "Ici, le montant ne quitte jamais votre navigateur en clair. Il est chiffré avec la clé publique FHE de CoFHE, envoyé au contrat ConfidentialPaywall, qui calcule homomorphiquement « montant ≥ prix » et « montant ≤ solde ». Le résultat est un booléen chiffré. Le serveur n'apprend que ce booléen, jamais le montant.",
    "Un observateur de la chaîne voit que votre adresse a appelé pay() sur ce contrat, à telle heure, avec tel gas. Il ne voit pas si vous avez payé 0,10 $ ou 4,02 $, ni même si le paiement a été accepté : les deux montants exécutent exactement le même circuit.",
    "Ce n'est pas de l'anonymat. L'adresse reste publique, le contrat identifie la ressource, et le réseau de seuil CoFHE fonctionne aujourd'hui en testnet, avec des roues d'entraînement (Privacy Stage 1). Mais c'est un pas concret : la confidentialité des montants comme propriété par défaut d'un paiement web.",
  ],
} as const;
