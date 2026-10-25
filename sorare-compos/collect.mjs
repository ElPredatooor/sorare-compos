// Point d'entree GitHub Actions : node collect.mjs
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { collect } from "./core.mjs";
import { candidatsBilan } from "./collecte.mjs";

const readJson = async (p, d) => { try { return JSON.parse(await readFile(p, "utf8")); } catch { return d; } };
const apiKey = process.env.SORARE_API_KEY || null;
const oddsKey = process.env.ODDS_API_KEY || null;
if (!apiKey) console.warn("SORARE_API_KEY absent : collecte lente sans clé");

const prev = await readJson("data/latest/joueurs.json", null);
const history = await readJson("data/history.json", { samples: [], calibration: [] });
// Bilan : archives faites avant la date limite d'une gameweek passee (les archives sans resume.json, d'avant le contrat v3, sont ignorees)
const now = new Date();
const jours = (await readdir("data/archive").catch(() => [])).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
const resumes = await Promise.all(jours.map(async (d) => ({ dossier: `data/archive/${d}`, resume: await readJson(`data/archive/${d}/resume.json`, null) })));
const compsPrecedentes = await Promise.all(candidatsBilan(resumes, now).map(async (x) => ({ ...x,
  compos: await readJson(`${x.dossier}/compos.json`, []), competitions: await readJson(`${x.dossier}/competitions.json`, []), paliers: await readJson(`${x.dossier}/paliers.json`, []) })));
const { files, history: h } = await collect({ apiKey, oddsKey, prev, history, compsPrecedentes, now, log: (m) => console.log(m) });

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
