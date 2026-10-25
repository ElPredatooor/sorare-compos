#!/usr/bin/env node
// Test hors ligne de outils/regles-delta.mjs : dispositions Mac (sorare-donnes/collectes/<dossier>) et dépôt GitHub
// (data/latest + data/archive/<jour>), règle modifiée, compétition nouvelle / disparue, code de sortie.
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const outil = join(resolve(dirname(fileURLToPath(import.meta.url))), "regles-delta.mjs");
const erreurs = []; const ok = (c, m) => { if (!c) erreurs.push(m); };
const tmp = mkdtempSync(join(tmpdir(), "regles-delta-"));
const ecrit = (d, nom, v) => { mkdirSync(d, { recursive: true }); writeFileSync(join(d, nom), JSON.stringify(v)); };
const comp = (gw, suffixe, extra = {}) => ({ competition: "NBA Classic Champion", slug: `${gw}-${suffixe}`, sport: "NBA", type: "NBA", max_compos: 3, cap_points: null, cap_etoiles: 16, min_in_season: null, max_par_club: 4, capitaine_pct: 0, cout_inscription: 0,
  regles: "5x Limited Cartes | Max 4 joueurs de chaque équipe dans ta compo | Cap de 16 étoiles La somme des étoiles des joueurs doit rester inférieure à 16", ...extra });
const ref = { releve_le: "2026-10-25", competitions: { nba_limited_champion: { sport: "NBA", nom: "NBA Classic Champion", suivie: true, max_compos: 3, cap_points: null, cap_etoiles: 16, min_in_season: null, max_par_club: 4, capitaine_pct: 0, cout_inscription: 0,
  regles: ["5x Limited Cartes", "Max 4 joueurs de chaque équipe dans ta compo", "Cap de 16 étoiles La somme des étoiles des joueurs doit rester inférieure à 16"] } } };
const refPath = join(tmp, "ref.json"); writeFileSync(refPath, JSON.stringify(ref));
const lance = (p) => spawnSync(process.execPath, [outil, p, "--reference", refPath], { encoding: "utf8" });
const salon = "-0a1b2c3d-1111-2222-3333-444455556666";

try {
  // 1. Mac, aucune différence (slug de gameweek différent, salon avec uuid ignoré)
  const coll = join(tmp, "mac", "sorare-donnes", "collectes");
  ecrit(join(coll, "2026-10-24_22h05"), "competitions.json", [comp("nba-23-26-oct-2026", "nba_limited_champion")]);
  ecrit(join(coll, "2026-10-25_07h48"), "competitions.json", [comp("nba-26-30-oct-2026", "nba_limited_champion" + salon)]);
  let r = lance(join(tmp, "mac"));
  ok(r.status === 0 && /aucun changement/.test(r.stdout), "Mac sans changement : code " + r.status + "\n" + r.stdout + r.stderr);
  // 2. Mac : plafond modifié + nouvelle compétition -> code 2
  ecrit(join(coll, "2026-10-26_07h00"), "competitions.json", [comp("nba-27-30-oct-2026", "nba_limited_champion", { cap_etoiles: 15, regles: "5x Limited Cartes | Max 4 joueurs de chaque équipe dans ta compo | Cap de 15 étoiles La somme des étoiles des joueurs doit rester inférieure à 15" }),
    comp("nba-27-30-oct-2026", "nba_limited_challenger", { competition: "NBA Challenger" })]);
  r = lance(join(tmp, "mac"));
  ok(r.status === 2, "Mac avec changement : code " + r.status + " (2 attendu)");
  ok(/cap_etoiles 16 → 15/.test(r.stdout) && /règle retirée ou modifiée « Cap de 16/.test(r.stdout) && /règle ajoutée ou modifiée « Cap de 15/.test(r.stdout), "plafond modifié non signalé :\n" + r.stdout);
  ok(/nouvelle compétition : NBA Challenger/.test(r.stdout), "nouvelle compétition non signalée :\n" + r.stdout);
  // 3. Dépôt GitHub : data/latest (jour = resume.maj) comparé à la dernière archive antérieure ; compétition disparue
  const data = join(tmp, "depot", "data");
  ecrit(join(data, "archive", "2026-10-24"), "competitions.json", [comp("nba-23-26-oct-2026", "nba_limited_champion"), comp("nba-23-26-oct-2026", "nba_limited_contender", { competition: "NBA Classic Contender", cap_etoiles: 11 })]);
  ecrit(join(data, "archive", "2026-10-25"), "competitions.json", [comp("nba-26-30-oct-2026", "nba_limited_champion")]);
  ecrit(join(data, "latest"), "competitions.json", [comp("nba-26-30-oct-2026", "nba_limited_champion")]);
  ecrit(join(data, "latest"), "resume.json", [{ maj: "2026-10-25T05:20:00Z" }]);
  r = lance(join(tmp, "depot"));
  ok(r.status === 2 && /archive\/2026-10-24/.test(r.stdout) && /compétition disparue : NBA Classic Contender/.test(r.stdout), "dépôt : archive précédente ou disparition mal traitée : code " + r.status + "\n" + r.stdout);
  // 4. Référence : coût d'inscription différent -> signalé
  ecrit(join(tmp, "seul", "x"), "competitions.json", [comp("nba-26-30-oct-2026", "nba_limited_champion", { cout_inscription: 150 })]);
  r = lance(join(tmp, "seul", "x"));
  ok(r.status === 2 && /cout_inscription 0 → 150/.test(r.stdout), "référence : coût d'inscription modifié non signalé :\n" + r.stdout);
  // 5. Compétition marquée « suivie: false » (NBA In-Season Contender, non jouée, utilisateur 25/10/2026) : ni nouvelle, ni disparue
  const ref2 = { ...ref, competitions: { ...ref.competitions, nba_limited_in_season_contender: { sport: "NBA", nom: "NBA In-Season Contender", suivie: false } } };
  const ref2Path = join(tmp, "ref2.json"); writeFileSync(ref2Path, JSON.stringify(ref2));
  const coll5 = join(tmp, "ns", "sorare-donnes", "collectes");
  ecrit(join(coll5, "2026-10-25_07h48"), "competitions.json", [comp("nba-26-30-oct-2026", "nba_limited_champion"), comp("nba-26-30-oct-2026", "nba_limited_in_season_contender", { competition: "NBA In-Season Contender", cap_etoiles: 11 })]);
  ecrit(join(coll5, "2026-10-26_07h00"), "competitions.json", [comp("nba-26-30-oct-2026", "nba_limited_champion")]);
  r = spawnSync(process.execPath, [outil, join(tmp, "ns"), "--reference", ref2Path], { encoding: "utf8" });
  ok(r.status === 0 && !/In-Season Contender/.test(r.stdout), "compétition non suivie signalée : code " + r.status + "\n" + r.stdout);
  r = spawnSync(process.execPath, [outil, join(coll5, "2026-10-25_07h48"), "--reference", ref2Path], { encoding: "utf8" });
  ok(r.status === 0 && !/In-Season Contender/.test(r.stdout), "compétition non suivie présente dans la collecte signalée : code " + r.status + "\n" + r.stdout);
} finally { rmSync(tmp, { recursive: true, force: true }); }

if (erreurs.length) { console.error("ÉCHEC regles-delta :\n  - " + erreurs.join("\n  - ")); process.exit(1); }
console.log("OK : regles-delta (Mac, dépôt GitHub, règle modifiée, compétition nouvelle et disparue, référence, compétition non suivie).");
