// Garde de nuit Set NBA (NBA seulement, jamais le football) : regle de decision pure, sans reseau ni ecriture.
// Le script reseau (lecture des compos posees, ESPN, workflow GitHub) est a la charge de l'agent `donnees` ; il appelle :
//   - candidatsDepuisCollecte(donnees, opts) : cartes Common NBA du set en cours -> candidats { cardSlug, playerSlug, equipe, etoiles, projection, debutMatch }
//   - choisirRemplacements({ compo, autresCartesUtilisees, candidats, statuts, maintenant, ... }) -> { remplacements, signalements, impossible }
// MODE ESSAI (02/11/2026) : l'appelant n'ecrit rien sur Sorare, il journalise seulement la decision.
//
// Regles (sources) :
//   - « Certain absent » = statut ESPN « Out » ; Doubtful / Questionable / Day-To-Day : signale, jamais remplace (utilisateur 02/11/2026).
//   - Des qu'un joueur d'une compo a commence son match, TOUTE la compo est verrouillee (utilisateur 02/11/2026, skill regles-nba).
//   - Somme des etoiles <= 16, au plus 4 joueurs d'une meme equipe NBA (utilisateur 02/11/2026 ; ARCADE_NBA_ETOILES / ARCADE_NBA_PAR_EQUIPE de compos.mjs).
//   - Sans niveau = 1★ (etoilesCap de compos.mjs, choix de l'utilisateur pour les compos Pro, repris par la piste Set NBA).
//   - Une carte par compo, un joueur une seule fois par compo (meilleureCompoNba de compos.mjs) ; une carte deja utilisee
//     dans une autre compo (posee ou jouee) ne resert pas (aide Sorare « What is Sorare Set (NBA)? » + utilisateur 02/11/2026).
//   - Valeur d'une carte = projection du match × probabilite de jouer × puissance × skin, comme planPiste / PISTE_ARCADE_NBA.valeur.
import { ARCADE_NBA_ETOILES, ARCADE_NBA_PAR_EQUIPE } from "./compos.mjs";

const EPS = 1e-9;
// Dates : nombre (ms), Date ou texte ISO. Les dates des jeux publies (matchs.date, « 2026-11-03T03:00 ») sont en UTC sans
// suffixe : on ajoute « Z » (sinon Node les lirait a l'heure locale).
export const versMs = (t) => {
  if (t == null || t === "") return NaN;
  if (typeof t === "number") return t;
  if (t instanceof Date) return t.getTime();
  const s = String(t);
  return Date.parse(/^\d{4}-\d\d-\d\dT\d\d:\d\d(:\d\d)?$/.test(s) ? s + "Z" : s);
};
const etoilesDe = (x) => (x.etoiles == null || x.etoiles === "" ? 1 : Number(x.etoiles)); // = etoilesCap de compos.mjs
const heureBx = (t) => { try { return new Intl.DateTimeFormat("fr-BE", { timeZone: "Europe/Brussels", hour: "2-digit", minute: "2-digit" }).format(new Date(t)).replace(":", "h"); } catch { return new Date(t).toISOString().slice(11, 16); } };
const nb = (x) => String(Math.round(x * 10) / 10).replace(".", ",");
const statutDe = (statuts, slug) => { const s = statuts instanceof Map ? statuts.get(slug) : statuts?.[slug]; return s ? String(s).trim() : ""; };
const estOut = (s) => /^out$/i.test(s);

/**
 * Remplacements d'une compo Set NBA posee (NBA seulement).
 * compo : [{ cardSlug, playerSlug, equipe, etoiles, debutMatch }] ; candidats : [{ cardSlug, playerSlug, equipe, etoiles, projection, debutMatch }]
 * autresCartesUtilisees : Set ou tableau de cardSlug (cartes posees ou jouees dans les AUTRES compos) ; statuts : Map playerSlug -> statut ESPN.
 * fenetre (optionnelle) : { debut, fin } du Set NBA (resume.arcade_nba_debut / arcade_nba_fin) ; le match du remplacant doit y tomber.
 * Retour : { remplacements: [{ sortant, entrant, projectionEntrant, raison }], signalements: [{ joueur, cardSlug, statut, message }], impossible: [{ sortant, raison }] }
 */
export function choisirRemplacements({ compo, autresCartesUtilisees = [], candidats = [], statuts = new Map(), maintenant = Date.now(), plafondEtoiles = ARCADE_NBA_ETOILES, maxParEquipe = ARCADE_NBA_PAR_EQUIPE, fenetre = null }) {
  const now = versMs(maintenant);
  const res = { remplacements: [], signalements: [], impossible: [] };
  const lignes = (compo || []).map((x) => ({ ...x, t: versMs(x.debutMatch) }));

  // Signalements (Doubtful, Questionable, Day-To-Day... : pas de remplacement)
  for (const x of lignes) {
    const s = statutDe(statuts, x.playerSlug);
    if (s && !estOut(s)) res.signalements.push({ joueur: x.playerSlug, cardSlug: x.cardSlug, statut: s, message: `${x.playerSlug} : statut ESPN « ${s} », pas certain absent, laissé dans la compo (à surveiller).` });
  }
  const outs = lignes.filter((x) => estOut(statutDe(statuts, x.playerSlug))).sort((a, b) => (a.t || 0) - (b.t || 0));
  if (!outs.length) return res;

  // Verrou : un match commence dans la compo = toute la compo verrouillee (utilisateur 02/11/2026)
  const commence = lignes.filter((x) => Number.isFinite(x.t) && x.t <= now);
  if (commence.length) {
    const qui = commence.map((x) => `${x.playerSlug} (${heureBx(x.t)})`).join(", ");
    for (const o of outs) res.impossible.push({ sortant: o.cardSlug, raison: `Compo verrouillée : le match de ${qui} a déjà commencé, aucune carte ne peut plus être changée.` });
    return res;
  }

  const premierMatch = Math.min(...lignes.map((x) => x.t).filter(Number.isFinite));
  const deb = fenetre ? versMs(fenetre.debut) : -Infinity, fin = fenetre ? versMs(fenetre.fin) : Infinity;
  const utilisees = new Set(autresCartesUtilisees instanceof Set ? autresCartesUtilisees : autresCartesUtilisees || []);
  let actuelle = lignes.slice(); // compo courante, mise a jour apres chaque remplacement

  for (const o of outs) {
    const reste = actuelle.filter((x) => x.cardSlug !== o.cardSlug);
    const etoilesReste = reste.reduce((s, x) => s + etoilesDe(x), 0);
    const parEquipe = new Map(); for (const x of reste) parEquipe.set(x.equipe, (parEquipe.get(x.equipe) || 0) + 1);
    const dansCompo = new Set(actuelle.map((x) => x.cardSlug)), joueursCompo = new Set(reste.map((x) => x.playerSlug));
    const rejets = { utilisee: 0, out: 0, commence: 0, horsFenetre: 0, etoiles: 0, equipe: 0, projection: 0, joueur: 0 };
    let best = null;
    for (const c of candidats) {
      const t = versMs(c.debutMatch), p = Number(c.projection);
      if (dansCompo.has(c.cardSlug) || utilisees.has(c.cardSlug)) { rejets.utilisee++; continue; }
      if (joueursCompo.has(c.playerSlug) || c.playerSlug === o.playerSlug) { rejets.joueur++; continue; }
      if (estOut(statutDe(statuts, c.playerSlug))) { rejets.out++; continue; }
      if (!Number.isFinite(t) || t <= now) { rejets.commence++; continue; }
      if (t < deb || t > fin) { rejets.horsFenetre++; continue; }
      if (!(p > 0)) { rejets.projection++; continue; }
      if (etoilesReste + etoilesDe(c) > plafondEtoiles + EPS) { rejets.etoiles++; continue; }
      if ((parEquipe.get(c.equipe) || 0) >= maxParEquipe) { rejets.equipe++; continue; }
      // meilleure projection ; a egalite, moins d'etoiles, puis ordre des slugs (decision stable)
      if (!best || p > best.p + EPS || (Math.abs(p - best.p) <= EPS && (etoilesDe(c) < etoilesDe(best.c) - EPS || (Math.abs(etoilesDe(c) - etoilesDe(best.c)) <= EPS && c.cardSlug < best.c.cardSlug)))) best = { c, p, t };
    }
    if (!best) {
      const motifs = [["etoiles", "plafond de " + nb(plafondEtoiles) + "★ dépassé (" + nb(etoilesReste) + "★ déjà pris par les 4 autres)"], ["equipe", "déjà " + maxParEquipe + " joueurs de leur équipe"], ["commence", "match déjà commencé ou inconnu"], ["horsFenetre", "match hors de la fenêtre du Set"], ["utilisee", "carte déjà dans une compo"], ["out", "joueur lui-même Out"], ["joueur", "joueur déjà dans la compo"], ["projection", "projection nulle"]]
        .filter(([k]) => rejets[k]).map(([k, txt]) => `${rejets[k]} : ${txt}`);
      res.impossible.push({ sortant: o.cardSlug, raison: (candidats || []).length ? `Aucun remplaçant valable pour ${o.playerSlug} (Out) parmi ${candidats.length} cartes — ${motifs.join(" ; ")}. Compo laissée telle quelle.` : `Aucune carte Common NBA candidate fournie pour remplacer ${o.playerSlug} (Out). Compo laissée telle quelle.` });
      continue;
    }
    const c = best.c, e = etoilesReste + etoilesDe(c);
    let raison = `${o.playerSlug} est Out (ESPN) ; ${c.playerSlug} (${c.equipe}, ${nb(etoilesDe(c))}★, match à ${heureBx(best.t)}) a la meilleure projection valide (${nb(best.p)}) ; étoiles de la compo ${nb(e)}/${nb(plafondEtoiles)}.`;
    const sc = statutDe(statuts, c.playerSlug);
    if (sc) raison += ` Attention : ${c.playerSlug} est lui-même « ${sc} » chez ESPN.`;
    if (Number.isFinite(premierMatch) && best.t < premierMatch) raison += ` Attention : son match (${heureBx(best.t)}) commence avant le premier match actuel de la compo (${heureBx(premierMatch)}) : la compo se verrouillera plus tôt.`;
    res.remplacements.push({ sortant: o.cardSlug, entrant: c.cardSlug, projectionEntrant: best.p, raison });
    actuelle = reste.concat({ cardSlug: c.cardSlug, playerSlug: c.playerSlug, equipe: c.equipe, etoiles: etoilesDe(c), debutMatch: c.debutMatch, t: best.t });
  }
  return res;
}

/**
 * Ou trouver etoiles et projection d'une carte Common NBA dans les donnees publiees par la collecte quotidienne
 * (depot-github/data/latest/*.json, ou sorare-donnes/collectes/<date>/*.json ; contrat v8, aucun changement de format) :
 *   - cartes.json  : sport = "NBA", rarete = "common", set_courant = true ; carte_id = cardSlug, slug = playerSlug, puissance, skin.
 *   - joueurs.json : jointure slug = playerSlug ; etoiles (null -> 1★), club = equipe, espn_statut (statut de la collecte, a
 *                    remplacer la nuit par ESPN en direct), score_attendu (repli si aucun match).
 *   - matchs.json  : jointure slug = playerSlug, sport = "NBA" ; date (UTC, « AAAA-MM-JJTHH:MM ») = debutMatch,
 *                    proj = projection du match, proba = probabilite de jouer (%).
 *   - resume.json  : arcade_nba_debut / arcade_nba_fin = fenetre du Set NBA.
 * projection = proj × proba / 100 × puissance × skin, comme la piste Set NBA (planPiste). Le match retenu est le premier
 * match du joueur qui n'a pas commence et tombe dans la fenetre. Sans ligne matchs (joueur sans match) : pas de candidat.
 * donnees = { cartes, joueurs, matchs, resume } (tableaux deja lus) ; opts = { maintenant }.
 */
export function candidatsDepuisCollecte({ cartes = [], joueurs = [], matchs = [], resume = [] }, { maintenant = Date.now() } = {}) {
  const now = versMs(maintenant);
  const R = Array.isArray(resume) ? resume[0] || {} : resume || {};
  const deb = versMs(R.arcade_nba_debut), fin = versMs(R.arcade_nba_fin);
  const J = new Map(joueurs.filter((j) => j.sport === "NBA").map((j) => [j.slug, j]));
  const M = new Map();
  for (const m of matchs) {
    if (m.sport !== "NBA") continue;
    const t = versMs(m.date);
    if (!(t > now) || (Number.isFinite(deb) && t < deb) || (Number.isFinite(fin) && t > fin)) continue;
    const o = M.get(m.slug); if (!o || t < o.t) M.set(m.slug, { t, date: m.date, proj: Number(m.proj) || 0, proba: Number(m.proba) || 0 });
  }
  const out = [];
  for (const k of cartes) {
    if (k.sport !== "NBA" || k.rarete !== "common" || !k.set_courant) continue;
    const j = J.get(k.slug), g = M.get(k.slug);
    if (!j || !g) continue;
    out.push({ cardSlug: k.carte_id, playerSlug: k.slug, joueur: k.joueur, equipe: j.club, etoiles: j.etoiles ?? 1,
      projection: Math.round(g.proj * g.proba / 100 * (Number(k.puissance) || 1) * (Number(k.skin) || 1) * 10) / 10,
      debutMatch: new Date(g.t).toISOString(), espn_statut: j.espn_statut || "" });
  }
  return { candidats: out, fenetre: { debut: R.arcade_nba_debut || null, fin: R.arcade_nba_fin || null } };
}

// Lecture locale d'un dossier de collecte (depot-github/data/latest ou sorare-donnes/collectes/<date>) : fichiers seulement, aucun reseau.
export async function lireCollecte(dossier) {
  const { readFile } = await import("node:fs/promises");
  const { join } = await import("node:path");
  const lis = async (n) => { const j = JSON.parse(await readFile(join(dossier, n + ".json"), "utf8")); return Array.isArray(j) ? j : j.rows || j.data || []; };
  return { cartes: await lis("cartes"), joueurs: await lis("joueurs"), matchs: await lis("matchs"), resume: await lis("resume") };
}
