#!/usr/bin/env node
// Observation de nuit NBA (LECTURE SEULE) : relève à intervalle régulier l'état des paliers NBA d'Elpredatooor
// (piste Set et pistes CAREER) et l'état des matchs NBA sur ESPN, pour apprendre à quelle heure un palier passe
// de compo posée à LIVE puis CLAIMABLE / FAILED, et à quelle heure une compo se verrouille.
// Aucune écriture sur Sorare : uniquement des requêtes `query`.
// Dépôt public : aucun nom de joueur, slug de carte ni identifiant de compo ou d'étape dans les sorties.
//
// Variables d'environnement :
//   SORARE_API_KEY  clé API (facultative mais conseillée)        SORARE_JWT  jeton JWT (facultatif ; audience JWT_AUD)
//   JWT_AUD         audience du jeton (défaut elpredatooor-nuit)   DUREE_MINUTES (défaut 350)   INTERVALLE_MINUTES (défaut 5)
//   ESPN_DATES      dates ESPN AAAAMMJJ séparées par des virgules (défaut : jour courant à New York et lendemain)
//   SORTIE          dossier des fichiers produits (défaut observation-nuit-nba)
// Coût : 2 à 4 appels Sorare et 2 appels ESPN par relevé (70 relevés par nuit avec les valeurs par défaut, soit au plus
// 280 appels Sorare en 6 h, très loin de la limite de 1 000 par 10 minutes).
import fs from "node:fs";
import path from "node:path";

const API = "https://api.sorare.com/graphql";
const USER_SLUG = "elpredatooor";
const DUREE = Number(process.env.DUREE_MINUTES || 350);
const INTERVALLE = Math.max(0.25, Number(process.env.INTERVALLE_MINUTES || 5));
const SORTIE = process.env.SORTIE || "observation-nuit-nba";
const apiKey = process.env.SORARE_API_KEY || "";
const jwt = process.env.SORARE_JWT || "";
const jwtAud = process.env.JWT_AUD || "elpredatooor-nuit";

fs.mkdirSync(SORTIE, { recursive: true });
const F_JOURNAL = path.join(SORTIE, "journal.txt");
const F_RELEVES = path.join(SORTIE, "releves.jsonl");
const F_RESUME = path.join(SORTIE, "resume.md");

// ---------- Heures ----------
const fmt = (tz) => new Intl.DateTimeFormat("fr-BE", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
const fBxl = fmt("Europe/Brussels"), fUtc = fmt("UTC");
const heures = (d = new Date()) => ({ utc: fUtc.format(d), bxl: fBxl.format(d) });
const heureCourte = (d) => `${fUtc.format(d).slice(-8)} UTC / ${fBxl.format(d).slice(-8)} Bruxelles`;
const isoBxl = (iso) => { if (!iso) return null; const d = new Date(iso); return isNaN(d) ? iso : `${fBxl.format(d)} Bxl`; };

// Masque tout ce qui ressemble à un secret avant écriture (défense en profondeur)
const masque = (s) => {
  let t = String(s);
  for (const sec of [jwt, apiKey]) if (sec && sec.length > 4) t = t.split(sec).join("[masqué]");
  return t;
};
const ecrire = (ligne) => { const l = masque(ligne); console.log(l); fs.appendFileSync(F_JOURNAL, l + "\n"); };

// ---------- Réseau : délai max 20 s, une reprise ----------
async function fetchDelai(url, opts = {}, essais = 2) {
  let derniere;
  for (let i = 0; i < essais; i++) {
    try {
      const r = await fetch(url, { ...opts, signal: AbortSignal.timeout(20000) });
      if (r.status === 429) { derniere = new Error("HTTP 429 (trop de requêtes)"); await attendre(30000); continue; }
      return r;
    } catch (e) { derniere = e; if (i < essais - 1) await attendre(3000); }
  }
  throw derniere;
}
const attendre = (ms) => new Promise((ok) => setTimeout(ok, ms));

let appelsSorare = 0, appelsEspn = 0;
async function gql(query, avecJeton) {
  const headers = { "content-type": "application/json", accept: "application/json" };
  if (apiKey) headers.APIKEY = apiKey;
  if (avecJeton && jwt) { headers.Authorization = `Bearer ${jwt}`; headers["JWT-AUD"] = jwtAud; }
  appelsSorare++;
  const r = await fetchDelai(API, { method: "POST", headers, body: JSON.stringify({ query }) });
  let j; try { j = await r.json(); } catch { throw new Error(`HTTP ${r.status}, réponse non JSON`); }
  if (j.errors?.length) {
    const msg = j.errors.map((e) => e.message).join(" | ").slice(0, 300);
    const err = new Error(msg); err.data = j.data; throw err;
  }
  return j.data;
}

// ---------- Requêtes (champs vérifiés dans le schéma public du 02/11/2026) ----------
// Lineup : LineupInterface (draft cancelledAt hasLiveGames updatable deletable confirmable),
//          TaskLineupInterface (aasmState score taskAppearances{ locked lockedAt score scoreStatus game{ date statusTyped } }),
//          So5Lineup (canEdit anyEarliestGame{ date statusTyped }).
const LINEUP_COMPLET = `myLineups{ __typename draft cancelledAt hasLiveGames updatable deletable confirmable
  ... on TaskLineupInterface{ aasmState score taskAppearances{ locked lockedAt score scoreStatus game{ date statusTyped } } }
  ... on So5Lineup{ canEdit anyEarliestGame{ date statusTyped } } }`;
const LINEUP_SIMPLE = `myLineups{ __typename draft hasLiveGames updatable ... on TaskLineupInterface{ aasmState score } }`;
const ETAPES = (lineups) => `steps{ __typename id level target state
  ... on CareerStep{ maxLineupsCount remainingLineupsCount lockedLineupsCount pendingLineupsCount }
  ${lineups} }`;
const PLATEAU = (lineups) => `id title endDate myUnclaimedRewardsCount myCurrentStep{ id level state } ${ETAPES(lineups)}`;
// Trois niveaux : si un champ est refusé, on retombe sur une requête plus légère.
const NIVEAUX = [LINEUP_COMPLET, LINEUP_SIMPLE, ""];
let niveauPrive = 0;

async function relevePrive(mode) {
  while (niveauPrive < NIVEAUX.length) {
    const l = NIVEAUX[niveauPrive];
    const q = `query { currentUser { slug setBoard(sport: NBA, mode: ${mode}){ ${PLATEAU(l)} }
      boards(sport: NBA, mode: ${mode}){ ${PLATEAU(l)} } } }`;
    try { return (await gql(q, true)).currentUser; }
    catch (e) {
      if (/doesn't exist|not exist|cannot|complex|Cannot query|Unknown/i.test(e.message) && niveauPrive < NIVEAUX.length - 1) {
        ecrire(`  [requête privée] niveau ${niveauPrive} refusé (${e.message.slice(0, 160)}) : passage à une requête plus légère`);
        niveauPrive++; continue;
      }
      throw e;
    }
  }
}
async function relevePublic() {
  const q = `query { user(slug: "${USER_SLUG}"){ boards(sport: NBA, mode: CAREER){ id title endDate steps{ id level target state } } } }`;
  return (await gql(q, false)).user;
}

// ---------- ESPN ----------
function datesEspn() {
  if (process.env.ESPN_DATES) return process.env.ESPN_DATES.split(",").map((s) => s.trim()).filter(Boolean);
  const ny = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" })
    .format(d).replace(/-/g, "");
  const now = new Date();
  return [ny(now), ny(new Date(now.getTime() + 24 * 3600e3))];
}
const DATES_ESPN = datesEspn();
async function releveEspn() {
  const matchs = [];
  for (const d of DATES_ESPN) {
    appelsEspn++;
    const r = await fetchDelai(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/scoreboard?dates=${d}`);
    if (!r.ok) throw new Error(`ESPN ${d} : HTTP ${r.status}`);
    const j = await r.json();
    for (const ev of j.events || []) {
      const c = ev.competitions?.[0] || {};
      const eq = (ha) => c.competitors?.find((x) => x.homeAway === ha);
      const dom = eq("home"), ext = eq("away");
      const st = c.status || ev.status || {};
      matchs.push({
        cle: `${ext?.team?.abbreviation || "?"}@${dom?.team?.abbreviation || "?"} (${d})`,
        debut: ev.date, statut: st.type?.name, etat: st.type?.state, detail: st.type?.shortDetail,
        periode: st.period, horloge: st.displayClock, score: `${ext?.score ?? "-"}-${dom?.score ?? "-"}`,
      });
    }
  }
  return matchs;
}

// ---------- Résumé des plateaux (sans identifiants) ----------
function resumeLineups(lineups) {
  if (!Array.isArray(lineups)) return null;
  return lineups.map((l) => {
    const app = l.taskAppearances || [];
    const lockedAt = app.map((a) => a.lockedAt).filter(Boolean).sort();
    return {
      type: l.__typename, aasmState: l.aasmState ?? null, score: l.score ?? null, draft: l.draft, hasLiveGames: l.hasLiveGames,
      updatable: l.updatable ?? null, deletable: l.deletable ?? null, confirmable: l.confirmable ?? null, canEdit: l.canEdit ?? null,
      annulee: l.cancelledAt ? true : false,
      cartes: app.length || null, verrouillees: app.length ? app.filter((a) => a.locked).length : null,
      premierVerrou: lockedAt[0] || null, dernierVerrou: lockedAt[lockedAt.length - 1] || null,
      statutsScore: app.length ? [...new Set(app.map((a) => a.scoreStatus))].sort().join("/") : null,
      statutsMatchs: app.length ? [...new Set(app.map((a) => a.game?.statusTyped).filter(Boolean))].sort().join("/") : null,
      premierMatch: (app.map((a) => a.game?.date).filter(Boolean).sort()[0]) || l.anyEarliestGame?.date || null,
    };
  });
}
function resumePlateau(b, origine) {
  return {
    origine, titre: b.title || "(sans titre)", fin: b.endDate || null, aRecolter: b.myUnclaimedRewardsCount ?? null,
    etapeCourante: b.myCurrentStep ? { niveau: b.myCurrentStep.level, etat: b.myCurrentStep.state } : null,
    etapes: (b.steps || []).map((s) => ({
      niveau: s.level, cible: s.target, etat: s.state, type: s.__typename,
      max: s.maxLineupsCount ?? null, restantes: s.remainingLineupsCount ?? null,
      verrouillees: s.lockedLineupsCount ?? null, enAttente: s.pendingLineupsCount ?? null,
      compos: resumeLineups(s.myLineups),
    })),
  };
}

// ---------- Détection des changements ----------
const precedent = new Map();   // clé -> valeur comparée
const transitions = [];        // { heure, objet, avant, apres }
function compare(cle, valeur, d, etiquette) {
  const v = JSON.stringify(valeur);
  if (precedent.has(cle) && precedent.get(cle) !== v) {
    const t = { utc: fUtc.format(d).slice(-8), bxl: fBxl.format(d).slice(-8), objet: etiquette, avant: lisible(precedent.get(cle)), apres: lisible(v) };
    transitions.push(t);
    ecrire(`  >>> CHANGEMENT ${etiquette} : ${t.avant} -> ${t.apres}`);
  }
  precedent.set(cle, v);
}
const lisible = (v) => { try { const o = JSON.parse(v); return typeof o === "object" && o ? Object.entries(o).map(([k, x]) => `${k}=${x}`).join(", ") : String(o); } catch { return v; } };

function suivrePlateau(p, d) {
  const base = `${p.origine} « ${p.titre} »`;
  if (p.etapeCourante) compare(`${base}|courante`, p.etapeCourante, d, `${base} étape courante`);
  for (const e of p.etapes) {
    const et = `${base} niveau ${e.niveau} (cible ${e.cible})`;
    compare(`${et}|etat`, e.etat, d, `${et} état`);
    if (e.max !== null) compare(`${et}|compteurs`, { restantes: e.restantes, verrouillees: e.verrouillees, enAttente: e.enAttente }, d, `${et} compteurs`);
    (e.compos || []).forEach((c, i) => {
      compare(`${et}|compo${i}`, { etat: c.aasmState, enDirect: c.hasLiveGames, modifiable: c.updatable ?? c.canEdit,
        verrouillees: c.verrouillees, statutsMatchs: c.statutsMatchs, statutsScore: c.statutsScore, annulee: c.annulee },
        d, `${et} compo n°${i + 1}`);
    });
    if (e.compos) compare(`${et}|nbcompos`, e.compos.length, d, `${et} nombre de compos`);
  }
}

// ---------- Boucle ----------
const debut = new Date();
const fin = new Date(debut.getTime() + DUREE * 60e3);
let jetonEtat = jwt ? "à vérifier" : "absent";
let releves = 0, erreurs = 0;
const derniers = { plateaux: null, matchs: null };

ecrire(`Observation de nuit NBA (lecture seule) : début ${heures(debut).utc} UTC / ${heures(debut).bxl} Bruxelles, `
  + `durée ${DUREE} min, intervalle ${INTERVALLE} min, dates ESPN ${DATES_ESPN.join(", ")}.`);
if (!apiKey) ecrire("Clé API Sorare absente : requêtes publiques sans clé (complexité limitée).");
if (!jwt) ecrire("JETON ABSENT : SORARE_JWT non fourni, mode public seulement (piste Set et compos invisibles).");

async function unReleve() {
  const d = new Date(); releves++;
  const h = heures(d);
  const ligne = { utc: h.utc, bxl: h.bxl, jeton: null, plateaux: [], matchs: [], erreurs: [] };
  ecrire(`--- Relevé ${releves} : ${h.utc} UTC / ${h.bxl} Bruxelles`);

  // 1. Avec jeton
  if (jwt && jetonEtat !== "refusé") {
    try {
      let cu = await relevePrive("CAREER");
      if (!cu) {
        jetonEtat = "refusé";
        ecrire("JETON REFUSÉ : currentUser vaut null (jeton expiré, mauvaise audience ou invalide). Suite en mode public seulement.");
      } else {
        if (jetonEtat !== "accepté") ecrire(`Jeton accepté (compte ${cu.slug === USER_SLUG ? USER_SLUG : "autre que " + USER_SLUG}).`);
        jetonEtat = "accepté";
        let set = cu.setBoard, modeSet = "CAREER";
        if (!set) {
          const cs = await relevePrive("SQUAD");
          set = cs?.setBoard; modeSet = "SQUAD";
          if (cs?.boards?.length) for (const b of cs.boards) ligne.plateaux.push(resumePlateau(b, "privé SQUAD"));
        }
        if (set) ligne.plateaux.push(resumePlateau(set, `Set (${modeSet})`));
        else ecrire("  setBoard NBA introuvable en CAREER comme en SQUAD.");
        for (const b of cu.boards || []) ligne.plateaux.push(resumePlateau(b, "privé CAREER"));
      }
    } catch (e) {
      erreurs++; ligne.erreurs.push(`privé : ${masque(e.message)}`); ecrire(`  Erreur requête privée : ${masque(e.message)}`);
      if (/unauthori[sz]ed|unauthenticated|not authenticated|segments|signature|expired|invalid token|jwt/i.test(e.message)) {
        jetonEtat = "refusé";
        ecrire("JETON REFUSÉ par Sorare (voir l'erreur ci-dessus). Suite en mode public seulement.");
      }
    }
  }
  ligne.jeton = jetonEtat;

  // 2. Public (toujours)
  try {
    const u = await relevePublic();
    for (const b of u?.boards || []) ligne.plateaux.push(resumePlateau(b, "public"));
  } catch (e) { erreurs++; ligne.erreurs.push(`public : ${masque(e.message)}`); ecrire(`  Erreur requête publique : ${masque(e.message)}`); }

  // 3. ESPN
  try { ligne.matchs = await releveEspn(); }
  catch (e) { erreurs++; ligne.erreurs.push(`ESPN : ${e.message}`); ecrire(`  Erreur ESPN : ${e.message}`); }

  // Affichage compact
  for (const p of ligne.plateaux) {
    ecrire(`  [${p.origine}] ${p.titre}${p.fin ? ` (fin ${isoBxl(p.fin)})` : ""}${p.aRecolter !== null ? `, à récolter ${p.aRecolter}` : ""}`
      + `${p.etapeCourante ? `, étape courante niv. ${p.etapeCourante.niveau} ${p.etapeCourante.etat}` : ""}`);
    for (const e of p.etapes) {
      let s = `    niv. ${e.niveau} cible ${e.cible} : ${e.etat}`;
      if (e.max !== null) s += ` | compos max ${e.max}, restantes ${e.restantes}, verrouillées ${e.verrouillees}, en attente ${e.enAttente}`;
      ecrire(s);
      (e.compos || []).forEach((c, i) => ecrire(`      compo n°${i + 1} : ${c.aasmState ?? c.type}, score ${c.score ?? "-"}, en direct ${c.hasLiveGames}, `
        + `modifiable ${c.updatable ?? c.canEdit}, cartes verrouillées ${c.verrouillees ?? "-"}/${c.cartes ?? "-"}, `
        + `1er verrou ${isoBxl(c.premierVerrou) ?? "-"}, 1er match ${isoBxl(c.premierMatch) ?? "-"}, matchs ${c.statutsMatchs ?? "-"}, scores ${c.statutsScore ?? "-"}`));
    }
  }
  for (const m of ligne.matchs) ecrire(`  ${m.cle} : ${m.statut} ${m.detail ?? ""} (période ${m.periode}, horloge ${m.horloge}) ${m.score}`);

  // Changements
  for (const p of ligne.plateaux) suivrePlateau(p, d);
  for (const m of ligne.matchs) compare(`match|${m.cle}`, { statut: m.statut, periode: m.periode }, d, `Match ${m.cle}`);
  compare("jeton", jetonEtat, d, "Jeton");

  fs.appendFileSync(F_RELEVES, masque(JSON.stringify(ligne)) + "\n");
  if (ligne.plateaux.length) derniers.plateaux = ligne.plateaux;
  if (ligne.matchs.length) derniers.matchs = ligne.matchs;
  ecrireResume(false);
}

function ecrireResume(final) {
  const fin2 = new Date();
  const L = [];
  L.push(`## Observation de nuit NBA (lecture seule)${final ? "" : " : en cours"}`, "");
  L.push(`- Début : ${heureCourte(debut)} ; dernier relevé : ${heureCourte(fin2)} ; ${releves} relevés, ${erreurs} erreurs réseau ou API.`);
  L.push(`- Jeton : ${jetonEtat}${jetonEtat === "absent" ? " (mode public seulement : piste Set et compos invisibles)" : ""}.`);
  L.push(`- Appels : ${appelsSorare} Sorare, ${appelsEspn} ESPN. Dates ESPN : ${DATES_ESPN.join(", ")}.`, "");
  L.push(`### Transitions (${transitions.length})`, "");
  if (transitions.length) {
    L.push("| UTC | Bruxelles | Objet | Avant | Après |", "|---|---|---|---|---|");
    for (const t of transitions) L.push(`| ${t.utc} | ${t.bxl} | ${t.objet} | ${t.avant} | ${t.apres} |`);
  } else L.push("Aucun changement observé.");
  L.push("", "### Dernier état des paliers", "");
  for (const p of derniers.plateaux || []) {
    L.push(`- **${p.origine} : ${p.titre}** : ` + p.etapes.map((e) => `niv. ${e.niveau} (${e.cible}) ${e.etat}`
      + (e.compos?.length ? ` [${e.compos.map((c) => `${c.aasmState ?? "?"} ${c.score ?? "-"}`).join("; ")}]` : "")).join(" ; "));
  }
  L.push("", "### Dernier état des matchs", "");
  for (const m of derniers.matchs || []) L.push(`- ${m.cle} : ${m.statut} ${m.detail ?? ""} ${m.score}`);
  const txt = masque(L.join("\n") + "\n");
  fs.writeFileSync(F_RESUME, txt);
  if (final && process.env.GITHUB_STEP_SUMMARY) fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, txt);
}

let arret = false;
for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => {
  if (arret) return; arret = true;
  ecrire(`Arrêt demandé (${sig}) : résumé écrit.`); ecrireResume(true); process.exit(0);
});

while (true) {
  const t0 = Date.now();
  try { await unReleve(); } catch (e) { erreurs++; ecrire(`Erreur inattendue (relevé ignoré) : ${masque(e.message)}`); }
  const prochain = t0 + INTERVALLE * 60e3;
  if (prochain > fin.getTime()) break;
  await attendre(Math.max(0, prochain - Date.now()));
}
ecrire(`Fin : ${releves} relevés, ${transitions.length} changements, ${appelsSorare} appels Sorare, ${appelsEspn} appels ESPN.`);
ecrireResume(true);
