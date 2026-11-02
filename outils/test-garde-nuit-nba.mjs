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

if (!process.env.GARDER) fs.rmSync(tmp, { recursive: true, force: true });
console.log(ko ? `${ko} ECHEC(S)` : "OK");
process.exit(ko ? 1 : 0);
