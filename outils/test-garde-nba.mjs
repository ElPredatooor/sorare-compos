// Test hors ligne de la garde de nuit Set NBA (sorare-compos/garde-nba.mjs) : NBA seulement, aucun reseau, aucune cle.
// Usage : node outils/test-garde-nba.mjs [dossier de collecte pour l'essai sur donnees reelles]
import { choisirRemplacements, candidatsDepuisCollecte, lireCollecte } from "../sorare-compos/garde-nba.mjs";

let ko = 0;
const ok = (cond, msg) => { if (!cond) { ko++; console.log("ECHEC :", msg); } else console.log("ok   :", msg); };
const NOW = "2026-11-03T00:30:00Z";
const T1 = "2026-11-03T01:00:00Z", T2 = "2026-11-03T02:00:00Z", T3 = "2026-11-03T03:00:00Z", T0 = "2026-11-03T00:00:00Z";
// compo posee : 16★ au total, deux Celtics
const compo = () => [
  { cardSlug: "a-c", playerSlug: "a", equipe: "Celtics", etoiles: 4, debutMatch: T2 },
  { cardSlug: "b-c", playerSlug: "b", equipe: "Celtics", etoiles: 3, debutMatch: T2 },
  { cardSlug: "c-c", playerSlug: "c", equipe: "Heat", etoiles: 3, debutMatch: T2 },
  { cardSlug: "d-c", playerSlug: "d", equipe: "Bulls", etoiles: 3, debutMatch: T2 },
  { cardSlug: "e-c", playerSlug: "e", equipe: "Knicks", etoiles: 3, debutMatch: T2 },
];
const cand = (slug, equipe, etoiles, projection, debutMatch = T3) => ({ cardSlug: slug + "-c", playerSlug: slug, equipe, etoiles, projection, debutMatch });
const run = (o) => choisirRemplacements({ compo: compo(), maintenant: NOW, ...o });

// 1. Un Out remplace par le meilleur valide
let r = run({ statuts: new Map([["c", "Out"]]), candidats: [cand("x", "Lakers", 3, 30), cand("y", "Suns", 2, 35), cand("z", "Nets", 3, 20)] });
ok(r.remplacements.length === 1 && r.remplacements[0].sortant === "c-c" && r.remplacements[0].entrant === "y-c" && r.remplacements[0].projectionEntrant === 35, "1 Out remplacé par la meilleure projection (y, 35)");
// 2. Plafond d'etoiles : 13★ restent, le 4★ a 50 est refuse
r = run({ statuts: new Map([["c", "Out"]]), candidats: [cand("big", "Lakers", 4, 50), cand("x", "Suns", 3, 30)] });
ok(r.remplacements[0]?.entrant === "x-c", "plafond 16★ : le 4★ (13 + 4 = 17) est écarté, le 3★ est pris");
ok(run({ statuts: new Map([["c", "Out"]]), candidats: [cand("big", "Lakers", 3.5, 50)] }).remplacements.length === 0, "plafond par demi-points : 13 + 3,5 = 16,5 > 16 refusé (13 + 3 = 16 accepté au test précédent)");
// 3. 4 par equipe : compo avec 3 Celtics + Out non Celtic -> un 4e Celtic accepte ; avec 4 Celtics restants -> refuse
const c4 = compo().map((x) => (x.playerSlug === "c" || x.playerSlug === "d" ? { ...x, equipe: "Celtics" } : x)); // a, b, c, d Celtics
r = choisirRemplacements({ compo: c4, maintenant: NOW, statuts: new Map([["e", "Out"]]), candidats: [cand("cel", "Celtics", 2, 60), cand("x", "Suns", 2, 20)] });
ok(r.remplacements[0]?.entrant === "x-c", "max 4 par équipe : 5e Celtic refusé, le Suns pris");
r = choisirRemplacements({ compo: c4, maintenant: NOW, statuts: new Map([["d", "Out"]]), candidats: [cand("cel", "Celtics", 2, 60), cand("x", "Suns", 2, 20)] });
ok(r.remplacements[0]?.entrant === "cel-c", "max 4 par équipe : remplacer un Celtic par un Celtic reste permis");
// 4. Carte deja utilisee (autre compo) et carte deja dans la compo
r = run({ statuts: new Map([["c", "Out"]]), autresCartesUtilisees: new Set(["y-c"]), candidats: [cand("y", "Suns", 2, 35), cand("x", "Lakers", 3, 30), { ...cand("a", "Celtics", 1, 99), cardSlug: "a-c" }] });
ok(r.remplacements[0]?.entrant === "x-c", "carte déjà utilisée ailleurs (y) et carte déjà dans la compo (a) exclues");
// 5. Candidat dont le match a commence, candidat Out, candidat hors fenetre
r = run({ statuts: new Map([["c", "Out"], ["o", "Out"]]), fenetre: { debut: T0, fin: "2026-11-03T05:00:00Z" },
  candidats: [cand("deja", "Suns", 2, 80, "2026-11-03T00:15:00Z"), cand("o", "Nets", 2, 70), cand("loin", "Jazz", 2, 65, "2026-11-04T01:00:00Z"), cand("x", "Lakers", 3, 30)] });
ok(r.remplacements[0]?.entrant === "x-c", "match commencé, joueur Out et match hors fenêtre exclus");
// 6. Aucun candidat valable -> impossible avec raison, rien remplace
r = run({ statuts: new Map([["c", "Out"]]), candidats: [cand("big", "Lakers", 5, 50), cand("deja", "Suns", 2, 80, "2026-11-03T00:10:00Z")] });
ok(r.remplacements.length === 0 && r.impossible.length === 1 && /plafond/.test(r.impossible[0].raison) && /commencé/.test(r.impossible[0].raison), "aucun candidat valable : impossible + raison (" + r.impossible[0]?.raison + ")");
r = run({ statuts: new Map([["c", "Out"]]), candidats: [] });
ok(r.impossible.length === 1 && /Aucune carte/.test(r.impossible[0].raison), "liste de candidats vide : raison explicite");
// 7. Deux Out traites l'un apres l'autre (etoiles et equipes mises a jour)
// Out a (4★, T2) et c (3★, T2) ; reste b,d,e = 9★ ; candidats : p (4★, 50), q (4★, 45), s (3★, 30)
// 1er (a) : 9 + 4 = 13 ≤ 16 -> p ; 2e (c) : 9 + 4 (p) = 13, + q 4★ = 17 > 16 -> s
r = run({ statuts: new Map([["a", "Out"], ["c", "Out"]]), candidats: [cand("p", "Lakers", 4, 50), cand("q", "Suns", 4, 45), cand("s", "Nets", 3, 30)] });
ok(r.remplacements.length === 2 && r.remplacements[0].entrant === "p-c" && r.remplacements[1].entrant === "s-c", "deux Out : p puis s (q refusé car 17★ après le premier remplacement)");
// 8. Compo verrouillee : un match de la compo a commence
const cv = compo(); cv[4] = { ...cv[4], debutMatch: "2026-11-03T00:00:00Z" };
r = choisirRemplacements({ compo: cv, maintenant: NOW, statuts: new Map([["c", "Out"]]), candidats: [cand("x", "Lakers", 3, 30)] });
ok(r.remplacements.length === 0 && /verrouillée/.test(r.impossible[0]?.raison || ""), "compo verrouillée dès qu'un match a commencé");
// 9. Doubtful / Questionable : signales, pas remplaces
r = run({ statuts: new Map([["b", "Doubtful"], ["d", "Questionable"]]), candidats: [cand("x", "Lakers", 3, 30)] });
ok(r.remplacements.length === 0 && r.signalements.length === 2, "Doubtful / Questionable signalés, pas remplacés");
// 10. Remplacant qui joue plus tot que le premier match : avertissement
r = run({ statuts: new Map([["c", "Out"]]), candidats: [cand("tot", "Lakers", 3, 30, T1)] });
ok(/verrouillera plus tôt/.test(r.remplacements[0]?.raison || ""), "remplaçant plus tôt que le 1er match : avertissement de verrouillage");

// 11. Extraction depuis les donnees publiees (jeux simules, contrat v8)
const donnees = {
  cartes: [{ sport: "NBA", slug: "p1", joueur: "P1", carte_id: "p1-common-1", rarete: "common", puissance: 1, skin: 1.05, set_courant: true },
    { sport: "NBA", slug: "p1", joueur: "P1", carte_id: "p1-limited", rarete: "limited", puissance: 1.04, skin: 1, set_courant: false },
    { sport: "NBA", slug: "p2", joueur: "P2", carte_id: "p2-common-old", rarete: "common", puissance: 1, skin: 1, set_courant: false }],
  joueurs: [{ sport: "NBA", slug: "p1", club: "Lakers", etoiles: 2.5, espn_statut: "" }, { sport: "NBA", slug: "p2", club: "Heat", etoiles: null }],
  matchs: [{ sport: "NBA", slug: "p1", date: "2026-11-03T00:10", proj: 40, proba: 95 }, { sport: "NBA", slug: "p1", date: "2026-11-04T01:00", proj: 30, proba: 50 }],
  resume: [{ arcade_nba_debut: "2026-11-03T00:00:00Z", arcade_nba_fin: "2026-11-06T06:00:00Z" }],
};
let x = candidatsDepuisCollecte(donnees, { maintenant: "2026-11-02T23:00:00Z" });
ok(x.candidats.length === 1 && x.candidats[0].cardSlug === "p1-common-1" && x.candidats[0].projection === 39.9 && x.candidats[0].etoiles === 2.5 && x.candidats[0].debutMatch === "2026-11-03T00:10:00.000Z", "extraction : Common du set seulement, proj × proba × puissance × skin = 39,9, date lue en UTC");
x = candidatsDepuisCollecte(donnees, { maintenant: "2026-11-03T00:20:00Z" });
ok(x.candidats[0]?.debutMatch === "2026-11-04T01:00:00.000Z" && x.candidats[0].projection === 15.8, "extraction : match commencé ignoré, match suivant retenu");

// Essai sur une collecte reelle (lecture seule, facultatif)
const dossier = process.argv[2];
if (dossier) {
  const d = await lireCollecte(dossier);
  const { candidats, fenetre } = candidatsDepuisCollecte(d, { maintenant: (d.resume[0] || {}).arcade_nba_debut });
  console.log(`collecte ${dossier} : ${candidats.length} candidats Common NBA, fenêtre ${fenetre.debut} → ${fenetre.fin}`);
  console.log(candidats.sort((a, b) => b.projection - a.projection).slice(0, 5).map((c) => `${c.joueur} ${c.equipe} ${c.etoiles}★ ${c.projection} ${c.debutMatch}`).join("\n"));
}
console.log(ko ? `${ko} ECHEC(S)` : "OK");
process.exit(ko ? 1 : 0);
