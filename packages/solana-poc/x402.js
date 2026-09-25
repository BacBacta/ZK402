// Schéma x402 « shielded-note » sur Solana : paiement HTTP 402 par une note du pool blindé.
//  - Le vendeur répond 402 avec ses exigences (accepts[]) ;
//  - l'agent rejoue la requête avec l'en-tête X-PAYMENT = base64(JSON PaymentPayload) contenant
//    une preuve ZK (aucune signature, aucune adresse de l'agent) ;
//  - le vendeur appelle le facilitateur : /verify (contrôles + simulation, rien n'est payé) puis
//    /settle (envoi de la transaction), et renvoie X-PAYMENT-RESPONSE.
// Forme calquée sur x402 (x402Version, accepts, scheme, network, payTo, asset, amount,
// X-PAYMENT / X-PAYMENT-RESPONSE) ; le schéma « shielded-note » est propre à ce prototype.
const http = require("http");

const SCHEME = "shielded-note";
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64");
const unb64 = (s) => JSON.parse(Buffer.from(s, "base64").toString("utf8"));
async function readJson(req) { let b = ""; for await (const c of req) { b += c; if (b.length > 32768) throw new Error("trop grand"); } return JSON.parse(b); }
const send = (res, status, body, headers = {}) => { res.writeHead(status, { "content-type": "application/json", ...headers }); res.end(JSON.stringify(body)); };

/** Facilitateur x402 adossé au relayeur : /supported, /verify, /settle. */
function facilitatorServer(relayer, { network }) {
  const check = (payload, req) => {
    if (payload?.scheme !== SCHEME || req?.scheme !== SCHEME) return "schéma non pris en charge";
    if (payload.network !== network || req.network !== network) return "réseau incorrect";
    return null;
  };
  return http.createServer(async (req, res) => {
    try {
      if (req.method === "GET" && req.url === "/supported") return send(res, 200, { kinds: [{ x402Version: 2, scheme: SCHEME, network }] });
      if (req.method !== "POST") return send(res, 404, {});
      const { paymentPayload, paymentRequirements } = await readJson(req);
      const bad = check(paymentPayload, paymentRequirements);
      const expect = { recipientOwner: paymentRequirements.payTo, amount: paymentRequirements.amount };
      if (req.url === "/verify") {
        if (bad) return send(res, 200, { isValid: false, invalidReason: bad });
        const p = await relayer.prepare(paymentPayload.payload, expect);
        return send(res, 200, p.status === 200 ? { isValid: true, payer: "shielded" } : { isValid: false, invalidReason: p.error });
      }
      if (req.url === "/settle") {
        if (bad) return send(res, 200, { success: false, errorReason: bad, network });
        const r = await relayer.relay(paymentPayload.payload, expect);
        return send(res, 200, r.status === 200
          ? { success: true, transaction: r.sig, network, payer: "shielded", computeUnits: r.simulatedComputeUnits }
          : { success: false, errorReason: r.error, network });
      }
      send(res, 404, {});
    } catch (e) { send(res, 500, { error: String(e.message).slice(0, 200) }); }
  });
}

/** Vendeur : une ressource payante protégée par x402. */
function sellerServer({ facilitatorUrl, requirements, resource }) {
  const post = async (path, body) => (await fetch(facilitatorUrl + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })).json();
  return http.createServer(async (req, res) => {
    if (req.url !== requirements.resource) return send(res, 404, {});
    const header = req.headers["x-payment"];
    const pay402 = (error) => send(res, 402, { x402Version: 2, error, accepts: [requirements] });
    if (!header) return pay402("paiement requis");
    let paymentPayload;
    try { paymentPayload = unb64(header); } catch { return pay402("en-tête X-PAYMENT illisible"); }
    const v = await post("/verify", { paymentPayload, paymentRequirements: requirements });
    if (!v.isValid) return pay402(`paiement refusé : ${v.invalidReason}`);
    const s = await post("/settle", { paymentPayload, paymentRequirements: requirements });
    if (!s.success) return pay402(`règlement échoué : ${s.errorReason}`);
    send(res, 200, resource(), { "x-payment-response": b64(s) });
  });
}

/** Client (agent) : GET ; si 402, construit le paiement avec `pay(requirements)` et rejoue. */
async function fetchWithPayment(url, pay) {
  const first = await fetch(url);
  if (first.status !== 402) return { status: first.status, body: await first.json() };
  const { accepts } = await first.json();
  const reqs = accepts.find((a) => a.scheme === SCHEME);
  const paymentPayload = { x402Version: 2, scheme: SCHEME, network: reqs.network, payload: await pay(reqs) };
  return retryWith(url, paymentPayload, reqs);
}
async function retryWith(url, paymentPayload, requirements) {
  const r = await fetch(url, { headers: { "x-payment": b64(paymentPayload) } });
  const body = await r.json();
  const pr = r.headers.get("x-payment-response");
  return { status: r.status, body, paymentResponse: pr ? unb64(pr) : null, paymentPayload, requirements };
}

module.exports = { SCHEME, facilitatorServer, sellerServer, fetchWithPayment, retryWith };
