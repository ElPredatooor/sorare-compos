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
export const POS = { Goalkeeper: "Gardien", Defender: "Défenseur", Midfielder: "Milieu", Forward: "Attaquant" };

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const round = (x, d = 1) => (x == null || Number.isNaN(x) ? null : Math.round(x * 10 ** d) / 10 ** d);
export const mean = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : null);
export const sd = (a) => { if (a.length < 2) return null; const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1)); };
export const day = (iso) => (iso ? iso.slice(0, 10) : "");

export async function collecte({ apiKey, oddsKey = null, espn = true, history = { samples: [], calibration: [] }, now = new Date(), log = console.log }) {
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
export function posteCartes(cards) {
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
export function cleCompetition(nom) {
  const n = String(nom || "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\buefa\b/g, "").replace(/\s+/g, " ").trim();
  if (/conference/.test(n)) return "conference-league";
  if (/europa league/.test(n)) return "europa-league";
  return n;
}
// g : match brut (anyFutureGames, competition{ name }), match du modele (competition : texte) ou nom de competition.
// Vrai si la competition est autorisee et si le match tombe dans la fenetre European Contenders.
export function estMatchEurope(europe, g) {
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
export async function chercheEurope({ gq, fixtures, fixturesRecentes, now = new Date(), log = () => {} }) {
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
export function cardLabel(c) { return [c.rarity === "super_rare" ? "Super Rare" : c.rarity[0].toUpperCase() + c.rarity.slice(1), c.season, c.skin && c.skin !== "STANDARD" ? c.skin.toLowerCase() : "", c.inSeason ? "In-Season" : ""].filter(Boolean).join(" "); }

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
export function matchOdds(odds, nba, team, opp, date) {
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
export async function collectePaliers(gq, comps, log, fixturesRecentes = null) {
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
export function candidatsBilan(liste, now = new Date()) {
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
export async function collecteBilan({ gq, batched, fixturesRecentes, players }, precedentes, paliers = [], now = new Date(), log = console.log) {
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
