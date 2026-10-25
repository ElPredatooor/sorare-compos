// Regroupe sorare-compos/core.mjs et ses modules (collecte, modele, compos) en un seul fichier
// a coller dans la console d'un onglet https://sorare.com (le navigateur ne charge pas les imports).
//
// Usage :
//   node outils/bundle-navigateur.mjs            -> ecrit sorare-compos/collecteur-navigateur.js
//   node outils/bundle-navigateur.mjs --check    -> verifie que le fichier est a jour (code 1 sinon), n'ecrit rien
//
// Le fichier produit est GENERE : ne jamais le modifier a la main, modifier les modules puis relancer cet outil.
// Aucune dependance : chaque module est place dans sa propre fonction, ses exports sont renvoyes dans un objet.
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const racine = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const dossier = join(racine, "sorare-compos");
const entree = "core.mjs";
const sortie = join(dossier, "collecteur-navigateur.js");

const modules = new Map(); // nom -> { deps, imports, exports, body }
async function lire(nom) {
  if (modules.has(nom)) return;
  const src = await readFile(join(dossier, nom), "utf8");
  const imports = []; const exports = [];
  const lignes = src.split("\n").map((l) => {
    const m = l.match(/^import\s*\{([^}]*)\}\s*from\s*["']\.\/([\w.-]+\.mjs)["'];?\s*$/);
    if (m) { imports.push({ noms: m[1].split(",").map((x) => x.trim()).filter(Boolean), de: m[2] }); return ""; }
    if (/^\s*import\s/.test(l)) throw new Error(`${nom} : import non pris en charge (${l.trim()}). Seuls les imports nommés de fichiers locaux .mjs sont acceptés.`);
    const e = l.match(/^export\s+(async\s+function\*?|function\*?|const|let|class)\s+([A-Za-z_$][\w$]*)/);
    if (e) { exports.push(e[2]); return l.replace(/^export\s+/, ""); }
    if (/^\s*export\s/.test(l)) throw new Error(`${nom} : export non pris en charge (${l.trim()}). Utiliser « export function », « export const » ou « export class ».`);
    return l;
  });
  modules.set(nom, { imports, exports, body: lignes.join("\n") });
  for (const i of imports) await lire(i.de);
}
await lire(entree);

// Ordre : dependances d'abord
const ordre = []; const vus = new Set();
const visite = (nom, pile = []) => {
  if (vus.has(nom)) return;
  if (pile.includes(nom)) throw new Error("Dépendance circulaire : " + [...pile, nom].join(" -> "));
  for (const i of modules.get(nom).imports) visite(i.de, [...pile, nom]);
  vus.add(nom); ordre.push(nom);
};
visite(entree);
const id = (nom) => "__m_" + nom.replace(/\.mjs$/, "").replace(/\W/g, "_");
for (const nom of ordre) for (const i of modules.get(nom).imports) for (const n of i.noms) {
  if (!modules.get(i.de).exports.includes(n)) throw new Error(`${nom} importe « ${n} » que ${i.de} n'exporte pas`);
}
if (!modules.get(entree).exports.includes("collect")) throw new Error(`${entree} doit exporter collect()`);

const blocs = ordre.map((nom) => {
  const m = modules.get(nom);
  const imp = m.imports.map((i) => `  const { ${i.noms.join(", ")} } = ${id(i.de)};`).join("\n");
  return `// ===== ${nom} =====\nconst ${id(nom)} = (() => {\n${imp}${imp ? "\n" : ""}${m.body}\nreturn { ${m.exports.join(", ")} };\n})();`;
});

const texte = `// FICHIER GÉNÉRÉ par outils/bundle-navigateur.mjs à partir de sorare-compos/${ordre.join(", ")}.
// Ne pas modifier à la main : modifier les modules, puis relancer « node outils/bundle-navigateur.mjs ».
// À coller tel quel dans la console d'un onglet https://sorare.com (navigateur intégré de Claude).
// Clés lues dans le localStorage de sorare.com : SX_APIKEY (Sorare), SX_ODDSKEY (The Odds API, facultative).
// Lancer : window.SXRUN({ prev, history, odds }) ; suivre window.SXR.state ("running", "done" ou "error") et window.SXR.log ;
// récupérer : window.SXR.sizes puis window.SXR.part(nom, i) (morceaux JSON de 40 000 caractères, à concaténer).
(() => {
${blocs.join("\n\n")}

const { collect } = ${id(entree)};
const MORCEAU = 40000;
window.SXCOLLECT = collect;
window.SXR = { state: "idle", log: [] };
window.SXRUN = (opts = {}) => {
  let apiKey = null, oddsKey = null;
  try { apiKey = localStorage.getItem("SX_APIKEY"); oddsKey = localStorage.getItem("SX_ODDSKEY"); } catch (e) { /* stockage indisponible */ }
  const SXR = { state: "running", log: [], debut: new Date().toISOString() };
  window.SXR = SXR;
  collect({ apiKey, oddsKey: opts.odds === false ? null : oddsKey, prev: opts.prev || null, history: opts.history || { samples: [], calibration: [] }, log: (m) => SXR.log.push(m) })
    .then((r) => {
      SXR.files = r.files; SXR.history = r.history;
      const json = Object.fromEntries([...Object.entries(r.files), ["history", r.history]].map(([k, v]) => [k, JSON.stringify(v)]));
      SXR.sizes = Object.fromEntries(Object.entries(json).map(([k, v]) => [k, { caracteres: v.length, morceaux: Math.ceil(v.length / MORCEAU), lignes: Array.isArray(r.files[k]) ? r.files[k].length : null }]));
      SXR.part = (nom, i = 0) => json[nom].slice(i * MORCEAU, (i + 1) * MORCEAU);
      SXR.state = "done";
    })
    .catch((e) => { SXR.state = "error"; SXR.error = String((e && e.message) || e); });
  return "collecte lancée";
};
return "collecteur prêt (" + ${JSON.stringify(ordre.join(", "))} + ")";
})();
`;

if (process.argv.includes("--check")) {
  let actuel = ""; try { actuel = await readFile(sortie, "utf8"); } catch { /* absent */ }
  if (actuel !== texte) { console.error("collecteur-navigateur.js n'est PAS à jour : relancer « node outils/bundle-navigateur.mjs »."); process.exit(1); }
  console.log("collecteur-navigateur.js est à jour.");
} else {
  await writeFile(sortie, texte);
  console.log(`collecteur-navigateur.js écrit (${texte.length} caractères) à partir de ${ordre.join(", ")}.`);
}
