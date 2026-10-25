/*
 * dash-shim.js : réimplémentation légère de l'objet `dash` du runtime « Dashboard » de claude.ai,
 * pour publier sorare-compos/dashboard/index.html comme site statique (GitHub Pages).
 *
 * API fournie (celle que la page appelle, plus des équivalents simples du reste) :
 *   dash.data(id)            → { status: 'loading' | 'ok' | 'missing' | 'error', data, error }
 *   dash.onData(fn)          → fn rappelée quand un jeu ou un calcul change, quand la largeur change
 *                              et quand le thème clair/sombre change. Renvoie une fonction de désabonnement.
 *   dash.calc(id, { inputs, fn, title, description })
 *                            → calcul recalculé quand toutes ses entrées sont « ok ».
 *   dash.colors              → palette de graphiques du thème courant (clair ou sombre).
 *   dash.setLink(id)         → écrit #id dans l'adresse (lien direct vers un onglet ou un sport).
 *   dash.params / setParams / resetParams → paramètres lus et écrits dans la query string.
 *   dash.loader(id, fn)      → chargeur personnalisé (fonction async qui renvoie des lignes).
 *   dash.refresh()           → recharge tous les jeux.
 *
 * Les jeux sont lus dans data/<nom>.json, sinon data/<nom>.csv (CSV avec en-tête). Si le manifeste
 * data/index.json existe (écrit par build.mjs), il dit directement quel fichier lire.
 * Les marques data-source du HTML servent seulement à savoir quels jeux charger.
 */
(function () {
  'use strict';
  var script = document.currentScript;
  var BASE = (script && script.dataset.base) || 'data/';

  var sources = new Map();   // id → { status, data, error }
  var loaders = new Map();   // id → fonction de chargement personnalisée
  var calcs = new Map();     // id → { inputs, fn, title, description }
  var calcCache = new Map(); // id → état calculé pour la version courante
  var listeners = [];
  var version = 0;
  var started = false;

  // ---------- Thème et couleurs ----------
  var PALETTES = {
    light: ['#c6613f', '#3f6fa8', '#5e7d3a', '#a3762b', '#7d5ba6', '#2f8a83', '#b04a6b', '#6b6a64'],
    dark: ['#e08a68', '#7aa7dd', '#94b46c', '#d6a24f', '#ad8fd6', '#5fbfb6', '#de7f9f', '#a3a29b'],
  };
  var darkMq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var isDark = function () { return !!(darkMq && darkMq.matches); };

  // ---------- CSV ----------
  function parseCsv(text) {
    text = String(text).replace(/^﻿/, '');
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text[i];
      if (q) {
        if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += ch;
      } else if (ch === '"') q = true;
      else if (ch === ',') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') {
        if (ch === '\r' && text[i + 1] === '\n') i++;
        row.push(cell); rows.push(row); row = []; cell = '';
      } else cell += ch;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    rows = rows.filter(function (r) { return !(r.length === 1 && r[0] === ''); });
    if (!rows.length) return [];
    var head = rows[0];
    return rows.slice(1).map(function (r) {
      var o = {};
      head.forEach(function (k, j) { o[k] = typed(r[j]); });
      return o;
    });
  }
  // Cellule vide → null ; nombres et booléens typés comme en JSON
  function typed(v) {
    if (v == null || v === '') return null;
    if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(v)) return Number(v);
    if (v === 'true') return true;
    if (v === 'false') return false;
    return v;
  }

  // ---------- Chargement ----------
  function setSource(id, state) { sources.set(id, state); changed(); }

  function load(id) {
    if (calcs.has(id)) return;
    var prev = sources.get(id);
    if (!prev || prev.status !== 'ok') setSource(id, { status: 'loading', data: prev ? prev.data : null });
    var custom = loaders.get(id);
    var p = custom ? Promise.resolve().then(function () { return custom(id); }).then(function (rows) {
      return rows == null ? { status: 'missing', data: null } : { status: 'ok', data: Array.isArray(rows) ? rows : [rows] };
    }) : fetchSource(id);
    return p.then(function (st) { setSource(id, st); }, function (e) {
      console.error('[dash] Jeu « ' + id + ' » illisible :', e);
      setSource(id, { status: 'error', data: null, error: String(e && e.message || e) });
    });
  }

  // Manifeste data/index.json (écrit par build.mjs) : { jeux: { joueurs: 'joueurs.json', bilan: 'bilan.csv', … } }.
  // Il évite de sonder <nom>.json avant <nom>.csv (et donc des 404 dans la console). Sans manifeste : sondage.
  var manifest = null;
  function getManifest() {
    if (!manifest) manifest = fetch(BASE + 'index.json', { cache: 'no-cache' })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (m) { return m && m.jeux ? m : null; }, function () { return null; });
    return manifest;
  }
  function fetchFile(file) {
    return fetch(BASE + file, { cache: 'no-cache' }).then(function (r) {
      if (r.status === 404) return { status: 'missing', data: null };
      if (!r.ok) throw new Error('HTTP ' + r.status + ' sur ' + file);
      return r.text().then(function (t) {
        if (/\.csv$/i.test(file)) return { status: 'ok', data: parseCsv(t) };
        var d = JSON.parse(t);
        return { status: 'ok', data: Array.isArray(d) ? d : d == null ? [] : [d] };
      });
    });
  }
  function fetchSource(id) {
    return getManifest().then(function (m) {
      if (!m) return probeSource(id);
      var file = Object.prototype.hasOwnProperty.call(m.jeux, id) ? m.jeux[id] : null;
      return file ? fetchFile(file) : { status: 'missing', data: null };
    });
  }
  function probeSource(id) {
    var url = BASE + encodeURIComponent(id);
    return fetch(url + '.json', { cache: 'no-cache' }).then(function (r) {
      if (r.ok) return r.text().then(function (t) {
        var d = JSON.parse(t);
        return { status: 'ok', data: Array.isArray(d) ? d : d == null ? [] : [d] };
      });
      if (r.status !== 404) throw new Error('HTTP ' + r.status + ' sur ' + id + '.json');
      return fetch(url + '.csv', { cache: 'no-cache' }).then(function (r2) {
        if (r2.ok) return r2.text().then(function (t) { return { status: 'ok', data: parseCsv(t) }; });
        if (r2.status === 404) return { status: 'missing', data: null };
        throw new Error('HTTP ' + r2.status + ' sur ' + id + '.csv');
      });
    });
  }

  // ---------- Calculs ----------
  function calcState(id, stack) {
    if (calcCache.has(id)) return calcCache.get(id);
    var c = calcs.get(id);
    if (stack.indexOf(id) >= 0) return { status: 'error', data: null, error: 'Calcul circulaire : ' + stack.concat(id).join(' → ') };
    var ins = (c.inputs || []).map(function (i) { return stateOf(i, stack.concat(id)); });
    var st;
    var bad = ins.filter(function (s) { return s.status === 'error'; })[0];
    if (bad) st = { status: 'error', data: null, error: bad.error || 'Entrée en erreur' };
    else if (ins.some(function (s) { return s.status === 'missing'; })) st = { status: 'missing', data: null };
    else if (ins.some(function (s) { return s.status !== 'ok'; })) st = { status: 'loading', data: null };
    else {
      try { st = { status: 'ok', data: c.fn.apply(null, ins.map(function (s) { return s.data; })) }; }
      catch (e) { console.error('[dash] Calcul « ' + id + ' » en erreur :', e); st = { status: 'error', data: null, error: String(e && e.message || e) }; }
    }
    calcCache.set(id, st);
    return st;
  }

  function stateOf(id, stack) {
    if (calcs.has(id)) return calcState(id, stack || []);
    var s = sources.get(id);
    if (!s) { if (started) load(id); else sources.set(id, { status: 'loading', data: null }); s = sources.get(id); }
    return s;
  }

  // ---------- Notifications (regroupées) ----------
  var pending = false;
  function changed() {
    version++; calcCache.clear();
    if (pending) return;
    pending = true;
    setTimeout(function () {
      pending = false;
      listeners.slice().forEach(function (fn) {
        try { fn(api); } catch (e) { console.error('[dash] Erreur dans onData :', e); }
      });
    }, 0);
  }

  // ---------- Paramètres et liens ----------
  function readParams() { var o = {}; new URLSearchParams(location.search).forEach(function (v, k) { o[k] = v; }); return o; }
  function writeParams(o) {
    var u = new URL(location.href); u.search = '';
    Object.keys(o).forEach(function (k) { if (o[k] != null && o[k] !== '') u.searchParams.set(k, o[k]); });
    history.replaceState(history.state, '', u.toString());
  }

  var api = {
    data: function (id) { return stateOf(String(id)); },
    onData: function (fn) {
      listeners.push(fn);
      changed();
      return function () { listeners = listeners.filter(function (f) { return f !== fn; }); };
    },
    calc: function (id, spec) {
      calcs.set(String(id), spec || {});
      sources.delete(String(id));
      if (started) (spec.inputs || []).forEach(function (i) { stateOf(i); });
      changed();
      return api;
    },
    loader: function (id, fn) { loaders.set(String(id), fn); if (started) load(String(id)); return api; },
    get params() { return readParams(); },
    setParams: function (o) { var p = readParams(); Object.keys(o || {}).forEach(function (k) { p[k] = o[k]; }); writeParams(p); changed(); },
    resetParams: function () { writeParams({}); changed(); },
    setLink: function (id) {
      var u = new URL(location.href); u.hash = id ? String(id) : '';
      history.replaceState(history.state, '', u.toString());
    },
    get colors() { return PALETTES[isDark() ? 'dark' : 'light'].slice(); },
    refresh: function () { manifest = null; return Promise.all(Array.from(sources.keys()).map(load)); },
  };
  window.dash = api;

  // ---------- Démarrage : jeux cités par data-source et par les calculs ----------
  function start() {
    if (started) return;
    started = true;
    var ids = new Set();
    document.querySelectorAll('[data-source]').forEach(function (n) {
      n.getAttribute('data-source').split(/\s+/).filter(Boolean).forEach(function (x) { ids.add(x); });
    });
    calcs.forEach(function (c) { (c.inputs || []).forEach(function (x) { ids.add(x); }); });
    sources.forEach(function (_, id) { ids.add(id); });
    ids.forEach(function (id) { if (!calcs.has(id)) load(id); });
    if (location.protocol === 'file:') console.warn('[dash] Page ouverte en file:// : les jeux ne se chargent qu’à travers un serveur web (GitHub Pages ou serveur local).');
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
  else setTimeout(start, 0);

  // Changement de largeur (pas de hauteur : la barre d'adresse mobile ne doit pas tout redessiner)
  var lastW = window.innerWidth, rt = 0;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { if (window.innerWidth !== lastW) { lastW = window.innerWidth; changed(); } }, 150);
  });
  if (darkMq) {
    var onTheme = function () { changed(); };
    if (darkMq.addEventListener) darkMq.addEventListener('change', onTheme); else if (darkMq.addListener) darkMq.addListener(onTheme);
  }
})();
