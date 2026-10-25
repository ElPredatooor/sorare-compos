// Vérification des jeux de données Sorare : contrat (docs/contrat-donnees.md v3) et règles des compos.
// Usage : node outils/verifier.mjs <dossier>   (le dossier contient joueurs.json|csv, compos.json|csv, ...)
// Code de sortie : 0 = OK ou remarques seulement, 1 = au moins une erreur bloquante.
import { readFile, access } from "node:fs/promises";
import path from "node:path";

const dir = process.argv[2] || "data/latest";
const errors = [], warnings = [];
const err = (sport, msg) => errors.push(`[${sport}] ${msg}`);
const warn = (sport, msg) => warnings.push(`[${sport}] ${msg}`);

// ---------- Contrat ----------
// Colonnes obligatoires : v1, v2 (source_titulaire, matchs) et colonnes de la demande Cowork n° 1 déjà produites par la collecte
// (joueurs.proj_match…, compos.slug / carte_id, competitions.type…, jeux cartes et paliers).
const COLS = {
  joueurs: ["joueur", "slug", "sport", "modes", "club", "poste", "etoiles", "plancher_etoiles", "gain_etoiles", "gain_sorare", "back_to_back", "espn_statut", "espn_info", "espn_retour", "minutes_5", "minutes_tendance", "statut", "blessure", "suspension", "l5", "l10", "l15", "forme10", "minutes_moy", "part_decisive", "regularite", "matchs_gw", "adversaire", "match", "adv_attaque_rang", "adv_defense_rang", "adv_nb_equipes", "adv_ligue", "adv_attaque_val", "adv_defense_val", "competition_match", "proba_victoire", "proba_victoire_adv", "clean_sheet", "total_match", "proba_titulaire", "source_titulaire", "grade_sorare", "proj_sorare", "proj_forme", "score_attendu", "carte", "carte_label", "bonus", "bonus_skin", "score_final", "nb_cartes", "proj_match", "matchs_probables", "coequipiers_absents", "minutes_liberees"],
  compos: ["competition", "sport", "numero", "slot", "joueur", "slug", "carte_id", "carte", "capitaine", "score_attendu", "gain_etoiles", "bonus", "score_final", "etoiles", "moyenne_cap", "adversaire", "match", "adv_attaque_rang", "adv_defense_rang", "adv_nb_equipes"],
  competitions: ["competition", "slug", "sport", "date_limite", "joueurs_eligibles", "contraintes", "max_compos", "nb_compos", "scores_compos", "score_compo", "statut", "regles", "type", "rang", "cap_points", "cap_etoiles", "min_in_season", "max_par_club", "capitaine_pct"],
  jours: ["mode", "jour", "rang", "joueur", "poste", "adversaire", "match", "score_attendu", "adv_attaque_rang", "adv_defense_rang", "adv_nb_equipes"],
  changements: ["joueur", "modes", "type", "detail"],
  calibration: ["date", "sport", "matchs", "erreur_modele", "erreur_sorare", "erreur_forme", "poids_sorare"],
  resume: ["maj", "cartes", "joueurs", "set", "gw_football", "gw_nba", "limite_football", "limite_nba", "poids_sorare", "cotes_externes", "appels_api"],
  cartes: ["sport", "slug", "joueur", "carte_id", "label", "rarete", "saison", "puissance", "skin", "in_season", "set_courant"],
  paliers: ["sport", "competition", "gw_reference", "type", "rang", "score", "recompense", "participants"],
  matchs: ["sport", "slug", "joueur", "date", "jour", "adversaire", "proj", "proba", "b2b", "adv_attaque_rang", "adv_defense_rang", "adv_nb_equipes", "proba_victoire", "total"],
  bilan: ["sport", "gw", "competition", "numero", "score_prevu", "score_reel", "ecart", "palier_vise", "palier_atteint", "joueurs", "source_compos"],
  plan_arcade: ["depart", "etape", "palier", "seuil", "creneau", "resultat_vers", "compo", "joueurs", "score_attendu", "proba_compo", "proba_palier", "conseil"],
};
// Colonnes v3 contrôlées seulement si présentes (collectes antérieures au contrat v3, ou stratège pas encore livré) : remarque si absentes
const COLS_V3 = {
  competitions: ["cout_inscription", "gains_esperes", "gain_net_espere", "autres_recompenses", "rentable", "recommandation", "alternative"],
  resume: ["gw_debut_football", "gw_fin_football", "gw_debut_nba", "gw_fin_nba"],
};
const FACULTATIFS = new Set(["bilan", "plan_arcade"]); // jeu v3 : absent des collectes antérieures -> remarque
const NBA_ONLY = ["etoiles", "plancher_etoiles", "gain_etoiles", "gain_sorare", "back_to_back", "espn_statut", "espn_info", "espn_retour", "minutes_5", "minutes_tendance", "l10", "matchs_probables", "coequipiers_absents", "minutes_liberees"];
const FOOT_ONLY = ["statut", "suspension", "part_decisive", "clean_sheet", "grade_sorare", "bonus_skin", "competition_match", "proba_victoire_adv", "source_titulaire"];
const FLOOR = { 5: 50, 4.5: 45, 4: 40, 3.5: 35, 3: 30, 2.5: 25, 2: 20, 1.5: 15, 1: 0 };
const FOOT_SLOTS = ["Gardien", "Défenseur", "Milieu", "Attaquant", "Extra"];

// ---------- Lecture JSON ou CSV ----------
function parseCsv(text) {
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const [head = [], ...body] = rows.filter((r) => r.length > 1 || r[0] !== "");
  const conv = (v) => (v === "" ? null : v === "true" ? true : v === "false" ? false : !Number.isNaN(Number(v)) && /^-?\d/.test(v) ? Number(v) : v);
  return { columns: head, rows: body.map((r) => Object.fromEntries(head.map((h, k) => [h, conv(r[k] ?? "")]))) };
}
async function load(name) {
  for (const ext of ["json", "csv"]) {
    const p = path.join(dir, `${name}.${ext}`);
    try { await access(p); } catch { continue; }
    const text = await readFile(p, "utf8");
    if (ext === "json") { const rows = JSON.parse(text); return { file: p, columns: rows.length ? Object.keys(rows[0]) : null, rows }; }
    return { file: p, ...parseCsv(text) };
  }
  return null;
}
const empty = (v) => v == null || v === "";
const num = (v) => (empty(v) ? null : Number(v));
const sportOf = (s) => (String(s).toUpperCase() === "NBA" ? "NBA" : "FOOTBALL");
const bool = (v) => v === true || v === "true" || v === 1 || v === "1" || v === "oui";
const fr = (x) => String(Math.round(x * 10) / 10).replace(".", ",");

// ---------- Présence des jeux et des colonnes ----------
const data = {}, cols = {};
for (const name of Object.keys(COLS)) {
  const d = await load(name);
  if (!d) { (FACULTATIFS.has(name) ? warn : err)("F+N", `${name} : fichier absent dans ${dir}` + (FACULTATIFS.has(name) ? " (jeu v3, collecte antérieure au contrat v3 ?)" : "")); continue; }
  data[name] = d.rows; cols[name] = d.columns;
  if (!d.columns) continue; // JSON vide : rien à contrôler
  const v3 = COLS_V3[name] || [];
  const miss = COLS[name].filter((c) => !d.columns.includes(c));
  const missV3 = v3.filter((c) => !d.columns.includes(c));
  const extra = d.columns.filter((c) => !COLS[name].includes(c) && !v3.includes(c));
  if (miss.length) err("F+N", `${name} : colonnes absentes du fichier : ${miss.join(", ")}`);
  if (missV3.length) warn("F+N", `${name} : colonnes v3 absentes (pas encore produites ou collecte antérieure au contrat v3) : ${missV3.join(", ")}`);
  if (extra.length) warn("F+N", `${name} : colonnes hors contrat (à ajouter à docs/contrat-donnees.md) : ${extra.join(", ")}`);
}
const has = (name, col) => (cols[name] || []).includes(col);

// ---------- joueurs : séparation football / NBA ----------
const joueurs = data.joueurs || [];
const joueurBySlug = new Map();
for (const r of joueurs) {
  if (joueurBySlug.has(r.slug)) err(sportOf(r.sport), `joueurs : slug en double ${r.slug}`);
  joueurBySlug.set(r.slug, r);
  if (!["FOOTBALL", "NBA"].includes(r.sport)) err("F+N", `joueurs : sport invalide « ${r.sport} » pour ${r.joueur}`);
  const nba = r.sport === "NBA";
  for (const k of nba ? FOOT_ONLY : NBA_ONLY) if (k in r && !empty(r[k])) err(nba ? "NBA" : "FOOTBALL", `joueurs : ${r.joueur} a une valeur dans la colonne ${k}, réservée à l'autre sport`);
  if (nba && !empty(r.poste)) err("NBA", `joueurs : ${r.joueur} a un poste (doit être vide en NBA)`);
  if (!nba && !empty(r.source_titulaire) && !["cote Sorare", "statut"].includes(r.source_titulaire)) err("FOOTBALL", `joueurs : source_titulaire « ${r.source_titulaire} » inconnue pour ${r.joueur}`);
  if (nba && !empty(r.etoiles)) {
    const e = Number(r.etoiles);
    if (!(e in FLOOR)) err("NBA", `joueurs : ${r.joueur} a ${e} étoiles (attendu 1 à 5 par demi-points)`);
    else if (!empty(r.plancher_etoiles) && Number(r.plancher_etoiles) !== FLOOR[e]) err("NBA", `joueurs : ${r.joueur} ${e}★ avec un plancher ${r.plancher_etoiles} (attendu ${FLOOR[e]})`);
  }
}
const nbaSansEtoiles = joueurs.filter((r) => r.sport === "NBA" && empty(r.etoiles));
const nbaSansClub = joueurs.filter((r) => r.sport === "NBA" && empty(r.club));
if (nbaSansEtoiles.length || nbaSansClub.length) warn("NBA", `joueurs : ${nbaSansEtoiles.length} sans étoiles (${nbaSansEtoiles.map((r) => r.joueur).join(", ")}), ${nbaSansClub.length} sans équipe (joueurs libres chez Sorare : activeClub et gameplayTier vides ; comptés 1★ par l'optimiseur)`);

// ---------- cartes ----------
const cartes = data.cartes || [];
const carteById = new Map();
for (const k of cartes) {
  if (carteById.has(k.carte_id)) err(sportOf(k.sport), `cartes : carte_id en double ${k.carte_id}`);
  carteById.set(k.carte_id, k);
  if (!["Football", "NBA"].includes(k.sport)) err("F+N", `cartes : sport « ${k.sport} » invalide (attendu Football ou NBA) pour ${k.carte_id}`);
  const j = joueurBySlug.get(k.slug);
  if (j && sportOf(j.sport) !== sportOf(k.sport)) err(sportOf(k.sport), `cartes : ${k.carte_id} (${k.sport}) rattachée à un joueur ${j.sport}`);
}

// ---------- competitions et compos ----------
const comps = data.competitions || [], compos = data.compos || [];
const compByName = new Map(comps.map((c) => [c.competition, c]));
for (const l of compos) {
  if (!compByName.has(l.competition)) err(sportOf(l.sport), `compos : compétition « ${l.competition} » absente de competitions`);
  if (has("compos", "slug") && !joueurBySlug.has(l.slug)) err(sportOf(l.sport), `compos : ${l.joueur} (${l.slug}) absent de joueurs`);
  if (has("compos", "carte_id") && cartes.length && !carteById.has(l.carte_id)) err(sportOf(l.sport), `compos : carte ${l.carte_id} de ${l.joueur} absente de cartes`);
}
// Une compo sans raison : statut vide ou simple « N compos proposées »
const sansRaison = (s) => empty(s) || /^(\d+ compos? proposées?|Compo proposée)$/i.test(String(s).trim());
const cardUse = new Map();
for (const c of comps) {
  const sport = sportOf(c.sport);
  const txt = String(c.contraintes || "");
  const lu = (col, re) => (has("competitions", col) ? num(c[col]) : num((txt.match(re) || [])[1]?.replace(",", ".")));
  const capStars = lu("cap_etoiles", /somme des étoiles ≤ ([\d.,]+)/);
  const capPoints = lu("cap_points", /somme des moyennes ≤ ([\d.,]+)/);
  const minIS = lu("min_in_season", /min (\d+) cartes In-Season/);
  const maxClub = lu("max_par_club", /max (\d+) par équipe/);
  const capPct = has("competitions", "capitaine_pct") ? num(c.capitaine_pct) || 0 : num((txt.match(/capitaine \+(\d+)/) || [])[1]) || 0;
  if (sport === "NBA" && capPct) err("NBA", `${c.competition} : capitaine_pct = ${capPct} (pas de capitaine en NBA)`);
  const lines = compos.filter((l) => l.competition === c.competition);
  const nums = [...new Set(lines.map((l) => Number(l.numero) || 1))].sort((a, b) => a - b);
  const scores = String(c.scores_compos ?? "").split(" ").filter(Boolean).map(Number);
  if (Number(c.nb_compos) !== nums.length) err(sport, `${c.competition} : nb_compos = ${c.nb_compos} mais ${nums.length} compo(s) dans compos`);
  if (Number(c.nb_compos) > Number(c.max_compos)) err(sport, `${c.competition} : nb_compos (${c.nb_compos}) > max_compos (${c.max_compos})`);
  if (scores.length !== Number(c.nb_compos)) err(sport, `${c.competition} : ${scores.length} score(s) dans scores_compos pour ${c.nb_compos} compo(s)`);
  if (Number(c.nb_compos) < Number(c.max_compos) && sansRaison(c.statut)) warn(sport, `${c.competition} : moins de compos que possible sans raison dans le statut`);
  nums.forEach((n, i) => { if (n !== i + 1) err(sport, `${c.competition} : numéros de compo non consécutifs (${nums.join(", ")})`); });
  for (const n of nums) {
    const t = lines.filter((l) => (Number(l.numero) || 1) === n);
    const label = `${c.competition} compo ${n}`;
    if (t.length !== 5) err(sport, `${label} : ${t.length} joueurs (attendu 5)`);
    if (new Set(t.map((l) => l.slug || l.joueur)).size !== t.length) err(sport, `${label} : un joueur apparaît deux fois`);
    if (scores[n - 1] != null) {
      const s = t.reduce((a, l) => a + (num(l.score_final) || 0), 0);
      if (Math.abs(s - scores[n - 1]) > 1) warn(sport, `${label} : somme des scores ${s.toFixed(1)} ≠ score annoncé ${scores[n - 1]}`);
    }
    const carte = (l) => carteById.get(l.carte_id);
    const inSeason = (l) => (carte(l) ? bool(carte(l).in_season) : /In-Season/.test(String(l.carte)));
    if (maxClub != null) {
      const parClub = new Map();
      for (const l of t) { const club = joueurBySlug.get(l.slug)?.club; if (club) parClub.set(club, (parClub.get(club) || 0) + 1); }
      for (const [club, k] of parClub) if (k > maxClub) err(sport, `${label} : ${k} joueurs de ${club} (maximum ${maxClub})`);
    }
    if (minIS != null) {
      const nIS = t.filter(inSeason).length;
      if (nIS < Math.min(minIS, 5)) err(sport, `${label} : ${nIS} cartes In-Season (minimum ${minIS})`);
    }
    if (sport === "NBA") {
      if (t.some((l) => !empty(l.capitaine))) err("NBA", `${label} : capitaine présent (pas de capitaine en NBA)`);
      // règle retenue : un joueur sans niveau compte 1★ sous le plafond
      const stars = t.reduce((a, l) => a + (empty(l.etoiles) ? 1 : Number(l.etoiles)), 0);
      if (capStars != null && stars > capStars + 1e-9) err("NBA", `${label} : ${fr(stars)} étoiles > plafond ${capStars}`);
      if (t.some((l) => empty(l.etoiles))) warn("NBA", `${label} : étoiles manquantes pour au moins un joueur (compté 1★)`);
      if (t.some((l) => carte(l) && carte(l).rarete !== "limited")) err("NBA", `${label} : carte non Limited`);
    } else {
      const slots = t.map((l) => l.slot).sort();
      const isSet = /^Football Set/.test(c.competition) || c.type === "SET";
      if (JSON.stringify(slots) !== JSON.stringify([...FOOT_SLOTS].sort())) err("FOOTBALL", `${label} : postes ${slots.join(", ")} (attendu ${FOOT_SLOTS.join(", ")})`);
      const caps = t.filter((l) => l.capitaine === "Oui").length;
      if (capPct && caps !== 1) err("FOOTBALL", `${label} : ${caps} capitaine(s) (attendu 1)`);
      if (!capPct && caps) err("FOOTBALL", `${label} : capitaine alors que la compétition n'en prévoit pas`);
      if (capPoints != null) {
        if (t.some((l) => empty(l.moyenne_cap))) err("FOOTBALL", `${label} : moyenne_cap manquante (compétition à plafond)`);
        const s = t.reduce((a, l) => a + (num(l.moyenne_cap) || 0), 0);
        if (s > capPoints + 1e-9) err("FOOTBALL", `${label} : somme des moyennes ${s.toFixed(1)} > plafond ${capPoints}`);
      }
      if (isSet && t.some((l) => (carte(l) ? carte(l).rarete !== "common" : !/^Common/.test(String(l.carte))))) err("FOOTBALL", `${label} : carte non Common dans la compo Set`);
    }
    for (const l of t) { const k = has("compos", "carte_id") && !empty(l.carte_id) ? sport + "|id|" + l.carte_id : sport + "|lib|" + l.joueur + "|" + l.carte; cardUse.set(k, [...(cardUse.get(k) || []), { label, joueur: l.joueur, carte: l.carte }]); }
  }

  // Colonnes v3 (stratège), contrôlées si présentes
  if (has("competitions", "gains_esperes")) {
    const gains = String(c.gains_esperes ?? "").split(" ").filter(Boolean).map(Number);
    const cout = num(c.cout_inscription) || 0;
    if (/arena/.test(String(c.slug)) && cout !== 150) warn(sport, `${c.competition} : cout_inscription = ${c.cout_inscription} (Rooms : 150 essences Limited attendues)`);
    if (gains.length && gains.length !== scores.length) err(sport, `${c.competition} : ${gains.length} valeur(s) dans gains_esperes pour ${scores.length} dans scores_compos`);
    if (gains.some((g) => Number.isNaN(g))) err(sport, `${c.competition} : gains_esperes non numérique (« ${c.gains_esperes} »)`);
    if (gains.length && !empty(c.gain_net_espere)) {
      const net = gains.reduce((a, g) => a + g, 0) - cout * Number(c.nb_compos);
      if (Math.abs(net - Number(c.gain_net_espere)) > 1) err(sport, `${c.competition} : gain_net_espere ${c.gain_net_espere} ≠ somme des gains − coût (${fr(net)})`);
    }
    if (!gains.length && !empty(c.gain_net_espere)) warn(sport, `${c.competition} : gain_net_espere rempli sans gains_esperes`);
    const r = empty(c.rentable) ? "" : String(c.rentable);
    if (r && !["oui", "non"].includes(r)) err(sport, `${c.competition} : rentable « ${r} » (attendu oui, non ou vide)`);
    if (cout > 0 && gains.length) {
      const attendu = gains.some((g) => g < cout) ? "non" : "oui";
      if (r !== attendu) err(sport, `${c.competition} : rentable = « ${r} » alors que les gains espérés (${gains.join(", ")}) ${attendu === "non" ? "passent sous" : "couvrent"} le coût de ${cout}`);
    } else if (r) warn(sport, `${c.competition} : rentable = « ${r} » sans coût d'inscription ou sans palier`);
    if (cout > 0 && Number(c.nb_compos) > 0 && empty(c.recommandation)) warn(sport, `${c.competition} : compétition payante sans recommandation`);
  }
}
// Une carte par compo : contrôle exact par carte_id, sinon (anciennes collectes) même joueur et même libellé
for (const [k, where] of cardUse) if (where.length > 1) {
  const [sport, mode] = k.split("|");
  const w = where.map((x) => x.label).join(" ; ");
  if (mode === "id") err(sport, `${where[0].joueur} : la même carte (${k.split("|")[2]}) est alignée dans ${where.length} compos (${w})`);
  else warn(sport, `${where[0].joueur} (${where[0].carte}) aligné dans ${where.length} compos (${w}) : vérifier qu'il possède bien ${where.length} cartes distinctes (compos.carte_id absent)`);
}

// ---------- paliers ----------
const paliers = data.paliers || [];
const palGroupes = new Map();
for (const p of paliers) {
  const sport = sportOf(p.sport);
  if (!["Football", "NBA"].includes(p.sport)) err("F+N", `paliers : sport « ${p.sport} » invalide (attendu Football ou NBA)`);
  if (!["classement", "salon"].includes(p.type)) err(sport, `paliers : type « ${p.type} » inconnu (${p.competition})`);
  if (!(Number(p.rang) >= 1)) err(sport, `paliers : rang ${p.rang} invalide (${p.competition})`);
  if (empty(p.score)) err(sport, `paliers : score manquant (${p.competition}, rang ${p.rang})`);
  const c = compByName.get(p.competition);
  if (!c) warn(sport, `paliers : compétition « ${p.competition} » absente de competitions`);
  else if (sportOf(c.sport) !== sport) err(sport, `paliers : ${p.competition} classée ${p.sport} mais la compétition est ${c.sport}`);
  const k = p.competition + "|" + p.gw_reference;
  palGroupes.set(k, [...(palGroupes.get(k) || []), p]);
}
for (const [k, list] of palGroupes) {
  const s = list.slice().sort((a, b) => a.rang - b.rang);
  for (let i = 1; i < s.length; i++) if (Number(s[i].score) > Number(s[i - 1].score) + 1e-9) { warn(sportOf(s[i].sport), `paliers : ${k.split("|")[0]} : score du rang ${s[i].rang} (${s[i].score}) supérieur à celui du rang ${s[i - 1].rang} (${s[i - 1].score})`); break; }
}

// ---------- matchs (NBA) ----------
const clesMatchs = new Set();
for (const m of data.matchs || []) {
  // v4 : lignes football autorisées pour les joueurs du Set (période Arcade)
  if (m.sport === "Football") { const jf = joueurBySlug.get(m.slug); if (!jf || jf.sport !== "FOOTBALL" || !String(jf.modes || "").includes("SET")) err("FOOTBALL", `matchs : ${m.joueur} n'est pas un joueur du Set`); continue; }
  if (m.sport !== "NBA") err("F+N", `matchs : sport « ${m.sport} » invalide`);
  const j = joueurBySlug.get(m.slug);
  if (!j) err("NBA", `matchs : ${m.joueur} (${m.slug}) absent de joueurs`);
  else if (j.sport !== "NBA") err("NBA", `matchs : ${m.joueur} est un joueur ${j.sport}`);
  const k = m.slug + "|" + m.date;
  if (clesMatchs.has(k)) err("NBA", `matchs : ligne en double ${m.joueur} ${m.date}`);
  clesMatchs.add(k);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(m.jour))) err("NBA", `matchs : jour « ${m.jour} » invalide (${m.joueur})`);
  if (!empty(m.proba) && !(Number(m.proba) >= 0 && Number(m.proba) <= 100)) err("NBA", `matchs : proba ${m.proba} hors 0 à 100 (${m.joueur} ${m.jour})`);
  if (!empty(m.proba_victoire) && !(Number(m.proba_victoire) >= 0 && Number(m.proba_victoire) <= 100)) err("NBA", `matchs : proba_victoire ${m.proba_victoire} hors 0 à 100 (${m.joueur} ${m.jour})`);
  if (!empty(m.b2b) && typeof m.b2b !== "boolean") err("NBA", `matchs : b2b « ${m.b2b} » non booléen (${m.joueur} ${m.jour})`);
}

// ---------- bilan (v3) ----------
const clesBilan = new Set();
for (const b of data.bilan || []) {
  const sport = sportOf(b.sport);
  if (!["Football", "NBA"].includes(b.sport)) err("F+N", `bilan : sport « ${b.sport} » invalide (attendu Football ou NBA)`);
  if (/^NBA/.test(String(b.competition)) !== (b.sport === "NBA")) err(sport, `bilan : ${b.competition} classée ${b.sport}`);
  if (empty(b.gw) || !String(b.gw).startsWith(b.sport === "NBA" ? "nba" : "football")) err(sport, `bilan : gameweek « ${b.gw} » incohérente avec le sport (${b.competition})`);
  if (!(Number(b.numero) >= 1)) err(sport, `bilan : numéro ${b.numero} invalide (${b.competition})`);
  const k = [b.sport, b.competition, b.numero, b.gw].join("|");
  if (clesBilan.has(k)) err(sport, `bilan : ligne en double ${b.competition} compo ${b.numero} (${b.gw})`);
  clesBilan.add(k);
  if (!empty(b.score_reel) && !empty(b.score_prevu) && Math.abs(Number(b.score_reel) - Number(b.score_prevu) - Number(b.ecart)) > 0.15) err(sport, `bilan : ${b.competition} compo ${b.numero} : ecart ${b.ecart} ≠ score_reel − score_prevu`);
  if (empty(b.score_reel)) warn(sport, `bilan : ${b.competition} compo ${b.numero} : score réel inconnu (scores d'un joueur introuvables)`);
  if (empty(b.source_compos)) err(sport, `bilan : ${b.competition} compo ${b.numero} : source_compos vide`);
  if (String(b.joueurs || "").split(" ; ").filter(Boolean).length !== 5) warn(sport, `bilan : ${b.competition} compo ${b.numero} : ${String(b.joueurs || "").split(" ; ").filter(Boolean).length} joueurs dans le détail (attendu 5)`);
}

// ---------- jours, changements, calibration, resume ----------
for (const r of data.jours || []) {
  if (!(Number(r.rang) >= 1 && Number(r.rang) <= 5)) err(sportOf(r.mode), `jours : rang ${r.rang} hors 1 à 5 (${r.mode} ${r.jour})`);
  if (r.mode === "NBA" && !empty(r.poste)) err("NBA", `jours : ${r.joueur} a un poste en NBA`);
}
const validTypes = ["Nouvelle blessure", "Retour de blessure", "Suspension", "Statut modifié", "Projection en hausse", "Projection en baisse"];
for (const r of data.changements || []) {
  if (!validTypes.includes(r.type)) err("F+N", `changements : type inconnu « ${r.type} »`);
  if (String(r.modes).split(" ").includes("NBA") && ["Suspension", "Statut modifié"].includes(r.type)) warn("NBA", `changements : ${r.type} pour ${r.joueur} (type football)`);
}
for (const r of data.calibration || []) if (!["FOOTBALL", "NBA"].includes(r.sport)) err("F+N", `calibration : sport « ${r.sport} » invalide au ${r.date}`);
if (data.resume && data.resume.length !== 1) err("F+N", `resume : ${data.resume.length} lignes (attendu 1)`);
const res = (data.resume || [])[0];
if (res) for (const [k, sp] of [["football", "FOOTBALL"], ["nba", "NBA"]]) {
  const d0 = res["gw_debut_" + k], d1 = res["gw_fin_" + k];
  if (empty(d0) || empty(d1)) continue;
  if (!(Date.parse(d0) < Date.parse(d1))) err(sp, `resume : gw_debut_${k} (${d0}) n'est pas avant gw_fin_${k} (${d1})`);
  if (!empty(res["limite_" + k]) && Date.parse(res["limite_" + k]) > Date.parse(d1)) err(sp, `resume : date limite ${res["limite_" + k]} après la fin de la gameweek (${d1})`);
}

// ---------- Rapport ----------
const verdict = errors.length ? "BLOQUANT" : warnings.length ? "OK avec remarques" : "OK";
console.log(`Vérification de ${dir} : ${verdict}`);
console.log(`${joueurs.length} joueurs, ${comps.length} compétitions, ${compos.length} lignes de compos, ${cartes.length} cartes, ${paliers.length} paliers, ${(data.matchs || []).length} matchs, ${data.bilan ? data.bilan.length + " lignes de bilan" : "pas de bilan"}`);
if (errors.length) console.log("\nErreurs bloquantes :\n" + errors.map((e) => "  - " + e).join("\n"));
if (warnings.length) console.log("\nRemarques :\n" + warnings.map((e) => "  - " + e).join("\n"));
process.exit(errors.length ? 1 : 0);
