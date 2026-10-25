#!/usr/bin/env node
// Construit le site autonome du dashboard (GitHub Pages) dans site/dist/.
//
//   node site/build.mjs <dossier de données> [--page <fichier html>] [--out <dossier>]
//
// - Page : sorare-compos/dashboard/index.html (lue telle quelle, jamais modifiée).
// - Données : jeux <nom>.json (sinon <nom>.csv) du dossier passé en argument, copiés dans dist/data/.
//   Un jeu vide ([]) devient un CSV d'en-tête (colonnes de docs/contrat-donnees.md, version 3).
//   Le jeu bilan, absent tant qu'aucune gameweek proposée n'est terminée, est créé en CSV d'en-tête.
//   Les fichiers hors contrat (history.json, log.json…) ne sont pas publiés.
// Node 20+, aucune dépendance.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// Colonnes du contrat de données (docs/contrat-donnees.md, version 3), dans l'ordre du contrat
const COLUMNS = {
  joueurs: ['joueur', 'slug', 'sport', 'modes', 'club', 'poste', 'etoiles', 'plancher_etoiles', 'gain_etoiles', 'gain_sorare', 'back_to_back', 'espn_statut', 'espn_info', 'espn_retour', 'minutes_5', 'minutes_tendance', 'statut', 'blessure', 'suspension', 'l5', 'l15', 'l10', 'forme10', 'minutes_moy', 'part_decisive', 'regularite', 'matchs_gw', 'adversaire', 'match', 'adv_attaque_rang', 'adv_defense_rang', 'adv_nb_equipes', 'adv_ligue', 'adv_attaque_val', 'adv_defense_val', 'competition_match', 'proba_victoire', 'proba_victoire_adv', 'clean_sheet', 'total_match', 'proba_titulaire', 'source_titulaire', 'grade_sorare', 'proj_sorare', 'proj_forme', 'score_attendu', 'carte', 'carte_label', 'bonus', 'bonus_skin', 'score_final', 'nb_cartes', 'proj_match', 'matchs_probables', 'coequipiers_absents', 'minutes_liberees'],
  matchs: ['sport', 'slug', 'joueur', 'date', 'jour', 'adversaire', 'proj', 'proba', 'b2b', 'adv_attaque_rang', 'adv_defense_rang', 'adv_nb_equipes', 'proba_victoire', 'total'],
  compos: ['competition', 'sport', 'numero', 'slot', 'joueur', 'carte', 'capitaine', 'score_attendu', 'score_final', 'gain_etoiles', 'etoiles', 'bonus', 'moyenne_cap', 'adversaire', 'match', 'adv_attaque_rang', 'adv_defense_rang', 'adv_nb_equipes', 'slug', 'carte_id'],
  competitions: ['competition', 'slug', 'sport', 'date_limite', 'joueurs_eligibles', 'contraintes', 'max_compos', 'nb_compos', 'scores_compos', 'score_compo', 'statut', 'regles', 'type', 'rang', 'cap_points', 'cap_etoiles', 'min_in_season', 'max_par_club', 'capitaine_pct', 'cout_inscription', 'gains_esperes', 'gain_net_espere', 'autres_recompenses', 'rentable', 'recommandation', 'alternative'],
  bilan: ['sport', 'gw', 'competition', 'numero', 'score_prevu', 'score_reel', 'ecart', 'palier_vise', 'palier_atteint', 'joueurs', 'source_compos'],
  plan_arcade: ['depart', 'etape', 'palier', 'seuil', 'creneau', 'resultat_vers', 'compo', 'joueurs', 'score_attendu', 'proba_compo', 'proba_palier', 'conseil'],
  cartes: ['sport', 'slug', 'joueur', 'carte_id', 'label', 'rarete', 'saison', 'puissance', 'skin', 'in_season', 'set_courant'],
  paliers: ['sport', 'competition', 'gw_reference', 'type', 'rang', 'score', 'recompense', 'participants'],
  jours: ['mode', 'jour', 'rang', 'joueur', 'poste', 'adversaire', 'match', 'score_attendu', 'adv_attaque_rang', 'adv_defense_rang', 'adv_nb_equipes'],
  changements: ['joueur', 'modes', 'type', 'detail'],
  calibration: ['date', 'sport', 'matchs', 'erreur_modele', 'erreur_sorare', 'erreur_forme', 'poids_sorare'],
  resume: ['maj', 'cartes', 'joueurs', 'set', 'gw_football', 'gw_nba', 'limite_football', 'limite_nba', 'poids_sorare', 'cotes_externes', 'appels_api', 'gw_debut_football', 'gw_fin_football', 'gw_debut_nba', 'gw_fin_nba'],
};
// Jeux créés vides (CSV d'en-tête) quand ils manquent dans la collecte
const EMPTY_IF_MISSING = new Set(['bilan']);

function args(argv) {
  const o = { data: null, page: path.join(ROOT, 'sorare-compos/dashboard/index.html'), out: path.join(HERE, 'dist') };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--page') o.page = path.resolve(argv[++i]);
    else if (argv[i] === '--out') o.out = path.resolve(argv[++i]);
    else if (!o.data) o.data = path.resolve(argv[i]);
    else throw new Error('Argument inattendu : ' + argv[i]);
  }
  if (!o.data) throw new Error('Usage : node site/build.mjs <dossier de données> [--page <html>] [--out <dossier>]');
  return o;
}

const csvHeader = (cols) => cols.map((c) => (/[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c)).join(',') + '\n';
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Copie des jeux ; renvoie le résumé (première ligne de resume) s'il est lisible
function copyData(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  const report = [];
  const files = {};
  let resume = null;
  for (const [name, cols] of Object.entries(COLUMNS)) {
    const j = path.join(src, name + '.json'), c = path.join(src, name + '.csv');
    if (fs.existsSync(j)) {
      const txt = fs.readFileSync(j, 'utf8');
      let d;
      try { d = JSON.parse(txt); } catch (e) { throw new Error(name + '.json n’est pas un JSON valide : ' + e.message); }
      if (Array.isArray(d) && d.length === 0) {
        fs.writeFileSync(path.join(dst, name + '.csv'), csvHeader(cols)); files[name] = name + '.csv';
        report.push(`${name}: vide → ${name}.csv (en-tête seul)`);
      } else {
        fs.writeFileSync(path.join(dst, name + '.json'), JSON.stringify(d)); files[name] = name + '.json';
        report.push(`${name}: ${Array.isArray(d) ? d.length + (d.length > 1 ? ' lignes' : ' ligne') : 'objet'} (JSON)`);
        if (name === 'resume') resume = Array.isArray(d) ? d[0] : d;
      }
    } else if (fs.existsSync(c)) {
      fs.copyFileSync(c, path.join(dst, name + '.csv')); files[name] = name + '.csv';
      report.push(`${name}: copié (CSV)`);
      if (name === 'resume') resume = firstCsvRow(fs.readFileSync(c, 'utf8'));
    } else if (EMPTY_IF_MISSING.has(name)) {
      fs.writeFileSync(path.join(dst, name + '.csv'), csvHeader(cols)); files[name] = name + '.csv';
      report.push(`${name}: absent → ${name}.csv (en-tête seul)`);
    } else {
      report.push(`${name}: ABSENT (la page l’affichera comme manquant)`);
    }
  }
  // Manifeste lu par dash-shim.js : il demande directement le bon fichier (pas de 404 dans la console)
  fs.writeFileSync(path.join(dst, 'index.json'), JSON.stringify({ maj: resume ? resume.maj : null, jeux: files }, null, 1));
  return { report, resume };
}
function firstCsvRow(txt) {
  const lines = txt.replace(/^﻿/, '').split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;
  const split = (l) => l.match(/("([^"]|"")*"|[^,]*)(,|$)/g).map((x) => x.replace(/,$/, '').replace(/^"|"$/g, '').replace(/""/g, '"'));
  const h = split(lines[0]), v = split(lines[1]);
  return Object.fromEntries(h.map((k, i) => [k, v[i] || null]));
}

// Date des données en heure de Bruxelles : « dimanche 25 octobre 2026 à 07h48 »
function fmtMaj(iso) {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return null;
  const p = {};
  new Intl.DateTimeFormat('fr-BE', { timeZone: 'Europe/Brussels', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(d).forEach((x) => (p[x.type] = x.value));
  return `${p.weekday} ${p.day} ${p.month} ${p.year} à ${p.hour}h${p.minute}`;
}

// Page : styles et HTML d'un côté, scripts de l'autre (dans l'ordre du fichier)
function splitPage(html) {
  const scripts = [];
  const markup = html.replace(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi, (_, attrs, body) => {
    if (/\bsrc\s*=/.test(attrs)) throw new Error('La page charge un script externe (' + attrs.trim() + ') : non pris en charge, aucune ressource externe.');
    scripts.push(body);
    return '';
  });
  if (/\b(src|href)\s*=\s*["']?https?:/i.test(markup)) console.warn('Attention : la page référence une ressource externe (http).');
  return { markup: markup.trim(), scripts };
}

// Thème : équivalents des variables du runtime Dashboard (clair et sombre)
const BASE_CSS = `
  :root {
    color-scheme: light dark;
    --font-anthropic-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
    --font-anthropic-serif: ui-serif, "Iowan Old Style", "Palatino Linotype", Georgia, Cambria, "Times New Roman", serif;
    --cds-font-size-title: 1.75rem; --cds-font-size-heading: 1.125rem; --cds-font-size-body: 0.9375rem; --cds-font-size-caption: 0.8125rem;
    --cds-font-weight-medium: 600;
    --cds-gap-xs: 4px; --cds-gap-sm: 8px; --cds-gap-md: 12px; --cds-gap-lg: 20px;
    --cds-pad-xs: 4px; --cds-pad-sm: 8px; --cds-pad-md: 12px; --cds-pad-lg: 16px;
    --cds-radius: 8px; --cds-dur-slow: 300ms;
    --color-bg: #faf9f5; --color-panel: #ffffff; --color-fg: #1f1e1d; --color-fg-muted: #6b6a64;
    --color-border-line: rgba(31, 30, 29, 0.14);
    --color-ok: #2e7d4f; --color-warn: #a35f00; --color-bad: #c0392b;
    --cds-chart-axis: rgba(31, 30, 29, 0.35); --cds-chart-grid: rgba(31, 30, 29, 0.08); --cds-chart-muted: rgba(31, 30, 29, 0.22);
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --color-bg: #262624; --color-panel: #30302e; --color-fg: #f5f4ef; --color-fg-muted: #a6a59f;
      --color-border-line: rgba(245, 244, 239, 0.14);
      --color-ok: #6cc28f; --color-warn: #e3a64a; --color-bad: #ef7d6e;
      --cds-chart-axis: rgba(245, 244, 239, 0.35); --cds-chart-grid: rgba(245, 244, 239, 0.08); --cds-chart-muted: rgba(245, 244, 239, 0.25);
    }
  }
  *, *::before, *::after { box-sizing: border-box; }
  html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
  body { margin: 0; background: var(--color-bg); color: var(--color-fg); font-family: var(--font-anthropic-sans); font-size: var(--cds-font-size-body); line-height: 1.45; }
  .site-head { display: flex; flex-wrap: wrap; gap: 2px var(--cds-gap-md); align-items: baseline; justify-content: space-between; max-width: 1280px; margin: 0 auto; padding: var(--cds-pad-sm) var(--cds-pad-lg); border-bottom: 1px solid var(--color-border-line); font-size: var(--cds-font-size-caption); color: var(--color-fg-muted); }
  .site-head strong { color: var(--color-fg); font-weight: var(--cds-font-weight-medium); }
  #dash-root { max-width: 1280px; margin: 0 auto; padding: var(--cds-pad-lg); }
  @media (max-width: 600px) { #dash-root { padding: var(--cds-pad-md); } .site-head { padding: var(--cds-pad-xs) var(--cds-pad-md); } }
  /* Les attributs SVG fill="var(--…)" ne lisent pas les variables CSS : on les applique en CSS */
  svg [fill="var(--cds-chart-muted)"] { fill: var(--cds-chart-muted); }
  noscript p { max-width: 60ch; }
`;

function render({ markup, scripts, majTxt }) {
  const title = 'Compos Sorare Elpredatooor';
  return `<!doctype html>
<html lang="fr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<title>${esc(title)}</title>
<style>${BASE_CSS}</style>
</head>
<body>
<header class="site-head">
  <strong>${esc(title)}</strong>
  <span id="site-maj">${majTxt ? 'Données du ' + esc(majTxt) + ' (heure de Bruxelles)' : 'Date des données inconnue'}</span>
</header>
<noscript><p>Ce tableau de bord a besoin de JavaScript.</p></noscript>
<div id="dash-root">
${markup}
</div>
<script src="dash-shim.js"></script>
${scripts.map((s) => '<script>' + s + '</script>').join('\n')}
</body>
</html>
`;
}

function main() {
  const o = args(process.argv.slice(2));
  if (!fs.existsSync(o.data) || !fs.statSync(o.data).isDirectory()) throw new Error('Dossier de données introuvable : ' + o.data);
  const html = fs.readFileSync(o.page, 'utf8');
  const { markup, scripts } = splitPage(html);
  if (!scripts.length) throw new Error('Aucun script dans la page : ' + o.page);

  fs.rmSync(o.out, { recursive: true, force: true });
  fs.mkdirSync(o.out, { recursive: true });
  const { report, resume } = copyData(o.data, path.join(o.out, 'data'));
  const majTxt = resume ? fmtMaj(resume.maj) : null;
  fs.writeFileSync(path.join(o.out, 'index.html'), render({ markup, scripts, majTxt }));
  fs.copyFileSync(path.join(HERE, 'dash-shim.js'), path.join(o.out, 'dash-shim.js'));
  fs.writeFileSync(path.join(o.out, '.nojekyll'), '');

  console.log('Site construit dans ' + path.relative(process.cwd(), o.out) + '/');
  console.log('  page : ' + path.relative(process.cwd(), o.page) + ' (' + scripts.length + ' script' + (scripts.length > 1 ? 's' : '') + ')');
  console.log('  données : ' + path.relative(process.cwd(), o.data) + (majTxt ? ' · collecte du ' + majTxt : ''));
  report.forEach((l) => console.log('    ' + l));
}

try { main(); } catch (e) { console.error('Erreur : ' + e.message); process.exit(1); }
