// Point d'entree GitHub Actions : node collect.mjs
// SPORT=football ou SPORT=nba : collecte d'un seul sport (workflows manuels), fusionnee avec data/latest : les lignes de
// l'autre sport y sont gardees telles quelles (fusionneSport, collecte.mjs). SPORT absent, vide ou « tout » : les deux sports.
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { collect } from "./core.mjs";
import { candidatsBilan, fusionneSport } from "./collecte.mjs";

const readJson = async (p, d) => { try { return JSON.parse(await readFile(p, "utf8")); } catch { return d; } };
const apiKey = process.env.SORARE_API_KEY || null;
const oddsKey = process.env.ODDS_API_KEY || null;
if (!apiKey) console.warn("SORARE_API_KEY absent : collecte lente sans clé");
const sportBrut = String(process.env.SPORT || "").trim().toLowerCase();
const SPORTS = { "": null, tout: null, all: null, football: "FOOTBALL", nba: "NBA" };
if (!(sportBrut in SPORTS)) { console.error(`SPORT « ${sportBrut} » inconnu : football, nba ou tout`); process.exit(1); }
const sport = SPORTS[sportBrut];

// Priorite des competitions NBA Pro (contrat v8) : fichier a cote de ce module (et non relatif au cwd).
// Absent -> null ; JSON invalide -> { erreur } ; dans les deux cas collect() garde l'ordre par defaut et le journalise.
const prioriteNba = await readFile(fileURLToPath(new URL("./priorite-nba.json", import.meta.url)), "utf8")
  .then((t) => { try { return JSON.parse(t); } catch (e) { return { erreur: "JSON invalide : " + e.message }; } }, () => null);
const prev = await readJson("data/latest/joueurs.json", null);
const history = await readJson("data/history.json", { samples: [], calibration: [] });
// Bilan : archives faites avant la date limite d'une gameweek passee (les archives sans resume.json, d'avant le contrat v3, sont ignorees)
const now = new Date();
const jours = (await readdir("data/archive").catch(() => [])).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const resumes = await Promise.all(jours.map(async (d) => ({ dossier: `data/archive/${d}`, resume: await readJson(`data/archive/${d}/resume.json`, null) })));
const compsPrecedentes = await Promise.all(candidatsBilan(resumes, now).map(async (x) => ({ ...x,
  compos: await readJson(`${x.dossier}/compos.json`, []), competitions: await readJson(`${x.dossier}/competitions.json`, []), paliers: await readJson(`${x.dossier}/paliers.json`, []) })));
const { files: collecte, history: h } = await collect({ apiKey, oddsKey, prev, history, compsPrecedentes, now, log: (m) => console.log(m), sport, prioriteNba });
let files = collecte;
if (sport) {
  // Fusion : chaque jeu de data/latest garde les lignes de l'autre sport ; jeu absent = seulement le sport collecte
  const anciens = {};
  for (const n of Object.keys(collecte)) { const v = await readJson(`data/latest/${n}.json`, null); if (Array.isArray(v)) anciens[n] = v; }
  files = fusionneSport(sport, collecte, anciens);
  console.log(`Collecte ${sport === "NBA" ? "NBA" : "football"} seule, fusionnée avec data/latest (lignes de l'autre sport gardées)`);
}

await mkdir("data/latest", { recursive: true });
const today = now.toISOString().slice(0, 10);
await mkdir(`data/archive/${today}`, { recursive: true });
for (const [name, rows] of Object.entries(files)) {
  await writeFile(`data/latest/${name}.json`, JSON.stringify(rows));
  console.log(`${name}: ${rows.length} lignes`);
}
// Archive du jour (la derniere collecte du jour remplace la precedente) : de quoi faire le bilan une fois la gameweek terminee
for (const n of ["compos", "competitions", "paliers", "resume"]) await writeFile(`data/archive/${today}/${n}.json`, JSON.stringify(files[n]));
await writeFile("data/history.json", JSON.stringify(h));
