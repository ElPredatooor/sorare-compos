#!/usr/bin/env node
// Test d'écriture CONTRÔLÉ, Set NBA seulement (demandé et autorisé par l'utilisateur dans le chat le 03/11/2026 :
// vérifier qu'on peut aligner une équipe). Lancé À LA MAIN (workflow test-ecriture-nba.yml, aucun cron), en présence de l'utilisateur.
//
// Ce que fait le script, et rien d'autre :
//   1. refuse de démarrer si CONFIRMATION ne vaut pas exactement « RENVOYER-A-L-IDENTIQUE » (aucun appel réseau) ;
//   2. lit la piste Set NBA (currentUser.setBoard(sport: NBA, mode: CAREER)), 1 appel ;
//   3. prend UNE compo READY dont aucun match n'a commencé (marge 5 min), sinon s'arrête sans rien envoyer ;
//   4. la renvoie STRICTEMENT IDENTIQUE par UNE seule écriture upsertStepLineup (même lineupId, même étape, mêmes index,
//      mêmes cartes, même match : gameId relu sur la compo ; pas de capitaine en Set NBA, champ omis), sans reprise réseau ;
//   5. relit la piste (1 appel) et compare cartes et matchs avant / après : succès seulement s'ils sont identiques.
// Coût : 3 appels Sorare. C'est le SEUL fichier du projet qui contient une écriture GraphQL (vérifié par outils/test-ecriture-nba-controle.mjs).
// N'utilise PAS le client query-only de nuit-nba-commun.mjs (seulement son fetch avec délai et son masquage).
// Journal public : comptes et états seulement ; noms et cartes uniquement dans SORTIE/rapport.md (artifact).
//
// Variables d'environnement : CONFIRMATION, SORARE_API_KEY, SORARE_JWT, JWT_AUD (défaut elpredatooor-nuit), SORTIE (défaut test-ecriture-nba).
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { API_SORARE, USER_SLUG, heureCourte, heureBxl, attendre, creerMasque, creerReseau } from "./nuit-nba-commun.mjs";

export const CONFIRMATION_ATTENDUE = "RENVOYER-A-L-IDENTIQUE";
const MARGE_MS = 5 * 60e3; // pas d'envoi si un match commence dans moins de 5 min

export const LECTURE = `query TestEcriturePiste { currentUser { slug setBoard(sport: NBA, mode: CAREER){ id
  steps{ id level target state myLineups{ __typename ... on TaskLineupInterface{ id aasmState draft cancelledAt updatable
    taskAppearances{ index locked anyCard{ slug } anyPlayer{ displayName } game{ id date statusTyped } } } } } } } }`;
// L'unique écriture du projet. Ne pas en ajouter d'autre (test-ecriture-nba-controle.mjs échoue sinon).
export const ECRITURE = `mutation TestEcritureRenvoi($input: upsertStepLineupInput!) {
  upsertStepLineup(input: $input) { errors { code message path } } }`;

const ETATS_ETAPE = new Set(["PLAYABLE", "LINEUP_SET"]);
const versMs = (t) => (t ? Date.parse(t) : NaN);
// Empreinte d'une compo : index -> carte + match, dans l'ordre des index
const empreinte = (apps) => JSON.stringify([...apps].sort((a, b) => a.index - b.index).map((a) => [a.index, a.anyCard?.slug ?? null, a.game?.id ?? null]));

export async function executer({ env = process.env, fetchFn = globalThis.fetch, horloge = () => new Date(), attente = attendre, sortieConsole = console.log } = {}) {
  const SORTIE = env.SORTIE || "test-ecriture-nba";
  const apiKey = env.SORARE_API_KEY || "", jwt = env.SORARE_JWT || "", jwtAud = env.JWT_AUD || "elpredatooor-nuit";
  const masque = creerMasque([jwt, apiKey]);
  fs.mkdirSync(SORTIE, { recursive: true });
  const F_JOURNAL = path.join(SORTIE, "journal.txt"), F_RAPPORT = path.join(SORTIE, "rapport.md");
  fs.writeFileSync(F_JOURNAL, "");
  const ecrire = (l) => { const t = masque(l); sortieConsole(t); fs.appendFileSync(F_JOURNAL, t + "\n"); };
  const R = ["# Test d'écriture Set NBA (renvoi à l'identique)", ""]; // compte rendu avec noms (artifact)
  const res = { statut: "arrêt", appels: 0, ecritures: 0 };
  const fin = (statut, msg) => {
    res.statut = statut; ecrire(msg); R.push("", `**Résultat : ${msg}**`);
    fs.writeFileSync(F_RAPPORT, masque(R.join("\n") + "\n"));
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, masque(`## Test d'écriture Set NBA\n\n- ${msg}\n- ${res.appels} appels Sorare, dont ${res.ecritures} écriture.\n`));
    return res;
  };

  ecrire(`Test d'écriture Set NBA : ${heureCourte(horloge())}.`);
  if ((env.CONFIRMATION ?? "") !== CONFIRMATION_ATTENDUE) return fin("refus", `ARRÊT : confirmation absente ou incorrecte (attendu exactement « ${CONFIRMATION_ATTENDUE} »). Aucun appel envoyé.`);
  if (!jwt) return fin("refus", "ARRÊT : jeton SORARE_JWT absent. Aucun appel envoyé.");

  // Lecture et écriture partagent l'envoi ; l'écriture n'a AUCUNE reprise (essais: 1).
  const lectureReseau = creerReseau({ fetchFn, attente }), ecritureReseau = creerReseau({ fetchFn, attente, essais: 1 });
  async function envoyer(reseau, query, variables) {
    const headers = { "content-type": "application/json", accept: "application/json", Authorization: `Bearer ${jwt}`, "JWT-AUD": jwtAud };
    if (apiKey) headers.APIKEY = apiKey;
    res.appels++;
    const r = await reseau(API_SORARE, { method: "POST", headers, body: JSON.stringify({ query, variables }) });
    let j; try { j = await r.json(); } catch { throw new Error(`HTTP ${r.status}, réponse non JSON`); }
    return j;
  }
  async function lirePiste() {
    const j = await envoyer(lectureReseau, LECTURE, {});
    if (j.errors?.length) throw new Error(`lecture refusée : ${j.errors.map((e) => e.message).join(" | ").slice(0, 200)}`);
    if (!j.data?.currentUser) throw new Error("currentUser vaut null (jeton expiré, mauvaise audience ou invalide)");
    return j.data.currentUser;
  }

  // 1. Lecture
  let cu;
  try { cu = await lirePiste(); } catch (e) { return fin("erreur", `ARRÊT : ${masque(e.message)}. Rien envoyé.`); }
  if (cu.slug !== USER_SLUG) return fin("refus", `ARRÊT : compte connecté autre que ${USER_SLUG}. Rien envoyé.`);
  const plateau = cu.setBoard;
  if (!plateau) return fin("refus", "ARRÊT : piste Set NBA (setBoard NBA, CAREER) introuvable. Rien envoyé.");
  const now = horloge().getTime();
  const toutes = [], eligibles = [];
  for (const s of plateau.steps || []) (s.myLineups || []).forEach((l, i) => {
    if (!l.id || l.cancelledAt || l.aasmState !== "READY" || l.draft) return;
    const apps = l.taskAppearances || [];
    const premier = Math.min(...apps.map((a) => versMs(a.game?.date)));
    const c = { step: s, lineup: l, n: i + 1, apps, premier };
    toutes.push(c);
    const pret = ETATS_ETAPE.has(s.state) && l.updatable && apps.length === 5
      && apps.every((a) => a.anyCard?.slug && Number.isInteger(a.index) && !a.locked && Number.isFinite(versMs(a.game?.date)) && /^SCHEDULED$/i.test(a.game?.statusTyped || "SCHEDULED"))
      && premier > now + MARGE_MS;
    if (pret) eligibles.push(c);
  });
  ecrire(`Piste lue : ${(plateau.steps || []).length} étapes, ${toutes.length} compos READY, dont ${eligibles.length} sans match commencé ni proche (marge 5 min).`);
  if (!eligibles.length) return fin("refus", "ARRÊT : aucune compo READY dont aucun match n'a commencé. Rien envoyé.");
  eligibles.sort((a, b) => b.premier - a.premier); // la plus éloignée de son premier match
  const c = eligibles[0];
  const avant = empreinte(c.apps);
  const appearances = [...c.apps].sort((a, b) => a.index - b.index)
    .map((a) => ({ index: a.index, cardSlug: a.anyCard.slug, ...(a.game?.id ? { gameId: a.game.id } : {}) }));
  ecrire(`Compo choisie : étape niv. ${c.step.level} (${c.step.state}), compo n°${c.n}, ${appearances.length} cartes, ${appearances.filter((a) => a.gameId).length} matchs fixés, premier match dans ${Math.round((c.premier - now) / 60e3)} min.`);
  R.push(`- Compo : étape niv. ${c.step.level} (cible ${c.step.target}, ${c.step.state}), compo n°${c.n}, premier match à ${heureBxl(c.premier)} (Bruxelles).`,
    "", "| Index | Joueur | Carte | Match (Bruxelles) |", "|---|---|---|---|",
    ...[...c.apps].sort((a, b) => a.index - b.index).map((a) => `| ${a.index} | ${a.anyPlayer?.displayName ?? "?"} | ${a.anyCard?.slug} | ${heureBxl(a.game?.date)} |`));

  // 2. Écriture unique : renvoi à l'identique
  const input = { stepId: c.step.id, lineupId: c.lineup.id, appearances };
  let erreurs = [];
  try {
    res.ecritures++;
    const j = await envoyer(ecritureReseau, ECRITURE, { input });
    erreurs = [...(j.errors || []).map((e) => ({ message: e.message, path: e.path })), ...(j.data?.upsertStepLineup?.errors || [])];
    if (!j.data?.upsertStepLineup && !j.errors?.length) erreurs.push({ message: "réponse sans upsertStepLineup" });
  } catch (e) { erreurs.push({ message: `réseau : ${e.message}` }); }
  // Erreurs : texte publié sans les cartes ni les noms (remplacés par « carte n°index »)
  const anonyme = (t) => { let x = String(t ?? ""); for (const a of c.apps) { if (a.anyCard?.slug) x = x.split(a.anyCard.slug).join(`carte n°${a.index}`); if (a.anyPlayer?.displayName) x = x.split(a.anyPlayer.displayName).join(`joueur n°${a.index}`); } return x; };
  ecrire(`Écriture envoyée (1) : ${erreurs.length} erreur(s)${erreurs.length ? " : " + erreurs.map((e) => `[${e.code ?? "-"}] ${anonyme(e.message)}${e.path ? " (" + [].concat(e.path).join(".") + ")" : ""}`).join(" | ").slice(0, 400) : ""}.`);
  R.push("", `- Erreurs de l'écriture : ${erreurs.length ? erreurs.map((e) => `[${e.code ?? "-"}] ${e.message}${e.path ? " (" + [].concat(e.path).join(".") + ")" : ""}`).join(" ; ") : "aucune"}.`);

  // 3. Relecture et comparaison
  await attente(3000);
  let apres = null, etatApres = "?";
  try {
    const cu2 = await lirePiste();
    const l2 = (cu2.setBoard?.steps || []).flatMap((s) => (s.myLineups || []).map((l) => ({ s, l }))).find((x) => x.l.id === c.lineup.id);
    if (l2) { apres = empreinte(l2.l.taskAppearances || []); etatApres = `${l2.l.aasmState}${l2.l.cancelledAt ? ", annulée" : ""}`; }
  } catch (e) { ecrire(`Relecture impossible : ${masque(e.message).slice(0, 200)}.`); }
  const identique = apres === avant;
  R.push(`- Relecture : compo ${apres ? `trouvée (${etatApres})` : "INTROUVABLE"} ; cartes et matchs ${identique ? "identiques" : "DIFFÉRENTS"}.`);
  if (apres && !identique) R.push("", "Avant : `" + avant + "`", "", "Après : `" + apres + "`");
  ecrire(`Relecture : compo ${apres ? `trouvée (état ${etatApres})` : "introuvable"}, cartes et matchs ${identique ? "identiques" : "DIFFÉRENTS"} avant / après.`);
  if (!erreurs.length && identique) return fin("succes", "SUCCÈS : la compo a été renvoyée et relue à l'identique (écriture acceptée par Sorare).");
  return fin("echec", `ÉCHEC : ${erreurs.length} erreur(s) d'écriture, compo ${identique ? "inchangée" : apres ? "MODIFIÉE (voir l'artifact)" : "introuvable à la relecture"}.`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const r = await executer();
  process.exit(r.statut === "succes" ? 0 : 1);
}
