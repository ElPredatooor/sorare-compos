// Test hors ligne du jeu bilan (contrat v3) : l'API Sorare est simulée (aucun appel réseau, aucune clé).
// Monde simulé au 24/10/2026 12:00 UTC :
//   - NBA : gameweek nba-20-23-oct-2026 terminée et clôturée (paliers relevés par la collecte en cours),
//           nba-23-26-oct-2026 commencée mais pas finie, nba-26-30-oct-2026 à venir ;
//   - football : football-20-23-oct-2026 terminée mais pas clôturée (paliers pas encore relevés), football-13-17 clôturée.
// Collectes précédentes simulées (comme sorare-donnes/collectes/) :
//   A 2026-10-20_10h00 : avant les dates limites de nba-20-23 et football-20-23 -> source attendue du bilan ;
//   B 2026-10-20_21h00 : même gameweek, mais après la date limite -> doit être ignorée ;
//   C 2026-10-23_19h00 : nba-23-26 (pas finie) -> ignorée ; D 2026-10-16_09h00 : gameweek NBA plus ancienne, fenêtre inconnue -> ignorée.
// Usage : node outils/test-bilan.mjs
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const racine = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = new Date("2026-10-24T12:00:00Z");
const H = 3600e3, J = 24 * H;
const iso = (t) => new Date(t).toISOString();

// ---------- Monde simulé ----------
const NBA = { // slug: [equipe, tier, l10, scores (date ISO -> score)]
  "nikola-jokic": ["Nuggets", "GOAT", 59, { "2026-10-21T01:00:00Z": 50, "2026-10-22T02:00:00Z": 70, "2026-10-24T01:00:00Z": 90 }],
  "tyrese-maxey": ["76ers", "STAR", 41, { "2026-10-21T00:00:00Z": 40, "2026-10-22T23:30:00Z": 55 }],
  "josh-hart": ["Knicks", "IMPACT_PLUS", 36, { "2026-10-21T23:30:00Z": 34 }],
  "dean-wade": ["Cavaliers", "ROSTER", 16, { "2026-10-19T23:00:00Z": 25 }], // aucun match dans la fenêtre -> 0
  "luka-doncic": ["Lakers", "GOAT", 58, { "2026-10-21T02:00:00Z": 140 }],
  "og-anunoby": ["Knicks", "STAR", 40, { "2026-10-21T23:30:00Z": 60 }],
  "keldon-johnson": ["Spurs", "ROSTER", 22, { "2026-10-22T00:00:00Z": 30 }],
  "isaiah-joe": ["Thunder", "ROSTER", 21, { "2026-10-22T00:00:00Z": 20 }],
  "jrue-holiday": ["Trail Blazers", "IMPACT_PLUS", 34, { "2026-10-22T02:00:00Z": 10 }],
  "ayo-dosunmu": ["Bulls", "IMPACT", 31, { "2026-10-21T00:00:00Z": 45 }],
  "yves-missi": ["Pelicans", "ROSTER_PLUS", 26, { "2026-10-21T00:00:00Z": 40 }],
  "aaron-gordon": ["Nuggets", "IMPACT", 32, { "2026-10-22T02:00:00Z": 38 }],
  "james-harden": ["Clippers", "STAR", 40, { "2026-10-22T03:00:00Z": 36, "2026-10-20T03:00:00Z": 80 }], // 80 avant la fenêtre
  "cam-whitmore": ["Rockets", "ROSTER", 20, { "2026-10-21T01:00:00Z": 36 }],
};
const ANCIEN = { "ancien-joueur": ["Hornets", "ROSTER", 20, { "2026-10-21T23:00:00Z": 48 }] }; // carte vendue depuis : pas dans le portefeuille
const JPL = { // slug: [poste, club, so5Scores]
  koffi: ["Goalkeeper", "Charleroi", { "2026-10-21T18:00:00Z": 50 }],
  sylla: ["Defender", "Club Brugge", { "2026-10-22T19:00:00Z": 30 }],
  abid: ["Midfielder", "Genk", { "2026-10-21T18:00:00Z": 60 }],
  forbs: ["Forward", "Club Brugge", { "2026-10-22T19:00:00Z": 70, "2026-10-17T19:00:00Z": 95 }], // 95 : gameweek précédente
  nielsen: ["Midfielder", "Club Brugge", {}], // pas joué -> 0
};
const node = (slug) => {
  const n = NBA[slug] || ANCIEN[slug], f = JPL[slug];
  const club = (name) => ({ name, slug: name.toLowerCase().replace(/\W+/g, "-"), domesticLeague: f ? { name: "First Division A" } : null });
  if (n) {
    const pgs = Object.entries(n[3]).sort((a, b) => b[0].localeCompare(a[0])).map(([date, score]) => ({ score, anyGame: { date } }));
    while (pgs.length < 5) pgs.push({ score: n[2], anyGame: { date: iso(NOW.getTime() - (20 + pgs.length) * J) } });
    return { slug, gameplayTier: n[1], activeClub: club(n[0]), l5: n[2], l15: n[2], l10: n[2], activeInjuries: [], playerGameScores: pgs, gainOnProjection: 1 };
  }
  if (f) {
    const s5 = Object.entries(f[2]).sort((a, b) => b[0].localeCompare(a[0])).map(([date, score]) => ({ score, decisiveScore: { totalScore: 20 }, game: { date } }));
    while (s5.length < 5) s5.push({ score: 45, decisiveScore: { totalScore: 20 }, game: { date: iso(NOW.getTime() - (20 + s5.length) * J) } });
    return { slug, gameplayTier: null, activeClub: club(f[1]), l5: 50, l15: 48, l10: null, activeInjuries: [], position: f[0], playingStatus: "STARTER", activeSuspensions: [],
      playerGameScores: s5.map((g) => ({ score: g.score, anyGame: { date: g.game.date }, anyPlayerGameStats: { minsPlayed: 80 } })), so5Scores: s5 };
  }
  return null;
};
const cards = [
  ...Object.keys(NBA).map((s) => ({ slug: s + "-limited-1", rarityTyped: "limited", sport: "NBA", seasonYear: 2025, inSeasonEligible: false, power: "1.05", cardSet: null, skinEdition: null, powerBreakdown: {}, anyPlayer: { slug: s, displayName: s } })),
  ...Object.keys(JPL).map((s) => ({ slug: s + "-limited-1", rarityTyped: "limited", sport: "FOOTBALL", seasonYear: 2026, inSeasonEligible: true, power: "1.08", cardSet: null, skinEdition: null, powerBreakdown: {}, anyPlayer: { slug: s, displayName: s } })),
];
const FX = {
  NBA: [{ slug: "nba-26-30-oct-2026", aasmState: "opened", startDate: "2026-10-26T23:00:00Z", endDate: "2026-10-30T05:00:00Z" },
        { slug: "nba-23-26-oct-2026", aasmState: "started", startDate: "2026-10-23T20:00:00Z", endDate: "2026-10-26T04:00:00Z" },
        { slug: "nba-20-23-oct-2026", aasmState: "closed", startDate: "2026-10-20T19:00:00Z", endDate: "2026-10-23T05:55:00Z" }],
  FOOTBALL: [{ slug: "football-27-30-oct-2026", aasmState: "opened", startDate: "2026-10-27T15:00:00Z", endDate: "2026-10-30T22:00:00Z" },
             { slug: "football-20-23-oct-2026", aasmState: "started", startDate: "2026-10-20T16:00:00Z", endDate: "2026-10-23T22:00:00Z" },
             { slug: "football-13-17-oct-2026", aasmState: "closed", startDate: "2026-10-13T16:00:00Z", endDate: "2026-10-17T22:00:00Z" }],
};
const upcoming = (sport) => ({ ...FX[sport][0], cutOffDate: FX[sport][0].startDate, gameWeek: 1,
  so5Leaderboards: sport === "NBA"
    ? ["nba_limited_champion", "nba_limited_arena_140"].map((x) => ({ slug: FX.NBA[0].slug + "-" + x, displayName: x, mainRarityType: "limited", teamsCap: /arena/.test(x) ? null : 3, format: null }))
    : [{ slug: FX.FOOTBALL[0].slug + "-seasonal-jupiler-in_season_jupiler_limited", displayName: "Limited", mainRarityType: "limited", teamsCap: 4, format: { title: "In-Season" } }] });
const rules = (slug) => { const d = (key, t) => ({ key, descriptions: [{ title: t, items: [] }] });
  return /jupiler/.test(slug) ? [d("CaptainScarcity", "Capitaine +50%"), d("SeasonBonus", "Min 4 cartes In-Season")] : [d("SameActiveClub", "Max 4 joueurs"), d("AverageScores", "Cap de 16 étoiles")]; };
const futureGames = (s) => [{ id: s, date: iso(NOW.getTime() + 3 * J), competition: { name: NBA[s] ? "NBA" : "First Division A" }, homeTeam: { slug: "x", name: "X" }, awayTeam: { slug: "y", name: "Y" },
  homeStats: null, awayStats: null, playerGameScore: { projectedScore: 40, projection: { grade: "B", reliabilityBasisPoints: 6000 }, anyPlayerGameStats: null } }];
// Paliers de la collecte en cours : NBA nba-20-23 (classement Classic Champion, salons Rooms), football football-13-17
const boards = (fx) => fx.startsWith("nba")
  ? [{ slug: fx + "-nba_limited_champion", so5LineupsCount: 3000 }, { slug: fx + "-nba_limited_arena_140", so5LineupsCount: 0 }, ...[1, 2, 3].map((k) => ({ slug: fx + "-nba_limited_arena_140-salon-" + k, so5LineupsCount: 10 }))]
  : [{ slug: fx + "-seasonal-jupiler-in_season_jupiler_limited", so5LineupsCount: 2000 }];
const shard = (q) => ({ __typename: "CardShardRewardConfig", quantity: q, configRarity: "limited" });
const rewards = (slug) => /-salon-/.test(slug) ? [500, 300, 225, 175, 150].map((q) => ({ ranks: 1, rankPct: null, rewardConfigs: [shard(q)] }))
  : [{ ranks: 1, rewardConfigs: [{ __typename: "MonetaryRewardConfig", amount: { usdCents: 100000 } }] }, { ranks: 99, rewardConfigs: [shard(1000)] }, { ranks: null, rankPct: 10, rewardConfigs: [{ __typename: "InGameCurrencyRewardConfig", currency: "LIMITED_XP", amount: 500 }] }];
const RANG = { nba: { 1: 300, 100: 250, 400: 200 }, football: { 1: 410, 100: 330, 300: 280 } };

let appels = 0; const requetes = [];
async function fetchSimule(url, opts = {}) {
  appels++;
  if (!String(url).includes("api.sorare.com")) throw new Error("appel réseau inattendu : " + url);
  const { query, variables: v = {} } = JSON.parse(opts.body);
  requetes.push(query);
  let data;
  if (query.includes("user(slug")) data = { user: { cards: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: cards } } };
  else if (query.includes("so5Fixture(type:UPCOMING")) data = { so5: { so5Fixture: upcoming(v.sport) } };
  else if (query.includes("displayedTypedRules")) data = { so5: { so5Leaderboard: { slug: v.s, displayedTypedRules: rules(v.s) } } };
  else if (query.includes("players(slugs")) data = { players: v.s.map(node) };
  else if (query.includes("anyFutureGames")) data = { anyPlayer: { slug: v.slug, anyFutureGames: { nodes: futureGames(v.slug) } } };
  else if (query.includes("so5Fixtures(")) data = { so5: { so5Fixtures: { nodes: FX[v.sport] } } };
  else if (query.includes("so5Fixture(slug")) data = { so5: { so5Fixture: { so5Leaderboards: boards(v.s) } } };
  else if (query.includes("rewardsConfig")) data = { so5: { so5Leaderboard: { rewardsConfig: { ranking: rewards(v.s) } } } };
  else if (query.includes("so5Rankings")) {
    if (/first:5/.test(query)) data = { so5: { so5Leaderboard: { so5Rankings: { nodes: [217, 200, 190, 180, 176].map((score) => ({ score })) } } } };
    else { const rang = v.a ? Number(Buffer.from(v.a, "base64").toString()) + 1 : 1; data = { so5: { so5Leaderboard: { so5Rankings: { nodes: [{ score: RANG[v.s.startsWith("nba") ? "nba" : "football"][rang] }] } } } }; }
  } else throw new Error("requête non simulée : " + query.slice(0, 120));
  return { ok: true, status: 200, text: async () => JSON.stringify({ data }), json: async () => ({ data }) };
}

// ---------- Collectes précédentes simulées ----------
const L = (competition, sport, numero, joueur, slug, bonus, score_final, capitaine = "") => ({ competition, sport, numero, slot: "x", joueur, slug, carte_id: slug + "-limited-1", carte: "Limited", capitaine, score_attendu: score_final, bonus, score_final });
const CC = "NBA Classic Champion", RC = "NBA Rooms Champion", JI = "Jupiler Limited (In-Season)"; // nom construit par collecte.mjs : "Jupiler " + displayName + " (format)"
const composA = [
  L(CC, "NBA", 1, "Nikola Jokić", "nikola-jokic", 5, 60), L(CC, "NBA", 1, "Tyrese Maxey", "tyrese-maxey", 4, 45), L(CC, "NBA", 1, "Josh Hart", "josh-hart", 3, 38),
  L(CC, "NBA", 1, "Ancien Joueur", "ancien-joueur", 2, 30), L(CC, "NBA", 1, "Dean Wade", "dean-wade", 6, 20),
  L(CC, "NBA", 2, "Luka Dončić", "luka-doncic", 5, 55), L(CC, "NBA", 2, "OG Anunoby", "og-anunoby", 4, 40), L(CC, "NBA", 2, "Keldon Johnson", "keldon-johnson", 3, 25),
  L(CC, "NBA", 2, "Isaiah Joe", "isaiah-joe", 2, 20), L(CC, "NBA", 2, "Jrue Holiday", "jrue-holiday", 0, 10),
  ...[["Ayo Dosunmu", "ayo-dosunmu", 40], ["Yves Missi", "yves-missi", 30], ["Aaron Gordon", "aaron-gordon", 35], ["James Harden", "james-harden", 30], ["Cam Whitmore", "cam-whitmore", 25]].map(([j, s, v]) => L(RC, "NBA", 1, j, s, 0, v)),
  L(JI, "Football", 1, "Koffi", "koffi", 8, 40), L(JI, "Football", 1, "Sylla", "sylla", 8, 35), L(JI, "Football", 1, "Abid", "abid", 8, 45),
  L(JI, "Football", 1, "Forbs", "forbs", 8, 81, "Oui"), L(JI, "Football", 1, "Nielsen", "nielsen", 8, 30),
];
const compsA = [{ competition: CC, sport: "NBA", scores_compos: "193 150", capitaine_pct: 0 }, { competition: RC, sport: "NBA", scores_compos: "160", capitaine_pct: 0 },
  { competition: JI, sport: "Football", scores_compos: "231", contraintes: "min 4 cartes In-Season, capitaine +50 %" }]; // pas de capitaine_pct : lu dans le texte
const palA = [ // paliers connus au moment de la collecte A (gameweeks précédentes) : servent à palier_vise
  ...[[1, 290, "1000 $"], [100, 240, "1000 essences Limited"], [400, 190, "500 XP Limited"]].map(([rang, score, recompense]) => ({ sport: "NBA", competition: CC, gw_reference: "nba-16-20-oct-2026", type: "classement", rang, score, recompense })),
  ...[[1, 215, 500], [2, 198, 300], [3, 185, 225], [4, 175, 175], [5, 160, 150]].map(([rang, score, q]) => ({ sport: "NBA", competition: RC, gw_reference: "nba-16-20-oct-2026 (médiane de 3 salons)", type: "salon", rang, score, recompense: q + " essences Limited" })),
  ...[[1, 400, "1000 $"], [600, 300, "500 essences Limited"], [1500, 250, "250 essences Limited"]].map(([rang, score, recompense]) => ({ sport: "Football", competition: JI, gw_reference: "football-6-9-oct-2026", type: "classement", rang, score, recompense })),
];
const R = (maj, gw_nba, limite_nba, gw_football, limite_football) => [{ maj, gw_nba, limite_nba, gw_football, limite_football }];
const leurre = (gw, sport) => [L(sport === "NBA" ? CC : JI, sport, 1, "Leurre", "nikola-jokic", 0, 999)];
const dossiers = [
  { dossier: "2026-10-16_09h00", resume: R("2026-10-16T07:00:00Z", "nba-16-20-oct-2026", "2026-10-16T19:00:00Z", "football-13-17-oct-2026", "2026-10-13T16:00:00Z"), compos: leurre("x", "NBA"), competitions: [], paliers: [] },
  { dossier: "2026-10-20_10h00", resume: R("2026-10-20T08:00:00Z", "nba-20-23-oct-2026", "2026-10-20T19:00:00Z", "football-20-23-oct-2026", "2026-10-20T16:00:00Z"), compos: composA, competitions: compsA, paliers: palA },
  { dossier: "2026-10-20_21h00", resume: R("2026-10-20T19:30:00Z", "nba-20-23-oct-2026", "2026-10-20T19:00:00Z", "football-20-23-oct-2026", "2026-10-20T16:00:00Z"), compos: [...leurre("x", "NBA"), ...leurre("x", "Football")], competitions: [], paliers: [] },
  { dossier: "2026-10-23_19h00", resume: R("2026-10-23T17:00:00Z", "nba-23-26-oct-2026", "2026-10-23T20:00:00Z", "football-27-30-oct-2026", "2026-10-27T15:00:00Z"), compos: leurre("x", "NBA"), competitions: [], paliers: [] },
];

// ---------- Exécutions ----------
const vraiTimeout = globalThis.setTimeout;
globalThis.setTimeout = (f) => vraiTimeout(f, 0);
globalThis.fetch = fetchSimule;
const { collect } = await import(pathToFileURL(join(racine, "sorare-compos", "core.mjs")).href);
const { candidatsBilan } = await import(pathToFileURL(join(racine, "sorare-compos", "collecte.mjs")).href);
const opts = (extra) => ({ apiKey: "cle-de-test", oddsKey: null, espn: false, prev: null, history: { samples: [], calibration: [] }, now: NOW, log: () => {}, ...extra });
const choisis = (now) => { const noms = candidatsBilan(dossiers, now).map((x) => x.dossier); return dossiers.filter((d) => noms.includes(d.dossier)); };

appels = 0; const sans = await collect(opts({})); const appelsSans = appels;
appels = 0; requetes.length = 0; const avec = await collect(opts({ compsPrecedentes: choisis(NOW) })); const appelsAvec = appels;
const bqAvec = requetes.filter((q) => q.includes("players(slugs") && !q.includes("gameplayTier")).length;
const avant = await collect(opts({ now: new Date("2026-10-22T12:00:00Z"), compsPrecedentes: choisis(new Date("2026-10-22T12:00:00Z")) }));
globalThis.setTimeout = vraiTimeout;

// ---------- Contrôles ----------
const erreurs = [];
const ok = (cond, msg) => { if (!cond) erreurs.push(msg); };
const eq = (a, b, msg) => ok(JSON.stringify(a) === JSON.stringify(b), `${msg} : attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`);
eq(candidatsBilan(dossiers, NOW).map((x) => x.dossier).sort(), ["2026-10-16_09h00", "2026-10-20_10h00", "2026-10-23_19h00"], "candidatsBilan (B, faite après la date limite, doit être écartée)");
const b = avec.files.bilan;
ok(Array.isArray(sans.files.bilan) && sans.files.bilan.length === 0, "sans compsPrecedentes, bilan doit être []");
ok(Array.isArray(avant.files.bilan) && avant.files.bilan.length === 0, "aucune gameweek proposée terminée (22/10) : bilan doit être []");
eq(appelsAvec - appelsSans, 1, "appels en plus pour le bilan (un lot players(slugs:) pour le joueur hors portefeuille)");
eq(bqAvec, 1, "requêtes de scores pour les joueurs hors portefeuille");
eq(b.length, 4, "nombre de lignes du bilan (Classic Champion 1 et 2, Rooms 1, Jupiler 1)");
const COLS = ["sport", "gw", "competition", "numero", "score_prevu", "score_reel", "ecart", "palier_vise", "palier_atteint", "joueurs", "source_compos"];
for (const r of b) eq(Object.keys(r), COLS, "colonnes du bilan (contrat v3)");
const ligne = (c, n) => b.find((r) => r.competition === c && r.numero === n) || {};
const attendu = [
  // NBA Classic Champion 1 : 70×1,05 + 55×1,04 + 34×1,03 + 48×1,02 (hors portefeuille) + 0 (Wade, pas de match dans la fenêtre) = 214,68
  [CC, 1, { sport: "NBA", gw: "nba-20-23-oct-2026", score_prevu: 193, score_reel: 214.7, ecart: 21.7, palier_vise: "top 400 : 500 XP Limited", palier_atteint: "top 400 : 500 XP Limited", source_compos: "2026-10-20_10h00" }],
  // NBA Classic Champion 2 : 140×1,05 + 60×1,04 + 30×1,03 + 20×1,02 + 10 = 270,7
  [CC, 2, { score_prevu: 150, score_reel: 270.7, ecart: 120.7, palier_vise: "aucun palier", palier_atteint: "top 100 : 1000 essences Limited" }],
  // NBA Rooms : 45 + 40 + 38 + 36 (Harden : 80 avant la fenêtre ignoré) + 36 = 195 ; salons 217/200/190/180/176
  [RC, 1, { score_prevu: 160, score_reel: 195, ecart: 35, palier_vise: "5e du salon : 150 essences Limited", palier_atteint: "3e du salon : 225 essences Limited" }],
  // Jupiler : 50×1,08 + 30×1,08 + 60×1,08 + 70×1,08×1,5 (capitaine, 95 de la gameweek précédente ignoré) + 0 = 264,6 ; paliers football-20-23 pas relevés
  [JI, 1, { sport: "Football", gw: "football-20-23-oct-2026", score_prevu: 231, score_reel: 264.6, ecart: 33.6, palier_vise: "aucun palier", palier_atteint: null }],
];
for (const [c, n, att] of attendu) { const r = ligne(c, n); for (const [k, v] of Object.entries(att)) eq(r[k], v, `${c} compo ${n}, ${k}`); }
eq(ligne(CC, 1).joueurs, "Nikola Jokić 60→73,5 ; Tyrese Maxey 45→57,2 ; Josh Hart 38→35 ; Ancien Joueur 30→49 ; Dean Wade 20→0", "détail des joueurs NBA");
ok(/^Forbs \(C\) 81→113,4$/.test(ligne(JI, 1).joueurs.split(" ; ")[3] || ""), "capitaine football mal noté : " + ligne(JI, 1).joueurs);
ok(!b.some((r) => r.score_prevu === 999), "une compo leurre (collecte après la date limite ou gameweek non finie) a été prise");
for (const r of b) ok(r.sport === (r.competition.startsWith("NBA") ? "NBA" : "Football"), "sport mélangé dans le bilan : " + r.competition);
// resume v3 : fenêtres des gameweeks à venir
const res = avec.files.resume[0];
eq([res.gw_debut_football, res.gw_fin_football, res.gw_debut_nba, res.gw_fin_nba], [FX.FOOTBALL[0].startDate, FX.FOOTBALL[0].endDate, FX.NBA[0].startDate, FX.NBA[0].endDate], "resume : gw_debut_* / gw_fin_*");

console.log(`Test du bilan : ${appelsSans} appels simulés sans bilan, ${appelsAvec} avec (+${appelsAvec - appelsSans}), ${b.length} lignes de bilan.`);
for (const r of b) console.log(`  ${r.sport} ${r.competition} compo ${r.numero} (${r.gw}) : ${r.score_prevu} → ${r.score_reel} (${r.ecart >= 0 ? "+" : ""}${r.ecart}) ; visé ${r.palier_vise ?? "—"} ; atteint ${r.palier_atteint ?? "—"}`);
if (erreurs.length) { console.error("ÉCHEC :\n  - " + erreurs.join("\n  - ")); process.exit(1); }
console.log("OK : bilan conforme (source avant la date limite, meilleur match NBA, capitaine football, paliers, joueur hors portefeuille).");
