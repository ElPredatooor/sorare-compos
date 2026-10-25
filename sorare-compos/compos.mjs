// Compositions Sorare pour Elpredatooor : sections 8 a 12 de l'ancien core.mjs
// (compos, meilleurs par jour, changements, cartes et calendrier NBA pour le dashboard).
// calculeCompos(contexte de collecte.mjs, rows de modele.mjs, prev, now) -> { lineups, compRows, jours, changes, cartes, matchs, plan_arcade }
// planPiste(rows, gabarit, opts) : plan de piste football (contrat v5, colonne mode) ; planArcade (Set, cartes Common) et
// planEurope (Pro European Contenders, cartes Limited et plus, Ligue Europa / Conference League) en sont deux reglages.
// evalueRentabilite(compRows, lineups, paliers, rows) : apres les paliers (core.mjs), colonnes v3 de competitions et choix
// NBA entre In-Season en priorite 1 et l'option sans In-Season (modifie compRows et lineups en place).

import { POS, round, day, cardLabel } from "./collecte.mjs";
import { jourDuMatch } from "./modele.mjs";

export function calculeCompos({ comps, currentSet, setName, fixtures, advRank, europe }, rows, prev, now = new Date()) {
  // ---------- 8. Compositions ----------
  const used = new Set();
  const order = [...comps].sort((a, b) => rank(a) - rank(b));
  // Option A : ordre de priorite actuel (In-Season NBA en priorite 1, decision de l'utilisateur du 24/10/2026)
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
export function fenetreArcade(fixtures, now) {
  const f = fixtures?.LIVE_FOOTBALL?.endDate ? fixtures.LIVE_FOOTBALL : fixtures?.FOOTBALL || {};
  const t0 = new Date(now).getTime();
  return { debut: Math.max(t0, Date.parse(f.startDate) || t0), fin: Date.parse(f.endDate) || t0 };
}

// Periode European Contenders (contrat v5, resume.europe_*) : contexte.europe de collecte.mjs (chercheEurope, agent donnees :
// { slug, debut, fin, competitions, capitaine, ... }) ; accepte aussi { startDate, endDate }. Sans fenetre : null -> ni plan
// europe ni matchs europeens. competitions : regle API Competitions (repli EUROPE_COMPETITIONS) ; capitaine : regle API
// CaptainScarcity (repli EUROPE_CAPITAINE).
export function fenetreEurope(e, now) {
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
export const ARCADE_SEUILS = [260, 300, 360, 400, 440, 480]; // utilisateur 25/10/2026
export const ARCADE_DELAI = 110 * 60e3; // 1h50, marge choisie par l'utilisateur le 25/10/2026 (Arcade et European Contenders)
export const ARCADE_VIES = 4; // 4 compos par palier (aide Sorare « What is Arcade? » ; « What is Pro? » : 4 vies aussi)
// Largeur d'un creneau (choix du stratege) : coups d'envoi entre t et t + largeur, largeur 0 (une seule vague), 1 h ou
// 2 h. Plus large = plus de joueurs mais resultat plus tardif ; la recherche choisit pour chaque lot la largeur la
// plus rentable (au palier 1 aussi : jouer au plus tot, mais sans bloquer la vague suivante si ce n'est pas utile).
export const ARCADE_LARGEURS = [0, 3600e3, 2 * 3600e3];
// Objectif : nombre espere de paliers franchis d'ici la fin. true = un palier refranchi apres un retour au palier 1
// compte de nouveau : Sorare redonne la recompense a chaque passage (confirme par l'utilisateur le 25/10/2026). Le plan
// conseille donc rarement d'attendre : un echec ne coute que le temps de refranchir les paliers deja passes.
export const ARCADE_RECOMPTE = true;
const ARCADE_PAR_POSTE = 6; // candidats par poste dans la recherche exhaustive d'une compo

// European Contenders (mode Pro football ; regles donnees par l'utilisateur le 25/10/2026, sauf mention) : 6 paliers aux
// seuils ci-dessous ; compo G/D/M/A + extra (jamais gardien) avec capitaine ; 4 vies (4 compos par palier) ; un succes fait
// monter, 4 echecs ramenent au palier 1 ; recompense redonnee a chaque passage (ARCADE_RECOMPTE) ; 1h50 apres le dernier
// coup d'envoi (ARCADE_DELAI). Cartes et matchs : regles API (docs/europa-contenders.md). Bonus : aide Sorare « What is Pro? »
// (XP, collection, nouvelle saison et capitaine comptent ; pas de bonus de rarete). Skin : non applique (bonus propre au Set).
// Les cartes sont consommees comme en Arcade : sans effet ici, chaque joueur n'a qu'un match europeen dans la periode.
export const EUROPE_SEUILS = [350, 390, 410, 450, 470, 500]; // utilisateur 25/10/2026
// API displayedTypedRules CaptainScarcity « Card score increased by 50% » ; additif (bonus de la carte + 50 % du score du
// joueur), comme optimise() : releve so5Appearances du 25/10/2026 et aide « What is Pro? »
export const EUROPE_CAPITAINE = 50;
// API Scarcity « Limited Cards » + « Higher scarcities permitted » ; Common exclues
export const EUROPE_RARETES = ["limited", "rare", "super_rare", "unique"];
// API Competitions « Players permitted from Europa Conference League, Europa League » (repli si collecte.mjs ne les fournit pas)
export const EUROPE_COMPETITIONS = ["Europa League", "Europa Conference League"];
// Choix du stratege : en Pro, une compo est modifiable jusqu'au premier coup d'envoi de ses joueurs et la marche court
// jusqu'a la fin de la journee (aide « What is Pro? ») : on admet aussi des creneaux de 3 h et 6 h pour melanger les
// matchs de 18h45 et de 21h00 d'un meme jeudi europeen.
export const EUROPE_LARGEURS = [0, 3600e3, 2 * 3600e3, 3 * 3600e3, 6 * 3600e3];
// Nom de competition -> cle comparable (l'API dit « UEFA Conference League » dans les matchs, « Europa Conference League »
// dans les regles ; « UEFA Europa League » / « Europa League »)
export const cleCompetition = (s) => { const x = String(s || "").toLowerCase(); return /conference/.test(x) ? "conference" : /champions/.test(x) ? "champions" : /europa/.test(x) ? "europa" : x.replace(/\buefa\b/g, "").trim(); };
// Puissance d'une carte sans la part rarete (powerBreakdown.scarcityBasisPoints, collecte en section 1). Sans powerBreakdown,
// la puissance totale est gardee (surestime une carte Rare ou plus si Sorare y met un bonus de rarete).
export const puissanceSansRarete = (card) => (Number(card.power) || 1) - (Number(card.bp?.scarcityBasisPoints) || 0) / 10000;

// Gabarits de piste. carte(card, opts), joueur(r), match(g, opts), valeur(base = proj × pPlay, card)
export const PISTE_ARCADE = { mode: "arcade", seuils: ARCADE_SEUILS, capitaine: 0, largeurs: ARCADE_LARGEURS, horizon: "la gameweek", expliquer: false,
  carte: (card, o) => card.rarity === "common" && card.set === o.currentSet, joueur: (r) => !!r._inSet, match: () => true,
  // meme loi que loiCompo (Set : bonus de carte × skin, pas de capitaine), avec la projection et la proba du match
  valeur: (base, card) => base * card.power * card.skinBonus };
export const PISTE_EUROPE = { mode: "europe", seuils: EUROPE_SEUILS, capitaine: EUROPE_CAPITAINE, largeurs: EUROPE_LARGEURS, horizon: "la période European Contenders", expliquer: true,
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
export function planPiste(rows, P, opts) {
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
export function planArcade(rows, { currentSet, debut, fin, recompte = ARCADE_RECOMPTE }) { return planPiste(rows, PISTE_ARCADE, { currentSet, debut, fin, recompte }); }
// European Contenders (Pro) : competitions = noms autorises lus par collecte.mjs (repli EUROPE_COMPETITIONS)
export function planEurope(rows, { debut, fin, competitions = EUROPE_COMPETITIONS, capitaine = EUROPE_CAPITAINE, recompte = ARCADE_RECOMPTE }) { return planPiste(rows, { ...PISTE_EUROPE, capitaine }, { debut, fin, competitions, recompte }); }

// NBA In-Season (slug in_season ou regle API "SeasonBonus")
const estInSeasonNba = (c) => c.sport === "NBA" && !!(c.inSeason || c.minInSeason);
const NON_RECOMMANDE = "non recommandé cette semaine";
// compRows (option A) -> affectation de l'option B, lue par evalueRentabilite() (core.mjs n'a pas a la transmettre)
const OPTION_B = new WeakMap();

// Affectation des cartes aux competitions, dans l'ordre donne (section 8 de l'ancien core.mjs, code inchange).
// sauter(c) -> texte : la competition n'a aucune compo et ce texte devient son statut (option B sans In-Season).
export function affecteCompetitions(order, rows, used, sauter = null) {
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
export const coutInscription = (c) => c.coutInscription ?? c.nbaDef?.essences ?? (c.sport === "FOOTBALL" && sansBonusCarte(c) ? 300 : 0);
// Salons (Rooms NBA « arena_140 », Cap 260 football « arena_limited ») : AUCUN bonus de carte (niveau / XP, In-Season,
// collection). Sources : aide Sorare « What is the Arena? How does it work? » (NBA, art. 30758177419165 : « No Bonuses …
// no XP, Collection, or Season bonuses applied to scores ») et API so5Rankings…so5Appearances{ score bonus } du 25/10/2026 :
// bonus = 1,0 pour toutes les cartes des salons NBA arena_140 et des salons Cap 260 (sauf capitaine 1,2), contre 1,04 a 1,13
// en Classic et In-Season. Les deux sports sont concernes (verifie sur chacun). Avant le 25/10/2026 : score × puissance.
export const sansBonusCarte = (c) => /arena/.test(c?.slug || "");
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
export function calculeChangements(rows, prev, fixtures) {
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
export function raisonInSeasonPrises(c, rows, used, prisPar, nIn) {
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

export function rank(c) { // ordre de priorite d'affectation des cartes
  if (c.sport === "FOOTBALL") return c.inSeason ? 0 : 1;
  return c.nbaDef ? c.nbaDef.rang : 9;
}

// Etoiles comptees sous un plafond (NBA uniquement, seul sport avec capStars). Niveau inconnu (gameplayTier absent,
// etoiles null) : compte comme DNP = 1 etoile, le plus petit niveau du bareme (regles-nba, table des etoiles),
// et non 0, sinon un joueur sans niveau permettait une compo fictive (In-Season Contender a 10,5 + 0 etoile).
const etoilesCap = (x) => x.r.etoiles ?? 1;

// Choix de 5 cartes maximisant le score sous contraintes (recherche exhaustive sur les meilleurs candidats)
export function optimise(c, pool) {
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
export function missingReason(c, pool, nIn) {
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
export function plafondEtoiles(c, pool) {
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
export function assignFootball(t) {
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
export const pAbove = (m, s, t) => (s > 0 ? 0.5 * (1 - erf((t - m) / (s * Math.SQRT2))) : m >= t ? 1 : 0);
export function ecartTypeJoueur(r, value) {
  const p = Math.min(1, Math.max(0.05, r.proba_titulaire == null || r.proba_titulaire === "" ? 0.8 : Number(r.proba_titulaire) / 100));
  const cv = (r.regularite == null || r.regularite === "" ? 40 : Number(r.regularite)) / 100 * (r.sport === "NBA" ? 0.8 : 1);
  const proj = value / p;
  return Math.sqrt(p * (proj * cv) ** 2 + p * (1 - p) * proj ** 2);
}
// Loi du score d'une compo (lignes de compos d'un meme numero). bySlug : joueurs (rows de modele.mjs, avec _cards).
export function loiCompo(picks, comp, bySlug) {
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
export function gainCompo(mean, sd, tiers) {
  let best = 0, gain = 0; const pTier = [];
  for (const t of tiers) {
    const p = pAbove(mean, sd, Number(t.score));
    gain += Math.max(0, p - best) * essencesDe(t.recompense);
    best = Math.max(best, p); pTier.push(best);
  }
  return { gain, pTier };
}

export function evalueRentabilite(compRows, lineups, paliers, rows, optionB = OPTION_B.get(compRows)) {
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
