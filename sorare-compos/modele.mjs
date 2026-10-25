// Modele de projection Sorare pour Elpredatooor : section 7 de l'ancien core.mjs (calcul par joueur).
// calculeJoueurs(contexte de collecte.mjs, now) -> { rows, newSamples }

import { POS, round, mean, sd, day, cardLabel, matchOdds } from "./collecte.mjs";

// Etoiles Sorare NBA : les niveaux "PLUS" valent une demi-etoile de plus (ex. IMPACT_PLUS = 3,5)
const STARS = { GOAT: 5, STAR_PLUS: 4.5, STAR: 4, IMPACT_PLUS: 3.5, IMPACT: 3, ROSTER_PLUS: 2.5, ROSTER: 2, DNP_PLUS: 1.5, DNP: 1 };
const STATUS_P = { STARTER: 0.9, REGULAR: 0.75, SUPER_SUBSTITUTE: 0.5, SUBSTITUTE: 0.35, RESERVE: 0.1, NOT_PLAYING: 0, RETIRED: 0 };
// Esperance du maximum de n tirages d'une loi normale centree reduite
const EMAX = [0, 0, 0.564, 0.846, 1.029, 1.163, 1.267];
const FLOOR = { GOAT: 50, STAR_PLUS: 45, STAR: 40, IMPACT_PLUS: 35, IMPACT: 30, ROSTER_PLUS: 25, ROSTER: 20, DNP_PLUS: 15, DNP: 0 };

export function calculeJoueurs({ fixtures, relevant, espnData, odds, advRank, isJPL, inSet, w }, now) {
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
export function jourDuMatch(t, nba) {
  if (nba) return new Date(t - 5 * 3600e3).toISOString().slice(0, 10);
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Brussels", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
    return `${p.year}-${p.month}-${p.day}`;
  } catch { return new Date(t + 3600e3).toISOString().slice(0, 10); }
}
// Absent ce jour-la si une date de retour (AAAA-MM-JJ) est annoncee et que le jour du match ne la depasse pas
export const absentLeJour = (jourMatch, retour) => !!retour && jourMatch <= retour;

function bestCard(list, rarity) { const l = list.filter((c) => !rarity || c.rarity === rarity); return (l.length ? l : list).slice().sort((a, b) => b.power * b.skinBonus - a.power * a.skinBonus)[0] || null; }
