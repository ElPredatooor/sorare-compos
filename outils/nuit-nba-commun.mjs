// Outils communs des scripts de nuit NBA (LECTURE SEULE) : heures, masquage des secrets, fetch avec délai maximal,
// client GraphQL Sorare qui n'accepte que des requêtes `query`.
// Utilisé par outils/garde-nuit-nba.mjs (et, pour le réseau et le masquage seulement, outils/test-ecriture-nba.mjs). outils/observation-nuit-nba.mjs a encore sa propre copie (il tourne la nuit
// du 2 au 3/11/2026 : à brancher sur ce module ensuite).

export const API_SORARE = "https://api.sorare.com/graphql";
export const USER_SLUG = "elpredatooor";

// ---------- Heures ----------
const fmt = (tz) => new Intl.DateTimeFormat("fr-BE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const fBxl = fmt("Europe/Brussels"), fUtc = fmt("UTC");
export const heures = (d = new Date()) => ({ utc: fUtc.format(d), bxl: fBxl.format(d) });
export const heureBxl = (t) => { const d = new Date(t); return isNaN(d) ? "?" : fBxl.format(d).slice(-8, -3).replace(":", "h"); };
export const heureCourte = (d) => `${fUtc.format(d).slice(-8)} UTC / ${fBxl.format(d).slice(-8)} Bruxelles`;
export const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));

// Masque les secrets connus avant toute écriture (défense en profondeur)
export const creerMasque = (secrets) => (s) => {
  let t = String(s);
  for (const sec of secrets) if (sec && sec.length > 4) t = t.split(sec).join("[masqué]");
  return t;
};

// ---------- Réseau : délai max 20 s par appel, une reprise ----------
export function creerReseau({ fetchFn = globalThis.fetch, attente = attendre, delaiMs = 20000, essais = 2 } = {}) {
  return async function fetchDelai(url, opts = {}) {
    let derniere;
    for (let i = 0; i < essais; i++) {
      try {
        const r = await fetchFn(url, { ...opts, signal: AbortSignal.timeout(delaiMs) });
        if (r.status === 429) { derniere = new Error("HTTP 429 (trop de requêtes)"); if (i < essais - 1) await attente(30000); continue; }
        return r;
      } catch (e) { derniere = e; if (i < essais - 1) await attente(3000); }
    }
    throw derniere;
  };
}

// Client GraphQL : lecture seule. Toute opération autre que `query` est refusée avant l'envoi.
export function creerClientSorare({ fetchDelai, apiKey = "", jwt = "", jwtAud = "elpredatooor-nuit" }) {
  const compteur = { appels: 0 };
  async function gql(query, variables = {}, avecJeton = true) {
    if (!/^\s*query\b/.test(query)) throw new Error("Requête refusée : seules les lectures (query) sont permises.");
    const headers = { "content-type": "application/json", accept: "application/json" };
    if (apiKey) headers.APIKEY = apiKey;
    if (avecJeton && jwt) { headers.Authorization = `Bearer ${jwt}`; headers["JWT-AUD"] = jwtAud; }
    compteur.appels++;
    const r = await fetchDelai(API_SORARE, { method: "POST", headers, body: JSON.stringify({ query, variables }) });
    let j; try { j = await r.json(); } catch { throw new Error(`HTTP ${r.status}, réponse non JSON`); }
    if (j.errors?.length) {
      const err = new Error(j.errors.map((e) => e.message).join(" | ").slice(0, 300)); err.data = j.data; throw err;
    }
    return j.data;
  }
  return { gql, compteur };
}

// Nom de joueur normalisé pour la jointure avec ESPN : même règle que `pname` de sorare-compos/collecte.mjs
export const pname = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z]/g, "");

// Blessures NBA en direct (ESPN, 1 appel) : Map nom normalisé -> { nom, equipe, statut, retour, info }
export async function blessuresEspn(fetchDelai) {
  const r = await fetchDelai("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries");
  if (!r.ok) throw new Error(`ESPN blessures : HTTP ${r.status}`);
  const ij = await r.json();
  const inj = new Map();
  for (const t of ij?.injuries || []) for (const e of t.injuries || []) {
    const det = e.details || {};
    inj.set(pname(e.athlete?.displayName), {
      nom: e.athlete?.displayName || "", equipe: t.displayName || "", statut: e.status || "", retour: det.returnDate || "",
      info: [det.type, det.detail, det.side].filter(Boolean).join(" "),
    });
  }
  return inj;
}

// ---------- Plan de nuit (variable de dépôt GitHub PLAN_NUIT_NBA, écrit par outils/plan-nuit-nba.mjs) ----------
// Une variable `vars` s'affiche EN CLAIR dans l'en-tête « env » de l'étape, donc dans le journal public du workflow, et les
// cardSlug contiennent les noms des joueurs. Le plan se range donc chiffré : « plan1:<base64(iv 12 o | tag 16 o | texte)> »,
// AES-256-GCM, clé = SHA-256("plan-nuit-nba|" + SORARE_API_KEY) (clé déjà dans le trousseau du Mac et en secret GitHub).
// Chiffrer sur le Mac (la clé passe en variable d'environnement, jamais affichée) :
//   node outils/plan-nuit-nba.mjs ... | SORARE_API_KEY="$(security find-generic-password -a elpredatooor -s SORARE_API_KEY -w)" \
//     node outils/nuit-nba-commun.mjs chiffrer-plan
// Un plan en JSON clair est encore accepté (tests), avec un avertissement.
import crypto from "node:crypto";
const clePlan = (secret) => crypto.createHash("sha256").update("plan-nuit-nba|" + secret).digest();
export function chiffrerPlan(texte, secret) {
  if (!secret) throw new Error("clé absente (SORARE_API_KEY)");
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv("aes-256-gcm", clePlan(secret), iv);
  const ct = Buffer.concat([c.update(String(texte), "utf8"), c.final()]);
  return "plan1:" + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
}
export function dechiffrerPlan(txt, secret) {
  const b = Buffer.from(String(txt).trim().slice(6), "base64");
  const d = crypto.createDecipheriv("aes-256-gcm", clePlan(secret), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString("utf8");
}
// -> { etat: "absent" | "illisible" | "chiffré" | "en clair", plan, erreur }
export function lirePlan(brut, secret) {
  const t = String(brut ?? "").trim();
  if (!t) return { etat: "absent", plan: null };
  let texte = t, etat = "en clair";
  if (t.startsWith("plan1:")) {
    if (!secret) return { etat: "illisible", plan: null, erreur: "plan chiffré mais clé SORARE_API_KEY absente" };
    try { texte = dechiffrerPlan(t, secret); etat = "chiffré"; } catch { return { etat: "illisible", plan: null, erreur: "déchiffrement impossible (autre clé ?)" }; }
  }
  let plan;
  try { plan = JSON.parse(texte); } catch { return { etat: "illisible", plan: null, erreur: "JSON invalide" }; }
  if (!plan || typeof plan !== "object" || !plan.paliers || typeof plan.paliers !== "object" || Array.isArray(plan.paliers))
    return { etat: "illisible", plan: null, erreur: "champ « paliers » absent ou mal formé" };
  return { etat, plan };
}

if (process.argv[1] && process.argv[2] === "chiffrer-plan" && import.meta.url === (await import("node:url")).pathToFileURL((await import("node:path")).resolve(process.argv[1])).href) {
  const morceaux = []; for await (const m of process.stdin) morceaux.push(m);
  const texte = Buffer.concat(morceaux).toString("utf8");
  const l = lirePlan(texte, "");
  if (l.etat !== "en clair") { console.error(`Plan refusé : ${l.erreur || l.etat}.`); process.exit(1); }
  if (!process.env.SORARE_API_KEY) { console.error("SORARE_API_KEY absente de l'environnement."); process.exit(1); }
  process.stdout.write(chiffrerPlan(JSON.stringify(l.plan), process.env.SORARE_API_KEY) + "\n");
}
