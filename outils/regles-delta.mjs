#!/usr/bin/env node
// Contrôle des changements de règles Sorare (football et NBA), sans réseau.
// Compare les règles relues par la collecte la plus récente (competitions.json : regles, cap_points, cap_etoiles,
// min_in_season, max_par_club, capitaine_pct, max_compos, cout_inscription, et regles_cles si présent)
//   1) à la collecte précédente ;
//   2) à l'instantané de référence docs/regles-reference.json (audit du 25/10/2026).
// Les compétitions sont rapprochées par suffixe de slug : la gameweek (« nba-26-30-oct-2026- ») et l'identifiant de
// salon (« -<uuid> ») sont retirés, car le slug change chaque gameweek.
//
// Usage :
//   node outils/regles-delta.mjs                      racine du projet : sorare-donnes/collectes/ (Mac) ou data/ (dépôt)
//   node outils/regles-delta.mjs <dossier>            <dossier> = racine, sorare-donnes/collectes, data, data/latest
//                                                     ou un dossier de collecte (contenant competitions.json)
//   options : --precedent <dossier>  --reference <fichier.json>  --maj-reference (réécrit la référence après examen)
// Code de sortie : 0 = rien à signaler ; 2 = changement à examiner ; 1 = données introuvables.
// Mac : la précédente = l'avant-dernier dossier AAAA-MM-JJ_HHhMM. Dépôt GitHub : la plus récente = data/latest,
// la précédente = la dernière data/archive/<jour> antérieure au jour de data/latest (resume.json, champ maj).
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { dirname, join, resolve, basename } from "node:path";
import { fileURLToPath } from "node:url";

const racine = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DOSSIER = /^\d{4}-\d{2}-\d{2}_\d{2}h\d{2}$/;
const JOUR = /^\d{4}-\d{2}-\d{2}$/;
const CHAMPS = ["cap_points", "cap_etoiles", "min_in_season", "max_par_club", "capitaine_pct", "max_compos", "cout_inscription"];

const lire = (p) => { try { return JSON.parse(readFileSync(p, "utf8")); } catch { return null; } };
const norm = (t) => String(t ?? "").replace(/\s+/g, " ").trim();
// suffixe de slug : sans la gameweek (jusqu'à l'année « -2026- » comprise) ni l'identifiant de salon
export function suffixe(slug) {
  return String(slug || "").replace(/^(football|nba|baseball)-.*?-\d{4}-/, "").replace(/-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/, "");
}
// competitions.json -> Map(suffixe -> { sport, nom, regles: [textes], champs })
export function indexe(lignes) {
  const m = new Map();
  for (const c of lignes || []) {
    const cle = c.type === "SET" ? "set" : suffixe(c.slug); // Set : règles non lisibles, nom du set variable
    if (!cle || m.has(cle)) continue; // salons Cap 260 en double : le premier suffit
    const regles = Array.isArray(c.regles) ? c.regles.map(norm) : String(c.regles || "").split(" | ").map(norm).filter(Boolean);
    const champs = {}; for (const k of CHAMPS) if (k in c) champs[k] = c[k] ?? null;
    m.set(cle, { sport: c.sport, nom: c.nom || c.competition || cle, regles, cles: c.regles_cles ? [].concat(c.regles_cles) : null, champs });
  }
  return m;
}
// Différences de B (ancien) vers A (nouveau). reference = true : une compétition absente de la collecte n'est qu'une info.
export function compare(A, B, { reference = false } = {}) {
  const changements = [], infos = [];
  for (const [k, a] of A) {
    const b = B.get(k);
    if (!b) { if (!(reference && k === "set")) changements.push(`[${a.sport}] nouvelle compétition : ${a.nom} (${k})${reference ? ", absente de la référence" : ""}`); continue; }
    for (const r of a.regles) if (!b.regles.includes(r)) changements.push(`[${a.sport}] ${a.nom} : règle ajoutée ou modifiée « ${r} »`);
    for (const r of b.regles) if (!a.regles.includes(r)) changements.push(`[${a.sport}] ${a.nom} : règle retirée ou modifiée « ${r} »`);
    if (a.cles && b.cles) {
      for (const x of a.cles) if (!b.cles.includes(x)) changements.push(`[${a.sport}] ${a.nom} : clé de règle ajoutée ${x}`);
      for (const x of b.cles) if (!a.cles.includes(x)) changements.push(`[${a.sport}] ${a.nom} : clé de règle retirée ${x}`);
    }
    for (const f of CHAMPS) {
      if (!(f in a.champs) || !(f in b.champs)) continue; // colonne absente d'un côté (ancien contrat) : pas comparable
      const va = a.champs[f] ?? null, vb = b.champs[f] ?? null;
      if (String(va) !== String(vb)) changements.push(`[${a.sport}] ${a.nom} : ${f} ${vb ?? "vide"} → ${va ?? "vide"}`);
    }
  }
  for (const [k, b] of B) {
    if (A.has(k)) continue;
    if (reference) { if (b.suivie) infos.push(`[${b.sport}] ${b.nom} (${k}) absente de cette collecte (hors gameweek ou trêve ?)`); }
    else changements.push(`[${b.sport}] compétition disparue : ${b.nom} (${k})`);
  }
  return { changements, infos };
}
// Référence (docs/regles-reference.json) -> même forme que indexe(), compétitions suivies par la collecte seulement
export function indexeReference(ref) {
  const m = new Map();
  for (const [k, c] of Object.entries(ref?.competitions || {})) {
    if (c.suivie === false) continue;
    const champs = {}; for (const f of CHAMPS) if (f in c) champs[f] = c[f] ?? null;
    m.set(k, { sport: c.sport, nom: c.nom, regles: (c.regles || []).map(norm), cles: c.regles_cles || null, champs, suivie: true });
  }
  return m;
}

// Choix des deux collectes à comparer
export function trouveCollectes(p, precedent = null) {
  const dossiersDe = (d) => (existsSync(d) ? readdirSync(d).filter((x) => DOSSIER.test(x) && existsSync(join(d, x, "competitions.json"))).sort() : []);
  const archive = (data, actuel) => {
    const resume = lire(join(actuel, "resume.json"));
    const jour = (Array.isArray(resume) ? resume[0]?.maj : resume?.maj)?.slice(0, 10) || new Date().toISOString().slice(0, 10);
    const jours = existsSync(join(data, "archive")) ? readdirSync(join(data, "archive")).filter((x) => JOUR.test(x) && x < jour && existsSync(join(data, "archive", x, "competitions.json"))).sort() : [];
    return jours.length ? join(data, "archive", jours[jours.length - 1]) : null;
  };
  let actuel = null, prec = precedent ? resolve(precedent) : null;
  if (existsSync(join(p, "competitions.json"))) {
    actuel = p;
    if (!prec) {
      const parent = dirname(p);
      if (basename(p) === "latest") prec = archive(parent, p);
      else if (DOSSIER.test(basename(p))) { const l = dossiersDe(parent); const i = l.indexOf(basename(p)); prec = i > 0 ? join(parent, l[i - 1]) : null; }
    }
  } else {
    const coll = existsSync(join(p, "sorare-donnes", "collectes")) ? join(p, "sorare-donnes", "collectes") : dossiersDe(p).length ? p : null;
    const data = existsSync(join(p, "data", "latest", "competitions.json")) ? join(p, "data") : existsSync(join(p, "latest", "competitions.json")) ? p : null;
    if (coll && dossiersDe(coll).length) {
      const l = dossiersDe(coll); actuel = join(coll, l[l.length - 1]); if (!prec && l.length > 1) prec = join(coll, l[l.length - 2]);
    } else if (data) { actuel = join(data, "latest"); if (!prec) prec = archive(data, actuel); }
  }
  return { actuel, precedent: prec };
}

export function analyse({ actuel, precedent, reference }) {
  const A = indexe(lire(join(actuel, "competitions.json")));
  const res = { actuel, precedent, lignes: [], nb: 0 };
  const bloc = (titre, r) => {
    res.lignes.push(`### ${titre}`);
    if (!r) { res.lignes.push("- non disponible"); return; }
    res.nb += r.changements.length;
    res.lignes.push(...(r.changements.length ? r.changements.map((x) => "- " + x) : ["- aucun changement"]), ...r.infos.map((x) => "- (info) " + x));
  };
  bloc(`Par rapport à la collecte précédente${precedent ? ` (${precedent})` : ""}`, precedent && existsSync(join(precedent, "competitions.json")) ? compare(A, indexe(lire(join(precedent, "competitions.json")))) : null);
  bloc(`Par rapport à la référence${reference?.releve_le ? ` du ${reference.releve_le}` : ""}`, reference ? compare(A, indexeReference(reference), { reference: true }) : null);
  return res;
}

// ---------- Ligne de commande ----------
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const pos = args.filter((x, i) => !x.startsWith("--") && !["--precedent", "--reference"].includes(args[i - 1]));
  const refPath = resolve(opt("--reference") || join(racine, "docs", "regles-reference.json"));
  const { actuel, precedent } = trouveCollectes(resolve(pos[0] || racine), opt("--precedent"));
  if (!actuel) { console.error("Règles : aucune collecte trouvée (competitions.json)."); process.exit(1); }
  const reference = lire(refPath);
  if (args.includes("--maj-reference")) {
    // après examen d'un changement accepté : les compétitions suivies prennent les règles de la collecte la plus récente
    const ref = reference || { version: 1, competitions: {} };
    for (const [k, a] of indexe(lire(join(actuel, "competitions.json")))) {
      if (k === "set") continue;
      ref.competitions[k] = { ...(ref.competitions[k] || {}), sport: a.sport, nom: a.nom, suivie: true, regles: a.regles, ...(a.cles ? { regles_cles: a.cles } : {}), ...a.champs };
    }
    ref.releve_le = new Date().toISOString().slice(0, 10); ref.source = `${ref.source || ""} Mise à jour depuis ${actuel}.`.trim();
    writeFileSync(refPath, JSON.stringify(ref, null, 1)); console.log(`Référence mise à jour : ${refPath}`); process.exit(0);
  }
  const res = analyse({ actuel, precedent, reference });
  console.log(`## Règles Sorare : ${res.nb ? `${res.nb} changement${res.nb > 1 ? "s" : ""} à examiner` : "aucun changement"}`);
  console.log(`Collecte : ${actuel}`);
  console.log(res.lignes.join("\n"));
  if (!reference) console.log(`(référence introuvable : ${refPath})`);
  process.exit(res.nb ? 2 : 0);
}
