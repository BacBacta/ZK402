// Service de contrôle des dépôts (conformité), co-signataire obligatoire de tout dépôt.
// Le programme `jspool` refuse un dépôt qui n'est pas signé par le contrôleur du pool.
// Ici, la liste de sanctions est une liste locale (test) ; en production : liste SDN de l'OFAC
// et/ou API de filtrage (Chainalysis, TRM…), appliquées au déposant ET à l'origine de ses fonds.
const web3 = require("@solana/web3.js");

function createScreener({ keypair, denylist = new Set() }) {
  const log = [];
  /** Vérifie le déposant ; si accepté, co-signe la transaction de dépôt (signature partielle). */
  function cosignDeposit(tx, depositor) {
    const who = depositor.toBase58();
    if (denylist.has(who)) { log.push({ depositor: who, decision: "refusé", reason: "liste de sanctions" }); return { ok: false, reason: "déposant sur liste de sanctions" }; }
    tx.partialSign(keypair);
    log.push({ depositor: who, decision: "accepté" });
    return { ok: true };
  }
  return { publicKey: keypair.publicKey, cosignDeposit, log };
}

module.exports = { createScreener };
