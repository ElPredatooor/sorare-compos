// FICHIER GÉNÉRÉ par outils/bundle-navigateur.mjs à partir de sorare-compos/collecte.mjs, modele.mjs, compos.mjs, core.mjs.
// Ne pas modifier à la main : modifier les modules, puis relancer « node outils/bundle-navigateur.mjs ».
// À coller tel quel dans la console d'un onglet https://sorare.com (navigateur intégré de Claude).
// Clés lues dans le localStorage de sorare.com : SX_APIKEY (Sorare), SX_ODDSKEY (The Odds API, facultative).
// Lancer : window.SXRUN({ prev, history, odds }) ; suivre window.SXR.state ("running", "done" ou "error") et window.SXR.log ;
// récupérer : window.SXR.sizes puis window.SXR.part(nom, i) (morceaux JSON de 40 000 caractères, à concaténer).
(() => {
// ===== collecte.mjs =====
const __m_collecte = (() => {
// Collecte Sorare pour Elpredatooor : sections 1 a 6 de l'ancien core.mjs
// (cartes, competitions, joueurs, matchs, cotes, ESPN, classements, calibration) et paliers de recompense.
// Fonctionne dans Node 20+ (GitHub Actions) et dans un navigateur (fetch natif).
// collecte({ apiKey, oddsKey, espn, history, now, log }) -> contexte lu par modele.mjs et compos.mjs

const API = "https://api.sorare.com/graphql";
const USER = "elpredatooor";
const NBA_COMPS = [
  // In-Season en priorite 1 (decision de l'utilisateur du 24/10/2026) : min 4 cartes de la saison en cours
  { suffix: "nba_limited_in_season_champion", nom: "NBA In-Season Champion", rang: 0, compos: 1 },
  // NBA In-Season Contender (nba_limited_in_season_contender, rang 1) : non jouee, ni calculee ni produite
  // (decision de l'utilisateur du 25/10/2026) ; marquee « suivie: false » dans docs/regles-reference.json.
  { suffix: "nba_limited_champion", nom: "NBA Classic Champion", rang: 2, compos: 3 },
  { suffix: "nba_limited_contender", nom: "NBA Classic Contender", rang: 3, compos: 3 },
  // essences : cout d'inscription en essences Limited, repli seulement. La source est la regle API « EntryItem »
  // (displayedTypedRules, So5CardShardsEntryItem { quantity rarity }), lue en section 2 dans coutInscription :
  // 150 Limited pour nba_limited_arena_140, verifie le 25/10/2026.
  { suffix: "nba_limited_arena_140", nom: "NBA Rooms Champion", rang: 4, compos: 2, essences: 150, salon: true },
];
const POS = { Goalkeeper: "Gardien", Defender: "Défenseur", Midfielder: "Milieu", Forward: "Attaquant" };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const round = (x, d = 1) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
const sd = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
const day = (iso) => (iso ? iso.slice(0, 10) : "");

async function collecte({ apiKey, oddsKey = null, espn = true, history = { samples: [], calibration: [] }, now = new Date(), log = console.log }) {
  const headers = { "content-type": "application/json", "accept-language": "fr" };
  if (apiKey) headers.APIKEY = apiKey;
  let calls = 0;
  async function gq(query, variables = {}) {
    let last = "";
    for (let k = 0; k < 6; k++) {
      try {
        calls++;
        const r = await fetch(API, { method: "POST", headers, body: JSON.stringify({ query, variables }) });
        const text = await r.text();
        let j; try { j = JSON.parse(text); } catch { j = { error: text.slice(0, 200) }; }
        if (j.data && !j.errors) return j.data;
        last = j.error || (j.errors && j.errors.map((e) => e.message).join(" | ")) || `HTTP ${r.status}`;
        if (/complexity|doesn't exist|not supported|Field|Argument/i.test(last)) throw new Error("GQL:" + last);
      } catch (e) {
        if (String(e.message || e).startsWith("GQL:")) throw e;
        last = String(e.message || e);
      }
      await sleep(/too many/i.test(last) ? 30000 * (k + 1) : 5000 * (k + 1));
    }
    throw new Error("API Sorare : " + last);
  }
  // Requete par lots avec reduction automatique de la taille si la complexite est trop forte
  async function batched(items, size, fn) {
    const out = [];
    let i = 0;
    while (i < items.length) {
      const chunk = items.slice(i, i + size);
      try { out.push(...(await fn(chunk))); i += chunk.length; await sleep(apiKey ? 150 : 2500); }
      catch (e) { if (/complexity/i.test(e.message) && size > 1) { size = Math.max(1, Math.floor(size / 2)); log("lot réduit à " + size); } else throw e; }
    }
    return out;
  }

  // ---------- 1. Cartes ----------
  log("Cartes…");
  let cards = [], after = null, page = apiKey ? 100 : 25;
  for (;;) {
    let d;
    try {
      d = await gq(`query($a:String){ user(slug:"${USER}"){ cards(first:${page}, after:$a){ pageInfo{ hasNextPage endCursor } nodes { slug rarityTyped sport seasonYear inSeasonEligible anyPositions power cardSet{ slug name } skinEdition{ skin bonus } powerBreakdown{ collectionBasisPoints xpBasisPoints seasonBasisPoints scarcityBasisPoints specialEditionCardsBasisPoints activeClubsBasisPoints nationalityBasisPoints positionsBasisPoints } anyPlayer{ slug displayName } } } } }`, { a: after });
    } catch (e) { if (/complexity/i.test(e.message) && page > 10) { page = Math.floor(page / 2); continue; } throw e; }
    const c = d.user.cards; cards.push(...c.nodes);
    if (!c.pageInfo.hasNextPage) break; after = c.pageInfo.endCursor;
  }
  const currentSet = mostCommon(cards.filter((c) => c.rarityTyped === "common" && c.sport === "FOOTBALL" && c.cardSet).map((c) => c.cardSet.slug));
  const setName = (cards.find((c) => c.cardSet && c.cardSet.slug === currentSet) || {}).cardSet?.name || currentSet || "";
  const byPlayer = new Map();
  for (const c of cards) {
    const s = c.anyPlayer.slug;
    if (!byPlayer.has(s)) byPlayer.set(s, { slug: s, name: c.anyPlayer.displayName, sport: c.sport, cards: [] });
    byPlayer.get(s).cards.push({
      slug: c.slug, rarity: c.rarityTyped, season: c.seasonYear, inSeason: !!c.inSeasonEligible,
      power: Number(c.power) || 1, skin: c.skinEdition?.skin || "", skinBonus: Number(c.skinEdition?.bonus) || 1,
      set: c.cardSet?.slug || "", bp: c.powerBreakdown || {},
      // Poste de la carte (Card.anyPositions, football ; [] en NBA) : c'est lui qui compte dans les compos (voir section 3)
      positions: c.sport === "FOOTBALL" && Array.isArray(c.anyPositions) ? c.anyPositions.filter((x) => POS[x]) : [],
    });
  }
  const players = [...byPlayer.values()];
  log(`${cards.length} cartes, ${players.length} joueurs, set courant ${setName}`);

  // Gameweeks recentes d'un sport (1 appel par sport, mis en cache) : partage par European Contenders, les paliers et le bilan
  const recentes = new Map();
  const fixturesRecentes = async (sport) => {
    if (!recentes.has(sport)) recentes.set(sport, (await gq(`query($sport:Sport!){ so5{ so5Fixtures(sport:$sport, first:8){ nodes{ slug aasmState startDate endDate } } } }`, { sport })).so5.so5Fixtures.nodes);
    return recentes.get(sport);
  };

  // ---------- 2. Gameweeks et competitions ----------
  log("Compétitions…");
  const fixtures = {};
  // Football : la gameweek EN COURS (type LIVE) est demandee dans la meme requete (alias « live », 0 appel de plus) ;
  // le mode Set / Arcade se joue dessus (contrat v4, resume.arcade_debut / arcade_fin). Verifie le 25/10/2026 :
  // LIVE = football-23-27-oct-2026 (aasmState started), UPCOMING = football-27-30-oct-2026. Sans gameweek en cours
  // (live null), fixtures.LIVE_FOOTBALL reprend la fenetre de la gameweek a venir.
  for (const sport of ["FOOTBALL", "NBA"]) {
    const live = sport === "FOOTBALL" ? " live: so5Fixture(type:LIVE sport:$sport){ slug aasmState startDate endDate so5Leaderboards{ slug } }" : "";
    const d = await gq(`query($sport:Sport!){ so5{ so5Fixture(type:UPCOMING sport:$sport){ slug cutOffDate startDate endDate gameWeek so5Leaderboards{ slug displayName mainRarityType teamsCap format{ title } } }${live} } }`, { sport });
    fixtures[sport] = d.so5.so5Fixture;
    if (sport === "FOOTBALL") {
      const l = d.so5.live, u = d.so5.so5Fixture;
      fixtures.LIVE_FOOTBALL = l?.slug ? { slug: l.slug, startDate: l.startDate || null, endDate: l.endDate || null, enCours: true }
        : { slug: u.slug, startDate: u.startDate || null, endDate: u.endDate || null, enCours: false };
      fixtures.LIVE_FOOTBALL.so5Leaderboards = l?.slug ? l.so5Leaderboards || null : null;
    }
  }
  // Salons (Cap 260 « ..._jupiler_arena_limited ») : l'API liste le salon de base puis chaque salon de 10
  // « ..._arena_limited-<uuid> » (21 salons la gameweek du 23-27/10/2026). Une seule entree par slug sans uuid, la plus
  // courte (le salon de base) ; suffix est calcule sans uuid pour que collectePaliers retrouve les salons.
  const sansUuid = (s) => s.replace(/-[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/, "");
  const vus = new Set();
  const wanted = [
    ...fixtures.FOOTBALL.so5Leaderboards.filter((l) => /jupiler/.test(l.slug) && l.mainRarityType === "limited"),
    ...fixtures.NBA.so5Leaderboards.filter((l) => NBA_COMPS.some((n) => l.slug.endsWith("-" + n.suffix))),
  ].sort((a, b) => a.slug.length - b.slug.length).filter((l) => { const k = sansUuid(l.slug); if (vus.has(k)) return false; vus.add(k); return true; });
  const comps = [];
  for (const l of wanted) {
    const d = await gq(`query($s:String!){ so5{ so5Leaderboard(slug:$s){ slug displayedTypedRules{ key descriptions{ title items{ title } } ... on So5EntryItemRule { entryItem{ ... on So5CardShardsEntryItem { quantity rarity } } } } } } }`, { s: l.slug });
    const rules = d.so5.so5Leaderboard.displayedTypedRules.map((r) => ({ key: r.key, text: r.descriptions.map((x) => [x.title, ...(x.items || []).map((i) => i.title)].filter(Boolean).join(" ")).join(" ; ") }));
    // Cout d'inscription (regle EntryItem, texte vide) : 150 Limited Rooms NBA, 300 Limited Cap 260, releve le 25/10/2026
    const entry = d.so5.so5Leaderboard.displayedTypedRules.find((r) => r.key === "EntryItem")?.entryItem;
    const num = (key) => { const r = rules.find((x) => x.key === key); const m = r && r.text.match(/(\d+)/); return m ? Number(m[1]) : null; };
    const sport = l.slug.startsWith("nba") ? "NBA" : "FOOTBALL";
    const nbaDef = NBA_COMPS.find((n) => l.slug.endsWith("-" + n.suffix));
    comps.push({ nbaDef,
      slug: l.slug, sport, fixture: (sport === "NBA" ? fixtures.NBA : fixtures.FOOTBALL).slug,
      nom: nbaDef ? nbaDef.nom : "Jupiler " + l.displayName + (l.format?.title && l.format.title !== l.displayName ? " (" + l.format.title + ")" : ""),
      cutoff: (sport === "NBA" ? fixtures.NBA : fixtures.FOOTBALL).cutOffDate,
      equipes: l.teamsCap, inSeason: /in_season/.test(l.slug), salon: /arena/.test(l.slug), suffix: sansUuid(l.slug).slice(((sport === "NBA" ? fixtures.NBA : fixtures.FOOTBALL).slug + "-").length),
      capPoints: num("SumOfAverageScores"), capStars: num("AverageScores"), capitaine: num("CaptainScarcity"),
      minInSeason: num("SeasonBonus"), maxParClub: num("SameActiveClub"),
      coutInscription: entry?.rarity === "limited" ? entry.quantity : undefined,
      regles: rules.filter((r) => r.text).map((r) => r.text).join(" | "),
    });
  }

  // European Contenders (contrat v5, resume.europe_*) : leaderboard « …-special-weekly-european-contenders-division-1 »
  // de la gameweek en cours ou a venir. Cout : 0 a 3 appels de recherche + 1 appel de regles si trouve.
  let europe = null;
  try { europe = await chercheEurope({ gq, fixtures, fixturesRecentes, now, log }); } catch (e) { log("European Contenders : " + e.message); }

  // ---------- 3. Donnees joueurs ----------
  log("Joueurs…");
  const PQ = `query($s:[String!]!){ players(slugs:$s){ slug gameplayTier activeClub{ name slug domesticLeague{ name } }
    l5: averageScore(type:LAST_FIVE_SO5_AVERAGE_SCORE) l15: averageScore(type:LAST_FIFTEEN_SO5_AVERAGE_SCORE) l10: averageScore(type:LAST_TEN_PLAYED_SO5_AVERAGE_SCORE)
    activeInjuries{ status kind expectedEndDate }
    ... on Player { position playingStatus activeSuspensions{ endDate } playerGameScores(last:10){ score anyGame{ date } anyPlayerGameStats{ ... on PlayerGameStats{ minsPlayed } } } so5Scores(last:10){ score decisiveScore{ totalScore } game{ date } } }
    ... on NBAPlayer { gainOnProjection(eventType:CLASSIC) playerGameScores(last:10){ score anyGame{ date } } } } }`;
  const info = new Map();
  (await batched(players.map((p) => p.slug), apiKey ? 40 : 10, async (s) => (await gq(PQ, { s })).players)).forEach((p) => p && info.set(p.slug, p));
  for (const p of players) p.d = info.get(p.slug) || null;
  // Poste football : celui des cartes (Card.anyPositions), pas Player.position. Verifie le 25/10/2026 : Guilherme Smith
  // (Union) a Player.position = Midfielder mais sa carte Limited 2026 est Forward ; 80 cartes 2026 du portefeuille sur
  // 1 321 ont un poste different de Player.position. d.position (lu par modele.mjs et compos.mjs) devient le poste des
  // cartes de la saison la plus recente ; Player.position est garde dans d.positionJoueur. Si les cartes d'un joueur
  // n'ont pas toutes le meme poste, p.postesCartes en garde la liste (cas absent du portefeuille au 25/10/2026).
  for (const p of players) {
    if (!p.d || p.sport !== "FOOTBALL") continue;
    const pc = posteCartes(p.cards);
    p.postesCartes = pc.tous;
    p.d.positionJoueur = p.d.position ?? null;
    if (pc.poste) p.d.position = pc.poste;
    if (pc.tous.length > 1) log(`poste : ${p.name} a des cartes à plusieurs postes (${pc.tous.join(", ")}), retenu ${pc.poste}`);
  }

  const isJPL = (p) => p.d?.activeClub?.domesticLeague?.name === "First Division A";
  const inSet = (p) => p.sport === "FOOTBALL" && p.cards.some((c) => c.rarity === "common" && c.set === currentSet);
  // Set : les 40 meilleurs (L15) par poste parmi les joueurs qui jouent, pour limiter les appels API
  const setPool = new Set();
  for (const pos of ["Goalkeeper", "Defender", "Midfielder", "Forward"]) {
    players.filter((p) => p.d && !isJPL(p) && inSet(p) && p.d.position === pos && ["STARTER", "REGULAR", "SUPER_SUBSTITUTE"].includes(p.d.playingStatus))
      .sort((a, b) => (b.d.l15 || 0) - (a.d.l15 || 0)).slice(0, 40).forEach((p) => setPool.add(p.slug));
  }
  const relevant = players.filter((p) => p.d && (p.sport === "NBA" || isJPL(p) || setPool.has(p.slug)));
  // European Contenders (v5) : joueurs football avec une carte Limited ou plus rare, hors Jupiler et hors Set retenu ;
  // leurs matchs futurs sont lus en section 4 (1 appel anyFutureGames par joueur ; 1 joueur au 25/10/2026, Justin Reynolds).
  // Seulement s'il existe une competition European Contenders en cours ou a venir.
  const europeens = europe ? players.filter((p) => p.d && p.sport === "FOOTBALL" && !relevant.includes(p) && p.cards.some((c) => RARETES_EUROPE.has(c.rarity))) : [];
  for (const p of europeens) { p.europeSeul = true; relevant.push(p); }
  log(`${relevant.length} joueurs pertinents` + (europeens.length ? ` (dont ${europeens.length} pour European Contenders seulement)` : ""));

  // ---------- 4. Prochains matchs, projections Sorare, cotes ----------
  log("Matchs à venir…");
  const FQ = `query($slug:String!){ anyPlayer(slug:$slug){ slug anyFutureGames(first:6){ nodes { id date competition{ name } homeTeam{ slug name } awayTeam{ slug name }
    homeStats{ ... on FootballTeamGameStats{ winOddsBasisPoints } } awayStats{ ... on FootballTeamGameStats{ winOddsBasisPoints } }
    playerGameScore(playerSlug:$slug){ projectedScore projection{ grade reliabilityBasisPoints } anyPlayerGameStats{ ... on PlayerGameStats{ footballPlayingStatusOdds{ starterOddsBasisPoints reliability } } } } } } } }`;
  for (const p of relevant) {
    try { const d = await gq(FQ, { slug: p.slug }); p.games = d.anyPlayer.anyFutureGames.nodes; }
    catch (e) { p.games = []; log("matchs " + p.slug + " : " + e.message); }
    await sleep(apiKey ? 250 : 1500);
  }
  // Cotes de titularisation Sorare (footballPlayingStatusOdds) : verifie le 25/10/2026, le champ existe mais vaut null
  // pour tous les matchs, meme a quelques heures du coup d'envoi, avec une cle API seule (currentUser = null) ; les
  // cotes de victoire et les projections, elles, arrivent. Il faut une session Sorare authentifiee pour les obtenir.
  // proba_titulaire retombe alors sur le statut (joueurs.source_titulaire = "statut").
  const foot = relevant.filter((p) => p.sport === "FOOTBALL");
  const avecCote = foot.filter((p) => (p.games || []).some((g) => g.playerGameScore?.anyPlayerGameStats?.footballPlayingStatusOdds?.starterOddsBasisPoints != null)).length;
  log(`Cotes de titularisation Sorare : ${avecCote}/${foot.length} joueurs football`);

  // ---------- 5. Cotes externes (facultatif) ----------
  const odds = oddsKey ? await fetchOdds(oddsKey, log) : [];
  const espnData = espn ? await fetchEspn(relevant.filter((p) => p.sport === "NBA"), log) : new Map();
  const standings = espn ? await fetchStandings(log) : { find: () => null };
  const advRank = (name, sport) => {
    const t = standings.find(name, sport);
    return t ? { adv_attaque_rang: t.att, adv_defense_rang: t.def, adv_nb_equipes: t.n, adv_ligue: t.ligue, adv_attaque_val: t.attVal, adv_defense_val: t.defVal } : { adv_attaque_rang: null, adv_defense_rang: null, adv_nb_equipes: null, adv_ligue: "", adv_attaque_val: null, adv_defense_val: null };
  };

  // ---------- 6. Calibration : projections d'hier contre scores reels ----------
  const samples = (history.samples || []).filter((s) => Date.parse(s.date) > now - 60 * 86400e3);
  const actualByKey = new Map();
  for (const p of players) for (const g of (p.d?.playerGameScores || [])) actualByKey.set(p.slug + "|" + day(g.anyGame?.date), g.score);
  for (const s of samples) if (s.actual == null) { const a = actualByKey.get(s.slug + "|" + s.date); if (a != null) s.actual = a; }
  for (const s of samples) if (!s.sport) s.sport = byPlayer.get(s.slug)?.sport || "FOOTBALL";
  const done = samples.filter((s) => s.actual != null && s.pPlay > 0.5);
  let w = 0.5; // poids de la projection Sorare face a la forme
  if (done.length >= 40) {
    let best = Infinity;
    for (let k = 0; k <= 10; k++) {
      const ww = k / 10;
      const err = mean(done.map((s) => Math.abs((s.sorare != null ? ww * s.sorare + (1 - ww) * s.form : s.form) - s.actual)));
      if (err < best) { best = err; w = ww; }
    }
  }
  const recentAll = done.filter((s) => Date.parse(s.date) > now - 7 * 86400e3);
  const calib = (history.calibration || []).filter((c) => c.date !== day(now.toISOString()) && c.sport);
  for (const sp of ["FOOTBALL", "NBA"]) {
    const recent = recentAll.filter((s) => s.sport === sp);
    if (!recent.length) continue;
    calib.push({
      date: day(now.toISOString()), sport: sp, matchs: recent.length,
      erreur_modele: round(mean(recent.map((s) => Math.abs((s.sorare != null ? w * s.sorare + (1 - w) * s.form : s.form) - s.actual)))),
      erreur_sorare: round(mean(recent.filter((s) => s.sorare != null).map((s) => Math.abs(s.sorare - s.actual)))),
      erreur_forme: round(mean(recent.map((s) => Math.abs(s.form - s.actual)))),
      poids_sorare: w,
    });
  }

  return { gq, batched, fixturesRecentes, appels: () => calls, europe, estMatchEurope: (g) => estMatchEurope(europe, g), cards, players, byPlayer, currentSet, setName, fixtures, comps, relevant, isJPL, inSet, odds, espnData, standings, advRank, samples, w, calib };
}

// ---------- Poste football d'apres les cartes (Card.anyPositions) ----------
// cards : cartes d'un joueur (section 1, champ positions). Poste = celui de la carte de la saison la plus recente
// (le plus frequent si plusieurs cartes de cette saison) ; tous = postes distincts de toutes ses cartes.
function posteCartes(cards) {
  const avec = (cards || []).filter((c) => c.positions && c.positions.length);
  const tous = [...new Set(avec.flatMap((c) => c.positions))];
  if (!avec.length) return { poste: null, tous };
  const saison = Math.max(...avec.map((c) => Number(c.season) || 0));
  return { poste: mostCommon(avec.filter((c) => (Number(c.season) || 0) === saison).map((c) => c.positions[0])), tous };
}

// ---------- European Contenders (contrat v5) ----------
const RARETES_EUROPE = new Set(["limited", "rare", "super_rare", "unique"]); // « Higher scarcities permitted »
const EUROPE_SUFFIXE = "-special-weekly-european-contenders-division-1";
const EUROPE_COMPETITIONS_DEFAUT = ["Europa Conference League", "Europa League"]; // releve le 25/10/2026 (gameweek 723)
// Nom de competition -> cle comparable : « UEFA Europa League » = « Europa League », « UEFA Conference League » =
// « Europa Conference League » ; les autres noms sont compares tels quels (minuscules, sans accents).
function cleCompetition(nom) {
  const n = String(nom || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\buefa\b/g, "").replace(/\s+/g, " ").trim();
  if (/conference/.test(n)) return "conference-league";
  if (/europa league/.test(n)) return "europa-league";
  return n;
}
// g : match brut (anyFutureGames, competition{ name }), match du modele (competition : texte) ou nom de competition.
// Vrai si la competition est autorisee et si le match tombe dans la fenetre European Contenders.
function estMatchEurope(europe, g) {
  if (!europe || !g) return false;
  const nom = typeof g === "string" ? g : typeof g.competition === "string" ? g.competition : g.competition?.name;
  if (!europe.competitions.map(cleCompetition).includes(cleCompetition(nom))) return false;
  if (typeof g === "string" || !g.date) return true;
  const t = Date.parse(g.date);
  return !(t < Date.parse(europe.debut) - 3600e3) && !(t > Date.parse(europe.fin));
}
// Cherche le leaderboard sans deviner son slug (un slug absent fait echouer la requete, NOT_FOUND) : d'abord dans les
// leaderboards deja lus (gameweek LIVE et UPCOMING, 0 appel), puis dans les autres gameweeks football non terminees de
// so5Fixtures (appel partage avec paliers et bilan), 1 appel so5Fixture(slug) par gameweek, au plus 3, de la plus proche
// a la plus lointaine. Puis 1 appel pour ses regles. Retour : null ou
// { slug, nom, fixture, debut, fin, competitions[], taille, remplacants, capitaine, equipes, regles }.
async function chercheEurope({ gq, fixtures, fixturesRecentes, now = new Date(), log = () => {} }) {
  const t = +now;
  const cands = [];
  const L = fixtures.LIVE_FOOTBALL, U = fixtures.FOOTBALL;
  if (L?.enCours && L.so5Leaderboards) cands.push({ slug: L.slug, startDate: L.startDate, endDate: L.endDate, boards: L.so5Leaderboards });
  if (U?.so5Leaderboards) cands.push({ slug: U.slug, startDate: U.startDate, endDate: U.endDate, boards: U.so5Leaderboards });
  let trouve = null;
  const essaie = (c) => { const b = (c.boards || []).find((l) => l.slug.endsWith(EUROPE_SUFFIXE)); return b && !(Date.parse(c.endDate) < t) ? { ...c, board: b } : null; };
  for (const c of cands) if ((trouve = essaie(c))) break;
  if (!trouve && fixturesRecentes) {
    const vus = new Set(cands.map((c) => c.slug));
    const autres = (await fixturesRecentes("FOOTBALL")).filter((f) => f.slug && !vus.has(f.slug) && f.aasmState !== "closed" && !(Date.parse(f.endDate) < t))
      .sort((a, b) => (Date.parse(a.startDate) || 0) - (Date.parse(b.startDate) || 0)).slice(0, 3);
    for (const f of autres) {
      const d = await gq(`query($s:String!){ so5{ so5Fixture(slug:$s){ so5Leaderboards{ slug } } } }`, { s: f.slug });
      if ((trouve = essaie({ ...f, boards: d.so5.so5Fixture?.so5Leaderboards || [] }))) break;
    }
  }
  if (!trouve) { log("European Contenders : aucune compétition en cours ou à venir"); return null; }
  const slug = trouve.board.slug;
  const d = await gq(`query($s:String!){ so5{ so5Leaderboard(slug:$s){ slug displayName teamsCap so5League{ displayName } displayedTypedRules{ key descriptions{ title items{ title } } } } } }`, { s: slug });
  const lb = d.so5.so5Leaderboard || {};
  const rules = (lb.displayedTypedRules || []).map((r) => ({ key: r.key, items: r.descriptions.flatMap((x) => (x.items || []).map((i) => i.title).filter(Boolean)), text: r.descriptions.map((x) => [x.title, ...(x.items || []).map((i) => i.title)].filter(Boolean).join(" ")).join(" ; ") }));
  const regle = (k) => rules.find((r) => r.key === k);
  const comps = regle("Competitions")?.items || [];
  const scar = regle("Scarcity")?.text || "";
  const cap = (regle("CaptainScarcity")?.text || "").match(/(\d+)\s*%/);
  const europe = {
    slug, nom: lb.so5League?.displayName || "European Contenders", fixture: trouve.slug,
    debut: trouve.startDate || null, fin: trouve.endDate || null,
    competitions: comps.length ? comps : EUROPE_COMPETITIONS_DEFAUT,
    taille: Number((scar.match(/(\d+)\s*x/i) || [])[1]) || null,
    remplacants: Number((scar.match(/\+\s*(\d+)\s*Sub/i) || [])[1]) || 0,
    capitaine: cap ? Number(cap[1]) : null, equipes: lb.teamsCap ?? null,
    regles: rules.filter((r) => r.text).map((r) => r.text).join(" | "),
  };
  if (!comps.length) log("European Contenders : règle Competitions illisible, compétitions par défaut");
  log(`European Contenders : ${slug} (${europe.debut} → ${europe.fin}), ${europe.competitions.join(", ")}`);
  return europe;
}

function mostCommon(a) { const m = new Map(); a.forEach((x) => m.set(x, (m.get(x) || 0) + 1)); return [...m.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || null; }
function cardLabel(c) { return [c.rarity === "super_rare" ? "Super Rare" : c.rarity[0].toUpperCase() + c.rarity.slice(1), c.season, c.skin && c.skin !== "STANDARD" ? c.skin.toLowerCase() : "", c.inSeason ? "In-Season" : ""].filter(Boolean).join(" "); }

// ---------- Cotes externes : The Odds API (facultatif) ----------
const ODDS_SPORTS = ["basketball_nba", "soccer_belgium_first_div", "soccer_epl", "soccer_spain_la_liga", "soccer_germany_bundesliga", "soccer_france_ligue_one"];
async function fetchOdds(key, log) {
  const out = [];
  for (const s of ODDS_SPORTS) {
    try {
      const r = await fetch(`https://api.the-odds-api.com/v4/sports/${s}/odds?regions=eu&markets=h2h,totals&oddsFormat=decimal&apiKey=${encodeURIComponent(key)}`);
      if (!r.ok) { log("cotes " + s + " : HTTP " + r.status); continue; }
      for (const ev of await r.json()) {
        const h = {}, tot = [];
        for (const bm of ev.bookmakers || []) for (const mk of bm.markets || []) {
          if (mk.key === "h2h") { const inv = mk.outcomes.reduce((a, o) => a + 1 / o.price, 0); for (const o of mk.outcomes) (h[o.name] ||= []).push(1 / o.price / inv); }
          if (mk.key === "totals") { const ov = mk.outcomes.find((o) => o.name === "Over"), un = mk.outcomes.find((o) => o.name === "Under"); if (ov && un) tot.push({ line: ov.point, pOver: (1 / ov.price) / (1 / ov.price + 1 / un.price) }); }
        }
        const win = Object.fromEntries(Object.entries(h).map(([k, v]) => [k, v.reduce((a, x) => a + x, 0) / v.length]));
        out.push({ sport: s, home: ev.home_team, away: ev.away_team, date: ev.commence_time, win, totals: tot });
      }
    } catch (e) { log("cotes " + s + " : " + e.message); }
  }
  // Les bookmakers ne cotent qu'environ 24 h a l'avance (verifie le 25/10/2026 : NBA cotee jusqu'au lendemain,
  // puis seulement les matchs de Noel) : on l'ecrit dans le journal pour expliquer les cotes manquantes.
  const nbaEv = out.filter((e) => e.sport === "basketball_nba" && Object.keys(e.win).length).map((e) => e.date).sort();
  const proches = nbaEv.filter((d) => Date.parse(d) < Date.parse(nbaEv[0]) + 4 * 86400e3);
  log(`Cotes externes : ${out.length} matchs, dont ${nbaEv.length} NBA` + (proches.length ? ` (cotés jusqu'au ${proches[proches.length - 1].slice(0, 10)})` : ""));
  return out;
}
const norm = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/münchen|munchen/g, "munich").replace(/koln|köln/g, "cologne").replace(/\bsaint\b|\bst\b\.?/g, "st").replace(/\b\d+\b/g, "").replace(/\b(fc|kv|krc|rsc|kaa|sv|vv|afc|cf|sc|rc|rcd|ud|cd|sd|ca|ksv|ad|us|ss|ac|as|club|de|the|royal|1\.|fsv|tsg|vfb|vfl|ssc|ogc|losc)\b/g, "").replace(/[^a-z0-9]/g, "");
// NBA : on compare le surnom (dernier mot), unique par franchise : "LA Clippers" (Sorare) = "Los Angeles Clippers"
// (The Odds API), et "Los Angeles Lakers" ne se confond plus avec les Clippers (meme debut "losang").
const nick = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").pop() || "";
// Ressemblance de deux noms d'equipe : 3 identiques, 2 l'un contient l'autre, 1 meme debut (6 lettres), 0 differents
function teamScore(a, b, nba) {
  if (nba) { const x = nick(a), y = nick(b); return x && x === y ? 3 : 0; }
  const x = norm(a), y = norm(b);
  if (!x || !y) return 0;
  return x === y ? 3 : x.includes(y) || y.includes(x) ? 2 : x.slice(0, 6) === y.slice(0, 6) ? 1 : 0;
}
function matchOdds(odds, nba, team, opp, date) {
  if (!odds.length || !team) return null;
  const t = Date.parse(date);
  // Meilleure correspondance (et non la premiere) : evite de prendre Manchester City pour Manchester United
  let ev = null, best = 0, gap = Infinity;
  for (const e of odds) {
    if (nba ? e.sport !== "basketball_nba" : e.sport === "basketball_nba") continue;
    const dt = Math.abs(Date.parse(e.date) - t);
    if (!(dt < 36 * 3600e3)) continue;
    const s = Math.max(Math.min(teamScore(e.home, team, nba), teamScore(e.away, opp, nba)), Math.min(teamScore(e.home, opp, nba), teamScore(e.away, team, nba)));
    if (s > best || (s && s === best && dt < gap)) { ev = e; best = s; gap = dt; }
  }
  if (!ev) return null;
  const keyOf = (name) => { let k = null, b = 0; for (const x of Object.keys(ev.win)) { const s = teamScore(x, name, nba); if (s > b) { k = x; b = s; } } return k; };
  const key = keyOf(team);
  const win = key ? ev.win[key] : null;
  let total = null, cs = null;
  if (ev.totals.length) {
    const byLine = new Map(); for (const x of ev.totals) (byLine.get(x.line) || byLine.set(x.line, []).get(x.line)).push(x.pOver);
    const [line, ps] = [...byLine.entries()].sort((a, b) => b[1].length - a[1].length)[0];
    const pOver = ps.reduce((a, x) => a + x, 0) / ps.length;
    if (nba) total = line;
    else {
      // Poisson : trouver lambda total tel que P(buts > line) = pOver, puis repartir selon les chances de victoire
      let lo = 0.2, hi = 6;
      for (let i = 0; i < 40; i++) { const mid = (lo + hi) / 2; let c = 0, term = Math.exp(-mid); for (let k = 0; k <= Math.floor(line); k++) { c += term; term *= mid / (k + 1); } (1 - c < pOver ? (lo = mid) : (hi = mid)); }
      const lam = (lo + hi) / 2; total = Math.round(lam * 100) / 100;
      const oppKey = keyOf(opp);
      const pw = win ?? 0.4, po = oppKey ? ev.win[oppKey] : 0.3;
      const shareOpp = po / Math.max(0.05, pw + po);
      cs = Math.exp(-lam * shareOpp);
    }
  }
  return { win, total, cs };
}

// ---------- Paliers : scores reellement atteints a chaque recompense lors de la derniere gameweek terminee ----------
const REWARDS_Q = `rewardsConfig{ ranking{ ranks rankPct rewardConfigs{ __typename ...on CardRewardConfig{ rarity gameplayTier } ...on CardShardRewardConfig{ quantity configRarity } ...on MonetaryRewardConfig{ amount{ usdCents } } ...on InGameCurrencyRewardConfig{ currency amount } ...on CoinRewardConfig{ amount } } } }`;
const TIER_FR = { GOAT: "5★", STAR_PLUS: "4,5★", STAR: "4★", IMPACT_PLUS: "3,5★", IMPACT: "3★", ROSTER_PLUS: "2,5★", ROSTER: "2★" };
function rewardLabel(cfgs) {
  return cfgs.map((c) => {
    switch (c.__typename) {
      case "MonetaryRewardConfig": return Math.round((c.amount?.usdCents || 0) / 100) + " $";
      case "CardShardRewardConfig": return c.quantity + " essences " + (c.configRarity === "limited" ? "Limited" : c.configRarity);
      case "InGameCurrencyRewardConfig": return c.amount + " " + String(c.currency).replace("LIMITED_XP", "XP Limited");
      case "CardRewardConfig": return "carte " + (c.rarity === "limited" ? "Limited" : c.rarity) + (TIER_FR[c.gameplayTier] ? " " + TIER_FR[c.gameplayTier] : "");
      case "CoinRewardConfig": return c.amount + " coins";
      default: return c.__typename;
    }
  }).join(" + ");
}
async function collectePaliers(gq, comps, log, fixturesRecentes = null) {
  const out = [];
  const closed = {};
  for (const sport of ["FOOTBALL", "NBA"]) {
    const nodes = fixturesRecentes ? await fixturesRecentes(sport) : (await gq(`query($sport:Sport!){ so5{ so5Fixtures(sport:$sport, first:8){ nodes{ slug aasmState } } } }`, { sport })).so5.so5Fixtures.nodes;
    closed[sport] = nodes.filter((f) => f.aasmState === "closed").map((f) => f.slug);
  }
  const boards = new Map();
  const boardsOf = async (fx) => { if (!boards.has(fx)) { const d = await gq(`query($s:String!){ so5{ so5Fixture(slug:$s){ so5Leaderboards{ slug so5LineupsCount } } } }`, { s: fx }); boards.set(fx, d.so5.so5Fixture?.so5Leaderboards || []); } return boards.get(fx); };
  const med = (a) => { const s = a.slice().sort((x, y) => x - y); return s.length ? s[Math.floor((s.length - 1) / 2)] : null; };
  for (const c of comps) {
    const salon = !!(c.nbaDef?.salon || c.salon);
    for (const fx of closed[c.sport === "NBA" ? "NBA" : "FOOTBALL"]) {
      const list = await boardsOf(fx);
      const slug = fx + "-" + c.suffix;
      if (salon) {
        const rooms = list.filter((l) => l.slug.startsWith(slug + "-") && l.so5LineupsCount >= 5).slice(0, 40);
        if (!rooms.length) continue;
        const cfg = (await gq(`query($s:String!){ so5{ so5Leaderboard(slug:$s){ ${REWARDS_Q} } } }`, { s: rooms[0].slug })).so5.so5Leaderboard.rewardsConfig.ranking;
        const tops = [];
        for (const r of rooms) { const d = await gq(`query($s:String!){ so5{ so5Leaderboard(slug:$s){ so5Rankings(first:5){ nodes{ score } } } } }`, { s: r.slug }); tops.push(d.so5.so5Leaderboard.so5Rankings.nodes.map((x) => x.score)); await sleep(150); }
        let rang = 0;
        for (const t of cfg) { rang += t.ranks || 1; out.push({ sport: c.sport === "NBA" ? "NBA" : "Football", competition: c.nom, gw_reference: `${fx} (médiane de ${rooms.length} salons)`, type: "salon", rang, score: round(med(tops.map((x) => x[rang - 1]).filter((x) => x != null))), recompense: rewardLabel(t.rewardConfigs), participants: 10 }); }
        break;
      }
      const lb = list.find((l) => l.slug === slug);
      if (!lb || !lb.so5LineupsCount) continue;
      const cfg = (await gq(`query($s:String!){ so5{ so5Leaderboard(slug:$s){ ${REWARDS_Q} } } }`, { s: slug })).so5.so5Leaderboard.rewardsConfig.ranking;
      let cum = 0;
      for (const t of cfg) {
        cum += t.ranks ?? Math.round((t.rankPct || 0) * lb.so5LineupsCount / 100);
        if (cum < 1 || cum > lb.so5LineupsCount) continue;
        const d = await gq(`query($s:String!,$a:String){ so5{ so5Leaderboard(slug:$s){ so5Rankings(first:1, after:$a){ nodes{ score } } } } }`, { s: slug, a: cum > 1 ? b64(String(cum - 1)) : null });
        const sc = d.so5.so5Leaderboard.so5Rankings.nodes[0]?.score;
        if (sc != null) out.push({ sport: c.sport === "NBA" ? "NBA" : "Football", competition: c.nom, gw_reference: fx, type: "classement", rang: cum, score: round(sc, 2), recompense: rewardLabel(t.rewardConfigs), participants: lb.so5LineupsCount });
        await sleep(150);
      }
      break;
    }
  }
  log(`Paliers : ${out.length} lignes`);
  return out;
}
const b64 = (s) => (typeof btoa === "function" ? btoa(s) : Buffer.from(s).toString("base64"));

// ---------- Bilan de la derniere gameweek terminee (contrat v3, jeu bilan) ----------
// Source des compos : la derniere collecte enregistree avant la date limite de la gameweek (resume.gw_* / limite_*).
const SPORTS_BILAN = [["FOOTBALL", "Football", "football"], ["NBA", "NBA", "nba"]];
const resumeDe = (x) => (Array.isArray(x?.resume) ? x.resume[0] : x?.resume) || null;
// liste : [{ dossier, resume }] -> collectes candidates : pour chaque sport et chaque gameweek dont la date limite est passee
// (et la fin aussi, quand resume.gw_fin_* est connu), la derniere collecte faite avant la date limite. Aucun appel reseau.
function candidatsBilan(liste, now = new Date()) {
  const t = +now; const best = new Map();
  for (const x of liste) {
    const r = resumeDe(x); if (!r) continue;
    for (const [, , k] of SPORTS_BILAN) {
      const gw = r["gw_" + k], lim = Date.parse(r["limite_" + k]), maj = Date.parse(r.maj), fin = Date.parse(r["gw_fin_" + k]);
      if (!gw || !(maj < lim) || !(lim < t) || fin > t) continue;
      const cle = k + "|" + gw, cur = best.get(cle);
      if (!cur || maj > cur.maj) best.set(cle, { maj, x });
    }
  }
  return [...new Set([...best.values()].map((v) => v.x))];
}
// Scores reels sur la fenetre de la gameweek : NBA = meilleur match ; football = score So5 du match (le meilleur s'il y en a deux).
function scoreFenetre(d, sport, debut, fin) {
  if (!d) return null;
  const t0 = Date.parse(debut) - 3600e3, t1 = Date.parse(fin);
  const src = sport === "NBA" ? (d.playerGameScores || []).map((g) => ({ s: g.score, t: g.anyGame?.date }))
    : (d.so5Scores ? d.so5Scores.map((g) => ({ s: g.score, t: g.game?.date })) : (d.playerGameScores || []).map((g) => ({ s: g.score, t: g.anyGame?.date })));
  const dans = src.filter((g) => g.s != null && Date.parse(g.t) >= t0 && Date.parse(g.t) <= t1).map((g) => Number(g.s));
  return dans.length ? Math.max(...dans) : 0;
}
const palierLabel = (p) => (p.type === "salon" ? `${p.rang === 1 ? "1er" : p.rang + "e"} du salon : ${p.recompense}` : `top ${p.rang} : ${p.recompense}`);
// Meilleur palier (rang le plus petit) dont le score est atteint ; "aucun palier" si des paliers existent mais aucun n'est atteint
function meilleurPalier(liste, x) {
  if (!liste.length || x == null) return null;
  const p = liste.filter((q) => Number(q.score) <= x).sort((a, b) => a.rang - b.rang)[0];
  return p ? palierLabel(p) : "aucun palier";
}
// precedentes : [{ dossier, compos, competitions, paliers, resume }] (ou un seul objet) ; paliers : ceux de la collecte en cours.
// Cout : 0 appel en plus des paliers (so5Fixtures partage) ; + 1 appel par lot de 40 joueurs alignes qui ne sont plus dans le portefeuille.
async function collecteBilan({ gq, batched, fixturesRecentes, players }, precedentes, paliers = [], now = new Date(), log = console.log) {
  const liste = !precedentes ? [] : Array.isArray(precedentes) ? precedentes : [precedentes];
  if (!liste.length) return [];
  const t = +now; const choix = [];
  for (const [SP, nom, k] of SPORTS_BILAN) {
    const cands = liste.map((x) => ({ x, r: resumeDe(x) })).filter(({ r }) => r && r["gw_" + k] && Date.parse(r.maj) < Date.parse(r["limite_" + k]) && Date.parse(r["limite_" + k]) < t);
    if (!cands.length) continue;
    let fx = [];
    try { fx = await fixturesRecentes(SP); } catch (e) { log("bilan : gameweeks " + SP + " : " + e.message); }
    for (const c of cands) {
      const f = fx.find((y) => y.slug === c.r["gw_" + k]);
      c.debut = f?.startDate || c.r["gw_debut_" + k] || null; c.fin = f?.endDate || c.r["gw_fin_" + k] || null;
    }
    const finies = cands.filter((c) => c.debut && c.fin && Date.parse(c.fin) < t).sort((a, b) => Date.parse(b.fin) - Date.parse(a.fin) || Date.parse(b.r.maj) - Date.parse(a.r.maj));
    if (!finies.length) continue;
    const c = finies[0];
    choix.push({ SP, nom, c, gw: c.r["gw_" + k], lignes: (c.x.compos || []).filter((l) => l.sport === nom) });
  }
  if (!choix.some((x) => x.lignes.length)) { log("Bilan : aucune gameweek proposée terminée"); return []; }

  // Scores des joueurs alignes : deja lus pour le portefeuille (section 3), sinon une requete par lots de 40
  const parSlug = new Map(players.map((p) => [p.slug, p])), parNom = new Map(players.map((p) => [p.name, p]));
  const slugDe = (l) => l.slug || parNom.get(l.joueur)?.slug || null;
  const manquants = [...new Set(choix.flatMap((x) => x.lignes.map(slugDe)).filter((s) => s && !parSlug.get(s)?.d))];
  const extra = new Map();
  if (manquants.length) {
    const BQ = `query($s:[String!]!){ players(slugs:$s){ slug ... on Player { so5Scores(last:10){ score game{ date } } } ... on NBAPlayer { playerGameScores(last:10){ score anyGame{ date } } } } }`;
    try { (await batched(manquants, 40, async (s) => (await gq(BQ, { s })).players)).forEach((p) => p && extra.set(p.slug, p)); }
    catch (e) { log("bilan : scores des joueurs hors portefeuille : " + e.message); }
  }
  const dataDe = (s) => parSlug.get(s)?.d || extra.get(s) || null;

  const fr = (n) => (n == null ? "?" : String(round(n)).replace(".", ","));
  const out = [];
  for (const { SP, nom, c, gw, lignes } of choix) {
    const compets = c.x.competitions || [];
    const palSource = (c.x.paliers && c.x.paliers.length ? c.x.paliers : paliers) || [];
    const groupes = new Map();
    for (const l of lignes) { const cle = l.competition + "|" + (Number(l.numero) || 1); if (!groupes.has(cle)) groupes.set(cle, []); groupes.get(cle).push(l); }
    let sansPalier = 0;
    for (const [cle, t5] of groupes) {
      const competition = t5[0].competition, numero = Number(t5[0].numero) || 1;
      const comp = compets.find((x) => x.competition === competition);
      const pct = comp?.capitaine_pct != null ? Number(comp.capitaine_pct) : Number((String(comp?.contraintes || "").match(/capitaine \+(\d+)/) || [])[1] || 0);
      const prevuListe = String(comp?.scores_compos || "").split(" ").filter(Boolean).map(Number);
      const prevu = Number.isFinite(prevuListe[numero - 1]) ? prevuListe[numero - 1] : round(t5.reduce((a, l) => a + (Number(l.score_final) || 0), 0));
      let reel = 0; const detail = [];
      for (const l of t5) {
        const cap = l.capitaine === "Oui";
        const base = scoreFenetre(dataDe(slugDe(l)), SP, c.debut, c.fin);
        // Bonus de carte et capitaine s'additionnent (score × (1 + bonus + capitaine)) ; salons (slug « arena », Rooms NBA
        // et Cap 260) : aucun bonus de carte, seul le capitaine compte (cf. sansBonusCarte dans compos.mjs).
        const bonusCarte = /arena/.test(comp?.slug || "") ? 0 : (Number(l.bonus) || 0) / 100;
        const v = base == null ? null : base * (1 + bonusCarte + (cap ? pct / 100 : 0));
        reel = reel == null || v == null ? null : reel + v;
        detail.push(`${l.joueur}${cap ? " (C)" : ""} ${fr(l.score_final)}→${fr(v)}`);
      }
      const reelR = reel == null ? null : round(reel);
      const pals = (liste) => liste.filter((p) => p.competition === competition && p.score != null);
      const palGw = pals(paliers || []).filter((p) => p.gw_reference === gw || String(p.gw_reference).startsWith(gw + " "));
      if (!palGw.length && pals(palSource).length) sansPalier++;
      out.push({ sport: nom, gw, competition, numero, score_prevu: prevu, score_reel: reelR, ecart: reelR == null || prevu == null ? null : round(reelR - prevu),
        palier_vise: meilleurPalier(pals(palSource), prevu), palier_atteint: meilleurPalier(palGw, reelR), joueurs: detail.join(" ; "), source_compos: String(c.x.dossier || "") });
    }
    log(`Bilan ${nom} : ${groupes.size} compo(s) de ${gw} (collecte ${c.x.dossier || "?"})` + (sansPalier ? `, paliers de ${gw} pas encore relevés (gameweek non clôturée) : palier_atteint vide pour ${sansPalier}` : ""));
  }
  return out;
}

// ---------- ESPN (NBA) : blessures detaillees et minutes ----------
const pname = (s) => (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\b(jr|sr|ii|iii|iv)\b\.?/g, "").replace(/[^a-z]/g, "");
async function fetchEspn(nbaPlayers, log) {
  const out = new Map();
  const getJson = async (u) => { try { const r = await fetch(u); return r.ok ? await r.json() : null; } catch { return null; } };
  const byName = new Map();
  for (let id = 1; id <= 30; id++) {
    const ro = await getJson(`https://site.api.espn.com/apis/site/v2/sports/basketball/nba/teams/${id}/roster`);
    for (const a of ro?.athletes || []) byName.set(pname(a.displayName), { id: a.id, team: ro.team?.displayName || "" });
    await sleep(100);
  }
  const inj = new Map();
  const ij = await getJson("https://site.api.espn.com/apis/site/v2/sports/basketball/nba/injuries");
  for (const t of ij?.injuries || []) for (const e of t.injuries || []) {
    const det = e.details || {};
    inj.set(pname(e.athlete?.displayName), {
      nom: e.athlete?.displayName || "", equipe: t.displayName || "",
      statut: e.status || "", retour: det.returnDate || "",
      info: [det.type, det.detail, det.side].filter(Boolean).join(" ") + (e.shortComment ? " — " + e.shortComment : ""),
    });
  }
  // Minutes moyennes (5 derniers matchs) et tendance, depuis le journal de matchs ESPN
  const minCache = new Map();
  const minutesOf = async (id) => {
    if (minCache.has(id)) return minCache.get(id);
    const gl = await getJson(`https://site.web.api.espn.com/apis/common/v3/sports/basketball/nba/athletes/${id}/gamelog`);
    const res = { min5: null, trend: "", lastT: 0 };
    if (gl) {
      const evs = [];
      for (const st of gl.seasonTypes || []) for (const c of st.categories || []) for (const e of c.events || []) {
        const meta = gl.events?.[e.eventId]; const m = Number(String(e.stats?.[0] ?? "").split(":")[0]);
        if (meta?.gameDate && !Number.isNaN(m)) evs.push({ t: Date.parse(meta.gameDate), m });
      }
      evs.sort((x, y) => x.t - y.t);
      const last = evs.slice(-5).map((x) => x.m);
      if (last.length) res.min5 = Math.round(mean(last));
      res.lastT = evs.length ? evs[evs.length - 1].t : 0;
      const prev = evs.slice(-10, -5).map((x) => x.m);
      if (last.length >= 3 && prev.length >= 3) { const a1 = mean(last.slice(-3)), a0 = mean(prev); res.trend = a1 < a0 * 0.75 ? "en baisse" : a1 > a0 * 1.25 ? "en hausse" : "stable"; }
    }
    minCache.set(id, res); await sleep(120);
    return res;
  };
  const teamOut = new Map(); // equipe -> joueurs Out
  for (const [k, v] of inj) if (/^out/i.test(v.statut) && v.equipe) { if (!teamOut.has(v.equipe)) teamOut.set(v.equipe, []); teamOut.get(v.equipe).push({ k, ...v }); }
  let found = 0;
  for (const p of nbaPlayers) {
    const k = pname(p.name); const a = byName.get(k); const i = inj.get(k);
    const rec = { statut: i?.statut || "", retour: i?.retour || "", info: i?.info || "", min5: null, trend: "", absents: "", minLib: null };
    if (a) {
      found++;
      const mm = await minutesOf(a.id); rec.min5 = mm.min5; rec.trend = mm.trend;
      // Role elargi : coequipiers Out et leurs minutes habituelles
      const abs = [];
      for (const o of (teamOut.get(a.team) || []).filter((o) => o.k !== k)) {
        const oa = byName.get(o.k); const om = oa ? await minutesOf(oa.id) : { min5: null };
        // absence recente seulement : un joueur absent depuis des semaines n'apporte plus de minutes nouvelles
        if (om.min5 != null && om.min5 >= 10 && om.lastT > Date.now() - 21 * 86400e3) abs.push({ nom: o.nom, min: om.min5 });
      }
      abs.sort((x, y) => y.min - x.min);
      rec.absents = abs.map((x) => `${x.nom} (${x.min} min)`).join(", ");
      rec.minLib = abs.length ? abs.reduce((t, x) => t + x.min, 0) : null;
    }
    out.set(p.slug, rec);
  }
  log(`ESPN : ${found}/${nbaPlayers.length} joueurs NBA retrouvés, ${inj.size} blessures listées`);
  return out;
}

// ---------- Classements attaque / defense des adversaires (ESPN) ----------
const FOOT_LEAGUES = { "bel.1": "Jupiler Pro League", "eng.1": "Premier League", "esp.1": "LaLiga", "ger.1": "Bundesliga", "fra.1": "Ligue 1", "ita.1": "Serie A", "por.1": "Liga Portugal", "ned.1": "Eredivisie", "tur.1": "Süper Lig", "sco.1": "Premiership", "eng.2": "Championship", "esp.2": "LaLiga 2", "ger.2": "2. Bundesliga", "uefa.champions": "Ligue des champions", "uefa.europa": "Ligue Europa", "uefa.europa.conf": "Conference League" };
async function fetchStandings(log) {
  const getJson = async (u) => { try { const r = await fetch(u); return r.ok ? await r.json() : null; } catch { return null; } };
  const entries = (j) => (j?.children || (j ? [j] : [])).flatMap((c) => c.standings?.entries || []);
  const stat = (e, n) => e.stats?.find((x) => x.name === n)?.value;
  const teams = { NBA: [], FOOTBALL: [] };
  const rankIn = (list, key, desc) => { const sorted = list.slice().sort((a, b) => (desc ? b[key] - a[key] : a[key] - b[key])); sorted.forEach((t, i) => (t[key + "Rank"] = i + 1)); };
  // NBA : saison en cours, completee par la saison passee tant que peu de matchs ont ete joues
  const curYear = new Date().getUTCMonth() >= 8 ? new Date().getUTCFullYear() + 1 : new Date().getUTCFullYear();
  const cur = entries(await getJson("https://site.web.api.espn.com/apis/v2/sports/basketball/nba/standings"));
  const prev = entries(await getJson(`https://site.web.api.espn.com/apis/v2/sports/basketball/nba/standings?season=${curYear - 1}`));
  const prevBy = new Map(prev.map((e) => [e.team?.displayName, e]));
  const nba = cur.map((e) => {
    const g = (stat(e, "wins") || 0) + (stat(e, "losses") || 0);
    const p = prevBy.get(e.team?.displayName);
    const w = g / (g + 15);
    const blend = (n) => { const c = stat(e, n), q = p ? stat(p, n) : null; return c == null ? q : q == null ? c : w * c + (1 - w) * q; };
    return { name: e.team?.displayName, ligue: "NBA", att: blend("avgPointsFor"), def: blend("avgPointsAgainst") };
  }).filter((t) => t.name && t.att != null && t.def != null);
  rankIn(nba, "att", true); rankIn(nba, "def", false);
  teams.NBA = nba.map((t) => ({ name: t.name, ligue: "NBA", att: t.attRank, def: t.defRank, n: nba.length, attVal: Math.round(t.att * 10) / 10, defVal: Math.round(t.def * 10) / 10 }));
  for (const [code, ligue] of Object.entries(FOOT_LEAGUES)) {
    const list = entries(await getJson(`https://site.web.api.espn.com/apis/v2/sports/soccer/${code}/standings`)).map((e) => {
      const gp = stat(e, "gamesPlayed") || 0;
      return { name: e.team?.displayName, gp, att: gp ? (stat(e, "pointsFor") || 0) / gp : null, def: gp ? (stat(e, "pointsAgainst") || 0) / gp : null };
    }).filter((t) => t.name && t.att != null);
    rankIn(list, "att", true); rankIn(list, "def", false);
    for (const t of list) teams.FOOTBALL.push({ name: t.name, ligue, att: t.attRank, def: t.defRank, n: list.length, attVal: Math.round(t.att * 100) / 100, defVal: Math.round(t.def * 100) / 100 });
    await sleep(100);
  }
  log(`Classements : ${teams.NBA.length} équipes NBA, ${teams.FOOTBALL.length} équipes de football`);
  const cache = new Map();
  return {
    find(name, sport) {
      if (!name) return null;
      const key = sport + "|" + name;
      if (cache.has(key)) return cache.get(key);
      const list = teams[sport === "NBA" ? "NBA" : "FOOTBALL"];
      const n = norm(name);
      let hit = list.find((t) => norm(t.name) === n);
      if (!hit && n.length >= 4) {
        const c = list.filter((t) => { const m = norm(t.name); return m.length >= 4 && (m.includes(n) || n.includes(m)); });
        const starts = (t) => { const m = norm(t.name); return m.startsWith(n) || n.startsWith(m) ? 0 : 1; };
        if (c.length) hit = c.sort((a, b) => starts(a) - starts(b) || Math.abs(norm(a.name).length - n.length) - Math.abs(norm(b.name).length - n.length))[0];
      }
      cache.set(key, hit || null);
      return hit || null;
    },
  };
}

return { POS, sleep, round, mean, sd, day, collecte, posteCartes, cleCompetition, estMatchEurope, chercheEurope, cardLabel, matchOdds, collectePaliers, candidatsBilan, collecteBilan };
})();

// ===== modele.mjs =====
const __m_modele = (() => {
  const { POS, round, mean, sd, day, cardLabel, matchOdds } = __m_collecte;
// Modele de projection Sorare pour Elpredatooor : section 7 de l'ancien core.mjs (calcul par joueur).
// calculeJoueurs(contexte de collecte.mjs, now) -> { rows, newSamples }



// Etoiles Sorare NBA : les niveaux "PLUS" valent une demi-etoile de plus (ex. IMPACT_PLUS = 3,5)
const STARS = { GOAT: 5, STAR_PLUS: 4.5, STAR: 4, IMPACT_PLUS: 3.5, IMPACT: 3, ROSTER_PLUS: 2.5, ROSTER: 2, DNP_PLUS: 1.5, DNP: 1 };
const STATUS_P = { STARTER: 0.9, REGULAR: 0.75, SUPER_SUBSTITUTE: 0.5, SUBSTITUTE: 0.35, RESERVE: 0.1, NOT_PLAYING: 0, RETIRED: 0 };
// Esperance du maximum de n tirages d'une loi normale centree reduite
const EMAX = [0, 0, 0.564, 0.846, 1.029, 1.163, 1.267];
const FLOOR = { GOAT: 50, STAR_PLUS: 45, STAR: 40, IMPACT_PLUS: 35, IMPACT: 30, ROSTER_PLUS: 25, ROSTER: 20, DNP_PLUS: 15, DNP: 0 };

function calculeJoueurs({ fixtures, relevant, espnData, odds, advRank, isJPL, inSet, w }, now) {
  const t0 = now.getTime();
  const winF = { start: Date.parse(fixtures.FOOTBALL.startDate), end: Date.parse(fixtures.FOOTBALL.endDate) };
  const winN = { start: Date.parse(fixtures.NBA.startDate), end: Date.parse(fixtures.NBA.endDate) };
  const rows = [];
  const newSamples = [];
  for (const p of relevant) {
    const d = p.d; const nba = p.sport === "NBA";
    const club = d.activeClub?.name || ""; const clubSlug = d.activeClub?.slug || "";
    const hist = (d.playerGameScores || []).filter((g) => g.anyGame?.date).sort((a, b) => a.anyGame.date.localeCompare(b.anyGame.date));
    const scores = hist.map((g) => g.score ?? 0);
    const played = nba ? scores.filter((x) => x > 0) : hist.filter((g) => (g.anyPlayerGameStats?.minsPlayed || 0) > 0).map((g) => g.score);
    const mins = nba ? [] : hist.map((g) => g.anyPlayerGameStats?.minsPlayed || 0);
    const dec = (d.so5Scores || []).filter((s) => s.score > 0);
    const decShare = !nba && dec.length ? mean(dec.map((s) => Math.max(0, (s.decisiveScore?.totalScore ?? 35) - 35) / s.score)) : null;
    const cv = played.length >= 3 ? sd(played) / Math.max(1, mean(played)) : null;
    const form = (d.l5 || 0) * 0.6 + (d.l15 || 0) * 0.4;
    const inj = (d.activeInjuries || []).map((i) => [i.status, i.kind, i.expectedEndDate ? "retour " + day(i.expectedEndDate) : ""].filter(Boolean).join(" ")).join("; ");
    // Regle des blesses (choix de l'utilisateur du 25/10/2026, prudente, les deux sports) : absent pour tout match dont le
    // jour (NBA : soiree a New York ; football : heure de Bruxelles) est <= au jour de retour annonce ; present le lendemain.
    // Sorare : jour (UTC) de expectedEndDate, le plus tardif des blessures actives ; sans date : 30 jours.
    const injRetour = (d.activeInjuries || []).reduce((m, i) => { const j = day(i.expectedEndDate || new Date(t0 + 30 * 86400e3).toISOString()); return j > m ? j : m; }, "");
    const doubtful = /GTD|questionable|day.to.day|doubt/i.test(inj);
    const sus = (d.activeSuspensions || []).map((s) => "suspendu" + (s.endDate ? " jusqu'au " + day(s.endDate) : "")).join("; ");
    const susEnd = Math.max(0, ...(d.activeSuspensions || []).map((s) => (s.endDate ? Date.parse(s.endDate) : t0 + 30 * 86400e3)));
    const win = nba ? winN : winF;
    const es = nba ? espnData.get(p.slug) : null;
    // ESPN (NBA) : meme regle que Sorare. Avant le 25/10, la date ESPN sans heure etait lue a minuit UTC : un match le
    // soir du jour de retour (heure US) n'etait pas compte absent. Sans date de retour : 7 jours.
    const esRetour = es && /out/i.test(es.statut) ? day(es.retour || new Date(t0 + 7 * 86400e3).toISOString()) : "";
    const esFactor = es ? (/doubtful/i.test(es.statut) ? 0.25 : /questionable|day-to-day|game.time/i.test(es.statut) ? 0.6 : 1) : 1;
    const gameDates = (p.games || []).map((g) => Date.parse(g.date));
    const games = (p.games || []).map((g) => {
      const home = g.homeTeam?.slug === clubSlug;
      const opp = home ? g.awayTeam : g.homeTeam;
      const myOdds = (home ? g.homeStats : g.awayStats)?.winOddsBasisPoints;
      const oppOdds = (home ? g.awayStats : g.homeStats)?.winOddsBasisPoints;
      const pgs = g.playerGameScore || {};
      const so = pgs.anyPlayerGameStats?.footballPlayingStatusOdds;
      const t = Date.parse(g.date);
      const jm = jourDuMatch(t, nba);
      // Out Sorare ou Out ESPN : la plus tardive des deux dates de retour l'emporte (absent si l'une des deux couvre le jour)
      const out = (inj && !doubtful && absentLeJour(jm, injRetour)) || (sus && t < susEnd);
      const b2b = nba && gameDates.some((x) => x < t && t - x < 30 * 3600e3);
      let pPlay = nba ? (out || absentLeJour(jm, esRetour) ? 0 : (doubtful && absentLeJour(jm, injRetour) ? 0.5 : (d.l10 || 0) > 3 ? 0.95 : 0.4) * esFactor * (b2b ? 0.9 : 1))
        : out ? 0 : so?.starterOddsBasisPoints != null ? so.starterOddsBasisPoints / 10000 : (STATUS_P[d.playingStatus] ?? 0.5) * (doubtful ? 0.5 : 1);
      const sorare = pgs.projectedScore > 0 ? pgs.projectedScore : null;
      const proj = sorare != null ? w * sorare + (1 - w) * form : form;
      const ext = matchOdds(odds, nba, home ? g.homeTeam?.name : g.awayTeam?.name, opp?.name, g.date);
      return {
        date: g.date, t, competition: g.competition?.name || (nba ? "NBA" : ""), home, adversaire: opp?.name || "",
        winOdds: myOdds != null ? myOdds / 100 : ext?.win != null ? round(ext.win * 100) : null,
        oppWinOdds: oppOdds != null ? oppOdds / 100 : null,
        cleanSheet: ext?.cs != null ? round(ext.cs * 100) : null, total: ext?.total ?? null,
        sorare, grade: pgs.projection?.grade || "", pPlay, proj, b2b,
        // contrat v2 : origine de la proba de titularisation (football). null en NBA.
        srcTit: nba ? null : !out && so?.starterOddsBasisPoints != null ? "cote Sorare" : "statut",
        inWindow: t >= win.start && t <= win.end,
      };
    }).filter((g) => g.t > t0 - 3 * 3600e3);
    const gw = games.filter((g) => g.inWindow);
    const jplGames = games.filter((g) => g.competition === "First Division A");
    let expected = 0;
    if (nba) {
      const live = gw.filter((g) => g.pPlay > 0);
      if (live.length) {
        const m = mean(live.map((g) => g.proj));
        const s = sd(played.slice(-10)) ?? m * 0.3;
        const pAll = mean(live.map((g) => g.pPlay));
        expected = (m + (EMAX[Math.min(live.length, 6)] || 0) * s * 0.8) * Math.min(1, pAll + 0.05 * (live.length - 1));
      }
    } else {
      const g = (isJPL(p) ? jplGames.find((x) => x.inWindow) : null) || gw[0];
      if (g) expected = g.proj * g.pPlay;
    }
    const first = (nba ? gw.find((g) => g.pPlay > 0) : (isJPL(p) ? jplGames.find((x) => x.inWindow) : null) || gw[0]) || games[0];
    for (const g of games.filter((x) => x.pPlay > 0.5 && x.t < t0 + 3 * 86400e3)) newSamples.push({ slug: p.slug, sport: p.sport, date: day(g.date), sorare: g.sorare, form: round(form), pPlay: g.pPlay, actual: null });
    const best = bestCard(p.cards, nba ? null : isJPL(p) ? "limited" : "common");
    const modes = [nba ? "NBA" : null, isJPL(p) ? "JPL" : null, inSet(p) ? "SET" : null].filter(Boolean);
    rows.push({
      joueur: p.name, slug: p.slug, sport: p.sport, modes: modes.join(" "), club, poste: POS[d.position] || (nba ? "NBA" : d.position || ""),
      etoiles: nba ? STARS[d.gameplayTier] ?? null : null,
      plancher_etoiles: nba ? FLOOR[d.gameplayTier] ?? null : null,
      gain_etoiles: nba && FLOOR[d.gameplayTier] != null ? round(expected - FLOOR[d.gameplayTier]) : null,
      gain_sorare: nba && d.gainOnProjection != null ? round(d.gainOnProjection) : null,
      back_to_back: nba ? gw.filter((g) => g.b2b).length : null,
      espn_statut: es?.statut || "", espn_info: es?.info || "", espn_retour: es?.retour ? day(es.retour) : "",
      minutes_5: es?.min5 ?? null, minutes_tendance: es?.trend || "",
      statut: nba ? "" : d.playingStatus || "", blessure: inj, suspension: sus,
      l5: d.l5 ?? null, l10: d.l10 ?? null, l15: d.l15 ?? null,
      forme10: scores.map((x) => Math.round(x)).join(" "),
      minutes_moy: nba ? (es?.min5 ?? null) : mins.length ? Math.round(mean(mins)) : null,
      part_decisive: decShare != null ? Math.round(decShare * 100) : null,
      regularite: cv != null ? Math.round(cv * 100) : null,
      matchs_gw: gw.length, adversaire: first ? (first.home ? "vs " : "@ ") + first.adversaire : "", match: first?.date?.slice(0, 16) || "",
      ...advRank(first?.adversaire, p.sport),
      competition_match: first?.competition || "",
      proba_victoire: first?.winOdds ?? null, proba_victoire_adv: first?.oppWinOdds ?? null,
      clean_sheet: first?.cleanSheet ?? null, total_match: first?.total ?? null,
      proba_titulaire: first ? Math.round(first.pPlay * 100) : null, source_titulaire: nba ? null : first ? first.srcTit : null, grade_sorare: first?.grade || "",
      proj_sorare: first?.sorare != null ? round(first.sorare) : null, proj_forme: round(form),
      score_attendu: round(expected), carte: best ? best.slug : "", carte_label: best ? cardLabel(best) : "",
      bonus: best ? round((best.power - 1) * 100) : null, bonus_skin: best && best.skinBonus > 1 ? round((best.skinBonus - 1) * 100) : null,
      score_final: round(expected * (best ? best.power : 1)), nb_cartes: p.cards.length,
      proj_match: (() => { const l = (nba ? gw.filter((g) => g.pPlay > 0) : [first].filter(Boolean)); return l.length ? round(mean(l.map((g) => g.proj))) : round(form); })(),
      matchs_probables: nba ? gw.filter((g) => g.pPlay >= 0.5).length : null,
      coequipiers_absents: es?.absents || "", minutes_liberees: es?.minLib ?? null,
      _cards: p.cards, _games: games, _isJPL: isJPL(p), _inSet: inSet(p), _cv: cv ?? 0.5, _tier: d.gameplayTier, _clubSlug: clubSlug, _l15: d.l15 || 0, _pos: d.position,
    });
  }
  return { rows, newSamples };
}

// Jour d'un match pour la regle des blesses. NBA : soiree americaine, UTC − 5 (meme convention que matchs.jour et le
// calendrier de la page). Football : date a l'heure de Bruxelles (Jupiler ; heure de la date limite affichee).
function jourDuMatch(t, nba) {
  if (nba) return new Date(t - 5 * 3600e3).toISOString().slice(0, 10);
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  } catch { return new Date(t + 3600e3).toISOString().slice(0, 10); }
}
// Absent ce jour-la si une date de retour (AAAA-MM-JJ) est annoncee et que le jour du match ne la depasse pas
const absentLeJour = (jourMatch, retour) => !!retour && jourMatch <= retour;

function bestCard(list, rarity) { const l = list.filter((c) => !rarity || c.rarity === rarity); return (l.length ? l : list).slice().sort((a, b) => b.power * b.skinBonus - a.power * a.skinBonus)[0] || null; }

return { calculeJoueurs, jourDuMatch, absentLeJour };
})();

// ===== compos.mjs =====
const __m_compos = (() => {
  const { POS, round, day, cardLabel } = __m_collecte;
  const { jourDuMatch } = __m_modele;
// Compositions Sorare pour Elpredatooor : sections 8 a 12 de l'ancien core.mjs
// (compos, meilleurs par jour, changements, cartes et calendrier NBA pour le dashboard).
// calculeCompos(contexte de collecte.mjs, rows de modele.mjs, prev, now) -> { lineups, compRows, jours, changes, cartes, matchs, plan_arcade }
// planPiste(rows, gabarit, opts) : plan de piste football (contrat v5, colonne mode) ; planArcade (Set, cartes Common) et
// planEurope (Pro European Contenders, cartes Limited et plus, Ligue Europa / Conference League) en sont deux reglages.
// evalueRentabilite(compRows, lineups, paliers, rows) : apres les paliers (core.mjs), colonnes v3 de competitions et choix
// NBA entre In-Season en priorite 1 et l'option sans In-Season (modifie compRows et lineups en place).




function calculeCompos({ comps, currentSet, setName, fixtures, advRank, europe }, rows, prev, now = new Date()) {
  // ---------- 8. Compositions ----------
  const used = new Set();
  const order = [...comps].sort((a, b) => rank(a) - rank(b));
  // Option A : ordre de priorite actuel (In-Season NBA en priorite 1, decision de l'utilisateur du 24/10/2026)
  // NBA In-Season : seule In-Season Champion est jouee (In-Season Contender retiree de NBA_COMPS, utilisateur 25/10/2026) ;
  // le choix A / B, les raisons et la rentabilite restent generiques (toute competition NBA In-Season presente).
  const { lineups, compRows } = affecteCompetitions(order, rows, used);
  // Option B (NBA seulement, choix de l'utilisateur du 25/10/2026 : « recommander la meilleure au lieu d'appliquer la
  // priorite 1 aveuglement ») : memes competitions NBA sans les In-Season, les cartes In-Season restant disponibles pour
  // Classic et Rooms. Le choix entre A et B demande les paliers (connus apres les compos) : evalueRentabilite().
  // Football : jamais d'option B (cartes et competitions football non concernees).
  const nbaOrder = order.filter((c) => c.sport === "NBA");
  if (nbaOrder.some(estInSeasonNba)) OPTION_B.set(compRows, affecteCompetitions(nbaOrder, rows, new Set(), (c) => (estInSeasonNba(c) ? NON_RECOMMANDE : null)));
  // Mode Set (cartes Common du set en cours) : regles non publiques -> compo generique G/D/M/A + extra
  {
    const pool = rows.filter((r) => r._inSet).flatMap((r) => r._cards.filter((k) => k.rarity === "common" && k.set === currentSet && !used.has(k.slug)).map((card) => ({ r, card, value: r.score_attendu * card.power * card.skinBonus })));
    // meme regle que ci-dessus (proposition 2) : pas de compo Set si aucun joueur ne joue dans la gameweek ou si elle vaut 0
    const jouent = pool.some((x) => x.r.matchs_gw > 0);
    const sol0 = jouent ? optimise({ sport: "FOOTBALL", capitaine: 0 }, pool) : null;
    const sol = sol0 && sol0.total > 0 ? sol0 : null;
    const statutSet = sol ? "Compo proposée" : !pool.length ? "Aucune carte éligible" : !jouent ? "Aucun de tes joueurs du Set ne joue cette gameweek" : sol0 ? "Score attendu nul : " + SCORE_NUL : "Aucune carte éligible";
    const nom = "Football Set " + setName + " (Common)";
    compRows.push({ competition: nom, slug: "set-" + currentSet, sport: "Football", date_limite: fixtures.FOOTBALL.cutOffDate, joueurs_eligibles: new Set(pool.map((x) => x.r.slug)).size,
      contraintes: "gardien, défenseur, milieu, attaquant + extra ; bonus de carte et de skin inclus", max_compos: 1, nb_compos: sol ? 1 : 0, scores_compos: sol ? String(round(sol.total)) : "", score_compo: sol ? round(sol.total) : null, statut: statutSet,
      regles: "Règles du mode Set non lisibles via l'API publique : compo générique sur la gameweek football.", ...colonnesV3(0), type: "SET", rang: 9, cap_points: null, cap_etoiles: null, min_in_season: null, max_par_club: null, capitaine_pct: 0 });
    if (sol) for (const x of sol.picks) lineups.push({ competition: nom, sport: "Football", numero: 1, slot: x.slot, joueur: x.r.joueur, slug: x.r.slug, carte_id: x.card.slug, carte: cardLabel(x.card), capitaine: "",
      score_attendu: x.r.score_attendu, gain_etoiles: null, bonus: round((x.card.power * x.card.skinBonus - 1) * 100), score_final: round(x.value), etoiles: null, moyenne_cap: null, adversaire: x.r.adversaire, match: x.r.match, adv_attaque_rang: x.r.adv_attaque_rang, adv_defense_rang: x.r.adv_defense_rang, adv_nb_equipes: x.r.adv_nb_equipes });
  }
  // ---------- 9. Meilleurs joueurs par jour (modes Pro quotidiens) ----------
  const jours = [];
  const byDay = new Map();
  for (const r of rows) for (const g of r._games.slice(0, 4)) {
    if (g.pPlay <= 0) continue;
    const mode = r.sport === "NBA" ? "NBA" : r._isJPL ? "Jupiler" : r._inSet ? "Set " + setName : null;
    if (!mode) continue;
    // NBA : jour = soiree americaine (heure de New York, UTC − 5), comme matchs.jour (section 12) ; correctif du 25/10/2026
    // (un match a 01h00 UTC le 26/10 se joue le 25/10 au soir aux Etats-Unis). Football : date UTC, inchange.
    const k = mode + "|" + (r.sport === "NBA" ? day(new Date(g.t - 5 * 3600e3).toISOString()) : day(g.date));
    if (!byDay.has(k)) byDay.set(k, []);
    const ar = advRank(g.adversaire, r.sport);
    byDay.get(k).push({ joueur: r.joueur, v: (g.proj * g.pPlay), adversaire: (g.home ? "vs " : "@ ") + g.adversaire, heure: g.date.slice(0, 16), poste: r.sport === "NBA" ? "" : r.poste, ar });
  }
  for (const [k, list] of byDay) {
    const [mode, d] = k.split("|");
    list.sort((a, b) => b.v - a.v).slice(0, 5).forEach((x, i) => jours.push({ mode, jour: d, rang: i + 1, joueur: x.joueur, poste: x.poste, adversaire: x.adversaire, match: x.heure, score_attendu: round(x.v), adv_attaque_rang: x.ar.adv_attaque_rang, adv_defense_rang: x.ar.adv_defense_rang, adv_nb_equipes: x.ar.adv_nb_equipes }));
  }
  jours.sort((a, b) => a.jour.localeCompare(b.jour) || a.mode.localeCompare(b.mode) || a.rang - b.rang);

  // ---------- 10. Changements depuis la veille ----------
  const changes = calculeChangements(rows, prev, fixtures);

  // ---------- 11. Cartes (pour recalculer les compos dans le dashboard) ----------
  const cartes = [];
  for (const r of rows) for (const k of r._cards) {
    const nba = r.sport === "NBA";
    const ok = nba ? k.rarity === "limited" : (r._isJPL && k.rarity !== "common") || (r._inSet && k.rarity === "common" && k.set === currentSet);
    if (!ok) continue;
    cartes.push({ sport: nba ? "NBA" : "Football", slug: r.slug, joueur: r.joueur, carte_id: k.slug, label: cardLabel(k), rarete: k.rarity, saison: k.season, puissance: k.power, skin: k.skinBonus, in_season: k.inSeason, set_courant: k.rarity === "common" && k.set === currentSet });
  }
  // ---------- 12. Calendrier : NBA (matchs de la gameweek) et football Set (periode Arcade, contrat v4) ----------
  const matchs = [];
  for (const r of rows.filter((x) => x.sport === "NBA")) for (const g of r._games.filter((x) => x.inWindow)) {
    const ar = advRank(g.adversaire, "NBA");
    matchs.push({ sport: "NBA", slug: r.slug, joueur: r.joueur, date: g.date.slice(0, 16), jour: day(new Date(g.t - 5 * 3600e3).toISOString()), adversaire: (g.home ? "vs " : "@ ") + g.adversaire, proj: round(g.proj), proba: Math.round(g.pPlay * 100), b2b: g.b2b, adv_attaque_rang: ar.adv_attaque_rang, adv_defense_rang: ar.adv_defense_rang, adv_nb_equipes: ar.adv_nb_equipes, proba_victoire: g.winOdds ?? null, total: g.total ?? null, competition_match: "" });
  }
  // Football (contrat v4) : joueurs du Set, matchs dont le coup d'envoi tombe entre now et la fin de la periode Arcade
  // (gameweek EN COURS, fixtures.LIVE_FOOTBALL de collecte.mjs ; repli : gameweek a venir). jour = date a Bruxelles.
  const fen = fenetreArcade(fixtures, now);
  for (const r of rows.filter((x) => x.sport !== "NBA" && x._inSet)) for (const g of r._games.filter((x) => x.t >= fen.debut && x.t <= fen.fin)) {
    const ar = advRank(g.adversaire, r.sport);
    matchs.push({ sport: "Football", slug: r.slug, joueur: r.joueur, date: g.date.slice(0, 16), jour: jourDuMatch(g.t, false), adversaire: (g.home ? "vs " : "@ ") + g.adversaire, proj: round(g.proj), proba: Math.round(g.pPlay * 100), b2b: null, adv_attaque_rang: ar.adv_attaque_rang, adv_defense_rang: ar.adv_defense_rang, adv_nb_equipes: ar.adv_nb_equipes, proba_victoire: g.winOdds ?? null, total: g.total ?? null, competition_match: g.competition || "" });
  }
  // Football Pro European Contenders (contrat v5) : joueurs avec une carte Limited ou plus, matchs d'une competition autorisee
  // (Ligue Europa, Conference League) dans la periode Europe. Une seule ligne par slug + date (un joueur du Set peut y etre deja).
  const eu = fenetreEurope(europe ?? fixtures?.EUROPE, now);
  if (eu) {
    const deja = new Set(matchs.map((x) => x.slug + "|" + x.date));
    for (const r of rows.filter((x) => x.sport !== "NBA" && (x._cards || []).some((k) => PISTE_EUROPE.carte(k)))) for (const g of r._games.filter((x) => x.t >= eu.debut && x.t <= eu.fin && PISTE_EUROPE.match(x, eu))) {
      const date = g.date.slice(0, 16); if (deja.has(r.slug + "|" + date)) continue; deja.add(r.slug + "|" + date);
      const ar = advRank(g.adversaire, r.sport);
      matchs.push({ sport: "Football", slug: r.slug, joueur: r.joueur, date, jour: jourDuMatch(g.t, false), adversaire: (g.home ? "vs " : "@ ") + g.adversaire, proj: round(g.proj), proba: Math.round(g.pPlay * 100), b2b: null, adv_attaque_rang: ar.adv_attaque_rang, adv_defense_rang: ar.adv_defense_rang, adv_nb_equipes: ar.adv_nb_equipes, proba_victoire: g.winOdds ?? null, total: g.total ?? null, competition_match: g.competition || "" });
    }
  }
  // ---------- 12 bis. Plans de piste football : Arcade (Set, contrat v4) puis European Contenders (Pro, contrat v5) ----------
  const plan_arcade = planArcade(rows, { currentSet, debut: fen.debut, fin: fen.fin }).concat(eu ? planEurope(rows, eu) : []);
  return { lineups, compRows, jours, changes, cartes, matchs, plan_arcade };
}

// Periode Arcade : de now (ou du debut de la gameweek en cours s'il est plus tard) a la fin de la gameweek football EN COURS
// (fixtures.LIVE_FOOTBALL, ajoute par l'agent donnees le 25/10/2026 = resume.arcade_debut / arcade_fin ; sans gameweek
// en cours, enCours: false et collecte.mjs y met deja la fenetre de la gameweek a venir) ; repli : fixtures.FOOTBALL.
function fenetreArcade(fixtures, now) {
  const f = fixtures?.LIVE_FOOTBALL?.endDate ? fixtures.LIVE_FOOTBALL : fixtures?.FOOTBALL || {};
  const t0 = new Date(now).getTime();
  return { debut: Math.max(t0, Date.parse(f.startDate) || t0), fin: Date.parse(f.endDate) || t0 };
}

// Periode European Contenders (contrat v5, resume.europe_*) : contexte.europe de collecte.mjs (chercheEurope, agent donnees :
// { slug, debut, fin, competitions, capitaine, ... }) ; accepte aussi { startDate, endDate }. Sans fenetre : null -> ni plan
// europe ni matchs europeens. competitions : regle API Competitions (repli EUROPE_COMPETITIONS) ; capitaine : regle API
// CaptainScarcity (repli EUROPE_CAPITAINE).
function fenetreEurope(e, now) {
  const fin = Date.parse(e?.fin ?? e?.endDate);
  if (!e || !Number.isFinite(fin)) return null;
  const t0 = new Date(now).getTime();
  return { debut: Math.max(t0, Date.parse(e.debut ?? e.startDate) || t0), fin, competitions: Array.isArray(e.competitions) && e.competitions.length ? e.competitions : EUROPE_COMPETITIONS, capitaine: Number(e.capitaine) > 0 ? Number(e.capitaine) : EUROPE_CAPITAINE };
}

// ---------- Pistes football : Arcade (Set) et European Contenders (Pro) ; FOOTBALL SEULEMENT ----------
// Un seul planificateur (planPiste), parametre par un gabarit de piste (PISTE_ARCADE, PISTE_EUROPE) : mode, seuils, cartes
// admises, matchs admis, capitaine, valeur d'une carte, largeurs de creneau. Sortie : jeu plan_arcade (contrat v5, colonne mode).
//
// Arcade. Regles (utilisateur 25/10/2026 + aide Sorare « What is Arcade? ») : 6 paliers aux seuils ci-dessous ; a chaque palier,
// jusqu'a 4 compos engagees en meme temps (4 vies) ; une seule qui atteint le seuil suffit pour passer au palier suivant ;
// si les 4 echouent, retour au palier 1. Une carte jouee ne resert plus. Compo G/D/M/A + 1 joueur de champ, bonus de carte
// × skin, pas de capitaine. Resultat d'un lot connu au plus tard 1h50 apres le dernier coup d'envoi de ses joueurs (marge
// de l'utilisateur) : le lot suivant ne prend que des joueurs dont le match commence a partir de ce moment.
// Bonus de collection (jusqu'a 5 % pour plusieurs joueurs du meme club) : IGNORE (bareme exact non publie, pas modelisable proprement).
const ARCADE_SEUILS = [260, 300, 360, 400, 440, 480]; // utilisateur 25/10/2026
const ARCADE_DELAI = 110 * 60e3; // 1h50, marge choisie par l'utilisateur le 25/10/2026 (Arcade et European Contenders)
const ARCADE_VIES = 4; // 4 compos par palier (aide Sorare « What is Arcade? » ; « What is Pro? » : 4 vies aussi)
// Largeur d'un creneau (choix du stratege) : coups d'envoi entre t et t + largeur, largeur 0 (une seule vague), 1 h ou
// 2 h. Plus large = plus de joueurs mais resultat plus tardif ; la recherche choisit pour chaque lot la largeur la
// plus rentable (au palier 1 aussi : jouer au plus tot, mais sans bloquer la vague suivante si ce n'est pas utile).
const ARCADE_LARGEURS = [0, 3600e3, 2 * 3600e3];
// Objectif : nombre espere de paliers franchis d'ici la fin. true = un palier refranchi apres un retour au palier 1
// compte de nouveau : Sorare redonne la recompense a chaque passage (confirme par l'utilisateur le 25/10/2026). Le plan
// conseille donc rarement d'attendre : un echec ne coute que le temps de refranchir les paliers deja passes.
const ARCADE_RECOMPTE = true;
const ARCADE_PAR_POSTE = 6; // candidats par poste dans la recherche exhaustive d'une compo

// European Contenders (mode Pro football ; regles donnees par l'utilisateur le 25/10/2026, sauf mention) : 6 paliers aux
// seuils ci-dessous ; compo G/D/M/A + extra (jamais gardien) avec capitaine ; 4 vies (4 compos par palier) ; un succes fait
// monter, 4 echecs ramenent au palier 1 ; recompense redonnee a chaque passage (ARCADE_RECOMPTE) ; 1h50 apres le dernier
// coup d'envoi (ARCADE_DELAI). Cartes et matchs : regles API (docs/europa-contenders.md). Bonus : aide Sorare « What is Pro? »
// (XP, collection, nouvelle saison et capitaine comptent ; pas de bonus de rarete). Skin : non applique (bonus propre au Set).
// Les cartes sont consommees comme en Arcade : sans effet ici, chaque joueur n'a qu'un match europeen dans la periode.
const EUROPE_SEUILS = [350, 390, 410, 450, 470, 500]; // utilisateur 25/10/2026
// API displayedTypedRules CaptainScarcity « Card score increased by 50% » ; additif (bonus de la carte + 50 % du score du
// joueur), comme optimise() : releve so5Appearances du 25/10/2026 et aide « What is Pro? »
const EUROPE_CAPITAINE = 50;
// API Scarcity « Limited Cards » + « Higher scarcities permitted » ; Common exclues
const EUROPE_RARETES = ["limited", "rare", "super_rare", "unique"];
// API Competitions « Players permitted from Europa Conference League, Europa League » (repli si collecte.mjs ne les fournit pas)
const EUROPE_COMPETITIONS = ["Europa League", "Europa Conference League"];
// Choix du stratege : en Pro, une compo est modifiable jusqu'au premier coup d'envoi de ses joueurs et la marche court
// jusqu'a la fin de la journee (aide « What is Pro? ») : on admet aussi des creneaux de 3 h et 6 h pour melanger les
// matchs de 18h45 et de 21h00 d'un meme jeudi europeen.
const EUROPE_LARGEURS = [0, 3600e3, 2 * 3600e3, 3 * 3600e3, 6 * 3600e3];
// Nom de competition -> cle comparable (l'API dit « UEFA Conference League » dans les matchs, « Europa Conference League »
// dans les regles ; « UEFA Europa League » / « Europa League »)
const cleCompetition = (s) => { const x = String(s || "").toLowerCase(); return /conference/.test(x) ? "conference" : /champions/.test(x) ? "champions" : /europa/.test(x) ? "europa" : x.replace(/\buefa\b/g, "").trim(); };
// Puissance d'une carte sans la part rarete (powerBreakdown.scarcityBasisPoints, collecte en section 1). Sans powerBreakdown,
// la puissance totale est gardee (surestime une carte Rare ou plus si Sorare y met un bonus de rarete).
const puissanceSansRarete = (card) => (Number(card.power) || 1) - (Number(card.bp?.scarcityBasisPoints) || 0) / 10000;

// Gabarits de piste. carte(card, opts), joueur(r), match(g, opts), valeur(base = proj × pPlay, card)
const PISTE_ARCADE = { mode: "arcade", seuils: ARCADE_SEUILS, capitaine: 0, largeurs: ARCADE_LARGEURS, horizon: "la gameweek", expliquer: false,
  carte: (card, o) => card.rarity === "common" && card.set === o.currentSet, joueur: (r) => !!r._inSet, match: () => true,
  // meme loi que loiCompo (Set : bonus de carte × skin, pas de capitaine), avec la projection et la proba du match
  valeur: (base, card) => base * card.power * card.skinBonus };
const PISTE_EUROPE = { mode: "europe", seuils: EUROPE_SEUILS, capitaine: EUROPE_CAPITAINE, largeurs: EUROPE_LARGEURS, horizon: "la période European Contenders", expliquer: true,
  carte: (card) => EUROPE_RARETES.includes(card.rarity), joueur: () => true,
  match: (g, o) => (o.competitions || EUROPE_COMPETITIONS).some((c) => cleCompetition(c) === cleCompetition(g.competition)),
  valeur: (base, card) => base * puissanceSansRarete(card) };

const heureBx = (t) => { try { return new Intl.DateTimeFormat("fr-BE", { timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit" }).format(new Date(t)).replace(":", "h"); } catch { return new Date(t).toISOString().slice(11, 16).replace(":", "h"); } };
const jourBx = (t) => { try { return new Intl.DateTimeFormat("fr-BE", { timeZone: "Europe/Brussels", weekday: "long" }).format(new Date(t)); } catch { return ""; } };
const dateBx = (t) => { try { return new Intl.DateTimeFormat("fr-BE", { timeZone: "Europe/Brussels", day: "numeric", month: "numeric" }).format(new Date(t)); } catch { return new Date(t).toISOString().slice(5, 10); } };
const quand = (t, ref) => (jourDuMatch(t, false) === jourDuMatch(ref, false) ? heureBx(t) : jourBx(t) + " " + heureBx(t));

// Meilleure compo (chance de depasser le seuil) parmi les unites { r, g, card, value, base, sd } ; un joueur une seule fois.
// capt > 0 : chaque joueur de la compo est essaye comme capitaine (bonus additif : + base × capt ; ecart-type × (1 + capt /
// puissance), comme loiCompo). capt = 0 (Arcade) : calcul identique a l'ancien meilleureCompoArcade.
function meilleureCompoPiste(units, seuil, capt = 0) {
  const best = new Map();
  for (const u of units) { const o = best.get(u.r.slug); if (!o || u.value > o.value) best.set(u.r.slug, u); }
  const l = [...best.values()].sort((a, b) => b.value - a.value);
  const par = (p) => l.filter((u) => u.r._pos === p).slice(0, ARCADE_PAR_POSTE);
  const G = par("Goalkeeper"), D = par("Defender"), M = par("Midfielder"), F = par("Forward");
  if (!G.length || !D.length || !M.length || !F.length) return null;
  const E = [...D, ...M, ...F]; // extra : jamais gardien
  const caps = capt > 0 ? [0, 1, 2, 3, 4] : [-1];
  let top = null;
  for (const g of G) for (const d of D) for (const m of M) for (const f of F) {
    const m4 = g.value + d.value + m.value + f.value, v4 = g.sd ** 2 + d.sd ** 2 + m.sd ** 2 + f.sd ** 2;
    for (const e of E) {
      if (e === d || e === m || e === f) continue;
      const five = [g, d, m, f, e];
      for (const ci of caps) {
        let mean = m4 + e.value, v = v4 + e.sd ** 2;
        if (ci >= 0) { const c = five[ci], k = c.value > 0 ? 1 + capt * c.base / c.value : 1; mean += c.base * capt; v += (c.sd * k) ** 2 - c.sd ** 2; }
        const sd = Math.sqrt(v);
        const p = pAbove(mean, sd, seuil);
        // a chance egale (souvent 0 % ou 100 %), la plus haute moyenne
        if (!top || p > top.p + 1e-12 || (Math.abs(p - top.p) <= 1e-12 && mean > top.mean)) top = { p, mean, sd, cap: ci >= 0 ? five[ci] : null, picks: [[g, "Gardien"], [d, "Défenseur"], [m, "Milieu"], [f, "Attaquant"], [e, "Extra"]] };
      }
    }
  }
  return top;
}
// Lot : jusqu'a 4 compos sans carte commune, composees de facon gloutonne (meilleure chance d'abord)
function lotPiste(units, seuil, capt) {
  let rest = units; const compos = [];
  while (compos.length < ARCADE_VIES) {
    const c = meilleureCompoPiste(rest, seuil, capt);
    if (!c) break;
    compos.push(c);
    const pris = new Set(c.picks.map(([u]) => u.card.slug));
    rest = rest.filter((u) => !pris.has(u.card.slug));
  }
  if (!compos.length) return null;
  const ts = compos.flatMap((c) => c.picks.map(([u]) => u.g.t));
  return { compos, p: 1 - compos.reduce((q, c) => q * (1 - c.p), 1), creneau: Math.min(...ts), resultat: Math.max(...ts) + ARCADE_DELAI };
}

// Pourquoi aucune compo n'est possible (piste qui l'explique : European Contenders). Fonde sur r._pos (joueurs.poste).
function raisonPisteVide(units, P, fin) {
  const quoi = "tes cartes Limited (ou plus) qui jouent la Ligue Europa ou la Conference League d'ici le " + dateBx(fin);
  if (!units.length) return "Aucune compo possible : aucune de tes cartes Limited (ou plus) ne joue la Ligue Europa ou la Conference League d'ici le " + dateBx(fin) + ".";
  const pos = new Set(units.map((u) => u.r._pos));
  const manque = [["Goalkeeper", "gardien"], ["Defender", "défenseur"], ["Midfielder", "milieu"], ["Forward", "attaquant"]].filter(([p]) => !pos.has(p)).map(([, n]) => n);
  if (manque.length) return `Aucune compo possible : aucun ${manque.join(" ni ")} parmi ${quoi}. Il faut une carte de plus à ce poste.`;
  if (!meilleureCompoPiste(units, P.seuils[0], P.capitaine / 100)) return `Aucune compo possible : il faut 4 joueurs de champ différents (l'extra ne peut pas être gardien) parmi ${quoi}.`;
  return `Aucune compo possible : les joueurs nécessaires ne jouent pas dans un même créneau de ${Math.max(...P.largeurs) / 3600e3} h.`;
}

// Plan pour chaque palier de depart (1 a 6) maximisant le nombre espere de paliers franchis d'ici fin.
// Programmation dynamique sur (palier, premier coup d'envoi autorise) : V(k, i) = max sur la largeur ( jouer le creneau i :
// p (1 + V(k+1, j)) + (1 − p) V(1, j) ), attendre : V(k, i+1) ), j = premier coup d'envoi >= resultat du lot. Palier 1 : rien a perdre, on joue
// le premier creneau jouable. Apres le palier 6, plus rien a gagner (V = 0). La recherche ignore la consommation des cartes
// (un joueur ne joue en principe qu'un match par periode) ; le plan affiche, lui, retire les cartes deja jouees.
// opts : { debut, fin, currentSet (Arcade), competitions (Europe), recompte }. Piste qui explique (Europe) sans compo
// possible : une seule ligne d'information (etape 0, compo 0, conseil = raison).
function planPiste(rows, P, opts) {
  const { debut, fin, recompte = ARCADE_RECOMPTE } = opts;
  const SEUILS = P.seuils, LARG = P.largeurs, capt = (P.capitaine || 0) / 100;
  const units = [];
  for (const r of rows) {
    if (r.sport === "NBA" || !P.joueur(r)) continue;
    const cards = (r._cards || []).filter((k) => P.carte(k, opts));
    for (const g of r._games || []) {
      if (!(g.t >= debut && g.t <= fin) || !(g.pPlay > 0) || !P.match(g, opts)) continue;
      for (const card of cards) {
        const base = g.proj * g.pPlay, value = P.valeur(base, card);
        units.push({ r, g, card, value, base, sd: ecartTypeJoueur({ sport: r.sport, regularite: r.regularite, proba_titulaire: g.pPlay * 100 }, value) });
      }
    }
  }
  const info = (conseil) => (P.expliquer ? [{ mode: P.mode, depart: 1, etape: 0, palier: 1, seuil: SEUILS[0], creneau: "", resultat_vers: "", compo: 0, joueurs: "", score_attendu: null, proba_compo: null, proba_palier: null, conseil }] : []);
  if (!units.length) return info(raisonPisteVide(units, P, fin));
  const T = [...new Set(units.map((u) => u.g.t))].sort((a, b) => a - b);
  const n = T.length, K = SEUILS.length;
  const dansCreneau = (i, w, exclus) => units.filter((u) => u.g.t >= T[i] && u.g.t <= T[i] + LARG[w] && !exclus.has(u.card.slug));
  const memoLot = new Map();
  const lot = (i, k, w) => { const key = (i * 8 + k) * 8 + w; if (!memoLot.has(key)) memoLot.set(key, lotPiste(dansCreneau(i, w, new Set()), SEUILS[k - 1], capt)); return memoLot.get(key); };
  const suivant = (t) => { let j = 0; while (j < n && T[j] < t) j++; return j; };
  const memo = new Map();
  // V(k, b, i) -> { v, i (creneau joue ou -1), w (largeur), j } ; b = plus haut palier deja franchi (pour ARCADE_RECOMPTE)
  const gain = (k, b) => (recompte || k > b ? 1 : 0);
  const V = (k, b, i) => {
    if (k > K || i >= n) return { v: 0, i: -1 };
    if (recompte) b = 0;
    const key = (k * 8 + b) * 1000 + i; if (memo.has(key)) return memo.get(key);
    let res = { v: 0, i: -1 }, jouable = false;
    LARG.forEach((_, w) => {
      const L = lot(i, k, w); if (!L) return;
      jouable = true;
      const j = suivant(L.resultat), v = L.p * (gain(k, b) + V(k + 1, Math.max(b, k), j).v) + (1 - L.p) * V(1, b, j).v;
      if (res.i < 0 || v > res.v + 1e-9) res = { v, i, w, j };
    });
    if (k > 1 || !jouable) { const a = V(k, b, i + 1); if (a.v > res.v + 1e-9) res = a; }
    memo.set(key, res); return res;
  };
  for (let i = n - 1; i >= 0; i--) for (let k = K; k >= 1; k--) for (let b = 0; b <= K; b++) V(k, b, i); // memo sans recursion profonde
  const plan = [];
  const fmtJ = (c) => ([u, poste]) => `${poste} ${u.r.joueur} (${u.r.club}, ${quand(u.g.t, debut)}) ${String(round(u.value + (u === c.cap ? u.base * capt : 0))).replace(".", ",")}${u === c.cap ? " (capitaine)" : ""}`;
  const pc = (p) => (p >= 0.995 ? "> 99 %" : p < 0.005 ? "< 1 %" : Math.round(p * 100) + " %");
  for (let depart = 1; depart <= K; depart++) {
    // chemin des reussites : depart, depart + 1, ... ; chaque conseil dit quoi faire en cas d'echec (retour au palier 1)
    const exclus = new Set(); let k = depart, i = 0, etape = 0, b = depart - 1;
    const esp = V(depart, b, 0).v;
    while (k <= K && i < n) {
      const d = V(k, b, i); if (d.i < 0) break;
      const L = lotPiste(dansCreneau(d.i, d.w, exclus), SEUILS[k - 1], capt);
      if (!L) break;
      etape++;
      const j = suivant(L.resultat);
      const echec = V(1, b, j);
      const apresEchec = echec.i >= 0 ? ` En cas d'échec des ${L.compos.length} : retour au palier 1, rejouer dès ${quand(T[echec.i], debut)}.` : ` En cas d'échec : retour au palier 1, plus de créneau avant la fin de ${P.horizon}.`;
      const nC = L.compos.length === 1 ? "1 compo" : L.compos.length + " compos";
      let conseil;
      if (k === 1) conseil = `Jouer ${nC} dès ${quand(L.creneau, debut)} : rien à perdre au palier 1.`;
      else {
        const premier = LARG.map((_, w) => lot(i, k, w)).filter(Boolean).sort((a, b) => b.p - a.p)[0];
        const auLieu = premier && d.i > i ? (premier.p < L.p - 0.005 ? ` (${pc(premier.p)} en jouant dès ${quand(premier.creneau, debut)})` : ` (jouer dès ${quand(premier.creneau, debut)} bloquerait les créneaux suivants)`) : "";
        conseil = d.i > i ? `Attendre le créneau de ${quand(L.creneau, debut)} et y jouer ${nC} : ${pc(L.p)} de passer le palier ${k}${auLieu}.` : `Jouer ${nC} dès ${quand(L.creneau, debut)} : ${pc(L.p)} de passer le palier ${k}.`;
        conseil += apresEchec;
      }
      if (etape === 1) conseil += ` Nouveaux paliers espérés d'ici la fin de ${P.horizon} : ${String(round(esp, 2)).replace(".", ",")}.`;
      L.compos.forEach((c, ci) => {
        plan.push({ mode: P.mode, depart, etape, palier: k, seuil: SEUILS[k - 1], creneau: new Date(L.creneau).toISOString().slice(0, 16), resultat_vers: new Date(L.resultat).toISOString().slice(0, 16),
          compo: ci + 1, joueurs: c.picks.map(fmtJ(c)).join(" ; "), score_attendu: round(c.mean), proba_compo: round(c.p * 100), proba_palier: round(L.p * 100), conseil });
        for (const [u] of c.picks) exclus.add(u.card.slug);
      });
      b = Math.max(b, k); k++; i = j;
    }
  }
  return plan.length ? plan : info(raisonPisteVide(units, P, fin));
}
// Arcade (Set) : signature d'avant, resultat identique (plus la colonne mode = "arcade")
function planArcade(rows, { currentSet, debut, fin, recompte = ARCADE_RECOMPTE }) { return planPiste(rows, PISTE_ARCADE, { currentSet, debut, fin, recompte }); }
// European Contenders (Pro) : competitions = noms autorises lus par collecte.mjs (repli EUROPE_COMPETITIONS)
function planEurope(rows, { debut, fin, competitions = EUROPE_COMPETITIONS, capitaine = EUROPE_CAPITAINE, recompte = ARCADE_RECOMPTE }) { return planPiste(rows, { ...PISTE_EUROPE, capitaine }, { debut, fin, competitions, recompte }); }

// NBA In-Season (slug in_season ou regle API "SeasonBonus")
const estInSeasonNba = (c) => c.sport === "NBA" && !!(c.inSeason || c.minInSeason);
const NON_RECOMMANDE = "non recommandé cette semaine";
// compRows (option A) -> affectation de l'option B, lue par evalueRentabilite() (core.mjs n'a pas a la transmettre)
const OPTION_B = new WeakMap();

// Affectation des cartes aux competitions, dans l'ordre donne (section 8 de l'ancien core.mjs, code inchange).
// sauter(c) -> texte : la competition n'a aucune compo et ce texte devient son statut (option B sans In-Season).
function affecteCompetitions(order, rows, used, sauter = null) {
  const lineups = []; const compRows = [];
  // carte -> competition qui l'a prise (pour expliquer un minimum In-Season impossible, proposition 11)
  const prisPar = new Map();
  // priorite affichee = position de la competition dans l'ordre d'affectation de son sport (1 = premiere servie)
  const priorite = new Map(); for (const sp of ["NBA", "FOOTBALL"]) order.filter((x) => (x.sport === "NBA") === (sp === "NBA")).forEach((x, i) => priorite.set(x, i + 1));
  for (const c of order) {
    if (c.inSeason && !c.minInSeason) c.minInSeason = 4;
    // nombre de compos a proposer : regle propre a l'utilisateur (NBA) sinon le maximum autorise par Sorare
    const maxTeams = c.nbaDef?.compos ?? (c.equipes > 0 ? c.equipes : 1);
    const contraintes = [c.capPoints ? "somme des moyennes ≤ " + c.capPoints : "", c.capStars ? "somme des étoiles ≤ " + c.capStars : "", c.minInSeason ? "min " + c.minInSeason + " cartes In-Season" : "", c.maxParClub ? "max " + c.maxParClub + " par équipe" : "", c.capitaine ? "capitaine +" + c.capitaine + " %" : "", sansBonusCarte(c) ? "sans bonus de carte (salon)" : "", coutInscription(c) ? "inscription : " + coutInscription(c) + " essences Limited par compo" : ""].filter(Boolean).join(", ");
    const scores = []; let raison = ""; let elig0 = null;
    const saut = sauter ? sauter(c) : null;
    for (let k = 1; k <= maxTeams; k++) {
      const pool = [];
      for (const r of rows) {
        if (c.sport === "NBA" && r.sport !== "NBA") continue;
        if (c.sport === "FOOTBALL" && !r._isJPL) continue;
        for (const card of r._cards) {
          if (used.has(card.slug)) continue;
          if (c.sport === "NBA" ? card.rarity !== "limited" : !["limited", "rare", "super_rare", "unique"].includes(card.rarity)) continue;
          pool.push({ r, card, value: r.score_attendu * (sansBonusCarte(c) ? 1 : card.power) });
        }
      }
      const elig = new Set(pool.map((x) => x.r.slug)).size;
      if (elig0 == null) elig0 = elig;
      if (saut) { raison = saut; break; }
      const nIn = new Set(pool.filter((x) => x.card.inSeason).map((x) => x.r.slug)).size;
      // Gameweek sans match (proposition 2, les deux sports ; choix de l'utilisateur du 25/10) : pas de compo si aucun
      // joueur eligible n'a de match dans la gameweek (joueurs.matchs_gw), ni si la meilleure compo vaut 0 point.
      if (pool.length && !pool.some((x) => x.r.matchs_gw > 0)) { raison = k === 1 ? SANS_MATCH : "aucun des joueurs restants ne joue cette gameweek"; break; }
      const sol = c.minInSeason && nIn < c.minInSeason ? null : optimise(c, pool);
      if (sol && !(sol.total > 0)) { raison = SCORE_NUL; break; }
      if (!sol) {
        raison = missingReason(c, pool, nIn);
        // NBA seulement (les textes football ne changent pas) : cartes In-Season prises par une competition prioritaire
        if (c.sport === "NBA" && c.minInSeason && nIn < c.minInSeason) raison = raisonInSeasonPrises(c, rows, used, prisPar, nIn) || raison;
        break;
      }
      scores.push(round(sol.total));
      for (const x of sol.picks) {
        used.add(x.card.slug); prisPar.set(x.card.slug, { nom: c.nom, priorite: priorite.get(c) });
        lineups.push({ competition: c.nom, sport: c.sport === "NBA" ? "NBA" : "Football", numero: k, slot: x.slot, joueur: x.r.joueur, slug: x.r.slug, carte_id: x.card.slug, carte: cardLabel(x.card), capitaine: c.capitaine && x === sol.captain ? "Oui" : "",
          score_attendu: x.r.score_attendu, gain_etoiles: x.r.gain_etoiles, bonus: sansBonusCarte(c) ? 0 : round((x.card.power - 1) * 100), score_final: round(x.value + (x === sol.captain ? x.r.score_attendu * (c.capitaine || 0) / 100 : 0)),
          etoiles: x.r.etoiles, moyenne_cap: c.capPoints ? x.r._l15 : null, adversaire: x.r.adversaire, match: x.r.match, adv_attaque_rang: x.r.adv_attaque_rang, adv_defense_rang: x.r.adv_defense_rang, adv_nb_equipes: x.r.adv_nb_equipes });
      }
    }
    compRows.push({ competition: c.nom, slug: c.slug, sport: c.sport === "NBA" ? "NBA" : "Football", date_limite: c.cutoff, joueurs_eligibles: elig0 ?? 0, contraintes,
      max_compos: maxTeams, nb_compos: scores.length, scores_compos: scores.join(" "), score_compo: scores.length ? scores[0] : null,
      statut: scores.length === maxTeams ? (maxTeams > 1 ? `${maxTeams} compos proposées` : "Compo proposée") : scores.length ? `${scores.length} compo${scores.length > 1 ? "s" : ""} sur ${maxTeams} possible${maxTeams > 1 ? "s" : ""} : ${raison}` : raison,
      regles: c.regles, ...colonnesV3(coutInscription(c)), type: c.sport === "NBA" ? "NBA" : "JPL", rang: rank(c), cap_points: c.capPoints, cap_etoiles: c.capStars, min_in_season: c.minInSeason || null, max_par_club: c.maxParClub, capitaine_pct: c.capitaine || 0 });
  }
  return { lineups, compRows };
}
// Colonnes v3 de competitions (contrat-donnees.md), remplies par evalueRentabilite() une fois les paliers connus.
// Cout d'inscription en essences Limited par compo. Source : API Sorare, so5Leaderboard.displayedTypedRules, regle
// « EntryItem » (So5EntryItemRule.entryItem { ... on So5CardShardsEntryItem { quantity rarity } }), relevee le 25/10/2026 :
// NBA Rooms Champion (nba_limited_arena_140) 150 ; Jupiler Cap 260 (salons ..._jupiler_arena_limited) 300.
// c.coutInscription (si collecte.mjs lit un jour cette regle) prime ; sinon NBA_COMPS (Rooms 150) ; sinon 300 pour un
// salon football (Cap 260) ; 0 ailleurs. Avant le 25/10/2026, le Cap 260 etait compte gratuit (ecart corrige).
const coutInscription = (c) => c.coutInscription ?? c.nbaDef?.essences ?? (c.sport === "FOOTBALL" && sansBonusCarte(c) ? 300 : 0);
// Salons (Rooms NBA « arena_140 », Cap 260 football « arena_limited ») : AUCUN bonus de carte (niveau / XP, In-Season,
// collection). Sources : aide Sorare « What is the Arena? How does it work? » (NBA, art. 30758177419165 : « No Bonuses …
// no XP, Collection, or Season bonuses applied to scores ») et API so5Rankings…so5Appearances{ score bonus } du 25/10/2026 :
// bonus = 1,0 pour toutes les cartes des salons NBA arena_140 et des salons Cap 260 (sauf capitaine 1,2), contre 1,04 a 1,13
// en Classic et In-Season. Les deux sports sont concernes (verifie sur chacun). Avant le 25/10/2026 : score × puissance.
const sansBonusCarte = (c) => /arena/.test(c?.slug || "");
const colonnesV3 = (cout) => ({ cout_inscription: cout, gains_esperes: "", gain_net_espere: null, autres_recompenses: "", rentable: "", recommandation: "", alternative: "" });

// Statuts sans compo (proposition 2) : textes communs aux deux sports
const SANS_MATCH = "aucun de tes joueurs ne joue cette gameweek";
const SCORE_NUL = "la meilleure compo possible vaut 0 point (joueurs absents, blessés ou sans match cette gameweek)";

// Changements depuis la veille (section 10). prev = joueurs.json de la collecte precedente.
// Projection en hausse / en baisse (proposition 6, les deux sports) : seulement si le joueur a des matchs dans la
// gameweek des deux cotes (joueurs.matchs_gw > 0 ; veille sans matchs_gw : score_attendu > 0). Sinon le score attendu
// tombe a 0 faute de match et ce n'est pas une baisse de projection (140 fausses baisses football le 24/10).
// Meme gameweek (le match retenu de la veille et celui du jour sont dans la fenetre de la gameweek en cours) :
// on compare score_attendu. Gameweek differente : le nombre de matchs et le match retenu changent, on compare la
// projection par match (proj_match), et rien si la veille n'a pas cette colonne.
function calculeChangements(rows, prev, fixtures) {
  const changes = [];
  if (!prev || !Array.isArray(prev)) return changes;
  const old = new Map(prev.map((r) => [r.slug, r]));
  const joue = (x) => (x.matchs_gw != null ? x.matchs_gw > 0 : x.score_attendu > 0);
  const tMatch = (m) => (m ? Date.parse(m.length === 16 ? m + ":00Z" : m) : NaN); // joueurs.match : UTC tronque a 16 caracteres
  const dansGw = (sport, m) => {
    const f = fixtures?.[sport === "NBA" ? "NBA" : "FOOTBALL"]; const t = tMatch(m);
    return !!f && t >= Date.parse(f.startDate) && t <= Date.parse(f.endDate);
  };
  for (const r of rows) {
    const o = old.get(r.slug); if (!o) continue;
    if (r.blessure && !o.blessure) changes.push({ joueur: r.joueur, modes: r.modes, type: "Nouvelle blessure", detail: r.blessure });
    if (!r.blessure && o.blessure) changes.push({ joueur: r.joueur, modes: r.modes, type: "Retour de blessure", detail: o.blessure });
    if (r.suspension && !o.suspension) changes.push({ joueur: r.joueur, modes: r.modes, type: "Suspension", detail: r.suspension });
    if (r.statut && o.statut && r.statut !== o.statut) changes.push({ joueur: r.joueur, modes: r.modes, type: "Statut modifié", detail: o.statut + " → " + r.statut });
    if (!joue(r) || !joue(o)) continue;
    const memeGw = dansGw(r.sport, o.match) && dansGw(r.sport, r.match);
    const [a, b, quoi] = memeGw ? [o.score_attendu, r.score_attendu, ""] : [o.proj_match, r.proj_match, "par match, nouvelle gameweek : "];
    if (a != null && b != null && Math.abs(b - a) >= 10) changes.push({ joueur: r.joueur, modes: r.modes, type: b > a ? "Projection en hausse" : "Projection en baisse", detail: quoi + a + " → " + b });
  }
  return changes;
}

// Minimum In-Season impossible parce que des competitions prioritaires ont pris les cartes In-Season (proposition 11, NBA).
// Renvoie null si aucune carte In-Season n'a ete prise (le texte de missingReason s'applique alors).
function raisonInSeasonPrises(c, rows, used, prisPar, nIn) {
  const libre = [], prises = [];
  for (const r of rows) {
    if (c.sport === "NBA" && r.sport !== "NBA") continue;
    if (c.sport === "FOOTBALL" && !r._isJPL) continue;
    for (const card of r._cards) {
      if (c.sport === "NBA" ? card.rarity !== "limited" : !["limited", "rare", "super_rare", "unique"].includes(card.rarity)) continue;
      const x = { r, card, value: r.score_attendu * card.power };
      libre.push(x);
      if (card.inSeason && used.has(card.slug)) prises.push(x);
    }
  }
  if (!prises.length) return null;
  const nTot = libre.filter((x) => x.card.inSeason).length;
  const parComp = new Map(); for (const x of prises) { const p = prisPar.get(x.card.slug); const k = p ? `${p.nom} (priorité ${p.priorite})` : "une autre compo"; parComp.set(k, (parComp.get(k) || 0) + 1); }
  const ou = [...parComp.keys()].join(" et ");
  const dans = parComp.size > 1 ? "dans les compos " + ou : "dans la compo " + ou;
  let txt = nIn === 0 && prises.length === nTot
    ? (nTot === 1 ? `ta seule carte In-Season est ${dans}` : `tes ${nTot} cartes In-Season sont ${dans}`)
    : `il ne reste que ${nIn} carte${nIn > 1 ? "s" : ""} In-Season (minimum ${c.minInSeason}) : ${prises.length} ${prises.length > 1 ? "sont" : "est"} ${dans}`;
  // et meme libres, le plafond d'etoiles serait-il tenable ? (meme borne basse que missingReason)
  const plafond = c.capStars ? plafondEtoiles(c, libre) : null;
  if (plafond) txt += " ; même libres, " + plafond;
  return txt;
}

function rank(c) { // ordre de priorite d'affectation des cartes
  if (c.sport === "FOOTBALL") return c.inSeason ? 0 : 1;
  return c.nbaDef ? c.nbaDef.rang : 9;
}

// Etoiles comptees sous un plafond (NBA uniquement, seul sport avec capStars). Niveau inconnu (gameplayTier absent,
// etoiles null) : compte comme DNP = 1 etoile, le plus petit niveau du bareme (regles-nba, table des etoiles),
// et non 0, sinon un joueur sans niveau permettait une compo fictive (ex-In-Season Contender, 11★ : 10,5 + 0 etoile ; non jouee depuis le 25/10/2026).
const etoilesCap = (x) => x.r.etoiles ?? 1;

// Choix de 5 cartes maximisant le score sous contraintes (recherche exhaustive sur les meilleurs candidats)
function optimise(c, pool) {
  if (!pool.length) return null;
  // une seule carte par joueur : garder la meilleure
  const bestBy = new Map();
  for (const x of pool) { const o = bestBy.get(x.r.slug); if (!o || x.value > o.value || (x.card.inSeason && !o.card.inSeason && x.value >= o.value * 0.97)) bestBy.set(x.r.slug, x); }
  // Competition avec minimum In-Season (regle API displayedTypedRules "SeasonBonus" : NBA In-Season, Jupiler In-Season) :
  // la carte In-Season d'un joueur doit rester disponible meme si une autre carte du meme joueur vaut plus
  // (sinon bestBy l'ecarte des que l'autre carte vaut plus de 103 %). On garde donc aussi la meilleure carte
  // In-Season de chaque joueur ; la boucle interdit ensuite deux cartes du meme joueur dans une compo.
  // Sans minimum In-Season, rien ne change. Correctif du 24/10/2026 (bug In-Season Champion, collecte 22h05).
  const bestIn = new Map();
  if (c.minInSeason) for (const x of pool) { if (!x.card.inSeason) continue; const o = bestIn.get(x.r.slug); if (!o || x.value > o.value) bestIn.set(x.r.slug, x); }
  let cand = [...bestBy.values()].sort((a, b) => b.value - a.value);
  const nba = c.sport === "NBA";
  if (nba && c.capStars) {
    // garder aussi des joueurs peu etoiles pour pouvoir respecter le plafond
    const byStar = new Map();
    for (const x of cand) { const k = x.r.etoiles || 0; if (!byStar.has(k)) byStar.set(k, []); if (byStar.get(k).length < 7) byStar.get(k).push(x); }
    cand = [...byStar.values()].flat().sort((a, b) => b.value - a.value);
  } else if (nba) cand = cand.slice(0, 26);
  else {
    const byPos = (p) => {
      const l = cand.filter((x) => x.r._pos === p);
      if (!c.capPoints) return l.slice(0, 6);
      // avec plafond : garder aussi les meilleurs rapports score / moyenne
      const eff = l.slice().sort((a, b) => b.value / Math.max(1, b.r._l15) - a.value / Math.max(1, a.r._l15)).slice(0, 4);
      const cheap = l.slice().sort((a, b) => a.r._l15 - b.r._l15).slice(0, 3);
      return [...new Set([...l.slice(0, 6), ...eff, ...cheap])];
    };
    cand = [...new Set([...byPos("Goalkeeper"), ...byPos("Defender"), ...byPos("Midfielder"), ...byPos("Forward")])];
  }
  // minimum In-Season : tous les candidats In-Season sont gardes, en plus de la selection ci-dessus
  // (sinon des cartes In-Season peu notees sont eliminees par le tri par etoiles / par poste avant le filtre minInSeason)
  // (ajoutes a la fin, sans retrier, pour garder l'ordre de parcours actuel et donc le meme choix en cas d'egalite)
  if (c.minInSeason) cand = [...new Set([...cand, ...bestIn.values()])];
  if (cand.length < 5) return null;
  let best = null;
  const n = cand.length;
  const capt = (c.capitaine || 0) / 100;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) for (let d = b + 1; d < n; d++) for (let e = d + 1; e < n; e++) for (let f = e + 1; f < n; f++) {
    const t = [cand[a], cand[b], cand[d], cand[e], cand[f]];
    if (c.capStars && t.reduce((s, x) => s + etoilesCap(x), 0) > c.capStars) continue;
    if (c.capPoints && t.reduce((s, x) => s + (x.r._l15 || 0), 0) > c.capPoints) continue;
    if (c.minInSeason && t.filter((x) => x.card.inSeason).length < Math.min(c.minInSeason, 5)) continue;
    if (c.minInSeason && new Set(t.map((x) => x.r.slug)).size < 5) continue; // une seule carte par joueur
    if (c.maxParClub) { const m = new Map(); let bad = false; for (const x of t) { const k = x.r._clubSlug; m.set(k, (m.get(k) || 0) + 1); if (m.get(k) > c.maxParClub) bad = true; } if (bad) continue; }
    let slots = null;
    if (!nba) { slots = assignFootball(t); if (!slots) continue; }
    // capitaine : meilleur score ajuste du risque. Bonus capitaine ADDITIF : il s'ajoute au bonus de la carte et porte sur
    // le score du joueur (sans bonus). Source : API so5Rankings…so5Appearances{ bonus } du 25/10/2026, Jupiler In-Season :
    // capitaine 1,64 / 1,65 pour des cartes a 1,14 / 1,15 (1 + 0,14 + 0,50), et non 1,14 × 1,5 = 1,71 ; aide Sorare
    // « How does scoring work in Sorare Football? » (bonus de carte ajoutes au score du joueur). Football seulement
    // (pas de capitaine en NBA). Avant le 25/10/2026 : valeur de la carte × (1 + bonus capitaine).
    const cap = t.slice().sort((x, y) => y.r.score_attendu * (1 - 0.3 * y.r._cv) - x.r.score_attendu * (1 - 0.3 * x.r._cv))[0];
    const total = t.reduce((s, x) => s + x.value, 0) + cap.r.score_attendu * capt;
    if (!best || total > best.total) best = { total, picks: t, captain: cap, slots };
  }
  if (!best) return null;
  if (nba) best.picks.sort((a, b) => b.value - a.value).forEach((x, i) => (x.slot = "Joueur " + (i + 1)));
  else best.picks.forEach((x) => (x.slot = best.slots.get(x)));
  return best;
}
// Pourquoi on ne peut pas faire une compo de plus
function missingReason(c, pool, nIn) {
  const players = new Map(); for (const x of pool) players.set(x.r.slug, x);
  const list = [...players.values()];
  if (!list.length) return "plus aucune carte disponible";
  if (c.minInSeason && nIn < c.minInSeason) return `il ne reste que ${nIn} carte${nIn > 1 ? "s" : ""} In-Season (minimum ${c.minInSeason})`;
  if (c.sport !== "NBA") {
    const need = { Goalkeeper: "gardien", Defender: "défenseur", Midfielder: "milieu", Forward: "attaquant" };
    const miss = Object.entries(need).filter(([p]) => !list.some((x) => x.r._pos === p)).map(([, n]) => n);
    if (miss.length) return "il te manque " + miss.map((m) => "un " + m).join(" et ");
    if (list.length < 5) return `il ne reste que ${list.length} joueurs disponibles`;
    return "aucune combinaison des cartes restantes ne respecte les règles";
  }
  if (list.length < 5) return `il ne reste que ${list.length} joueurs disponibles`;
  if (c.capStars && c.minInSeason) { const p = plafondEtoiles(c, pool); if (p) return p; }
  return c.capStars ? `aucune combinaison des cartes restantes ne tient sous ${c.capStars} étoiles` : "aucune combinaison des cartes restantes ne respecte les règles";
}
// NBA In-Season : le plafond d'etoiles (displayedTypedRules "AverageScores") est-il tenable avec les cartes In-Season imposees ?
// borne basse = les min In-Season joueurs In-Season les moins etoiles + les joueurs restants les moins etoiles.
// Renvoie le texte d'explication si la borne depasse le plafond, sinon null.
function plafondEtoiles(c, pool) {
  if (!c.capStars || !c.minInSeason) return null;
  const players = new Map(); for (const x of pool) players.set(x.r.slug, x);
  const list = [...players.values()];
  const etoiles = etoilesCap;
  const fmt = (v) => String(Math.round(v * 10) / 10).replace(".", ",") + "★";
  const slugsIn = new Set(pool.filter((x) => x.card.inSeason).map((x) => x.r.slug));
  const m = Math.min(c.minInSeason, 5);
  const ins = list.filter((x) => slugsIn.has(x.r.slug)).sort((a, b) => etoiles(a) - etoiles(b)).slice(0, m);
  const reste = list.filter((x) => !ins.includes(x)).sort((a, b) => etoiles(a) - etoiles(b)).slice(0, 5 - m);
  const sIn = ins.reduce((s, x) => s + etoiles(x), 0), sReste = reste.reduce((s, x) => s + etoiles(x), 0);
  if (ins.length === m && reste.length === 5 - m && sIn + sReste > c.capStars) {
    const quoi = slugsIn.size === m ? `les ${m} cartes In-Season font` : `les ${m} cartes In-Season les moins étoilées font déjà`;
    const autres = 5 - m === 1 ? "le 5e joueur" : `les ${5 - m} autres joueurs`;
    return `${quoi} ${fmt(sIn)}, il ne reste que ${fmt(Math.max(0, c.capStars - sIn))} pour ${autres} (minimum ${fmt(sReste)}) sous le plafond de ${c.capStars} étoiles`;
  }
  return null;
}
function assignFootball(t) {
  const need = ["Goalkeeper", "Defender", "Midfielder", "Forward"];
  const m = new Map(); const rest = [...t];
  for (const p of need) { const i = rest.findIndex((x) => x.r._pos === p); if (i < 0) return null; m.set(rest[i], POS[p]); rest.splice(i, 1); }
  if (rest[0].r._pos === "Goalkeeper") return null;
  m.set(rest[0], "Extra");
  return m;
}

// ---------- 14. Rentabilite des competitions (contrat v3) et choix In-Season NBA ----------
// Loi normale identique a celle de dashboard/index.html (fonctions erf, pAbove, dist et mkCand) pour que la page et
// les donnees affichent les memes chances : moyenne = somme des score_final de la compo ; ecart-type de la compo =
// racine de la somme des carres des ecarts-types des joueurs (capitaine : × (1 + bonus capitaine / puissance), bonus additif depuis le 25/10/2026) ; ecart-type
// d'un joueur = sqrt(p × (proj × cv)² + p × (1 − p) × proj²), avec value = score_attendu × puissance de la carte
// (× skin en Set), p = proba_titulaire / 100 bornee a [0,05 ; 1] (0,8 si absente), proj = value / p,
// cv = regularite / 100 (40 % si absente), × 0,8 en NBA. Fourchette 10–90 % = moyenne ± 1,2816 écart-type.
const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const pAbove = (m, s, t) => (s > 0 ? 0.5 * (1 - erf((t - m) / (s * Math.SQRT2))) : m >= t ? 1 : 0);
function ecartTypeJoueur(r, value) {
  const p = Math.min(1, Math.max(0.05, r.proba_titulaire == null || r.proba_titulaire === "" ? 0.8 : Number(r.proba_titulaire) / 100));
  const cv = (r.regularite == null || r.regularite === "" ? 40 : Number(r.regularite)) / 100 * (r.sport === "NBA" ? 0.8 : 1);
  const proj = value / p;
  return Math.sqrt(p * (proj * cv) ** 2 + p * (1 - p) * proj ** 2);
}
// Loi du score d'une compo (lignes de compos d'un meme numero). bySlug : joueurs (rows de modele.mjs, avec _cards).
function loiCompo(picks, comp, bySlug) {
  const capt = (Number(comp.capitaine_pct) || 0) / 100; const set = comp.type === "SET";
  const mean = picks.reduce((s, l) => s + (Number(l.score_final) || 0), 0);
  const sd = Math.sqrt(picks.reduce((s, l) => {
    const r = bySlug.get(l.slug); const k = r?._cards?.find((x) => x.slug === l.carte_id);
    // comme la page : sans joueur ou sans carte connus, ecart-type = 40 % du score
    // salon : pas de bonus de carte (sansBonusCarte) ; capitaine additif : ecart-type × (1 + bonus capitaine / puissance)
    const pw = sansBonusCarte(comp) ? 1 : Number(k?.power) || 1;
    const sdj = r && k ? ecartTypeJoueur(r, (Number(r.score_attendu) || 0) * pw * (set ? Number(k.skinBonus) || 1 : 1)) : (Number(l.score_final) || 0) * 0.4;
    return s + (sdj * (l.capitaine ? 1 + capt / pw : 1)) ** 2;
  }, 0));
  return { mean, sd };
}
// Recompenses d'un palier : seules les essences Limited ont une valeur (choix de l'utilisateur du 25/10/2026) ;
// $, cartes, XP et coins sont decrits a part (autres_recompenses). Libelles : rewardLabel() de collecte.mjs.
const essencesDe = (txt) => [...String(txt || "").matchAll(/(\d+)\s*essences?\s+Limited/gi)].reduce((s, m) => s + Number(m[1]), 0);
const autresDe = (txt) => String(txt || "").split(" + ").map((x) => x.trim()).filter((x) => x && !/essences?\s+Limited/i.test(x));
const genreAutre = (x) => (/\$/.test(x) ? "$" : /^carte/i.test(x) ? "carte" : /XP/i.test(x) ? "XP" : /coins/i.test(x) ? "coins" : x);
const pctTxt = (p) => (p >= 0.995 ? "> 99 %" : p < 0.005 ? "< 1 %" : Math.round(p * 100) + " %"); // = pct() de la page
const fr = (x, d = 0) => String(round(x, d)).replace(".", ",");
// Gain espere d'une compo en essences Limited : somme sur les paliers de P(atteindre ce palier et pas le meilleur
// suivant) × essences du palier. Classement : seul le palier le plus haut atteint compte (P(score ≥ seuil), en
// remontant des meilleurs rangs). Salons (Rooms, Cap 260) : rangs 1 a 5 d'un salon de 10, meme calcul sur le score
// median atteint a chaque rang. tiers : paliers d'une competition tries par rang croissant.
function gainCompo(mean, sd, tiers) {
  let best = 0, gain = 0; const pTier = [];
  for (const t of tiers) {
    const p = pAbove(mean, sd, Number(t.score));
    gain += Math.max(0, p - best) * essencesDe(t.recompense);
    best = Math.max(best, p); pTier.push(best);
  }
  return { gain, pTier };
}

function evalueRentabilite(compRows, lineups, paliers, rows, optionB = OPTION_B.get(compRows)) {
  const bySlug = new Map((rows || []).map((r) => [r.slug, r]));
  const tiersDe = (nom) => (paliers || []).filter((p) => p.competition === nom).sort((a, b) => Number(a.rang) - Number(b.rang));
  const eco = (cr, lus) => evalueLigne(cr, lus.filter((l) => l.competition === cr.competition), tiersDe(cr.competition), bySlug);
  const resA = compRows.map((cr) => ({ cr, e: eco(cr, lineups) }));
  for (const { cr, e } of resA) Object.assign(cr, e);
  if (!optionB) return { option: null };
  // ---- NBA : In-Season en priorite 1 (A) ou sans In-Season (B) ? (choix de l'utilisateur du 25/10/2026) ----
  const nbaA = compRows.filter((c) => c.sport === "NBA");
  const nbaB = optionB.compRows.map((cr) => ({ ...cr, ...eco(cr, optionB.lineups) }));
  const bilan = (list) => ({ net: list.reduce((s, c) => s + (c.gain_net_espere || 0), 0), pts: list.reduce((s, c) => s + String(c.scores_compos || "").split(" ").filter(Boolean).reduce((a, x) => a + Number(x), 0), 0) });
  const A = bilan(nbaA), B = bilan(nbaB);
  const isA = nbaA.filter((c) => c.min_in_season);
  const joueIS = isA.some((c) => c.nb_compos > 0);
  const paliersNba = nbaA.some((c) => tiersDe(c.competition).length);
  // Sans compo In-Season possible, A et B sont identiques ; sans aucun palier NBA, on garde la priorite decidee (A).
  if (!joueIS || !paliersNba) return { option: "A", A, B };
  const dNet = Math.round(A.net) - Math.round(B.net), dPts = round(A.pts - B.pts);
  const choixB = dNet < 0 || (dNet === 0 && dPts < 0);
  const libres = [...new Set(lineups.filter((l) => isA.some((c) => c.competition === l.competition)).map((l) => l.joueur + " (" + l.carte + ")"))];
  const parComp = nbaA.filter((c) => !c.min_in_season).map((c) => { const b = nbaB.find((x) => x.competition === c.competition); return b && b.scores_compos !== c.scores_compos ? `${c.competition.replace(/^NBA /, "")} ${c.scores_compos.replace(/\./g, ",") || "aucune"} → ${b.scores_compos.replace(/\./g, ",") || "aucune"}` : null; }).filter(Boolean);
  const alternative = `Avec In-Season : ${fr(A.pts)} pts et ${fr(A.net)} essences nettes espérées sur l'ensemble NBA ; sans In-Season (cartes In-Season en Classic et Rooms) : ${fr(B.pts)} pts et ${fr(B.net)} essences`
    + (parComp.length ? ` (${parComp.join(" ; ")})` : "") + `. Cartes prises par In-Season : ${libres.join(", ")}.`;
  const ecart = (d, u) => (d > 0 ? "+" : "") + fr(d) + " " + u;
  if (!choixB) {
    for (const c of isA) {
      c.alternative = alternative;
      c.recommandation = c.nb_compos > 0 ? "Jouer In-Season : " + (dNet !== 0 ? ecart(dNet, "essences espérées") : "mêmes essences espérées, " + ecart(dPts, "pts")) + " par rapport à l'option sans In-Season" : "Aucune compo à inscrire (voir le statut)";
    }
    return { option: "A", A, B };
  }
  // B retenue : les competitions NBA prennent l'affectation sans In-Season
  const pourquoi = dNet !== 0 ? `${ecart(-dNet, "essences nettes espérées")} sans In-Season (${fr(B.net)} contre ${fr(A.net)})` : `mêmes essences espérées, ${ecart(-dPts, "pts")} sans In-Season`;
  for (const b of nbaB) {
    if (b.min_in_season) {
      b.statut = `${NON_RECOMMANDE} : ${pourquoi} ; tes cartes In-Season sont plus utiles en Classic et Rooms`;
      b.recommandation = "Ne pas jouer In-Season cette semaine : " + pourquoi;
      b.alternative = alternative;
    }
    const i = compRows.findIndex((c) => c.sport === "NBA" && c.competition === b.competition);
    if (i >= 0) compRows[i] = b;
  }
  const debut = lineups.findIndex((l) => l.sport === "NBA");
  const autres = lineups.filter((l) => l.sport !== "NBA");
  const pos = debut < 0 ? autres.length : lineups.slice(0, debut).filter((l) => l.sport !== "NBA").length;
  lineups.splice(0, lineups.length, ...autres.slice(0, pos), ...optionB.lineups, ...autres.slice(pos));
  return { option: "B", A, B };
}

// Colonnes v3 d'une competition a partir de ses compos et de ses paliers
function evalueLigne(cr, lus, tiers, bySlug) {
  const cout = Number(cr.cout_inscription) || 0;
  const nums = [...new Set(lus.map((l) => l.numero))].sort((a, b) => a - b);
  const lois = nums.map((n) => loiCompo(lus.filter((l) => l.numero === n), cr, bySlug));
  const out = { cout_inscription: cout, gains_esperes: "", gain_net_espere: null, autres_recompenses: "", rentable: "", recommandation: "", alternative: "" };
  const n = nums.length;
  const inscrire = n > 1 ? `Inscrire les ${n} compos` : "Inscrire la compo";
  if (!n) { out.recommandation = cr.max_compos > 0 ? "Aucune compo à inscrire" : ""; if (tiers.length) out.gain_net_espere = 0; return out; }
  if (!tiers.length) { out.recommandation = inscrire + (cout ? ` (${cout} essences chacune, aucun palier connu pour juger)` : ""); return out; }
  const res = lois.map((d) => gainCompo(d.mean, d.sd, tiers));
  const gains = res.map((x) => Math.round(x.gain));
  out.gains_esperes = gains.join(" ");
  out.gain_net_espere = gains.reduce((s, x) => s + x, 0) - cout * n;
  // autres recompenses : pour chaque genre ($, carte, XP, coins), chance d'atteindre au moins le palier le plus bas de ce
  // genre ; plusieurs compos : chance qu'au moins une y arrive (compos sans joueur commun, supposees independantes)
  const genres = new Map();
  tiers.forEach((t, i) => autresDe(t.recompense).forEach((x) => { const g = genreAutre(x); genres.set(g, { i, label: x }); }));
  const parts = [...genres.values()].sort((a, b) => b.i - a.i).map(({ i, label }) => {
    const p = 1 - res.reduce((q, x) => q * (1 - x.pTier[i]), 1);
    return `${pctTxt(p)} d'au moins ${/^carte/i.test(label) ? "une " : ""}${label}`;
  });
  if (parts.length) out.autres_recompenses = (n > 1 ? `Sur les ${n} compos : ` : "") + parts.join(" ; ");
  if (cout) {
    const perdants = gains.map((g, i) => ({ g, k: nums[i] })).filter((x) => x.g < cout);
    out.rentable = perdants.length ? "non" : "oui";
    out.recommandation = !perdants.length ? `${inscrire} : ${gains.join(" et ")} essences espérées pour ${cout} payées chacune`
      : perdants.length === n ? `Ne pas inscrire${n > 1 ? ` les ${n} compos` : ""} : ${gains.join(" et ")} essences espérées pour ${cout} payées chacune`
      : `Inscrire ${nums.filter((k) => !perdants.some((x) => x.k === k)).map((k) => "la compo " + k).join(" et ")} ; ne pas inscrire ${perdants.map((x) => `la compo ${x.k} : ${x.g} essences espérées pour ${cout} payées`).join(" ; ")}`;
  } else out.recommandation = `${inscrire} : ${gains.join(" + ")} essences espérées`;
  return out;
}

return { calculeCompos, fenetreArcade, fenetreEurope, ARCADE_SEUILS, ARCADE_DELAI, ARCADE_VIES, ARCADE_LARGEURS, ARCADE_RECOMPTE, EUROPE_SEUILS, EUROPE_CAPITAINE, EUROPE_RARETES, EUROPE_COMPETITIONS, EUROPE_LARGEURS, cleCompetition, puissanceSansRarete, PISTE_ARCADE, PISTE_EUROPE, planPiste, planArcade, planEurope, affecteCompetitions, coutInscription, sansBonusCarte, calculeChangements, raisonInSeasonPrises, rank, optimise, missingReason, plafondEtoiles, assignFootball, pAbove, ecartTypeJoueur, loiCompo, gainCompo, evalueRentabilite };
})();

// ===== core.mjs =====
const __m_core = (() => {
  const { collecte, collectePaliers, collecteBilan } = __m_collecte;
  const { calculeJoueurs } = __m_modele;
  const { calculeCompos, evalueRentabilite } = __m_compos;
// Collecte et analyse Sorare pour Elpredatooor : point d'entree qui enchaine les trois etapes.
// collecte.mjs (sections 1 a 6) -> modele.mjs (section 7) -> compos.mjs (sections 8 a 12), puis paliers et sorties.
// Fonctionne dans Node 20+ (GitHub Actions) et dans un navigateur (fetch natif).
// collect({ apiKey, oddsKey, prev, history, compsPrecedentes, now, log }) -> { files: { nom: lignes[] }, history }
// compsPrecedentes : collectes enregistrees avant la date limite des gameweeks passees ([{ dossier, compos, competitions, paliers, resume }],
// voir candidatsBilan dans collecte.mjs) ; sert au jeu bilan. Absent (navigateur) -> bilan vide.





async function collect({ apiKey, oddsKey = null, espn = true, prev = null, history = { samples: [], calibration: [] }, compsPrecedentes = null, now = new Date(), log = console.log }) {
  const ctx = await collecte({ apiKey, oddsKey, espn, history, now, log });
  const { gq, comps, cards, players, setName, fixtures, odds, samples, w, calib } = ctx;
  const { rows, newSamples } = calculeJoueurs(ctx, now);
  const { lineups, compRows, jours, changes, cartes, matchs, plan_arcade } = calculeCompos(ctx, rows, prev, now);

  // ---------- 13. Paliers de recompense de la derniere gameweek terminee ----------
  let paliers = [];
  try { paliers = await collectePaliers(gq, comps, log, ctx.fixturesRecentes); } catch (e) { log("paliers : " + e.message); }
  try { evalueRentabilite(compRows, lineups, paliers, rows); } catch (e) { log("rentabilité : " + e.message); }

  // ---------- 14. Bilan de la derniere gameweek terminee (compos proposees contre scores reels) ----------
  let bilan = [];
  try { bilan = await collecteBilan(ctx, compsPrecedentes, paliers, now, log); } catch (e) { log("bilan : " + e.message); }

  // ---------- Sorties ----------
  const NBA_ONLY = ["etoiles", "plancher_etoiles", "gain_etoiles", "gain_sorare", "back_to_back", "espn_statut", "espn_info", "espn_retour", "minutes_5", "minutes_tendance", "l10", "matchs_probables", "coequipiers_absents", "minutes_liberees"];
  const FOOT_ONLY = ["statut", "suspension", "part_decisive", "clean_sheet", "grade_sorare", "bonus_skin", "competition_match", "proba_victoire_adv"];
  const clean = rows.map(({ _cards, _games, _isJPL, _inSet, _cv, _tier, _clubSlug, _l15, _pos, ...r }) => {
    for (const k of r.sport === "NBA" ? FOOT_ONLY : NBA_ONLY) r[k] = null;
    if (r.sport === "NBA") r.poste = "";
    return r;
  });
  const allSamples = samples.concat(newSamples.filter((n) => !samples.some((s) => s.slug === n.slug && s.date === n.date)));
  log(`${ctx.appels()} appels API`);
  return {
    files: {
      joueurs: clean, compos: lineups, competitions: compRows, jours, changements: changes, calibration: calib, cartes, matchs, plan_arcade, paliers, bilan,
      resume: [{ maj: now.toISOString(), cartes: cards.length, joueurs: players.length, set: setName, gw_football: fixtures.FOOTBALL.slug, gw_nba: fixtures.NBA.slug, limite_football: fixtures.FOOTBALL.cutOffDate, limite_nba: fixtures.NBA.cutOffDate, gw_debut_football: fixtures.FOOTBALL.startDate || null, gw_fin_football: fixtures.FOOTBALL.endDate || null, gw_debut_nba: fixtures.NBA.startDate || null, gw_fin_nba: fixtures.NBA.endDate || null, arcade_debut: fixtures.LIVE_FOOTBALL?.startDate ?? fixtures.FOOTBALL.startDate ?? null, arcade_fin: fixtures.LIVE_FOOTBALL?.endDate ?? fixtures.FOOTBALL.endDate ?? null, europe_slug: ctx.europe?.slug ?? null, europe_debut: ctx.europe?.debut ?? null, europe_fin: ctx.europe?.fin ?? null, poids_sorare: w, cotes_externes: odds.length > 0 ? "oui" : "non", appels_api: ctx.appels() }],
    },
    history: { samples: allSamples, calibration: calib.slice(-90) },
  };
}

return { collect };
})();

const { collect } = __m_core;
const MORCEAU = 40000;
window.SXCOLLECT = collect;
window.SXR = { state: "idle", log: [] };
window.SXRUN = (opts = {}) => {
  let apiKey = null, oddsKey = null;
  try { apiKey = localStorage.getItem("SX_APIKEY"); oddsKey = localStorage.getItem("SX_ODDSKEY"); } catch (e) { /* stockage indisponible */ }
  const SXR = { state: "running", log: [], debut: new Date().toISOString() };
  window.SXR = SXR;
  collect({ apiKey, oddsKey: opts.odds === false ? null : oddsKey, prev: opts.prev || null, history: opts.history || { samples: [], calibration: [] }, log: (m) => SXR.log.push(m) })
    .then((r) => {
      SXR.files = r.files; SXR.history = r.history;
      const json = Object.fromEntries([...Object.entries(r.files), ["history", r.history]].map(([k, v]) => [k, JSON.stringify(v)]));
      SXR.sizes = Object.fromEntries(Object.entries(json).map(([k, v]) => [k, { caracteres: v.length, morceaux: Math.ceil(v.length / MORCEAU), lignes: Array.isArray(r.files[k]) ? r.files[k].length : null }]));
      SXR.part = (nom, i = 0) => json[nom].slice(i * MORCEAU, (i + 1) * MORCEAU);
      SXR.state = "done";
    })
    .catch((e) => { SXR.state = "error"; SXR.error = String((e && e.message) || e); });
  return "collecte lancée";
};
return "collecteur prêt (" + "collecte.mjs, modele.mjs, compos.mjs, core.mjs" + ")";
})();
