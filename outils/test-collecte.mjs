// Test hors ligne de la collecte : l'API Sorare est simulée (aucun appel réseau, aucune clé).
// 1. lance collect() depuis les modules (sorare-compos/core.mjs) ;
// 2. lance la même collecte depuis le fichier généré sorare-compos/collecteur-navigateur.js ;
// 3. vérifie que les deux sorties sont identiques et contrôle quelques règles (football et NBA séparés).
// Usage : node outils/test-collecte.mjs [--sortie <dossier>] [--modules] [--arcade]
//   --arcade affiche le plan Arcade calculé sur le monde simulé
//   --sortie écrit les jeux simulés pour outils/verifier.mjs
//   --modules ne teste que les modules (saute la comparaison avec collecteur-navigateur.js, utile avant de régénérer le bundle)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import vm from "node:vm";

const racine = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const NOW = new Date("2026-10-26T08:00:00Z");
const H = 3600e3, J = 24 * H;
const iso = (t) => new Date(t).toISOString();

// ---------- Portefeuille et monde simulés ----------
const h = (s) => [...s].reduce((a, c) => (a * 31 + c.charCodeAt(0)) >>> 0, 7);
const round2 = (x) => Math.round(x * 100) / 100;
// empreinte du plan Arcade du monde simulé ci-dessous, relevée le 25/10/2026 avec le code d'avant planPiste (sortie --arcade identique)
const EMPREINTE_ARCADE = 3115012936;
const NBA = [ // slug, equipe, tier, l10, carteInSeason
  ["ayo-dosunmu", "Bulls", "IMPACT", 31, true], ["yves-missi", "Pelicans", "ROSTER_PLUS", 26, true],
  ["jrue-holiday", "Trail Blazers", "IMPACT_PLUS", 34, true], ["aaron-gordon", "Nuggets", "IMPACT", 32, true],
  ["nikola-jokic", "Nuggets", "GOAT", 59, false], ["tyrese-maxey", "76ers", "STAR", 41, false],
  ["josh-hart", "Knicks", "IMPACT_PLUS", 36, false], ["keldon-johnson", "Spurs", "ROSTER", 22, false],
  ["isaiah-joe", "Thunder", "ROSTER", 21, false], ["dean-wade", "Cavaliers", "DNP_PLUS", 16, false],
  ["luka-doncic", "Lakers", "GOAT", 58, false], ["og-anunoby", "Knicks", "STAR", 40, false],
];
const JPL = [ // slug, poste, club
  ["koffi", "Goalkeeper", "Charleroi"], ["sylla", "Defender", "Club Brugge"], ["burgess", "Defender", "Union SG"],
  ["abid", "Midfielder", "Genk"], ["forbs", "Forward", "Club Brugge"], ["nielsen", "Midfielder", "Club Brugge"],
];
const SET = [["raya", "Goalkeeper"], ["chabot", "Defender"], ["anton", "Defender"], ["pavlovic", "Midfielder"], ["vicente", "Forward"], ["schick", "Forward"]];
const club = (n) => ({ name: n, slug: n.toLowerCase().replace(/\W+/g, "-"), domesticLeague: { name: "x" } });
const players = new Map();
for (const [s, eq, tier, l10] of NBA) players.set(s, { sport: "NBA", slug: s, gameplayTier: tier, activeClub: { name: eq, slug: eq.toLowerCase().replace(/\W+/g, "-"), domesticLeague: null }, l5: l10 + 2, l15: l10 - 1, l10, gain: (h(s) % 9) - 3 });
for (const [s, pos, c] of JPL) players.set(s, { sport: "FOOTBALL", slug: s, position: pos, activeClub: { ...club(c), domesticLeague: { name: "First Division A" } }, l5: 45 + (h(s) % 20), l15: 40 + (h(s) % 15) });
for (const [s, pos] of SET) players.set(s, { sport: "FOOTBALL", slug: s, position: pos, activeClub: { ...club("Club " + s), domesticLeague: { name: "Bundesliga" } }, l5: 50 + (h(s) % 15), l15: 48 + (h(s) % 12) });

const cards = [];
for (const [s, , , , ins] of NBA) cards.push({ slug: s + "-limited-1", rarityTyped: "limited", sport: "NBA", seasonYear: ins ? 2026 : 2024, inSeasonEligible: ins, power: (1.03 + (h(s) % 8) / 100).toFixed(2), cardSet: null, skinEdition: null, powerBreakdown: {}, anyPlayer: { slug: s, displayName: s } });
cards.push({ slug: "nikola-jokic-limited-2", rarityTyped: "limited", sport: "NBA", seasonYear: 2025, inSeasonEligible: false, power: "1.05", cardSet: null, skinEdition: null, powerBreakdown: {}, anyPlayer: { slug: "nikola-jokic", displayName: "nikola-jokic" } });
for (const [s] of JPL) cards.push({ slug: s + "-limited-1", rarityTyped: "limited", sport: "FOOTBALL", seasonYear: s === "forbs" ? 2024 : 2026, inSeasonEligible: s !== "forbs", power: "1.08", cardSet: null, skinEdition: null, powerBreakdown: {}, anyPlayer: { slug: s, displayName: s } });
for (const [s] of SET) cards.push({ slug: s + "-common-1", rarityTyped: "common", sport: "FOOTBALL", seasonYear: 2026, inSeasonEligible: true, power: "1.04", cardSet: { slug: "glitch", name: "HyperGlitch" }, skinEdition: s === "chabot" ? { skin: "HOLO", bonus: "1.1" } : null, powerBreakdown: {}, anyPlayer: { slug: s, displayName: s } });

const FX = { FOOTBALL: "football-27-30-oct-2026", NBA: "nba-26-30-oct-2026" };
const fixture = (sport) => ({
  slug: FX[sport], cutOffDate: iso(NOW.getTime() + 10 * H), startDate: iso(NOW.getTime() + 10 * H), endDate: iso(NOW.getTime() + 4 * J), gameWeek: 1,
  so5Leaderboards: sport === "FOOTBALL"
    ? [{ slug: FX.FOOTBALL + "-seasonal-jupiler-in_season_jupiler_limited", displayName: "Jupiler Pro League – Limited", mainRarityType: "limited", teamsCap: 4, format: { title: "In-Season" } }]
    : ["nba_limited_in_season_champion", "nba_limited_in_season_contender", "nba_limited_champion", "nba_limited_contender", "nba_limited_arena_140"].map((x) => ({ slug: FX.NBA + "-" + x, displayName: x, mainRarityType: "limited", teamsCap: /arena/.test(x) ? null : 3, format: null })),
});
const rules = (slug) => {
  const d = (key, t) => ({ key, descriptions: [{ title: t, items: [] }] });
  if (/jupiler/.test(slug)) return [d("CaptainScarcity", "Capitaine Score de la carte augmenté de 50%"), d("SeasonBonus", "Min 4 cartes In-Season")];
  const cap = /contender/.test(slug) ? 11 : 16;
  return [d("SameActiveClub", "Max 4 joueurs de chaque équipe dans ta compo"), d("AverageScores", `Cap de ${cap} étoiles`), ...(/in_season/.test(slug) ? [d("SeasonBonus", "Min 4 cartes In-Season")] : [])];
};
const scores = (p) => Array.from({ length: 10 }, (_, i) => ({ score: Math.max(0, (p.l15 || 30) + ((h(p.slug + i) % 21) - 10)), anyGame: { date: iso(NOW.getTime() - (10 - i) * 2 * J) }, anyPlayerGameStats: p.sport === "NBA" ? null : { minsPlayed: 80 } }));
const playerNode = (s) => { const p = players.get(s); if (!p) return null; return {
  slug: s, gameplayTier: p.gameplayTier || null, activeClub: p.activeClub, l5: p.l5, l15: p.l15, l10: p.l10 ?? null, activeInjuries: s === "dean-wade" ? [{ status: "out", kind: "knee", expectedEndDate: iso(NOW.getTime() + 9 * J) }] : [],
  position: p.position || null, playingStatus: p.sport === "NBA" ? null : (s === "nielsen" ? "SUBSTITUTE" : "STARTER"), activeSuspensions: [],
  playerGameScores: scores(p), so5Scores: p.sport === "NBA" ? null : scores(p).map((g) => ({ score: g.score, decisiveScore: { totalScore: 40 }, game: { date: g.anyGame.date } })), gainOnProjection: p.gain ?? null }; };
const futureGames = (s) => { const p = players.get(s); const n = p.sport === "NBA" ? 2 + (h(s) % 3) : 1;
  return Array.from({ length: n }, (_, i) => { const t = NOW.getTime() + 12 * H + i * (p.sport === "NBA" ? 26 * H : 3 * J); const opp = { slug: "adv-" + (h(s + i) % 9), name: "Adversaire " + (h(s + i) % 9) };
    return { id: s + i, date: iso(t), competition: { name: p.sport === "NBA" ? "NBA" : p.activeClub.domesticLeague.name }, homeTeam: i % 2 ? opp : { slug: p.activeClub.slug, name: p.activeClub.name }, awayTeam: i % 2 ? { slug: p.activeClub.slug, name: p.activeClub.name } : opp,
      homeStats: p.sport === "NBA" ? null : { winOddsBasisPoints: 4500 }, awayStats: p.sport === "NBA" ? null : { winOddsBasisPoints: 3000 },
      playerGameScore: { projectedScore: (p.l10 || p.l15) + (h(s) % 7), projection: { grade: "B", reliabilityBasisPoints: 6000 }, anyPlayerGameStats: p.sport === "NBA" ? null : { footballPlayingStatusOdds: { starterOddsBasisPoints: s === "nielsen" ? 3000 : 8500, reliability: "HIGH" } } } }; }); };
// Gameweeks terminees et classements pour les paliers
const CLOSED = { FOOTBALL: "football-20-23-oct-2026", NBA: "nba-20-23-oct-2026" };
const closedBoards = (fx) => fx.startsWith("nba")
  ? [...["nba_limited_in_season_champion", "nba_limited_in_season_contender", "nba_limited_champion", "nba_limited_contender"].map((x) => ({ slug: fx + "-" + x, so5LineupsCount: 3000 })),
     { slug: fx + "-nba_limited_arena_140", so5LineupsCount: 0 }, ...[1, 2, 3].map((k) => ({ slug: fx + "-nba_limited_arena_140-salon-" + k, so5LineupsCount: 10 }))]
  : [{ slug: fx + "-seasonal-jupiler-in_season_jupiler_limited", so5LineupsCount: 2000 }];
const rewards = (slug) => /-salon-/.test(slug)
  ? [500, 300, 225, 175, 150].map((q) => ({ ranks: 1, rankPct: null, rewardConfigs: [{ __typename: "CardShardRewardConfig", quantity: q, configRarity: "limited" }] }))
  : [{ ranks: 1, rankPct: null, rewardConfigs: [{ __typename: "MonetaryRewardConfig", amount: { usdCents: 100000 } }] }, { ranks: 99, rankPct: null, rewardConfigs: [{ __typename: "CardShardRewardConfig", quantity: 1000, configRarity: "limited" }] }, { ranks: null, rankPct: 10, rewardConfigs: [{ __typename: "InGameCurrencyRewardConfig", currency: "LIMITED_XP", amount: 500 }] }];

let appels = 0;
async function fetchSimule(url, opts = {}) {
  appels++;
  if (!String(url).includes("api.sorare.com")) throw new Error("appel réseau inattendu : " + url);
  const { query, variables: v = {} } = JSON.parse(opts.body);
  let data;
  if (query.includes("user(slug")) data = { user: { cards: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: cards } } };
  else if (query.includes("so5Fixture(type:UPCOMING")) data = { so5: { so5Fixture: fixture(v.sport) } };
  else if (query.includes("displayedTypedRules")) data = { so5: { so5Leaderboard: { slug: v.s, displayedTypedRules: rules(v.s) } } };
  else if (query.includes("players(slugs")) data = { players: v.s.map(playerNode) };
  else if (query.includes("anyFutureGames")) data = { anyPlayer: { slug: v.slug, anyFutureGames: { nodes: futureGames(v.slug) } } };
  else if (query.includes("so5Fixtures(")) data = { so5: { so5Fixtures: { nodes: [{ slug: "x-ouverte", aasmState: "opened" }, { slug: CLOSED[v.sport], aasmState: "closed" }] } } };
  else if (query.includes("so5Fixture(slug")) data = { so5: { so5Fixture: { so5Leaderboards: closedBoards(v.s) } } };
  else if (query.includes("rewardsConfig")) data = { so5: { so5Leaderboard: { rewardsConfig: { ranking: rewards(v.s) } } } };
  else if (query.includes("so5Rankings")) {
    const rang = v.a ? Number(Buffer.from(v.a, "base64").toString()) + 1 : 1;
    const n = /first:5/.test(query) ? 5 : 1;
    data = { so5: { so5Leaderboard: { so5Rankings: { nodes: Array.from({ length: n }, (_, i) => ({ ranking: rang + i, score: Math.round((320 - 15 * Math.log(rang + i) - (h(v.s) % 10)) * 100) / 100 })) } } } };
  } else throw new Error("requête non simulée : " + query.slice(0, 120));
  return { ok: true, status: 200, text: async () => JSON.stringify({ data }), json: async () => ({ data }) };
}

// ---------- Exécutions ----------
const opts = () => ({ apiKey: "cle-de-test", oddsKey: null, espn: false, prev: null, history: { samples: [], calibration: [] }, now: NOW, log: () => {} });
const vraiTimeout = globalThis.setTimeout;
globalThis.setTimeout = (f) => vraiTimeout(f, 0); // pas d'attente entre les appels simulés
globalThis.fetch = fetchSimule;
const { collect } = await import(pathToFileURL(join(racine, "sorare-compos", "core.mjs")).href);
const a = await collect(opts());
const appelsModules = appels; appels = 0;

const MODULES = process.argv.includes("--modules");
let b = null;
if (!MODULES) {
const code = await readFile(join(racine, "sorare-compos", "collecteur-navigateur.js"), "utf8");
const fenetre = {};
const ctx = vm.createContext({ window: fenetre, fetch: fetchSimule, setTimeout: globalThis.setTimeout, console, btoa: (s) => Buffer.from(s).toString("base64"), localStorage: { getItem: () => null }, URLSearchParams, Date, Math, JSON, Promise, Map, Set, Array, Object, Number, String, Boolean, RegExp, Error, encodeURIComponent, Intl });
new vm.Script(code).runInContext(ctx);
if (typeof fenetre.SXCOLLECT !== "function") throw new Error("le collecteur navigateur n'expose pas window.SXCOLLECT");
b = JSON.parse(JSON.stringify(await fenetre.SXCOLLECT(opts())));
}
globalThis.setTimeout = vraiTimeout;

// ---------- Contrôles ----------
const erreurs = [];
const ok = (cond, msg) => { if (!cond) erreurs.push(msg); };
if (!MODULES) {
  const ja = JSON.stringify(a), jb = JSON.stringify(b);
  ok(ja === jb, "les modules et le collecteur navigateur ne donnent pas le même résultat : régénérer avec « node outils/bundle-navigateur.mjs »");
  ok(appelsModules === appels, `nombre d'appels API différent (modules ${appelsModules}, navigateur ${appels})`);
}
const f = a.files;
for (const k of ["joueurs", "compos", "competitions", "jours", "changements", "calibration", "resume", "cartes", "matchs", "paliers"]) ok(Array.isArray(f[k]), "jeu manquant : " + k);
const compsNba = f.competitions.filter((c) => c.sport === "NBA").sort((x, y) => x.rang - y.rang);
ok(compsNba[0] && compsNba[0].competition === "NBA In-Season Champion", "NBA : In-Season Champion doit être la priorité 1, trouvé : " + (compsNba[0] || {}).competition);
// Option sans In-Season retenue par evalueRentabilite (choix de l'utilisateur du 25/10/2026) : In-Season à 0 compo, statut explicite
const sansIS = /^non recommandé cette semaine : /.test(compsNba[0]?.statut || "");
ok(sansIS || f.compos.some((l) => l.competition === "NBA In-Season Champion"), "NBA : aucune compo In-Season Champion alors que 4 cartes In-Season sont disponibles");
ok(!sansIS || (!f.compos.some((l) => l.competition === "NBA In-Season Champion") && compsNba[0].recommandation && compsNba[0].alternative), "NBA : option sans In-Season incohérente (compo présente ou recommandation / alternative vide)");
const isc = f.compos.filter((l) => l.competition === "NBA In-Season Champion" && l.numero === 1);
const parId = new Map(f.cartes.map((k) => [k.carte_id, k]));
ok(sansIS || isc.filter((l) => parId.get(l.carte_id)?.in_season).length >= 4, "NBA In-Season : moins de 4 cartes In-Season dans la compo");
const ids = f.compos.map((l) => l.carte_id); ok(new Set(ids).size === ids.length, "une carte est utilisée dans deux compos");
for (const l of f.compos) ok(parId.has(l.carte_id), "compo avec une carte inconnue : " + l.carte_id);
for (const l of f.compos.filter((x) => x.sport === "NBA")) ok(!l.capitaine, "NBA : capitaine interdit (" + l.joueur + ")");
const joueursNba = f.joueurs.filter((r) => r.sport === "NBA"), joueursFoot = f.joueurs.filter((r) => r.sport === "FOOTBALL");
for (const r of joueursNba) ok(r.statut == null && r.clean_sheet == null && r.poste === "", "NBA : champ football rempli pour " + r.slug);
for (const r of joueursFoot) ok(r.etoiles == null && r.l10 == null && r.minutes_liberees == null, "football : champ NBA rempli pour " + r.slug);
// contrat v4 : lignes football seulement pour les joueurs du Set (période Arcade), jamais de ligne NBA pour un joueur football
const sportDe = new Map(f.joueurs.map((r) => [r.slug, r]));
for (const m of f.matchs) ok(m.sport === "NBA" ? sportDe.get(m.slug)?.sport === "NBA" : m.sport === "Football" && /SET/.test(sportDe.get(m.slug)?.modes || "") && m.b2b === null, "matchs : ligne inattendue " + m.sport + " " + m.slug);
ok(Array.isArray(f.plan_arcade ?? []), "plan_arcade doit être une liste");
// contrat v2 : source_titulaire (football seulement), proba_victoire et total dans matchs
for (const r of joueursNba) ok(r.source_titulaire === null, "NBA : source_titulaire remplie pour " + r.slug);
for (const r of joueursFoot) ok(["cote Sorare", "statut"].includes(r.source_titulaire), "football : source_titulaire inattendue pour " + r.slug + " : " + r.source_titulaire);
for (const m of f.matchs) ok("proba_victoire" in m && "total" in m, "matchs : colonnes proba_victoire / total absentes");
// gameweek normale : le Set a des matchs, il doit avoir une compo
ok(f.competitions.some((c) => /Set/.test(c.competition) && c.nb_compos === 1), "Set : pas de compo alors que les joueurs du Set jouent");
for (const c of compsNba) { const tot = new Map(); for (const l of f.compos.filter((x) => x.competition === c.competition)) tot.set(l.numero, (tot.get(l.numero) || 0) + (l.etoiles || 0)); for (const [n, t] of tot) ok(!c.cap_etoiles || t <= c.cap_etoiles, `${c.competition} compo ${n} : ${t} étoiles pour ${c.cap_etoiles}`); }
ok(f.paliers.some((p) => p.type === "salon") && f.paliers.some((p) => p.sport === "Football"), "paliers : salons NBA ou classement Jupiler manquants");

// Cas NBA In-Season (bug du 24/10/2026, collecte 22h05) : 4 cartes In-Season faiblement notées, beaucoup de joueurs
// mieux notés au même niveau d'étoiles, plafond 16 étoiles. Avant le correctif, optimise() ne gardait que 7 joueurs
// par niveau d'étoiles et éliminait les cartes In-Season avant le filtre minInSeason -> aucune compo.
{
  const { optimise, missingReason } = await import(pathToFileURL(join(racine, "sorare-compos", "compos.mjs")).href);
  const carte = (slug, etoiles, value, inSeason, club = "c-" + slug, n = 1) => ({ r: { slug, joueur: slug, etoiles, _clubSlug: club, _cv: 0.3 }, card: { slug: slug + "-" + n, inSeason }, value });
  const pool = [];
  for (let i = 0; i < 12; i++) pool.push(carte("fort-" + i, 2.5, 60 - i, false));      // 12 joueurs à 2,5★ mieux notés
  pool.push(carte("star", 5, 75, false), carte("sans-niveau", null, 0, false));            // une star, un joueur sans niveau
  const ins = [["dosunmu", 2.5, 32.6], ["missi", 2.5, 20.2], ["holiday", 3, 34.3], ["gordon", 2.5, 36.5]];
  for (const [s, e, v] of ins) pool.push(carte(s, e, v, true));
  pool.push(carte("gordon", 2.5, 45, false, "c-gordon", 2));                              // Gordon a aussi une carte non In-Season bien meilleure
  const champ = { sport: "NBA", capStars: 16, minInSeason: 4, maxParClub: 4 };
  const sol = optimise(champ, pool);
  ok(sol && sol.picks.filter((x) => x.card.inSeason).length >= 4, "optimise : pas de compo In-Season Champion avec 4 cartes In-Season faiblement notées");
  if (sol) {
    ok(sol.picks.reduce((s, x) => s + (x.r.etoiles ?? 1), 0) <= 16, "optimise : compo In-Season au-dessus du plafond");
    ok(new Set(sol.picks.map((x) => x.r.slug)).size === 5, "optimise : deux cartes du même joueur dans une compo In-Season");
    ok(sol.picks.some((x) => x.r.slug === "star"), "optimise : la star (5★) devrait compléter la compo In-Season (10,5 + 5 ≤ 16)");
  }
  // In-Season Contender (11★) : impossible (10,5★ + au moins 1★), et le statut doit l'expliquer ; le joueur sans niveau compte 1★
  const cont = { sport: "NBA", capStars: 11, minInSeason: 4, maxParClub: 4 };
  ok(optimise(cont, pool) === null, "optimise : compo In-Season Contender fictive (10,5★ + joueur sans niveau compté 0★)");
  const raison = missingReason(cont, pool, 4);
  ok(/10,5★/.test(raison) && /0,5★/.test(raison), "missingReason In-Season Contender peu explicite : " + raison);
  // sans minimum In-Season, le résultat ne dépend pas des cartes In-Season : les 5 meilleures valeurs sous le plafond
  const classic = optimise({ sport: "NBA", capStars: 16, maxParClub: 4 }, pool);
  ok(classic && classic.picks.map((x) => x.r.slug).sort().join() === ["star", "fort-0", "fort-1", "fort-2", "fort-3"].sort().join(), "optimise : compo Classic modifiée par le correctif In-Season");
}

// Proposition 6 (les deux sports) : pas de « Projection en hausse / en baisse » quand le joueur n'a pas de match
// dans la gameweek d'un des deux côtés, ni à cause d'un changement de gameweek (on compare alors proj_match).
{
  const { calculeChangements } = await import(pathToFileURL(join(racine, "sorare-compos", "compos.mjs")).href);
  const fx = { FOOTBALL: { startDate: "2026-10-27T15:00:00Z", endDate: "2026-10-31T00:00:00Z" }, NBA: { startDate: "2026-10-26T23:00:00Z", endDate: "2026-10-31T08:00:00Z" } };
  const j = (slug, sport, matchs_gw, score_attendu, proj_match, match) => ({ joueur: slug, slug, sport, modes: sport === "NBA" ? "NBA" : "SET", matchs_gw, score_attendu, proj_match, match, blessure: "", suspension: "", statut: sport === "NBA" ? "" : "STARTER" });
  const prev = [j("sans-match", "FOOTBALL", 1, 48, 53, "2026-10-28T19:00"), j("baisse", "FOOTBALL", 1, 50, 55, "2026-10-28T19:00"), j("nba-gw", "NBA", 4, 45, 30, "2026-10-21T00:00"), j("nba-chute", "NBA", 2, 40, 38, "2026-10-21T00:00"), j("veille-sans-match", "FOOTBALL", 0, 0, 50, "2026-10-25T14:00")];
  const rows = [j("sans-match", "FOOTBALL", 0, 0, 52, "2026-10-31T19:00"), j("baisse", "FOOTBALL", 1, 30, 40, "2026-10-28T19:00"), j("nba-gw", "NBA", 2, 33, 31, "2026-10-27T00:00"), j("nba-chute", "NBA", 2, 20, 18, "2026-10-27T00:00"), j("veille-sans-match", "FOOTBALL", 1, 45, 50, "2026-10-28T19:00")];
  const ch = calculeChangements(rows, prev, fx);
  const proj = (s) => ch.filter((x) => x.joueur === s && /Projection/.test(x.type));
  ok(!proj("sans-match").length, "changements : fausse baisse pour un joueur sans match dans la gameweek");
  ok(!proj("veille-sans-match").length, "changements : fausse hausse pour un joueur sans match la veille");
  ok(proj("baisse").length === 1 && proj("baisse")[0].type === "Projection en baisse", "changements : vraie baisse (même gameweek) non signalée");
  ok(!proj("nba-gw").length, "changements : fausse baisse NBA due au changement de gameweek (4 matchs → 2, projection par match stable)");
  ok(proj("nba-chute").length === 1 && /par match/.test(proj("nba-chute")[0].detail), "changements : vraie baisse NBA par match (nouvelle gameweek) non signalée");
}

// Proposition 2 (les deux sports) : gameweek sans match -> aucune compo, statut explicite (Set, Jupiler, NBA)
{
  const { calculeCompos } = await import(pathToFileURL(join(racine, "sorare-compos", "compos.mjs")).href);
  const pos = ["Goalkeeper", "Defender", "Midfielder", "Forward", "Forward", "Defender"];
  const row = (slug, sport, extra) => ({ joueur: slug, slug, sport, modes: "", score_attendu: 0, matchs_gw: 0, etoiles: sport === "NBA" ? 2 : null, _games: [], _cv: 0.3, _l15: 40, _clubSlug: "c-" + slug, _isJPL: false, _inSet: false, ...extra });
  const rows = [
    ...pos.map((p, i) => row("set-" + i, "FOOTBALL", { _inSet: true, _pos: p, _cards: [{ slug: "set-" + i + "-c", rarity: "common", set: "glitch", power: 1.04, skinBonus: 1, season: 2026 }] })),
    ...pos.map((p, i) => row("jpl-" + i, "FOOTBALL", { _isJPL: true, _pos: p, _cards: [{ slug: "jpl-" + i + "-l", rarity: "limited", inSeason: true, power: 1.08, skinBonus: 1, season: 2026 }] })),
    ...Array.from({ length: 6 }, (_, i) => row("nba-" + i, "NBA", { _cards: [{ slug: "nba-" + i + "-l", rarity: "limited", inSeason: false, power: 1.05, skinBonus: 1, season: 2024 }] })),
  ];
  const comps = [{ nom: "Jupiler In-Season", sport: "FOOTBALL", inSeason: true, equipes: 4, capitaine: 50, minInSeason: 4 }, { nom: "NBA Classic Champion", sport: "NBA", nbaDef: { rang: 2, compos: 3 }, capStars: 16, maxParClub: 4 }];
  const ctx = { comps, currentSet: "glitch", setName: "HyperGlitch", fixtures: { FOOTBALL: { cutOffDate: "x", startDate: "2026-10-27T15:00:00Z", endDate: "2026-10-31T00:00:00Z" }, NBA: { startDate: "2026-10-26T23:00:00Z", endDate: "2026-10-31T08:00:00Z" } }, advRank: () => ({}) };
  const o = calculeCompos(ctx, rows, null);
  ok(!o.lineups.length, "gameweek sans match : des compos sont proposées (" + o.lineups.map((l) => l.competition).join(", ") + ")");
  for (const c of o.compRows) ok(c.nb_compos === 0 && /ne joue cette gameweek/.test(c.statut), `gameweek sans match : statut peu clair pour ${c.competition} : ${c.statut}`);
  // matchs dans la gameweek mais score attendu nul (tous absents) : pas de compo à 0 point non plus
  const o2 = calculeCompos(ctx, rows.map((r) => ({ ...r, matchs_gw: 1 })), null);
  ok(!o2.lineups.length, "compo à 0 point proposée");
  for (const c of o2.compRows) ok(c.nb_compos === 0 && /0 point/.test(c.statut), `compo à 0 point : statut peu clair pour ${c.competition} : ${c.statut}`);
}

// Proposition 11 (NBA) : In-Season Contender sans carte In-Season parce qu'In-Season Champion les a prises
{
  const { calculeCompos } = await import(pathToFileURL(join(racine, "sorare-compos", "compos.mjs")).href);
  const r = (slug, etoiles, score, inSeason) => ({ joueur: slug, slug, sport: "NBA", modes: "NBA", score_attendu: score, matchs_gw: 2, etoiles, _games: [], _cv: 0.3, _clubSlug: "c-" + slug, _cards: [{ slug: slug + "-l", rarity: "limited", inSeason, power: 1.05, skinBonus: 1, season: inSeason ? 2026 : 2024 }] });
  const rows = [r("dosunmu", 2.5, 32, true), r("missi", 2.5, 20, true), r("holiday", 3, 34, true), r("gordon", 2.5, 36, true), r("jokic", 5, 60, false), r("wade", 1.5, 15, false), r("joe", 2, 21, false)];
  const comps = [{ nom: "NBA In-Season Champion", sport: "NBA", nbaDef: { rang: 0, compos: 1 }, capStars: 16, minInSeason: 4, maxParClub: 4 }, { nom: "NBA In-Season Contender", sport: "NBA", nbaDef: { rang: 1, compos: 1 }, capStars: 11, minInSeason: 4, maxParClub: 4 }];
  const o = calculeCompos({ comps, currentSet: "x", setName: "x", fixtures: { FOOTBALL: { cutOffDate: "x" }, NBA: {} }, advRank: () => ({}) }, rows, null);
  const cont = o.compRows.find((c) => c.competition === "NBA In-Season Contender");
  ok(/tes 4 cartes In-Season sont dans la compo NBA In-Season Champion \(priorité 1\)/.test(cont.statut) && /10,5★/.test(cont.statut), "In-Season Contender : raison peu explicite : " + cont.statut);
}

// Audit des règles du 25/10/2026 (sources : API so5Leaderboard.displayedTypedRules « EntryItem », so5Appearances{ bonus },
// aide Sorare « What is the Arena? ») : salons sans bonus de carte (NBA Rooms et Cap 260), Cap 260 à 300 essences,
// capitaine football additif (score du joueur × bonus capitaine, ajouté au score de la carte).
{
  const { affecteCompetitions } = await import(pathToFileURL(join(racine, "sorare-compos", "compos.mjs")).href);
  const round = (x) => Math.round(x * 10) / 10;
  const pos = ["Goalkeeper", "Defender", "Midfielder", "Forward", "Forward"];
  const foot = pos.map((p, i) => ({ joueur: "f" + i, slug: "f" + i, sport: "FOOTBALL", score_attendu: 40 + i, matchs_gw: 1, _cv: 0, _l15: 40, _clubSlug: "c" + i, _isJPL: true, _pos: p,
    _cards: [{ slug: "f" + i + "-l", rarity: "limited", inSeason: true, power: 1.1, skinBonus: 1, season: 2026 }] }));
  const nba = Array.from({ length: 5 }, (_, i) => ({ joueur: "n" + i, slug: "n" + i, sport: "NBA", score_attendu: 30 + i, matchs_gw: 2, etoiles: 2, _cv: 0, _clubSlug: "t" + i,
    _cards: [{ slug: "n" + i + "-l", rarity: "limited", inSeason: false, power: 1.1, skinBonus: 1, season: 2024 }] }));
  const rows = [...foot, ...nba];
  const somme = (l) => l.reduce((s, x) => s + x.score_attendu, 0);
  const cap260 = { nom: "Jupiler Cap 260", slug: "football-x-seasonal-jupiler-all_seasons_jupiler_arena_limited", sport: "FOOTBALL", equipes: null, capPoints: 260, capitaine: 20 };
  const isj = { nom: "Jupiler In-Season", slug: "football-x-seasonal-jupiler-in_season_jupiler_limited", sport: "FOOTBALL", inSeason: true, equipes: 1, capitaine: 50, minInSeason: 4 };
  const rooms = { nom: "NBA Rooms Champion", slug: "nba-x-nba_limited_arena_140", sport: "NBA", salon: true, nbaDef: { rang: 4, compos: 1, essences: 150 }, capStars: 16, maxParClub: 4 };
  const a = affecteCompetitions([cap260], rows, new Set());
  const cr = a.compRows[0];
  ok(cr.cout_inscription === 300 && /300 essences/.test(cr.contraintes), "Cap 260 : inscription 300 essences Limited attendue : " + cr.cout_inscription);
  ok(a.lineups.every((l) => l.bonus === 0), "Cap 260 : bonus de carte appliqué en salon");
  ok(Math.abs(cr.score_compo - round(somme(foot) + 44 * 0.2)) < 0.11, `Cap 260 : score ${cr.score_compo} ≠ somme des scores + 20 % du capitaine (${round(somme(foot) + 44 * 0.2)})`);
  const b = affecteCompetitions([isj], rows, new Set());
  const capL = b.lineups.find((l) => l.capitaine === "Oui");
  ok(capL && Math.abs(capL.score_final - round(capL.score_attendu * (1.1 + 0.5))) < 0.11, "Jupiler In-Season : capitaine non additif (attendu score × (1,1 + 0,5)) : " + capL?.score_final);
  ok(b.compRows[0].cout_inscription === 0, "Jupiler In-Season : coût d'inscription inattendu");
  const c = affecteCompetitions([rooms], rows, new Set());
  ok(Math.abs(c.compRows[0].score_compo - somme(nba)) < 0.11 && c.lineups.every((l) => l.bonus === 0), "NBA Rooms : bonus de carte appliqué en salon : " + c.compRows[0].score_compo);
  const d = affecteCompetitions([{ ...rooms, nom: "NBA Classic Champion", slug: "nba-x-nba_limited_champion", salon: false, nbaDef: { rang: 2, compos: 1 } }], rows, new Set());
  ok(Math.abs(d.compRows[0].score_compo - round(somme(nba) * 1.1)) < 0.11, "NBA Classic : bonus de carte absent : " + d.compRows[0].score_compo);
}

// Contrat v3 : colonnes de rentabilité toujours présentes dans competitions (les deux sports)
const V3 = ["cout_inscription", "gains_esperes", "gain_net_espere", "autres_recompenses", "rentable", "recommandation", "alternative"];
for (const c of f.competitions) for (const k of V3) ok(k in c, `competitions v3 : colonne ${k} absente pour ${c.competition}`);
for (const c of f.competitions) ok(c.cout_inscription === (c.competition === "NBA Rooms Champion" ? 150 : 0), `cout_inscription inattendu pour ${c.competition} : ${c.cout_inscription}`);
// Une fois evalueRentabilite() branché dans core.mjs (après les paliers), chaque compétition NBA avec compos et paliers a ses gains
if (f.competitions.some((c) => c.recommandation)) {
  for (const c of f.competitions.filter((x) => x.sport === "NBA" && x.nb_compos > 0 && f.paliers.some((p) => p.competition === x.competition))) {
    ok(String(c.gains_esperes).split(" ").filter(Boolean).length === c.nb_compos, `${c.competition} : gains_esperes non aligné sur scores_compos (${c.gains_esperes})`);
    ok(c.recommandation, `${c.competition} : recommandation vide`);
  }
  ok(f.competitions.filter((c) => c.sport === "Football").every((c) => !c.alternative), "football : alternative In-Season remplie (NBA seulement)");
}

// Rentabilité (contrat v3) et choix In-Season NBA (choix de l'utilisateur du 25/10/2026)
{
  const { gainCompo, pAbove, ecartTypeJoueur, calculeCompos, evalueRentabilite } = await import(pathToFileURL(join(racine, "sorare-compos", "compos.mjs")).href);
  // loi normale de la page : P(≥ moyenne) = 50 %, écart-type nul -> 0 ou 1
  ok(Math.abs(pAbove(200, 30, 200) - 0.5) < 1e-6 && pAbove(200, 0, 199) === 1 && pAbove(200, 0, 201) === 0, "pAbove : loi normale incorrecte");
  // écart-type d'un joueur = mkCand de la page : p = 0,95, cv = 30 % × 0,8 (NBA), value 40
  const sdRef = Math.sqrt(0.95 * ((40 / 0.95) * 0.24) ** 2 + 0.95 * 0.05 * (40 / 0.95) ** 2);
  ok(Math.abs(ecartTypeJoueur({ sport: "NBA", proba_titulaire: 95, regularite: 30 }, 40) - sdRef) < 1e-9, "ecartTypeJoueur différent de la page");
  // salon : seul le palier le plus haut atteint compte ; écart-type nul -> gain exact
  const salon = [500, 300, 225, 175, 150].map((e, i) => ({ rang: i + 1, score: 220 - 10 * i, recompense: e + " essences Limited" }));
  ok(gainCompo(205, 0, salon).gain === 225, "gainCompo : 205 pts dans un salon devrait rapporter 225 essences (3e), trouvé " + gainCompo(205, 0, salon).gain);
  ok(gainCompo(100, 0, salon).gain === 0, "gainCompo : score sous le 5e palier, gain non nul");
  // classement mêlant $ et essences : atteindre un palier en $ ne rapporte aucune essence
  const lad = [{ rang: 1, score: 300, recompense: "100 $" }, { rang: 10, score: 250, recompense: "1000 essences Limited" }];
  ok(gainCompo(310, 0, lad).gain === 0 && gainCompo(260, 0, lad).gain === 1000, "gainCompo : palier en $ compté en essences ou palier atteint ignoré");

  // Monde NBA : 4 cartes In-Season faibles (dont un blessé à 0), une star qui finit dans la compo In-Season, des Classic et des Rooms
  const r = (slug, etoiles, score, inSeason, n = 1) => ({ joueur: slug, slug, sport: "NBA", modes: "NBA", score_attendu: score, matchs_gw: 2, etoiles, proba_titulaire: 95, regularite: 30, _games: [], _cv: 0.3, _clubSlug: "c-" + slug,
    _cards: Array.from({ length: n }, (_, i) => ({ slug: slug + "-l" + i, rarity: "limited", inSeason: inSeason && i === 0, power: 1.05, skinBonus: 1, season: inSeason && i === 0 ? 2026 : 2024 })) });
  const rows = [r("dosunmu", 2.5, 31, true), r("missi", 2.5, 0, true), r("holiday", 3, 33, true), r("gordon", 2.5, 34, true, 2), r("jokic", 5, 68, false),
    ...Array.from({ length: 8 }, (_, i) => r("role-" + i, 2.5, 30 - i, false)), r("star2", 4, 50, false), r("star3", 4, 48, false)];
  const comps = [{ nom: "NBA In-Season Champion", sport: "NBA", inSeason: true, nbaDef: { rang: 0, compos: 1 }, capStars: 16, minInSeason: 4, maxParClub: 4 },
    { nom: "NBA Classic Champion", sport: "NBA", nbaDef: { rang: 2, compos: 1 }, capStars: 16, maxParClub: 4 },
    { nom: "NBA Rooms Champion", sport: "NBA", nbaDef: { rang: 4, compos: 2, essences: 150 }, capStars: 16, maxParClub: 4 }];
  const ctx = { comps, currentSet: "x", setName: "x", fixtures: { FOOTBALL: { cutOffDate: "x" }, NBA: {} }, advRank: () => ({}) };
  const classic = [{ rang: 1, score: 240, recompense: "3000 essences Limited" }, { rang: 100, score: 200, recompense: "500 essences Limited" }];
  const rooms = [500, 300, 225, 175, 150].map((e, i) => ({ rang: i + 1, score: 215 - 8 * i, recompense: e + " essences Limited" }));
  const pal = (isc) => [...isc.map((x) => ({ competition: "NBA In-Season Champion", ...x })), ...classic.map((x) => ({ competition: "NBA Classic Champion", ...x })), ...rooms.map((x) => ({ competition: "NBA Rooms Champion", ...x, type: "salon" }))];
  // (B) In-Season sans essences à gagner : jouer sans In-Season doit être retenu
  const o = calculeCompos(ctx, rows, null);
  ok(o.lineups.some((l) => l.competition === "NBA In-Season Champion" && l.joueur === "jokic"), "test In-Season : Jokić devrait être dans la compo In-Season (option A)");
  const res = evalueRentabilite(o.compRows, o.lineups, pal([{ rang: 1, score: 400, recompense: "1000 $" }]), rows);
  const isc = o.compRows.find((c) => c.competition === "NBA In-Season Champion");
  ok(res.option === "B", "option In-Season : B (sans In-Season) attendue quand In-Season ne rapporte aucune essence, trouvé " + res.option);
  ok(isc.nb_compos === 0 && /^non recommandé cette semaine : /.test(isc.statut), "option B : statut In-Season peu explicite : " + isc.statut);
  ok(!o.lineups.some((l) => l.competition === "NBA In-Season Champion"), "option B : compo In-Season encore présente");
  ok(isc.recommandation && /Avec In-Season : .*sans In-Season/.test(isc.alternative), "option B : recommandation ou alternative vide");
  ok(o.lineups.some((l) => l.joueur === "jokic"), "option B : Jokić n'est pas réutilisé en Classic ou Rooms");
  const ids = o.lineups.map((l) => l.carte_id); ok(new Set(ids).size === ids.length, "option B : une carte utilisée deux fois");
  const roomsRow = o.compRows.find((c) => c.competition === "NBA Rooms Champion");
  ok(roomsRow.cout_inscription === 150 && ["oui", "non"].includes(roomsRow.rentable) && roomsRow.gains_esperes.split(" ").length === roomsRow.nb_compos, "Rooms : colonnes v3 incomplètes");
  ok(roomsRow.gain_net_espere === roomsRow.gains_esperes.split(" ").reduce((s, x) => s + Number(x), 0) - 150 * roomsRow.nb_compos, "Rooms : gain_net_espere ≠ gains − 150 × compos");
  ok(roomsRow.rentable === (roomsRow.gains_esperes.split(" ").some((g) => Number(g) < 150) ? "non" : "oui"), "Rooms : rentable incohérent avec les gains");
  // (A) In-Season très rémunérateur : la priorité 1 est gardée
  const o2 = calculeCompos(ctx, rows, null);
  const res2 = evalueRentabilite(o2.compRows, o2.lineups, pal([{ rang: 1, score: 120, recompense: "5000 essences Limited" }]), rows);
  const isc2 = o2.compRows.find((c) => c.competition === "NBA In-Season Champion");
  ok(res2.option === "A" && isc2.nb_compos === 1 && /^Jouer In-Season : \+/.test(isc2.recommandation), "option A attendue quand In-Season rapporte plus : " + res2.option + " / " + isc2.recommandation);
  // Rooms non rentable : un salon hors de portée -> « non » et recommandation de ne pas inscrire
  const o3 = calculeCompos(ctx, rows, null);
  evalueRentabilite(o3.compRows, o3.lineups, [{ competition: "NBA Rooms Champion", rang: 1, score: 400, recompense: "500 essences Limited", type: "salon" }], rows, null);
  const r3 = o3.compRows.find((c) => c.competition === "NBA Rooms Champion");
  ok(r3.rentable === "non" && /^Ne pas inscrire/.test(r3.recommandation), "Rooms hors de portée : rentable / recommandation inattendus : " + r3.rentable + " / " + r3.recommandation);
  // autres récompenses : phrase en %, pas d'essences
  const o4 = calculeCompos(ctx, rows, null);
  evalueRentabilite(o4.compRows, o4.lineups, [{ competition: "NBA Classic Champion", rang: 1, score: 20, recompense: "carte Limited 5★" }], rows, null);
  ok(/^> 99 % d'au moins une carte Limited 5★$/.test(o4.compRows.find((c) => c.competition === "NBA Classic Champion").autres_recompenses), "autres_recompenses : phrase inattendue");
}

// Jeu jours (25/10/2026) : en NBA, jour = soirée américaine (UTC − 5, comme matchs.jour) ; football inchangé (date UTC)
{
  const { calculeCompos } = await import(pathToFileURL(join(racine, "sorare-compos", "compos.mjs")).href);
  const g = (date) => ({ date, t: Date.parse(date), pPlay: 0.9, proj: 40, home: true, adversaire: "X" });
  const rows = [{ joueur: "sabonis", slug: "sabonis", sport: "NBA", modes: "NBA", score_attendu: 40, matchs_gw: 1, etoiles: 3, _games: [g("2026-10-26T01:00:00Z")], _cards: [], _cv: 0.3, _clubSlug: "k" },
    { joueur: "forbs", slug: "forbs", sport: "FOOTBALL", modes: "JPL", poste: "Attaquant", score_attendu: 40, matchs_gw: 1, _isJPL: true, _games: [g("2026-10-26T18:45:00Z")], _cards: [], _cv: 0.3, _clubSlug: "b" }];
  const o = calculeCompos({ comps: [], currentSet: "x", setName: "x", fixtures: { FOOTBALL: { cutOffDate: "x" }, NBA: {} }, advRank: () => ({}) }, rows, null);
  ok(o.jours.find((x) => x.joueur === "sabonis")?.jour === "2026-10-25", "jours NBA : un match à 01h00 UTC le 26/10 doit être classé au 25/10 (soirée US)");
  ok(o.jours.find((x) => x.joueur === "forbs")?.jour === "2026-10-26", "jours football : date modifiée");
}

// Blessés (choix de l'utilisateur du 25/10/2026, règle prudente) : absent pour tout match dont le jour (New York en NBA,
// Bruxelles en football) est ≤ à la date de retour annoncée ; la plus tardive des dates ESPN et Sorare l'emporte.
{
  const { calculeJoueurs, jourDuMatch, absentLeJour } = await import(pathToFileURL(join(racine, "sorare-compos", "modele.mjs")).href);
  ok(jourDuMatch(Date.parse("2026-10-28T00:30:00Z"), true) === "2026-10-27" && jourDuMatch(Date.parse("2026-10-28T00:30:00Z"), false) === "2026-10-28", "jourDuMatch : jour NBA (New York) ou football (Bruxelles) incorrect");
  ok(absentLeJour("2026-10-27", "2026-10-27") && !absentLeJour("2026-10-28", "2026-10-27") && !absentLeJour("2026-10-27", ""), "absentLeJour : jour de retour inclus, lendemain présent");
  const now = new Date("2026-10-26T08:00:00Z");
  const fx = { FOOTBALL: { startDate: "2026-10-26T10:00:00Z", endDate: "2026-11-01T00:00:00Z" }, NBA: { startDate: "2026-10-26T10:00:00Z", endDate: "2026-11-01T00:00:00Z" } };
  const game = (date, home, club) => ({ date, competition: { name: club === "nets" ? "NBA" : "First Division A" }, homeTeam: home ? { slug: club, name: club } : { slug: "adv", name: "adv" }, awayTeam: home ? { slug: "adv", name: "adv" } : { slug: club, name: club }, playerGameScore: { projectedScore: 40 } });
  const nbaP = (slug, injuries, espn) => ({ slug, name: slug, sport: "NBA", cards: [], games: ["2026-10-27T23:00:00Z", "2026-10-29T00:30:00Z"].map((d, i) => game(d, i === 0, "nets")), espn,
    d: { activeClub: { name: "nets", slug: "nets" }, gameplayTier: "IMPACT", l5: 40, l10: 40, l15: 40, playerGameScores: [], activeInjuries: injuries, activeSuspensions: [] } });
  const foot = { slug: "forbs", name: "forbs", sport: "FOOTBALL", cards: [], games: [game("2026-10-28T18:45:00Z", true, "brugge")],
    d: { activeClub: { name: "brugge", slug: "brugge" }, position: "Forward", playingStatus: "STARTER", l5: 50, l15: 50, playerGameScores: [], activeInjuries: [{ status: "out", kind: "ankle", expectedEndDate: "2026-10-28T00:00:00Z" }], activeSuspensions: [] } };
  const relevant = [nbaP("espn-out", [], { statut: "Out", retour: "2026-10-27" }), nbaP("sorare-out", [{ status: "out", kind: "knee", expectedEndDate: "2026-10-28T00:00:00Z" }], null), foot];
  const espnData = new Map(relevant.filter((p) => p.espn).map((p) => [p.slug, p.espn]));
  const { rows } = calculeJoueurs({ fixtures: fx, relevant, espnData, odds: [], advRank: () => ({}), isJPL: (p) => p.sport === "FOOTBALL", inSet: () => false, w: 0.5 }, now);
  const pp = (s) => rows.find((x) => x.slug === s)._games.map((g) => g.pPlay);
  // ESPN « retour 27/10 » : le match du 27/10 au soir (23 h UTC, 19 h à New York) est manqué, celui du 28/10 joué
  ok(pp("espn-out")[0] === 0 && pp("espn-out")[1] > 0, "blessés : ESPN Out jusqu'au 27/10, match du 27/10 au soir (heure US) non compté absent : " + pp("espn-out"));
  // Sorare « retour 28/10 » : les deux matchs (27/10 et 28/10, heure de New York) sont manqués
  ok(pp("sorare-out").every((p) => p === 0), "blessés : Sorare retour 28/10, match du 28/10 au soir (heure US) compté joué : " + pp("sorare-out"));
  // football : retour 28/10, match le 28/10 à 19 h 45 (Bruxelles) -> absent
  ok(pp("forbs")[0] === 0 && rows.find((x) => x.slug === "forbs").score_attendu === 0, "blessés football : match le jour du retour Sorare compté joué");
}

// Mode Arcade (Set football, utilisateur 25/10/2026 + aide Sorare « What is Arcade? ») : palier 1 au plus tôt avec 4 compos,
// cartes jamais réutilisées, délai de 1h50 entre le dernier coup d'envoi d'un lot et le lot suivant, plan vide sans match.
{
  const { planArcade, ARCADE_SEUILS } = await import(pathToFileURL(join(racine, "sorare-compos", "compos.mjs")).href);
  const debut = Date.parse("2026-10-31T10:00:00Z"), fin = Date.parse("2026-11-03T00:00:00Z");
  const vagues = ["2026-10-31T12:30:00Z", "2026-10-31T14:30:00Z", "2026-10-31T17:30:00Z", "2026-10-31T20:00:00Z", "2026-11-01T13:00:00Z", "2026-11-01T15:30:00Z", "2026-11-01T19:45:00Z", "2026-11-02T20:00:00Z"];
  const postes = ["Goalkeeper", "Defender", "Defender", "Midfielder", "Midfielder", "Forward", "Forward"];
  const rows = [];
  vagues.forEach((v, vi) => { for (let e = 0; e < 3; e++) postes.forEach((pos, pi) => {
    const slug = `a-${vi}-${e}-${pi}`, t = Date.parse(v);
    rows.push({ joueur: slug, slug, sport: "FOOTBALL", club: "club-" + vi + "-" + e, regularite: 30 + (h(slug) % 20), _inSet: true, _pos: pos,
      _cards: Array.from({ length: 1 + (h(slug) % 2) }, (_, c) => ({ slug: slug + "-c" + c, rarity: "common", set: "glitch", power: 1.05, skinBonus: c ? 1.1 : 1 })),
      _games: [{ t, date: iso(t), proj: 45 + (h(slug + "p") % 30) + vi * 2, pPlay: 0.75 + (h(slug + "q") % 25) / 100 }] });
  }); });
  // un joueur hors Set et un match hors période : jamais dans le plan
  rows.push({ ...rows[0], slug: "hors-set", joueur: "hors-set", _inSet: false });
  rows.push({ ...rows[1], slug: "apres-fin", joueur: "apres-fin", _games: [{ ...rows[1]._games[0], t: fin + H, date: iso(fin + H) }] });
  const plan = planArcade(rows, { currentSet: "glitch", debut, fin });
  ok(plan.length > 0, "Arcade : plan vide alors que des joueurs du Set jouent");
  const p1 = plan.filter((l) => l.depart === 1 && l.etape === 1);
  ok(p1.length === 4 && p1.every((l) => l.creneau === vagues[0].slice(0, 16)) && /rien à perdre/.test(p1[0].conseil), "Arcade : au palier 1, il faut jouer 4 compos au premier créneau (" + p1.map((l) => l.creneau).join() + ")");
  for (let d = 1; d <= 6; d++) {
    const l = plan.filter((x) => x.depart === d);
    ok(l.length && l[0].palier === d && l[0].seuil === ARCADE_SEUILS[d - 1], `Arcade : le plan au départ ${d} ne commence pas au palier ${d}`);
    const cartes = l.flatMap((x) => x.joueurs.split(" ; "));
    ok(new Set(cartes).size === cartes.length, `Arcade : carte réutilisée dans le plan au départ ${d}`);
    ok(!cartes.some((c) => /hors-set|apres-fin/.test(c)), `Arcade : joueur hors Set ou hors période dans le plan au départ ${d}`);
    const etapes = [...new Set(l.map((x) => x.etape))];
    for (let e = 1; e < etapes.length; e++) { const a = l.find((x) => x.etape === etapes[e - 1]), b = l.find((x) => x.etape === etapes[e]);
      ok(Date.parse(b.creneau + "Z") >= Date.parse(a.resultat_vers + "Z"), `Arcade : départ ${d}, étape ${etapes[e]} jouée avant le résultat de l'étape précédente`); }
    for (const x of l) { ok(x.compo >= 1 && x.compo <= 4 && x.joueurs.split(" ; ").length === 5 && /^Gardien /.test(x.joueurs) && x.conseil, `Arcade : ligne incomplète (départ ${d}, étape ${x.etape})`);
      const lot = l.filter((y) => y.etape === x.etape); ok(Math.abs(1 - lot.reduce((q, y) => q * (1 - y.proba_compo / 100), 1) - x.proba_palier / 100) < 0.01, "Arcade : proba_palier ≠ 1 − Π(1 − proba_compo)"); }
  }
  // délai 1h50 : resultat_vers = dernier coup d'envoi du lot + 1h50
  ok(plan.every((x) => (Date.parse(x.resultat_vers + "Z") - Date.parse(x.creneau + "Z")) >= 110 * 60e3), "Arcade : résultat attendu moins de 1h50 après le coup d'envoi");
  ok(planArcade(rows, { currentSet: "glitch", debut: fin + 2 * H, fin: fin + 3 * H }).length === 0 && planArcade([], { currentSet: "glitch", debut, fin }).length === 0, "Arcade : plan non vide sans match avant la fin de la période");
  // non-régression (généralisation planPiste du 25/10/2026) : empreinte du plan Arcade d'avant, colonne mode = arcade
  const emp = plan.map((x) => [x.depart, x.etape, x.palier, x.creneau, x.resultat_vers, x.compo, x.score_attendu, x.proba_compo, x.proba_palier, x.conseil].join("|")).join("\n");
  if (process.argv.includes("--empreinte")) console.log("empreinte Arcade : " + h(emp) + " (" + plan.length + " lignes)");
  ok(h(emp) === EMPREINTE_ARCADE && plan.every((x) => x.mode === "arcade"), "Arcade : plan différent de celui d'avant la généralisation (empreinte " + h(emp) + ")");
  if (process.argv.includes("--arcade")) console.log(plan.map((x) => [x.depart, x.etape, x.palier, x.creneau, x.resultat_vers, x.compo, x.score_attendu, x.proba_compo, x.proba_palier, x.compo === 1 ? x.conseil : ""].join(" | ")).join("\n"));
}

// European Contenders (Pro football, utilisateur 25/10/2026 + API + aide « What is Pro? ») : cartes Limited et plus,
// matchs de Ligue Europa / Conference League seulement, extra jamais gardien, capitaine +50 % ADDITIF, pas de bonus de rareté.
{
  const C = await import(pathToFileURL(join(racine, "sorare-compos", "compos.mjs")).href);
  const debut = Date.parse("2026-11-05T12:00:00Z"), fin = Date.parse("2026-11-06T13:59:00Z");
  const vagues = ["2026-11-05T17:45:00Z", "2026-11-05T20:00:00Z"], compets = ["UEFA Conference League", "UEFA Europa League"];
  const postes = ["Goalkeeper", "Goalkeeper", "Defender", "Defender", "Defender", "Midfielder", "Midfielder", "Midfielder", "Forward", "Forward"];
  const mk = (slug, pos, t, comp, rarity, proj, bp = { scarcityBasisPoints: 1000 }) => ({ joueur: slug, slug, sport: "FOOTBALL", club: "club-" + slug, regularite: 30, _inSet: false, _pos: pos,
    _cards: [{ slug: slug + "-c", rarity, set: "x", power: 1.2, skinBonus: 1.1, bp }], _games: [{ t, date: iso(t), competition: comp, home: true, adversaire: "Adv", proj, pPlay: 0.9 }] });
  const rows = [];
  vagues.forEach((v, vi) => postes.forEach((pos, pi) => rows.push(mk(`e-${vi}-${pi}`, pos, Date.parse(v), compets[vi], pi % 3 ? "limited" : "rare", (pos === "Goalkeeper" ? 95 : 70) + (h("e" + vi + pi) % 15)))));
  // ignorés : carte Common seule (très forte), match de Ligue des champions, match de championnat
  rows.push(mk("commune", "Forward", Date.parse(vagues[1]), compets[1], "common", 300));
  rows.push(mk("ldc", "Forward", Date.parse(vagues[1]), "UEFA Champions League", "limited", 300));
  rows.push(mk("jpl", "Forward", Date.parse(vagues[1]), "First Division A", "limited", 300));
  const parNom = new Map(rows.map((r) => [r.slug, r]));
  const plan = C.planEurope(rows, { debut, fin });
  ok(plan.length > 0 && plan.every((x) => x.mode === "europe" && x.etape >= 1), "Europe : plan vide ou sans mode europe");
  ok(plan.filter((x) => x.depart === 1).every((x, i, l) => l[0].seuil === 350) && plan.some((x) => x.palier === 2 && x.seuil === 390), "Europe : seuils 350 / 390 non respectés");
  for (const x of plan) {
    const js = x.joueurs.split(" ; ").map((y) => ({ txt: y, slug: y.split(" ")[1], cap: / \(capitaine\)$/.test(y) }));
    ok(js.length === 5 && /^Gardien /.test(js[0].txt) && /^Extra /.test(js[4].txt), "Europe : compo pas G/D/M/A + extra : " + x.joueurs);
    ok(parNom.get(js[4].slug)?._pos !== "Goalkeeper", "Europe : extra gardien : " + x.joueurs);
    ok(!js.some((j) => /^(commune|ldc|jpl)$/.test(j.slug)), "Europe : carte Common ou match non européen retenu : " + x.joueurs);
    ok(js.filter((j) => j.cap).length === 1, "Europe : il faut exactement un capitaine : " + x.joueurs);
    // score de la compo = Σ proj × p × (puissance − part rareté) + 50 % du score du capitaine (additif, pas × 1,5)
    const att = js.reduce((s, j) => { const r = parNom.get(j.slug), base = r._games[0].proj * r._games[0].pPlay; return s + base * (1.2 - 0.1) + (j.cap ? base * 0.5 : 0); }, 0);
    ok(Math.abs(att - x.score_attendu) < 0.06, `Europe : score de compo ${x.score_attendu} ≠ ${round2(att)} attendu (capitaine additif, sans rareté)`);
  }
  // sans powerBreakdown : puissance totale gardée
  ok(C.puissanceSansRarete({ power: 1.2 }) === 1.2 && Math.abs(C.puissanceSansRarete({ power: 1.2, bp: { scarcityBasisPoints: 1000 } }) - 1.1) < 1e-9, "Europe : part rareté mal retirée");
  // aucun attaquant éligible (les seuls attaquants n'ont qu'une Common ou ne jouent pas la Ligue Europa / Conference League)
  const sansA = rows.filter((r) => r._pos !== "Forward" || /^(commune|ldc|jpl)$/.test(r.slug));
  const vide = C.planEurope(sansA, { debut, fin });
  ok(vide.length === 1 && vide[0].etape === 0 && vide[0].compo === 0 && /aucun attaquant/.test(vide[0].conseil), "Europe : cas sans attaquant mal expliqué : " + JSON.stringify(vide));
  ok(C.planEurope([], { debut, fin }).length === 1, "Europe : sans carte éligible, une ligne d'explication attendue");
  // calculeCompos : sans fenêtre Europe, ni plan europe ni matchs européens ; avec fenêtre, matchs européens seulement, avec competition_match
  const ctx = (europe) => ({ comps: [], currentSet: "glitch", setName: "G", advRank: () => ({}), europe, fixtures: { FOOTBALL: { startDate: iso(debut), endDate: iso(debut + H), cutOffDate: iso(debut) } } });
  const r0 = C.calculeCompos(ctx(null), rows, null, new Date(debut));
  ok(!r0.plan_arcade.some((x) => x.mode === "europe") && !r0.matchs.length, "Europe : plan ou matchs sans fenêtre Europe (repli : plan vide)");
  const r1 = C.calculeCompos(ctx({ slug: "eu", debut: iso(debut - J), fin: iso(fin), competitions: ["Europa Conference League", "Europa League"], capitaine: 50 }), rows, null, new Date(debut));
  ok(r1.plan_arcade.some((x) => x.mode === "europe") && r1.matchs.length === 20 && r1.matchs.every((m) => compets.includes(m.competition_match) && m.sport === "Football"), "Europe : matchs européens incorrects : " + r1.matchs.map((m) => m.slug + ":" + m.competition_match).join());
  if (process.argv.includes("--europe")) console.log(plan.filter((x) => x.depart <= 2).map((x) => [x.depart, x.etape, x.palier, x.seuil, x.creneau, x.compo, x.score_attendu, x.proba_compo, x.proba_palier, x.joueurs, x.compo === 1 ? x.conseil : ""].join(" | ")).join("\n") + "\n" + vide[0].conseil);
}

const i = process.argv.indexOf("--sortie");
if (i > 0) { const d = resolve(process.argv[i + 1]); await mkdir(d, { recursive: true }); for (const [k, v] of Object.entries(f)) await writeFile(join(d, k + ".json"), JSON.stringify(v)); console.log("Jeux simulés écrits dans " + d); }
console.log(`Test hors ligne : ${appelsModules} appels simulés, ${f.joueurs.length} joueurs, ${f.compos.length} lignes de compos, ${f.paliers.length} paliers.`);
if (erreurs.length) { console.error("ÉCHEC :\n  - " + erreurs.join("\n  - ")); process.exit(1); }
console.log(MODULES ? "OK (modules seuls, collecteur navigateur non comparé) : règles football et NBA respectées." : "OK : modules et collecteur navigateur identiques, règles football et NBA respectées.");
