// Test hors ligne de la garde de nuit Set NBA (outils/garde-nuit-nba.mjs) : API Sorare et ESPN simulés, horloge simulée.
// Aucun réseau, aucune clé. NBA seulement. Usage : node outils/test-garde-nuit-nba.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executer } from "./garde-nuit-nba.mjs";

let ko = 0;
const ok = (cond, msg) => { if (!cond) { ko++; console.log("ECHEC :", msg); } else console.log("ok   :", msg); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "garde-nuit-"));
const DONNEES = path.join(tmp, "data"); fs.mkdirSync(DONNEES);
const ecrisJson = (n, v) => fs.writeFileSync(path.join(DONNEES, n + ".json"), JSON.stringify(v));

// Collecte simulée (contrat v8) : candidats x (3★, 40), y (2★, 50, mais déjà posé dans une autre compo), z (2★, 20), w (absent du banc)
const T_COMPO = "2026-11-03T00:40:00Z", T_CAND = "2026-11-03T02:00";
const carte = (s, nom) => ({ sport: "NBA", slug: s, joueur: nom, carte_id: `${s}-c`, rarete: "common", puissance: 1, skin: 1, set_courant: true });
ecrisJson("cartes", [carte("x", "Xavier Candidat"), carte("y", "Yann Utilise"), carte("z", "Zoe Second"), carte("w", "William Horsbanc")]);
ecrisJson("joueurs", [
  { sport: "NBA", slug: "x", joueur: "Xavier Candidat", club: "Los Angeles Lakers", etoiles: 3 },
  { sport: "NBA", slug: "y", joueur: "Yann Utilise", club: "Phoenix Suns", etoiles: 2 },
  { sport: "NBA", slug: "z", joueur: "Zoe Second", club: "Brooklyn Nets", etoiles: 2 },
  { sport: "NBA", slug: "w", joueur: "William Horsbanc", club: "Utah Jazz", etoiles: 1 },
]);
ecrisJson("matchs", [["x", 40], ["y", 50], ["z", 20], ["w", 90]].map(([s, p]) => ({ sport: "NBA", slug: s, date: T_CAND, proj: p, proba: 100 })));
ecrisJson("resume", [{ maj_nba: "2026-11-02T14:46:32Z", arcade_nba_debut: "2026-11-03T00:00:00Z", arcade_nba_fin: "2026-11-06T06:00:00Z" }]);

// API simulée
const app = (s, nom, club, etoiles, date = T_COMPO) => ({ locked: false, starCost: etoiles, anyCard: { slug: `${s}-c`, rarityTyped: "common" },
  anyPlayer: { slug: s, displayName: nom, gameplayTierStars: etoiles, activeClub: { name: club } }, game: { date, statusTyped: "SCHEDULED" }, upcomingGame: null });
const plateau = { id: "board1", title: "Hot Streaks", endDate: null, steps: [
  { id: "step1", level: 1, target: 150, state: "CLAIMED", myLineups: [{ __typename: "TaskLineup", id: "L0", aasmState: "SUCCESSFUL", draft: false, cancelledAt: null, updatable: false,
    taskAppearances: [app("y", "Yann Utilise", "Phoenix Suns", 2, "2026-11-02T01:00:00Z")] }] },
  { id: "step2", level: 2, target: 180, state: "LINEUP_SET", myLineups: [{ __typename: "TaskLineup", id: "L1", aasmState: "READY", draft: false, cancelledAt: null, updatable: true,
    taskAppearances: [app("alain", "Alain Premier", "Boston Celtics", 4), app("b", "Bruno Doute", "Boston Celtics", 3), app("c", "Cedric Blesse", "Miami Heat", 3),
      app("d", "Denis Quatre", "Chicago Bulls", 3), app("e", "Emile Cinq", "New York Knicks", 3)] }] },
] };
const corps = [];
let appelsBanc = 0;
const reponse = (obj) => ({ ok: true, status: 200, json: async () => obj });
const fauxFetch = (jetonValide) => async (url, opts = {}) => {
  if (url.includes("espn.com")) return reponse({ injuries: [{ displayName: "Miami Heat", injuries: [{ athlete: { displayName: "Cédric Blessé" }, status: "Out", details: {} }] },
    { displayName: "Boston Celtics", injuries: [{ athlete: { displayName: "Bruno Doute" }, status: "Day-To-Day", details: {} }] }] });
  corps.push(opts.body);
  const { query } = JSON.parse(opts.body);
  if (!jetonValide || !opts.headers?.Authorization) return reponse({ data: { currentUser: null } });
  if (query.includes("GardePlateau")) return reponse({ data: { currentUser: { slug: "elpredatooor", setBoard: plateau } } });
  if (query.includes("GardeBanc")) { appelsBanc++; return reponse({ data: { currentUser: { step: { myFilteredBench: { pageInfo: { hasNextPage: false, endCursor: null },
    nodes: ["x", "y", "z"].map((s) => ({ __typename: "ComposeTeamBenchCard", starCost: s === "x" ? 3 : 2, anyPlayer: { slug: s, displayName: { x: "Xavier Candidat", y: "Yann Utilise", z: "Zoe Second" }[s] }, anyCard: { slug: `${s}-c` } })) } } } } }); }
  return reponse({ errors: [{ message: "requête inconnue" }] });
};

// Horloge simulée : 23h30 UTC → 00h50 UTC, relevé toutes les 5 min ; le premier match de la compo commence à 00h40 UTC
function horlogeSimulee(debut) { let t = Date.parse(debut); return { horloge: () => new Date(t), attente: async (ms) => { t += ms; } }; }

// 1. Avec jeton : un Out (Cédric Blessé), un Day-To-Day, une carte déjà utilisée ailleurs, un candidat absent du banc
const SECRET = "jeton-de-test-ne-doit-pas-sortir";
let sortieConsole = [];
const h1 = horlogeSimulee("2026-11-02T23:30:00Z");
const S1 = path.join(tmp, "sortie1");
const r1 = await executer({ env: { SORARE_JWT: SECRET, SORARE_API_KEY: "cle-de-test-secrete", DUREE_MINUTES: "80", INTERVALLE_MINUTES: "5", DONNEES, SORTIE: S1,
  GITHUB_STEP_SUMMARY: path.join(tmp, "resume-github.md") }, fetchFn: fauxFetch(true), ...h1, sortieConsole: (l) => sortieConsole.push(l), signaux: false });
const rapport = fs.readFileSync(path.join(S1, "rapport.md"), "utf8");
const journal = fs.readFileSync(path.join(S1, "journal.txt"), "utf8");
const resumeGh = fs.readFileSync(path.join(tmp, "resume-github.md"), "utf8");
const evts = fs.readFileSync(path.join(S1, "evenements.jsonl"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
ok(r1.releves === 17 && r1.jetonEtat === "accepté", `17 relevés de 23h30 à 00h50 UTC, jeton accepté (${r1.releves}, ${r1.jetonEtat})`);
ok(r1.totaux.remplacements.size === 1 && [...r1.totaux.remplacements][0].endsWith("R:c-c>x-c"), "un seul remplacement distinct : Cédric (Out) → Xavier (y déjà posé, w absent du banc)");
const evRemp = evts.filter((e) => e.remplacements?.length);
ok(evRemp.length === 1 && evRemp[0].remplacements[0].entrant === "Xavier Candidat" && evRemp[0].remplacements[0].projection === 40, "remplacement noté une seule fois (pas à chaque relevé), avec nom et projection");
ok(evts.some((e) => e.signalements?.some((s) => s.joueur === "Bruno Doute" && s.statut === "Day-To-Day")), "Day-To-Day signalé, pas remplacé");
const evVerrou = evts.filter((e) => e.impossible?.some((i) => i.verrou));
ok(evVerrou.length === 1 && evVerrou[0].heure === "2026-11-03T00:40:00.000Z", "« impossible : compo verrouillée » noté au relevé de 00h40 UTC");
ok(appelsBanc === 5, `banc relu toutes les 15 min tant que la compo est modifiable (23h30 à 00h30 : 5 fois), plus après le verrouillage : ${appelsBanc}`);
ok(/Remplacement proposé.*Cedric Blesse.*Xavier Candidat/.test(rapport) && /Sans action, la compo s'est verrouillée à 01h40/.test(rapport) && /vérifiée sur le banc/.test(rapport),
  "compte rendu : noms, remplaçant, verrouillage à 01h40 Bruxelles, disponibilité vérifiée");
const noms = ["Cédric", "Cedric", "Xavier", "Bruno", "Alain", "Yann", "Zoe", "William"];
ok(!noms.some((n) => journal.includes(n) || resumeGh.includes(n) || sortieConsole.join("\n").includes(n)), "journal, console et résumé GitHub sans aucun nom de joueur");
ok(/1 Out détectés, 1 remplacements proposés/.test(journal) && /1 remplacements proposés/.test(resumeGh), "journal et résumé GitHub donnent les comptes");
const tout = [rapport, journal, resumeGh, ...fs.readdirSync(S1).map((f) => fs.readFileSync(path.join(S1, f), "utf8"))].join("\n");
ok(!tout.includes(SECRET) && !tout.includes("cle-de-test-secrete"), "jeton et clé absents de toutes les sorties");
ok(corps.length > 0 && corps.every((b) => /^\s*query\b/.test(JSON.parse(b).query)), `${corps.length} requêtes Sorare envoyées, toutes en lecture (query)`);

// 2. Sans jeton : « jeton absent », une seule requête Sorare (validation), aucune erreur fatale
corps.length = 0; sortieConsole = [];
const S2 = path.join(tmp, "sortie2");
const r2 = await executer({ env: { DUREE_MINUTES: "10", INTERVALLE_MINUTES: "5", DONNEES, SORTIE: S2 }, fetchFn: fauxFetch(true), ...horlogeSimulee("2026-11-02T23:30:00Z"),
  sortieConsole: (l) => sortieConsole.push(l), signaux: false });
ok(r2.jetonEtat === "absent" && corps.length === 1 && /JETON ABSENT/.test(sortieConsole.join("\n")) && r2.releves === 3, "sans jeton : « JETON ABSENT », 1 requête Sorare, 3 relevés sans planter");

// 3. Réseau en panne : erreurs notées, la nuit continue
const S3 = path.join(tmp, "sortie3");
const r3 = await executer({ env: { SORARE_JWT: SECRET, DUREE_MINUTES: "10", INTERVALLE_MINUTES: "5", DONNEES, SORTIE: S3 },
  fetchFn: async () => { throw new Error("réseau coupé"); }, ...horlogeSimulee("2026-11-02T23:30:00Z"), sortieConsole: () => {}, signaux: false });
ok(r3.releves === 3 && fs.existsSync(path.join(S3, "rapport.md")), "réseau en panne : 3 relevés quand même, compte rendu écrit");

// 4. Nuit simulée avec plan : vague 1 validée à 03h45 UTC (étape 2 CLAIMABLE), plan du palier 3 à 2 compos :
//    A (un Out -> remplacé ; le meilleur candidat dépasserait 16★) et B (un match déjà commencé à 03h40 -> refusée).
const D4 = path.join(tmp, "data4"); fs.mkdirSync(D4);
const ecris4 = (n, v) => fs.writeFileSync(path.join(D4, n + ".json"), JSON.stringify(v));
const J4 = { a1: ["Anton Un", "Boston Celtics", 3], a2: ["Arno Deux", "Miami Heat", 3], a3: ["Axel Absent", "Chicago Bulls", 3], a4: ["Aldo Quatre", "Utah Jazz", 3],
  a5: ["Abel Cinq", "Denver Nuggets", 4], r1: ["Remi Remplacant", "Phoenix Suns", 3], r2: ["Raoul Tropcher", "Brooklyn Nets", 4],
  b1: ["Basile Tot", "Orlando Magic", 3], b2: ["Boris Deux", "Atlanta Hawks", 3], b3: ["Bart Trois", "Detroit Pistons", 3], b4: ["Bob Quatre", "Indiana Pacers", 3], b5: ["Ben Cinq", "Sacramento Kings", 3],
  v1: ["Victor Vague", "Toronto Raptors", 3] };
const M4 = { a1: "04:10", a2: "04:10", a3: "04:10", a4: "04:10", a5: "04:10", r1: "04:30", r2: "04:30", b1: "03:40", b2: "04:10", b3: "04:10", b4: "04:10", b5: "04:10", v1: "01:00" };
ecris4("cartes", Object.entries(J4).map(([s, [n]]) => carte(s, n)));
ecris4("joueurs", Object.entries(J4).map(([s, [n, club, e]]) => ({ sport: "NBA", slug: s, joueur: n, club, etoiles: e })));
ecris4("matchs", Object.entries(M4).map(([s, hm]) => ({ sport: "NBA", slug: s, date: "2026-11-04T" + hm, proj: s === "r2" ? 50 : s === "r1" ? 30 : 40, proba: 100 })));
ecris4("resume", [{ maj_nba: "2026-11-03T05:00:00Z", arcade_nba_debut: "2026-11-03T00:00:00Z", arcade_nba_fin: "2026-11-06T06:00:00Z" }]);
const h4 = horlogeSimulee("2026-11-04T03:30:00Z");
const appJ = (s) => app(s, J4[s][0], J4[s][1], J4[s][2], "2026-11-04T01:00:00Z");
const plateau4 = () => { const valide = h4.horloge().getTime() >= Date.parse("2026-11-04T03:45:00Z"); return { id: "board1", title: "Divination", endDate: null, steps: [
  { id: "s1", level: 1, target: 150, state: "CLAIMED", myLineups: [] },
  { id: "s2", level: 2, target: 180, state: valide ? "CLAIMABLE" : "LIVE", myLineups: [{ __typename: "TaskLineup", id: "V1", aasmState: valide ? "SUCCESSFUL" : "READY", draft: false, cancelledAt: null, updatable: false,
    taskAppearances: [appJ("v1")] }] },
  { id: "s3", level: 3, target: 210, state: "LOCKED", myLineups: [] }] }; };
const corps4 = [];
const fetch4 = async (url, opts = {}) => {
  if (url.includes("espn.com")) return reponse({ injuries: [{ displayName: "Chicago Bulls", injuries: [{ athlete: { displayName: "Axel Absent" }, status: "Out", details: {} }] }] });
  corps4.push(opts.body);
  const { query } = JSON.parse(opts.body);
  if (query.includes("GardePlateau")) return reponse({ data: { currentUser: { slug: "elpredatooor", setBoard: plateau4() } } });
  if (query.includes("GardeBanc")) return reponse({ data: { currentUser: { step: { myFilteredBench: { pageInfo: { hasNextPage: false, endCursor: null },
    nodes: Object.keys(J4).filter((s) => s !== "v1").map((s) => ({ __typename: "ComposeTeamBenchCard", starCost: J4[s][2], anyPlayer: { slug: s, displayName: J4[s][0] }, anyCard: { slug: s + "-c" } })) } } } } });
  return reponse({ errors: [{ message: "requête inconnue" }] });
};
const PLAN = { nuit: "2026-11-03", cree: "2026-11-03T20:00:00Z", paliers: { "3": { cible: 210, pas_avant: "2026-11-04T03:30:00Z", compos: [
  { nom: "A", cartes: ["a1-c", "a2-c", "a3-c", "a4-c", "a5-c"], projection: 200, chance: 0.42, premier_match: "2026-11-04T04:10:00Z" },
  { nom: "B", cartes: ["b1-c", "b2-c", "b3-c", "b4-c", "b5-c"], projection: 195, chance: 38, premier_match: "2026-11-04T03:40:00Z" }] } } };
const { chiffrerPlan } = await import("./nuit-nba-commun.mjs");
const CLE4 = "cle-de-test-secrete-4";
const planChiffre = chiffrerPlan(JSON.stringify(PLAN), CLE4);
ok(planChiffre.startsWith("plan1:") && !planChiffre.includes("a1-c") && !planChiffre.includes("Anton"), "plan chiffré : aucun cardSlug ni nom lisible dans la variable");
const S4 = path.join(tmp, "sortie4"); const console4 = [];
const r4 = await executer({ env: { SORARE_JWT: SECRET, SORARE_API_KEY: CLE4, PLAN_NUIT_NBA: planChiffre, DUREE_MINUTES: "30", INTERVALLE_MINUTES: "5", DONNEES: D4, SORTIE: S4,
  GITHUB_STEP_SUMMARY: path.join(tmp, "resume4.md") }, fetchFn: fetch4, ...h4, sortieConsole: (l) => console4.push(l), signaux: false });
const rap4 = fs.readFileSync(path.join(S4, "rapport.md"), "utf8"), jour4 = fs.readFileSync(path.join(S4, "journal.txt"), "utf8"), res4 = fs.readFileSync(path.join(tmp, "resume4.md"), "utf8");
const rec = r4.recoltes.get(2);
ok(r4.planEtat === "chiffré" && r4.recoltes.size === 1 && rec?.heure === "2026-11-04T03:45:00.000Z", `récolte simulée du niveau 2 notée une fois, à 03h45 UTC (${r4.planEtat}, ${r4.recoltes.size}, ${rec?.heure})`);
ok((jour4.match(/Récolte simulée/g) || []).length === 1 && /aurait récolté le niveau 2 ; palier 3 : 1 compos du plan auraient été alignées, 1 refusées/.test(jour4), "journal : une seule ligne de récolte, avec les comptes");
const A = rec?.alignements.find((x) => x.nom === "A"), B = rec?.alignements.find((x) => x.nom === "B");
ok(A?.ok && A.remplacements?.length === 1 && A.remplacements[0].out === "Axel Absent" && A.remplacements[0].entrant === "Remi Remplacant",
  "compo A : joueur Out remplacé par le meilleur candidat valable (le 4★ à 50 dépasserait 16★)");
ok(A?.minutesAvant === 25 && A.cartesFinales.includes("Remi Remplacant") && !A.cartesFinales.includes("Axel Absent"), `compo A : 25 min avant le premier match (${A?.minutesAvant})`);
ok(B && !B.ok && /match déjà commencé/.test(B.raison), "compo B refusée : match déjà commencé");
ok(/aurait récolté le niveau 2/.test(rap4) && /Aurait aligné la compo A\*\* à 04h45/.test(rap4) && /Compo B refusée/.test(rap4) && /banc de l'étape 2/.test(rap4) && /chance 42 %/.test(rap4),
  "compte rendu : récolte, compo A alignée à 04h45 Bruxelles (chance 42 %), compo B refusée, banc de l'étape 2");
const noms4 = Object.values(J4).flatMap(([n]) => n.split(" "));
ok(!noms4.some((n) => jour4.includes(n) || res4.includes(n) || console4.join("\n").includes(n)) && !/-c\b/.test(jour4 + res4), "journal, console et résumé GitHub sans nom ni cardSlug");
ok(/récoltes simulées : niveau 2 ; compos du plan : 1 auraient été alignées, 1 refusées/.test(res4), "résumé GitHub : récolte et comptes du plan");
ok(corps4.every((b) => /^\s*query\b/.test(JSON.parse(b).query)), `${corps4.length} requêtes Sorare, toutes en lecture (query)`);
// Plan illisible / absent : récolte notée quand même
for (const [val, attendu] of [["plan1:AAAA", "illisible"], ["", "absent"], ["{pas du json", "illisible"]]) {
  const h = horlogeSimulee("2026-11-04T03:50:00Z"); Object.assign(h4, h);
  const S = path.join(tmp, "sortie4-" + attendu + val.length);
  const r = await executer({ env: { SORARE_JWT: SECRET, SORARE_API_KEY: CLE4, PLAN_NUIT_NBA: val, DUREE_MINUTES: "0", DONNEES: D4, SORTIE: S }, fetchFn: fetch4, ...h, sortieConsole: () => {}, signaux: false });
  const j = fs.readFileSync(path.join(S, "journal.txt"), "utf8");
  ok(r.planEtat === attendu && r.recoltes.get(2)?.planAbsent === "plan " + attendu && new RegExp("Plan de nuit : " + attendu).test(j), `plan « ${val || "(vide)"} » : ${attendu}, récolte notée sans alignement`);
}

if (!process.env.GARDER) fs.rmSync(tmp, { recursive: true, force: true });
console.log(ko ? `${ko} ECHEC(S)` : "OK");
process.exit(ko ? 1 : 0);
