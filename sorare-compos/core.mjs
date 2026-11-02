// Collecte et analyse Sorare pour Elpredatooor : point d'entree qui enchaine les trois etapes.
// collecte.mjs (sections 1 a 6) -> modele.mjs (section 7) -> compos.mjs (sections 8 a 12), puis paliers et sorties.
// Fonctionne dans Node 20+ (GitHub Actions) et dans un navigateur (fetch natif).
// collect({ apiKey, oddsKey, prev, history, compsPrecedentes, now, log, sport, prioriteNba }) -> { files: { nom: lignes[] }, history }
// sport (facultatif) : "FOOTBALL" ou "NBA" = un seul sport ; les jeux ne contiennent alors utilement que ce sport et
// doivent etre fusionnes avec la collecte precedente par fusionneSport (collecte.mjs), comme le fait collect.mjs.
// compsPrecedentes : collectes enregistrees avant la date limite des gameweeks passees ([{ dossier, compos, competitions, paliers, resume }],
// voir candidatsBilan dans collecte.mjs) ; sert au jeu bilan. Absent (navigateur) -> bilan vide.
// prioriteNba (contrat v8) : contenu parse de sorare-compos/priorite-nba.json, lu par collect.mjs et collecte-locale.mjs ;
// normalise par normalisePrioriteNba (collecte.mjs) puis passe a calculeCompos dans ctx.prioriteNba (tableau de noms
// NBA_COMPS[].nom). Absent (navigateur) ou invalide -> ordre par defaut, message dans le journal. Football : aucun effet.

import { collecte, collectePaliers, collecteBilan, normalisePrioriteNba } from "./collecte.mjs";
import { calculeJoueurs } from "./modele.mjs";
import { calculeCompos, evalueRentabilite } from "./compos.mjs";

export async function collect({ apiKey, oddsKey = null, espn = true, prev = null, history = { samples: [], calibration: [] }, compsPrecedentes = null, now = new Date(), log = console.log, sport = null, prioriteNba = null }) {
  const ctx = await collecte({ apiKey, oddsKey, espn, history, now, log, sport });
  const { gq, comps, cards, players, setName, fixtures, odds, samples, w, calib } = ctx;
  const { rows, newSamples } = calculeJoueurs(ctx, now);
  const { lineups, compRows, jours, changes, cartes, matchs, plan_arcade } = calculeCompos({ ...ctx, prioriteNba: normalisePrioriteNba(prioriteNba, log) }, rows, prev, now);

  // ---------- 13. Paliers de recompense de la derniere gameweek terminee ----------
  let paliers = [];
  try { paliers = await collectePaliers(gq, comps, log, ctx.fixturesRecentes, sport); } catch (e) { log("paliers : " + e.message); }
  try { evalueRentabilite(compRows, lineups, paliers, rows); } catch (e) { log("rentabilité : " + e.message); }

  // ---------- 14. Bilan de la derniere gameweek terminee (compos proposees contre scores reels) ----------
  let bilan = [];
  try { bilan = await collecteBilan(ctx, compsPrecedentes, paliers, now, log); } catch (e) { log("bilan : " + e.message); }

  // ---------- Sorties ----------
  // resume v7 : set_nba (set Common NBA en cours, ctx.setNameNBA), arcade_nba_debut / arcade_nba_fin (fixtures.LIVE_NBA,
  // gameweek NBA en cours, a defaut la gameweek a venir) ; set reste le set football.
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
      resume: [{ maj: now.toISOString(), maj_football: !sport || sport === "FOOTBALL" ? now.toISOString() : null, maj_nba: !sport || sport === "NBA" ? now.toISOString() : null, cartes: cards.length, joueurs: players.length, set: setName, gw_football: fixtures.FOOTBALL.slug, gw_nba: fixtures.NBA.slug, limite_football: fixtures.FOOTBALL.cutOffDate, limite_nba: fixtures.NBA.cutOffDate, gw_debut_football: fixtures.FOOTBALL.startDate || null, gw_fin_football: fixtures.FOOTBALL.endDate || null, gw_debut_nba: fixtures.NBA.startDate || null, gw_fin_nba: fixtures.NBA.endDate || null, arcade_debut: fixtures.LIVE_FOOTBALL?.startDate ?? fixtures.FOOTBALL.startDate ?? null, arcade_fin: fixtures.LIVE_FOOTBALL?.endDate ?? fixtures.FOOTBALL.endDate ?? null, set_nba: ctx.setNameNBA || "", arcade_nba_debut: fixtures.LIVE_NBA?.startDate ?? fixtures.NBA.startDate ?? null, arcade_nba_fin: fixtures.LIVE_NBA?.endDate ?? fixtures.NBA.endDate ?? null, europe_slug: ctx.europe?.slug ?? null, europe_debut: ctx.europe?.debut ?? null, europe_fin: ctx.europe?.fin ?? null, poids_sorare: w, cotes_externes: odds.length > 0 ? "oui" : "non", appels_api: ctx.appels() }],
    },
    history: { samples: allSamples, calibration: calib.slice(-90) },
  };
}
