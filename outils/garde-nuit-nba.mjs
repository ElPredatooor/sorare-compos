#!/usr/bin/env node
// Garde de nuit Set NBA, MODE ESSAI (NBA seulement) : toutes les N minutes, lit les compos Set NBA posées par Elpredatooor,
// repère les joueurs Out chez ESPN et note ce que la garde AURAIT remplacé (règle : sorare-compos/garde-nba.mjs).
// LECTURE SEULE : uniquement des requêtes `query` (le client de nuit-nba-commun.mjs refuse tout le reste). Rien n'est modifié sur Sorare.
// Dépôt public : le journal et le résumé GitHub ne montrent que des comptes ; les noms de joueurs ne vont que dans
// le compte rendu joint en artifact (SORTIE/rapport.md, SORTIE/evenements.jsonl).
// Récolte et palier suivant (03/11/2026, mode essai aussi) : quand une étape de la piste passe CLAIMABLE, la garde note
// « aurait récolté le niveau N » (une fois), puis vérifie les compos du palier N+1 du plan de nuit (PLAN_NUIT_NBA, préparé
// avant la nuit par outils/plan-nuit-nba.mjs, chiffré : voir nuit-nba-commun.mjs) : cartes libres, aucun match commencé,
// remplacement d'un Out (choisirRemplacements), plafonds ; elle note « aurait aligné la compo A » ou la raison du refus.
//
// Variables d'environnement :
//   SORARE_API_KEY, SORARE_JWT (audience JWT_AUD, défaut elpredatooor-nuit), DUREE_MINUTES (défaut 355), INTERVALLE_MINUTES (défaut 5),
//   DONNEES (collecte du dépôt, défaut data/latest), SORTIE (défaut garde-nuit-nba), PLAN_NUIT_NBA (plan de nuit, facultatif).
// Coût par relevé : 1 appel ESPN + 1 appel Sorare (plateau Set avec compos et cartes). En plus, seulement quand une compo
// encore modifiable contient un Out : le banc Common de l'étape (1 appel par page de 50 cartes, ≈ 7 pour 306 cartes),
// gardé 15 min ; à chaque récolte simulée, le banc de l'étape récoltable (≈ 7 appels). Nuit type (72 relevés) : ≈ 72 à 150 appels Sorare en 6 h, loin de la limite de 1 000 par 10 minutes.
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { choisirRemplacements, candidatsDepuisCollecte, lireCollecte, versMs } from "../sorare-compos/garde-nba.mjs";
import { ARCADE_NBA_ETOILES, ARCADE_NBA_PAR_EQUIPE } from "../sorare-compos/compos.mjs";
import { USER_SLUG, heures, heureBxl, heureCourte, attendre, creerMasque, creerReseau, creerClientSorare, pname, blessuresEspn, lirePlan } from "./nuit-nba-commun.mjs";

// Plateau Set NBA : étapes, compos, cartes (champs vérifiés dans le schéma public du 02/11/2026).
const APPARITION = (leger) => `taskAppearances{ locked starCost anyCard{ slug rarityTyped }
  anyPlayer{ slug displayName ${leger ? "" : "gameplayTierStars"} activeClub{ name } } game{ date statusTyped } ${leger ? "" : "upcomingGame{ date }"} }`;
const REQ_PLATEAU = (leger) => `query GardePlateau { currentUser { slug setBoard(sport: NBA, mode: CAREER){ id title endDate
  steps{ id level target state myLineups{ __typename ... on TaskLineupInterface{ id aasmState draft cancelledAt updatable ${APPARITION(leger)} } } } } } }`;
// Banc de l'étape (myFilteredBench n'est pas permis dans une liste : on passe par currentUser.step(id)).
const REQ_BANC = `query GardeBanc($id: String!, $after: String, $first: Int) { currentUser { step(id: $id){
  myFilteredBench(first: $first, after: $after, filters: { rarities: [common], includeUsed: false, includeUnavailablePlayers: true }){
    pageInfo{ hasNextPage endCursor } nodes{ __typename starCost anyPlayer{ slug displayName } ... on ComposeTeamBenchCard{ anyCard{ slug } } } } } } }`;
const ETATS_SUIVIS = new Set(["PLAYABLE", "LINEUP_SET", "LIVE"]); // LIVE : pour noter le verrouillage d'une compo déjà suivie
const BANC_VALIDITE_MS = 15 * 60e3;
const RE_JETON = /unauthori[sz]ed|unauthenticated|not authenticated|segments|signature|expired|invalid token|jwt/i;
const RE_COMPLEXE = /complex|too many|depth|timeout/i;

export async function executer({ env = process.env, fetchFn = globalThis.fetch, horloge = () => new Date(), attente = attendre,
  sortieConsole = console.log, signaux = true } = {}) {
  const DUREE = Number(env.DUREE_MINUTES || 355);
  const INTERVALLE = Math.max(0.25, Number(env.INTERVALLE_MINUTES || 5));
  const SORTIE = env.SORTIE || "garde-nuit-nba";
  const DONNEES = env.DONNEES || "data/latest";
  const apiKey = env.SORARE_API_KEY || "", jwt = env.SORARE_JWT || "", jwtAud = env.JWT_AUD || "elpredatooor-nuit";
  const masque = creerMasque([jwt, apiKey]);
  const fetchDelai = creerReseau({ fetchFn, attente });
  const { gql, compteur } = creerClientSorare({ fetchDelai, apiKey, jwt, jwtAud });
  let appelsEspn = 0;

  fs.mkdirSync(SORTIE, { recursive: true });
  const F_JOURNAL = path.join(SORTIE, "journal.txt"), F_RAPPORT = path.join(SORTIE, "rapport.md"), F_EVT = path.join(SORTIE, "evenements.jsonl");
  for (const f of [F_JOURNAL, F_EVT]) fs.writeFileSync(f, "");
  // Journal public : comptes seulement, jamais de nom ni de slug
  const ecrire = (l) => { const t = masque(l); sortieConsole(t); fs.appendFileSync(F_JOURNAL, t + "\n"); };

  // ---------- Collecte du dépôt (candidats) ----------
  let collecte = { cartes: [], joueurs: [], matchs: [], resume: [] }, collecteNote;
  try {
    collecte = await lireCollecte(DONNEES);
    const R = collecte.resume[0] || {};
    collecteNote = `collecte du ${R.maj_nba || R.maj || "?"} (${DONNEES})`;
  } catch (e) { collecteNote = `collecte illisible dans ${DONNEES} (${e.message.slice(0, 80)}) : aucun candidat`; }
  const joueurs = new Map(collecte.joueurs.filter((j) => j.sport === "NBA").map((j) => [j.slug, j]));
  const nomJoueur = new Map(); // playerSlug -> nom (rapport seulement)
  for (const k of collecte.cartes) if (k.sport === "NBA" && k.joueur) nomJoueur.set(k.slug, k.joueur);
  for (const j of joueurs.values()) if (j.joueur) nomJoueur.set(j.slug, j.joueur);
  const carteCollecte = new Map(collecte.cartes.filter((k) => k.sport === "NBA" && k.carte_id).map((k) => [k.carte_id, k])); // cardSlug -> carte
  const prochainMatchCollecte = (slug, now) => collecte.matchs.filter((m) => m.sport === "NBA" && m.slug === slug && versMs(m.date) > now - 6 * 3600e3)
    .map((m) => versMs(m.date)).sort((a, b) => a - b)[0];

  // ---------- État de la nuit ----------
  const debut = horloge(), fin = debut.getTime() + DUREE * 60e3;
  let jetonEtat = jwt ? "à vérifier" : "absent", niveauLeger = false, releves = 0, erreurs = 0;
  let statuts = new Map(), espnOk = false, bancVerifie = null; // null = pas encore utile, true / false
  const bancs = new Map();        // stepId -> { t, cartes: Map cardSlug -> { starCost, playerSlug } } ou { t, erreur }
  const compos = new Map();       // lineupId -> { label, cartes initiales, signature, evenements[], decisions[], vueA, vueDerniere, disparue }
  const decisionsEnCours = new Map(); // lineupId -> [cardSlug entrants]
  const totaux = { remplacements: new Set(), impossibles: new Set(), signalements: new Set() }; // décisions distinctes de la nuit

  // ---------- Plan de nuit (palier suivant) ----------
  const planLu = lirePlan(env.PLAN_NUIT_NBA, apiKey);
  const plan = planLu.plan;
  const nbComposPlan = plan ? Object.values(plan.paliers).reduce((n, p) => n + (Array.isArray(p?.compos) ? p.compos.length : 0), 0) : 0;
  const planNote = planLu.etat === "absent" ? "absent (variable PLAN_NUIT_NBA vide) : récolte notée, aucun alignement vérifié"
    : planLu.etat === "illisible" ? `illisible (${planLu.erreur}) : récolte notée, aucun alignement vérifié`
    : `lu (${planLu.etat}${planLu.etat === "en clair" ? " : visible dans l'en-tête du journal public, le chiffrer" : ""}), nuit ${plan.nuit || "?"}, `
      + `paliers ${Object.keys(plan.paliers).join(", ") || "aucun"}, ${nbComposPlan} compos`;
  const recoltes = new Map(); // niveau -> { niveau, cible, heure, bxl, premierReleve, suivant, banc, alignements: [] }

  ecrire(`Garde de nuit Set NBA (MODE ESSAI, lecture seule) : début ${heureCourte(debut)}, durée ${DUREE} min, intervalle ${INTERVALLE} min.`);
  ecrire(`Candidats : ${collecteNote.replace(/\(.*\)/, "").trim()}.`);
  ecrire(`Plan de nuit : ${planNote}.`);
  if (!apiKey) ecrire("Clé API Sorare absente.");
  if (!jwt) ecrire("JETON ABSENT : SORARE_JWT non fourni, les compos Set NBA sont illisibles (ESPN seul).");

  const nom = (slug) => nomJoueur.get(slug) || slug;
  // Remplace les slugs de joueurs par leurs noms dans un texte (une seule passe, slug entier seulement)
  const avecNoms = (txt, slugs) => {
    const connus = [...slugs].filter((x) => x && nomJoueur.has(x)).sort((a, b) => b.length - a.length);
    if (!connus.length) return txt;
    const echappe = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, (c) => "\\" + c);
    const re = new RegExp(`(?<![\\p{L}\\p{N}-])(${connus.map(echappe).join("|")})(?![\\p{L}\\p{N}-])`, "gu");
    return txt.replace(re, (m) => nomJoueur.get(m));
  };

  async function lireBanc(stepId, now) {
    const c = bancs.get(stepId);
    if (c && now - c.t < BANC_VALIDITE_MS) return c;
    const cartes = new Map(); let after = null, first = 50, pages = 0;
    try {
      while (pages < 12) {
        let d;
        try { d = await gql(REQ_BANC, { id: stepId, after, first }); }
        catch (e) { if (RE_COMPLEXE.test(e.message) && first > 10) { first = Math.floor(first / 2); continue; } throw e; }
        const b = d?.currentUser?.step?.myFilteredBench; pages++;
        if (!b) throw new Error("banc illisible (currentUser ou step null)");
        for (const n of b.nodes || []) if (n.anyCard?.slug) {
          cartes.set(n.anyCard.slug, { starCost: n.starCost, playerSlug: n.anyPlayer?.slug });
          if (n.anyPlayer?.displayName) nomJoueur.set(n.anyPlayer.slug, n.anyPlayer.displayName);
        }
        if (!b.pageInfo?.hasNextPage) break;
        after = b.pageInfo.endCursor;
      }
      const r = { t: now, cartes }; bancs.set(stepId, r); return r;
    } catch (e) {
      erreurs++; ecrire(`  Erreur banc d'étape : ${masque(e.message).slice(0, 200)} (candidats de la collecte sans vérification)`);
      const r = { t: now, erreur: true }; bancs.set(stepId, r); return r;
    }
  }

  async function lirePlateau() {
    for (;;) {
      try { return await gql(REQ_PLATEAU(niveauLeger)); }
      catch (e) { if (!niveauLeger && RE_COMPLEXE.test(e.message)) { niveauLeger = true; ecrire("  Requête du plateau trop lourde : passage à la version allégée."); continue; } throw e; }
    }
  }

  // Palier suivant du plan, juste après une récolte simulée du niveau N (mode essai : rien n'est posé).
  // L'étape N+1 reste LOCKED tant que N n'est pas récoltée : la disponibilité se lit sur le banc de l'étape N (Common non utilisées).
  async function alignerPalierSuivant(r, step, plateau, { now, cartesParCompo, candidats, fen }) {
    const n1 = String(Number(step.level) + 1);
    const suivant = (plateau.steps || []).find((x) => String(x.level) === n1);
    r.suivant = suivant ? { niveau: suivant.level, cible: suivant.target, etat: suivant.state } : null;
    if (!plan) { r.planAbsent = `plan ${planLu.etat}`; return; }
    const pal = plan.paliers[n1];
    if (!suivant) { r.planAbsent = `pas d'étape ${n1} sur la piste (dernier palier ?)`; return; }
    if (!pal || !Array.isArray(pal.compos) || !pal.compos.length) { r.planAbsent = `pas de palier ${n1} dans le plan`; return; }
    r.cibleNote = pal.cible != null && suivant.target != null && Number(pal.cible) !== Number(suivant.target) ? `cible du plan ${pal.cible} ≠ cible de la piste ${suivant.target}` : null;
    r.pasAvant = pal.pas_avant || null;
    let banc = null;
    if (jetonEtat === "accepté") { const b = await lireBanc(step.id, now); banc = b.cartes || null; }
    r.banc = banc ? `vérifiée sur le banc de l'étape ${step.level} (${banc.size} Common non utilisées ; l'étape ${n1} est encore verrouillée en mode essai)` : "NON vérifiée (banc illisible ou jeton absent)";
    const utilisees = new Set([...cartesParCompo.values()].flat());
    const prisesPlan = new Set();
    let places = 4 - (suivant.myLineups || []).filter((l) => l.id && !l.cancelledAt).length;
    const cands = banc ? candidats.filter((k) => banc.has(k.cardSlug)).map((k) => ({ ...k, etoiles: banc.get(k.cardSlug).starCost ?? k.etoiles })) : candidats;
    const pasAvantMs = versMs(pal.pas_avant);
    const matchDe = (slug) => {
      const ts = collecte.matchs.filter((m) => m.sport === "NBA" && m.slug === slug).map((m) => versMs(m.date)).filter(Number.isFinite).sort((a, b) => a - b);
      return (Number.isFinite(pasAvantMs) ? ts.find((t) => t >= pasAvantMs - 60e3) : undefined) ?? ts.find((t) => t > now - 6 * 3600e3);
    };
    for (const co of pal.compos) {
      const a = { nom: co?.nom ?? "?", projection: co?.projection ?? null, chance: co?.chance ?? null, cartes: [], ok: false };
      r.alignements.push(a);
      const refus = (raison) => { a.raison = raison; };
      const cartes = Array.isArray(co?.cartes) ? co.cartes : [];
      if (cartes.length !== 5 || new Set(cartes).size !== 5) { refus("compo du plan invalide (5 cartes distinctes attendues)"); continue; }
      if (places <= 0) { refus("plus de place sur le palier (4 compos au plus)"); continue; }
      const lignes = cartes.map((cs) => {
        const k = carteCollecte.get(cs), slug = k?.slug || banc?.get(cs)?.playerSlug, j = joueurs.get(slug), t = slug ? matchDe(slug) : undefined;
        return { cardSlug: cs, playerSlug: slug, equipe: j?.club || "?", etoiles: banc?.get(cs)?.starCost ?? j?.etoiles ?? 1, debutMatch: Number.isFinite(t) ? new Date(t).toISOString() : null };
      });
      a.cartes = lignes.map((l) => ({ joueur: l.playerSlug ? nom(l.playerSlug) : l.cardSlug, carte: l.cardSlug, match: l.debutMatch }));
      const inconnues = lignes.filter((l) => !l.playerSlug);
      if (inconnues.length) { refus(`${inconnues.length} carte(s) inconnue(s) (ni dans la collecte ni sur le banc)`); continue; }
      const prises = lignes.filter((l) => utilisees.has(l.cardSlug) || prisesPlan.has(l.cardSlug));
      if (prises.length) { refus(`carte déjà prise : ${prises.map((l) => nom(l.playerSlug)).join(", ")} (compo posée ou jouée sur la piste, ou compo précédente du plan)`); continue; }
      const horsBanc = banc ? lignes.filter((l) => !banc.has(l.cardSlug)) : [];
      if (horsBanc.length) { refus(`carte absente du banc : ${horsBanc.map((l) => nom(l.playerSlug)).join(", ")} (déjà utilisée ou indisponible)`); continue; }
      const sansMatch = lignes.filter((l) => !l.debutMatch);
      if (sansMatch.length) { refus(`match introuvable dans la collecte pour ${sansMatch.map((l) => nom(l.playerSlug)).join(", ")}`); continue; }
      const premierPlan = versMs(co.premier_match);
      const premier = Math.min(...lignes.map((l) => versMs(l.debutMatch)), Number.isFinite(premierPlan) ? premierPlan : Infinity);
      if (premier <= now) { refus(`match déjà commencé (${heureBxl(premier)} Bruxelles) : compo verrouillée avant d'être posée`); continue; }
      // Un remplaçant ne prend pas une carte réservée par une autre compo du plan (tous paliers)
      const reservees = new Set(Object.values(plan.paliers).flatMap((p) => (p?.compos || []).filter((x) => x !== co).flatMap((x) => x?.cartes || [])));
      const res = choisirRemplacements({ compo: lignes, autresCartesUtilisees: new Set([...utilisees, ...prisesPlan, ...reservees]), candidats: cands, statuts, maintenant: now, fenetre: fen });
      const slugsTexte = new Set([...lignes.map((l) => l.playerSlug), ...cands.map((k) => k.playerSlug)]);
      a.signalements = res.signalements.map((x) => `${nom(x.joueur)} « ${x.statut} »`);
      if (res.impossible.length) { refus(`joueur Out sans remplaçant : ${res.impossible.map((i) => avecNoms(i.raison, slugsTexte)).join(" ")}`); continue; }
      let finale = lignes.slice();
      a.remplacements = res.remplacements.map((x) => {
        const sortant = lignes.find((l) => l.cardSlug === x.sortant), ent = cands.find((k) => k.cardSlug === x.entrant) || {};
        finale = finale.filter((l) => l.cardSlug !== x.sortant).concat({ cardSlug: ent.cardSlug, playerSlug: ent.playerSlug, equipe: ent.equipe, etoiles: ent.etoiles ?? 1, debutMatch: ent.debutMatch });
        return { out: nom(sortant?.playerSlug), entrant: nom(ent.playerSlug), carte: ent.cardSlug, projection: x.projectionEntrant, match: ent.debutMatch, raison: avecNoms(x.raison, slugsTexte) };
      });
      const etoiles = finale.reduce((s, l) => s + (Number(l.etoiles) || 1), 0);
      const parEquipe = new Map(); for (const l of finale) parEquipe.set(l.equipe, (parEquipe.get(l.equipe) || 0) + 1);
      const tropEquipe = [...parEquipe].filter(([e, n]) => e !== "?" && n > ARCADE_NBA_PAR_EQUIPE);
      if (etoiles > ARCADE_NBA_ETOILES + 1e-9) { refus(`plafond d'étoiles dépassé (${etoiles}★ > ${ARCADE_NBA_ETOILES}★)`); continue; }
      if (tropEquipe.length) { refus(`plus de ${ARCADE_NBA_PAR_EQUIPE} joueurs de ${tropEquipe.map(([e]) => e).join(", ")}`); continue; }
      const premierFinal = Math.min(...finale.map((l) => versMs(l.debutMatch)).filter(Number.isFinite));
      Object.assign(a, { ok: true, etoiles, premierMatch: new Date(premierFinal).toISOString(), minutesAvant: Math.round((premierFinal - now) / 60e3),
        cartesFinales: finale.map((l) => nom(l.playerSlug)) });
      for (const l of finale) prisesPlan.add(l.cardSlug);
      places--;
    }
  }

  function noter(c, evt) {
    c.evenements.push(evt);
    fs.appendFileSync(F_EVT, masque(JSON.stringify({ compo: c.label, ...evt })) + "\n");
  }

  async function unReleve() {
    const d = horloge(), now = d.getTime(); releves++;
    const h = heures(d);
    const compte = { compos: 0, out: 0, remplacements: 0, impossibles: 0, verrouillees: 0, signalements: 0, recoltes: 0, alignees: 0, refusees: 0 };

    // 1. ESPN (en direct ; en cas d'erreur, on garde les statuts précédents)
    let inj = null;
    try { appelsEspn++; inj = await blessuresEspn(fetchDelai); espnOk = true; }
    catch (e) { erreurs++; ecrire(`  Erreur ESPN : ${e.message.slice(0, 160)} (statuts du relevé précédent conservés)`); }

    // 2. Plateau Set NBA
    let plateau = null;
    if (jetonEtat !== "refusé" && !(jetonEtat === "absent" && releves > 1)) {
      try {
        const data = await lirePlateau();
        const cu = data?.currentUser;
        if (!cu) {
          if (jetonEtat !== "absent") { jetonEtat = "refusé"; ecrire("JETON REFUSÉ : currentUser vaut null (expiré, mauvaise audience ou invalide)."); }
          else ecrire("Jeton absent : currentUser vaut null, compos illisibles (requête validée par l'API).");
        } else {
          if (jetonEtat !== "accepté") ecrire(`Jeton accepté (compte ${cu.slug === USER_SLUG ? USER_SLUG : "autre que " + USER_SLUG}).`);
          jetonEtat = "accepté"; plateau = cu.setBoard;
          if (!plateau) ecrire("  setBoard NBA (CAREER) introuvable.");
        }
      } catch (e) {
        erreurs++; ecrire(`  Erreur plateau : ${masque(e.message).slice(0, 200)}`);
        if (RE_JETON.test(e.message)) { jetonEtat = "refusé"; ecrire("JETON REFUSÉ par Sorare. Suite : ESPN seul."); }
      }
    }

    if (plateau) {
      // Toutes les cartes posées du plateau, par compo (posées ou déjà jouées)
      const cartesParCompo = new Map(), suivies = [];
      for (const s of plateau.steps || []) (s.myLineups || []).forEach((l, i) => {
        if (!l.id || l.cancelledAt) return;
        const app = l.taskAppearances || [];
        cartesParCompo.set(l.id, app.map((a) => a.anyCard?.slug).filter(Boolean));
        if (ETATS_SUIVIS.has(s.state) && l.aasmState === "READY" && !l.draft && app.length)
          suivies.push({ id: l.id, stepId: s.id, label: `Étape niv. ${s.level} (cible ${s.target}), compo n°${i + 1}`, etatEtape: s.state, app });
      });

      // Compos au format de choisirRemplacements
      for (const x of suivies) {
        x.compo = x.app.map((a) => {
          const slug = a.anyPlayer?.slug, j = joueurs.get(slug);
          if (a.anyPlayer?.displayName) nomJoueur.set(slug, a.anyPlayer.displayName);
          const t = versMs(a.game?.date ?? a.upcomingGame?.date);
          return { cardSlug: a.anyCard?.slug, playerSlug: slug, equipe: j?.club || a.anyPlayer?.activeClub?.name || "?",
            etoiles: a.starCost ?? j?.etoiles ?? a.anyPlayer?.gameplayTierStars ?? null,
            debutMatch: Number.isFinite(t) ? new Date(t).toISOString() : (prochainMatchCollecte(slug, now) ? new Date(prochainMatchCollecte(slug, now)).toISOString() : null) };
        });
        x.premier = Math.min(...x.compo.map((c) => versMs(c.debutMatch)).filter(Number.isFinite));
      }
      suivies.sort((a, b) => (a.premier || 0) - (b.premier || 0));

      // Statuts ESPN par playerSlug (jointure par nom, comme collecte.mjs)
      const { candidats, fenetre } = candidatsDepuisCollecte(collecte, { maintenant: now });
      if (inj) {
        statuts = new Map();
        const slugs = new Set([...suivies.flatMap((x) => x.compo.map((c) => c.playerSlug)), ...candidats.map((c) => c.playerSlug)]);
        if (plan) for (const p of Object.values(plan.paliers)) for (const co of p?.compos || []) for (const cs of co?.cartes || []) { const k = carteCollecte.get(cs); if (k) slugs.add(k.slug); }
        for (const s of slugs) { const i = inj.get(pname(nom(s))); if (i?.statut) statuts.set(s, i.statut); }
      }
      const fen = fenetre.debut || fenetre.fin ? fenetre : null;

      for (const x of suivies) {
        compte.compos++;
        let c = compos.get(x.id);
        if (!c) {
          c = { label: x.label, cartes: x.compo.map((k) => ({ ...k })), signature: "", evenements: [], vueA: now, vueDerniere: now, decisions: [] };
          compos.set(x.id, c);
        }
        c.vueDerniere = now; c.disparue = false; c.etatEtape = x.etatEtape; c.premier = x.premier;
        const outs = x.compo.filter((k) => /^out$/i.test(statuts.get(k.playerSlug) || ""));
        compte.out += outs.length;
        const verrouillee = Number.isFinite(x.premier) && x.premier <= now;
        let cands = candidats, verif = "non vérifiée";
        if (outs.length && !verrouillee && jetonEtat === "accepté") {
          const b = await lireBanc(x.stepId, now);
          if (b.cartes) {
            cands = candidats.filter((k) => b.cartes.has(k.cardSlug)).map((k) => ({ ...k, etoiles: b.cartes.get(k.cardSlug).starCost ?? k.etoiles }));
            verif = `vérifiée sur le banc de l'étape (${b.cartes.size} Common disponibles, dont ${cands.length} avec projection)`;
            bancVerifie = bancVerifie === false ? false : true;
          } else bancVerifie = false;
        }
        const autres = new Set();
        for (const [id, cs] of cartesParCompo) if (id !== x.id) cs.forEach((s) => autres.add(s));
        for (const [id, cs] of decisionsEnCours) if (id !== x.id) cs.forEach((s) => autres.add(s));
        const res = choisirRemplacements({ compo: x.compo, autresCartesUtilisees: autres, candidats: cands, statuts, maintenant: now, fenetre: fen });
        decisionsEnCours.set(x.id, res.remplacements.map((r) => r.entrant));
        compte.remplacements += res.remplacements.length; compte.signalements += res.signalements.length;
        const nbVerrou = res.impossible.filter((i) => /verrouillée/.test(i.raison)).length;
        compte.verrouillees += nbVerrou; compte.impossibles += res.impossible.length - nbVerrou;

        // Ne noter que les changements de décision
        const cleR = (r) => `R:${r.sortant}>${r.entrant}`, cleI = (i) => `I:${i.sortant}:${/verrouillée/.test(i.raison) ? "verrou" : "aucun"}`, cleS = (s) => `S:${s.cardSlug}:${s.statut}`;
        const cles = [...res.remplacements.map(cleR), ...res.impossible.map(cleI), ...res.signalements.map(cleS)];
        const sig = JSON.stringify(cles);
        if (sig !== c.signature) {
          const avant = new Set(c.cles || []), maintenantCles = new Set(cles);
          const parCarte = new Map(x.compo.map((k) => [k.cardSlug, k]));
          const slugsTexte = new Set([...x.compo.map((k) => k.playerSlug), ...cands.map((k) => k.playerSlug)]);
          const evt = { heure: d.toISOString(), bxl: h.bxl, remplacements: [], impossible: [], signalements: [], disponibilite: verif };
          for (const r of res.remplacements.filter((r) => !avant.has(cleR(r)))) {
            const sortant = parCarte.get(r.sortant), ent = cands.find((k) => k.cardSlug === r.entrant) || {};
            const apres = x.compo.filter((k) => k.cardSlug !== r.sortant).map((k) => versMs(k.debutMatch)).concat(versMs(ent.debutMatch)).filter(Number.isFinite);
            evt.remplacements.push({ out: nom(sortant?.playerSlug), outCarte: r.sortant, entrant: nom(ent.playerSlug), entrantCarte: r.entrant, equipe: ent.equipe,
              etoiles: ent.etoiles, projection: r.projectionEntrant, matchEntrant: ent.debutMatch, raison: avecNoms(r.raison, slugsTexte),
              verrouSans: Number.isFinite(x.premier) ? new Date(x.premier).toISOString() : null, verrouAvec: apres.length ? new Date(Math.min(...apres)).toISOString() : null });
          }
          for (const i of res.impossible.filter((i) => !avant.has(cleI(i)))) evt.impossible.push({ out: nom(parCarte.get(i.sortant)?.playerSlug), outCarte: i.sortant, raison: avecNoms(i.raison, slugsTexte), verrou: /verrouillée/.test(i.raison) });
          for (const s of res.signalements.filter((s) => !avant.has(cleS(s)))) evt.signalements.push({ joueur: nom(s.joueur), statut: s.statut });
          evt.leves = [...avant].filter((k) => !maintenantCles.has(k)).length; // décisions précédentes qui ne tiennent plus
          if (!cles.length) evt.retour = true;
          if (evt.remplacements.length || evt.impossible.length || evt.signalements.length || evt.leves) noter(c, evt);
          c.signature = sig; c.cles = cles;
          for (const k of cles) totaux[k[0] === "R" ? "remplacements" : k[0] === "I" ? "impossibles" : "signalements"].add(`${x.id}|${k}`);
        }
      }
      // Récolte simulée : une étape passe CLAIMABLE -> « aurait récolté », puis vérification du palier suivant du plan (une fois par niveau)
      for (const s of plateau.steps || []) if (s.state === "CLAIMABLE" && !recoltes.has(s.level)) {
        const r = { niveau: s.level, cible: s.target, heure: d.toISOString(), bxl: h.bxl, premierReleve: releves === 1, alignements: [] };
        recoltes.set(s.level, r); compte.recoltes++;
        await alignerPalierSuivant(r, s, plateau, { now, cartesParCompo, candidats, fen });
        fs.appendFileSync(F_EVT, masque(JSON.stringify({ recolte: r })) + "\n");
        compte.alignees += r.alignements.filter((a) => a.ok).length; compte.refusees += r.alignements.filter((a) => !a.ok).length;
      }

      // Compos suivies qui ne sont plus « READY » dans une étape suivie (jouées, annulées, étape passée)
      for (const [id, c] of compos) if (!c.disparue && !suivies.some((x) => x.id === id)) {
        c.disparue = true; decisionsEnCours.delete(id);
        noter(c, { heure: d.toISOString(), bxl: h.bxl, disparue: true });
      }
    }

    ecrire(`Relevé ${releves} (${h.bxl.slice(-8)} Bruxelles) : jeton ${jetonEtat}, ESPN ${inj ? "ok" : "indisponible"}, ${compte.compos} compos suivies, `
      + `${compte.out} Out détectés, ${compte.remplacements} remplacements proposés, ${compte.impossibles} impossibles faute de candidat, `
      + `${compte.verrouillees} impossibles (compo verrouillée), ${compte.signalements} signalements (Doubtful / Questionable / Day-To-Day).`);
    for (const r of recoltes.values()) if (r.heure === d.toISOString())
      ecrire(`  Récolte simulée : la garde aurait récolté le niveau ${r.niveau}${r.premierReleve ? " (déjà récoltable au premier relevé)" : ""} ; palier ${Number(r.niveau) + 1} : `
        + (r.planAbsent ? r.planAbsent : `${r.alignements.filter((a) => a.ok).length} compos du plan auraient été alignées, ${r.alignements.filter((a) => !a.ok).length} refusées.`));
    ecrireRapport(false);
  }

  // ---------- Compte rendu (artifact) ----------
  function ecrireRapport(final) {
    const L = [], f = horloge();
    L.push(`# Garde de nuit Set NBA : MODE ESSAI${final ? "" : " (en cours)"}`, "",
      "Rien n'a été modifié sur Sorare : ce compte rendu dit ce que la garde AURAIT fait.", "",
      `- Période : ${heureCourte(debut)} → ${heureCourte(f)} ; ${releves} relevés, ${erreurs} erreurs réseau ou API.`,
      `- Jeton : ${jetonEtat}. ESPN : ${espnOk ? "lu" : "jamais lu"}. Appels : ${compteur.appels} Sorare, ${appelsEspn} ESPN.`,
      `- Candidats : ${collecteNote}. Disponibilité des cartes : ${bancVerifie === true ? "vérifiée sur le banc de l'étape (Common non utilisées)" : bancVerifie === false ? "NON vérifiée (banc illisible au moins une fois)" : "pas eu besoin de la vérifier (aucun Out sur une compo modifiable) ou jeton absent"}.`,
      `- Règle : sorare-compos/garde-nba.mjs (Out ESPN seulement ; compo verrouillée au premier match commencé ; ≤ 16★, ≤ 4 par équipe).`, "");
    if (!compos.size) L.push(jetonEtat === "accepté" ? "Aucune compo Set NBA posée (READY) pendant la nuit." : "Compos illisibles (jeton absent ou refusé).");
    for (const c of compos.values()) {
      L.push(`## ${c.label}`, "", `Suivie de ${heureBxl(c.vueA)} à ${heureBxl(c.vueDerniere)} (Bruxelles)${c.disparue ? ", puis sortie du suivi (jouée, annulée ou étape passée)" : ""}.`, "",
        "| Joueur | Équipe | ★ | Match (Bruxelles) |", "|---|---|---|---|");
      for (const k of c.cartes) L.push(`| ${nom(k.playerSlug)} | ${k.equipe} | ${k.etoiles ?? "?"} | ${k.debutMatch ? heureBxl(k.debutMatch) : "?"} |`);
      L.push("");
      if (!c.evenements.length) { L.push("Aucun Out ni signalement : rien à faire.", ""); continue; }
      L.push("| Heure (Bruxelles) | Décision |", "|---|---|");
      for (const e of c.evenements) {
        const hh = e.bxl.slice(-8, -3).replace(":", "h");
        if (e.disparue) { L.push(`| ${hh} | Compo sortie du suivi. |`); continue; }
        if (e.retour) L.push(`| ${hh} | Plus aucun Out ni signalement (retour à la normale). |`);
        else if (e.leves && !e.remplacements.length && !e.impossible.length && !e.signalements.length) L.push(`| ${hh} | ${e.leves} décision(s) précédente(s) levée(s) (statut ESPN changé ou candidat devenu indisponible). |`);
        else if (e.leves) L.push(`| ${hh} | ${e.leves} décision(s) précédente(s) remplacée(s) par celles ci-dessous. |`);
        for (const r of e.remplacements) L.push(`| ${hh} | **Remplacement proposé** : ${r.out} (Out) → **${r.entrant}** (${r.equipe}, ${r.etoiles}★, projection ${r.projection}, match ${heureBxl(r.matchEntrant)}). ${r.raison} Disponibilité ${e.disponibilite}. |`);
        for (const i of e.impossible) L.push(`| ${hh} | **Impossible${i.verrou ? " : compo verrouillée" : ""}** pour ${i.out} (Out) : ${i.raison} |`);
        for (const s of e.signalements) L.push(`| ${hh} | Signalement : ${s.joueur} « ${s.statut} » (laissé dans la compo). |`);
      }
      L.push("", "Ce qui serait arrivé :");
      const premiers = new Map();
      for (const e of c.evenements) for (const r of e.remplacements || []) if (!premiers.has(r.outCarte)) premiers.set(r.outCarte, { e, r });
      const verrous = c.evenements.filter((e) => (e.impossible || []).some((i) => i.verrou));
      for (const { e, r } of premiers.values()) {
        const v = verrous.find((x) => x.heure > e.heure);
        L.push(`- ${r.out} : Out détecté à ${e.bxl.slice(-8, -3).replace(":", "h")} ; la garde aurait mis ${r.entrant}. Verrouillage de la compo : ${r.verrouSans ? heureBxl(r.verrouSans) : "?"} sans changement, `
          + `${r.verrouAvec ? heureBxl(r.verrouAvec) : "?"} avec le remplaçant${r.verrouAvec && r.verrouSans && r.verrouAvec < r.verrouSans ? " (plus tôt : son match commence avant)" : ""}.`
          + (v ? ` Sans action, la compo s'est verrouillée à ${v.bxl.slice(-8, -3).replace(":", "h")} avec ${r.out} dedans.` : ""));
      }
      const jamais = new Map();
      for (const e of c.evenements) for (const i of e.impossible || []) if (!premiers.has(i.outCarte) && !jamais.has(i.outCarte)) jamais.set(i.outCarte, { e, i });
      for (const { e, i } of jamais.values()) L.push(`- ${i.out} : Out détecté à ${e.bxl.slice(-8, -3).replace(":", "h")}, aucun remplacement possible (${i.verrou ? "compo déjà verrouillée" : "aucun candidat valable"}).`);
      if (!premiers.size && !jamais.size) L.push("- Signalements seulement : aucune action.");
      L.push("");
    }
    // Récolte et palier suivant (plan de nuit)
    const pct = (c) => (c == null || c === "" ? "?" : `${Math.round(Number(c) <= 1 ? Number(c) * 100 : Number(c))} %`);
    L.push("## Récolte et palier suivant (plan de nuit)", "", `- Plan : ${planNote}.`);
    if (!recoltes.size) L.push(jetonEtat === "accepté" ? "- Aucune étape n'est devenue récoltable (CLAIMABLE) pendant la garde." : "- Piste illisible : récolte non surveillée.");
    for (const r of recoltes.values()) {
      const hh = r.bxl.slice(-8, -3).replace(":", "h");
      L.push(`- **${hh}** : la garde aurait récolté le niveau ${r.niveau} (cible ${r.cible ?? "?"})${r.premierReleve ? " ; étape déjà récoltable au premier relevé" : ""}.`);
      if (r.suivant) L.push(`  Palier suivant : niveau ${r.suivant.niveau} (cible ${r.suivant.cible ?? "?"}, état lu ${r.suivant.etat}).`);
      if (r.planAbsent) { L.push(`  Aucun alignement vérifié : ${r.planAbsent}.`); continue; }
      if (r.cibleNote) L.push(`  Attention : ${r.cibleNote}.`);
      L.push(`  Disponibilité des cartes : ${r.banc}. Matchs du plan à partir de ${r.pasAvant ? heureBxl(r.pasAvant) : "?"} (Bruxelles).`);
      for (const a of r.alignements) {
        if (a.ok) {
          L.push(`  - **Aurait aligné la compo ${a.nom}** à ${hh} (5 cartes : ${a.cartesFinales.join(", ")} ; ${a.etoiles}★ ; projection du plan ${a.projection ?? "?"}, chance ${pct(a.chance)}) : `
            + `premier match à ${heureBxl(a.premierMatch)}, soit ${a.minutesAvant} min de marge.`);
          for (const x of a.remplacements || []) L.push(`    Remplacement : ${x.out} (Out) → ${x.entrant} (projection ${x.projection}, match ${heureBxl(x.match)}). ${x.raison}`);
        } else L.push(`  - **Compo ${a.nom} refusée** : ${a.raison}. (Cartes du plan : ${a.cartes.map((c) => c.joueur).join(", ") || "?"}.)`);
        if (a.signalements?.length) L.push(`    Signalements laissés dans la compo : ${a.signalements.join(", ")}.`);
      }
    }
    L.push("");
    fs.writeFileSync(F_RAPPORT, masque(L.join("\n") + "\n"));
    if (final && env.GITHUB_STEP_SUMMARY) {
      const nbOut = new Set([...compos.values()].flatMap((c) => c.evenements.flatMap((e) => [...(e.remplacements || []), ...(e.impossible || [])].map((x) => x.outCarte)))).size;
      fs.appendFileSync(env.GITHUB_STEP_SUMMARY, masque([`## Garde de nuit Set NBA (mode essai, rien modifié)`, "",
        `- ${releves} relevés, ${erreurs} erreurs ; jeton ${jetonEtat} ; ${compteur.appels} appels Sorare, ${appelsEspn} ESPN.`,
        `- ${compos.size} compos suivies ; ${nbOut} joueurs Out détectés ; décisions notées : ${totaux.remplacements.size} remplacements proposés, `
        + `${totaux.impossibles.size} impossibles, ${totaux.signalements.size} signalements.`,
        `- Plan de nuit : ${planLu.etat} ; récoltes simulées : ${recoltes.size ? [...recoltes.keys()].map((n) => "niveau " + n).join(", ") : "aucune"} ; `
        + `compos du plan : ${[...recoltes.values()].reduce((n, r) => n + r.alignements.filter((a) => a.ok).length, 0)} auraient été alignées, `
        + `${[...recoltes.values()].reduce((n, r) => n + r.alignements.filter((a) => !a.ok).length, 0)} refusées.`,
        "- Détail avec les noms : artifact « garde-nuit-nba » (rapport.md).", ""].join("\n")));
    }
  }

  let arret = false;
  if (signaux) for (const sig of ["SIGTERM", "SIGINT"]) process.on(sig, () => {
    if (arret) return; arret = true; ecrire(`Arrêt demandé (${sig}) : compte rendu écrit.`); ecrireRapport(true); process.exit(0);
  });

  for (;;) {
    const t0 = horloge().getTime();
    try { await unReleve(); } catch (e) { erreurs++; ecrire(`Erreur inattendue (relevé ignoré) : ${masque(e.message).slice(0, 200)}`); }
    const prochain = t0 + INTERVALLE * 60e3;
    if (prochain > fin) break;
    await attente(Math.max(0, prochain - horloge().getTime()));
  }
  ecrire(`Fin : ${releves} relevés, ${compos.size} compos suivies, ${totaux.remplacements.size} remplacements proposés, ${totaux.impossibles.size} impossibles, `
    + `${totaux.signalements.size} signalements ; ${compteur.appels} appels Sorare, ${appelsEspn} appels ESPN.`);
  ecrireRapport(true);
  return { releves, compos, totaux, recoltes, planEtat: planLu.etat, jetonEtat, appelsSorare: compteur.appels, appelsEspn, sortie: SORTIE };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await executer();
