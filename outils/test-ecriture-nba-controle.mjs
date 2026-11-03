// Contrôle hors ligne du test d'écriture Set NBA (outils/test-ecriture-nba.mjs) : NBA seulement, aucun réseau, aucune clé.
//  1. Recherche dans le code du projet : une seule écriture GraphQL, dans test-ecriture-nba.mjs, et uniquement upsertStepLineup ;
//     aucune dans garde-nuit-nba.mjs ni ailleurs. Les motifs sont assemblés ici pour que ce fichier ne se signale pas lui-même.
//  2. Comportement avec une API simulée : confirmation, refus sans compo sûre, renvoi identique, erreurs, relecture différente.
// Usage : node outils/test-ecriture-nba-controle.mjs
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { executer, ECRITURE, CONFIRMATION_ATTENDUE } from "./test-ecriture-nba.mjs";

let ko = 0;
const ok = (cond, msg) => { if (!cond) { ko++; console.log("ECHEC :", msg); } else console.log("ok   :", msg); };
const RACINE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CE_FICHIER = path.join("outils", "test-ecriture-nba-controle.mjs"), SEUL = path.join("outils", "test-ecriture-nba.mjs");

// ---------- 1. Recherche dans le code ----------
const MOT = new RegExp("\\b" + "muta" + "tion\\b", "gi");
const OPERATIONS = new RegExp(["upsert" + "StepLineup", "claim" + "Step", "claim" + "Rewards", "claim" + "Reward", "upsert" + "So5Lineup", "upsert" + "TaskAppearances", "create" + "JwtToken", "sign" + "In"].map((x) => `\\b${x}\\b`).join("|"), "g");
const EXT = /\.(mjs|cjs|js|ts|yml|yaml|sh|py|html)$/;
const fichiers = [];
const parcourir = (d) => { if (!fs.existsSync(d)) return; for (const e of fs.readdirSync(d, { withFileTypes: true })) {
  if (["node_modules", "dist", ".git"].includes(e.name)) continue;
  const p = path.join(d, e.name);
  if (e.isDirectory()) parcourir(p); else if (EXT.test(e.name)) fichiers.push(path.relative(RACINE, p));
} };
for (const d of ["outils", "sorare-compos", ".github", "site"]) parcourir(path.join(RACINE, d));
const avecEcriture = fichiers.filter((f) => f !== CE_FICHIER && (MOT.test(fs.readFileSync(path.join(RACINE, f), "utf8")) | (MOT.lastIndex = 0)));
ok(avecEcriture.length === 1 && avecEcriture[0] === SEUL, `une seule écriture GraphQL dans le code (${fichiers.length} fichiers lus) : ${avecEcriture.join(", ") || "aucune"}`);
const autresOps = fichiers.filter((f) => f !== CE_FICHIER && f !== SEUL && OPERATIONS.test(fs.readFileSync(path.join(RACINE, f), "utf8")) | (OPERATIONS.lastIndex = 0));
ok(!autresOps.length, `aucune opération d'écriture Sorare nommée ailleurs : ${autresOps.join(", ") || "aucune"}`);
const garde = fs.readFileSync(path.join(RACINE, "outils", "garde-nuit-nba.mjs"), "utf8");
ok(!new RegExp("muta" + "tion", "i").test(garde) && !OPERATIONS.test(garde), "garde-nuit-nba.mjs : aucune écriture"); OPERATIONS.lastIndex = 0;
const src = fs.readFileSync(path.join(RACINE, SEUL), "utf8");
ok((src.match(MOT) || []).length === 1, "test-ecriture-nba.mjs : le mot-clé d'écriture n'apparaît qu'une fois (constante ECRITURE)");
ok(!/creerClientSorare/.test(src), "test-ecriture-nba.mjs n'utilise pas le client query-only");
// Champs racine du document d'écriture : exactement un, upsertStepLineup
const racine = (doc) => { const i = doc.indexOf("{"); let prof = 0, mot = "", champs = [];
  for (const ch of doc.slice(i)) { if (ch === "{") { if (prof === 1 && mot) champs.push(mot); prof++; mot = ""; } else if (ch === "}") { if (prof === 2) mot = ""; prof--; }
    else if (prof === 1) { if (/[A-Za-z_]/.test(ch)) mot += ch; else if (mot) { if (!champs.includes(mot) && !/^(input)$/.test(mot)) champs.push(mot); mot = ""; } } }
  return [...new Set(champs)].filter((c) => c !== "input"); };
ok(JSON.stringify(racine(ECRITURE)) === JSON.stringify(["upsertStepLineup"]) && /^\s*mutation\s+\w+\(\$input: upsertStepLineupInput!\)/.test(ECRITURE),
  `document d'écriture : un seul champ racine, upsertStepLineup (${racine(ECRITURE).join(", ")})`);
const yml = fs.readFileSync(path.join(RACINE, ".github", "workflows", "test-ecriture-nba.yml"), "utf8");
ok(/workflow_dispatch/.test(yml) && !/^\s*(schedule|push|pull_request|pull_request_target|workflow_call|workflow_run|repository_dispatch)\s*:|^\s*-\s*cron\s*:/m.test(yml) && /contents: read/.test(yml) && /::add-mask::\$SORARE_JWT/.test(yml) && /RENVOYER-A-L-IDENTIQUE/.test(yml),
  "workflow : manuel seulement (aucun cron), contents: read, jeton masqué, confirmation vérifiée");

// ---------- 2. Comportement (API simulée) ----------
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "test-ecriture-"));
const SECRET = "jeton-de-test-ne-doit-pas-sortir";
const T0 = "2026-11-04T23:00:00Z";
const app = (i, s, nom, date, gid) => ({ index: i, locked: false, anyCard: { slug: `${s}-carte` }, anyPlayer: { displayName: nom }, game: { id: gid, date, statusTyped: "scheduled" } });
const NOMS = ["Alpha Un", "Beta Deux", "Gamma Trois", "Delta Quatre", "Epsilon Cinq"];
const compo = (id, date, decal = 0) => ({ __typename: "TaskLineup", id, aasmState: "READY", draft: false, cancelledAt: null, updatable: true,
  taskAppearances: NOMS.map((n, i) => app((i + decal) % 5, `${id}-${i}`, n, date, `game-${i}`)) });
function plateauType({ commence = false } = {}) {
  return { id: "board", steps: [
    { id: "s1", level: 1, target: 150, state: "CLAIMED", myLineups: [{ ...compo("L0", "2026-11-04T01:00:00Z"), aasmState: "SUCCESSFUL", updatable: false }] },
    { id: "s2", level: 2, target: 180, state: "LINEUP_SET", myLineups: [compo("L1", commence ? "2026-11-04T22:30:00Z" : "2026-11-05T00:30:00Z", 2), compo("L2", "2026-11-04T23:20:00Z")] }] };
}
const reponse = (obj) => ({ ok: true, status: 200, json: async () => obj });
function api({ plateau, erreursEcriture = [], modifierApres = false, panneEcriture = false }) {
  const corps = [];
  let p = JSON.parse(JSON.stringify(plateau));
  const fetchFn = async (_url, opts) => {
    const b = JSON.parse(opts.body); corps.push({ ...b, auth: opts.headers.Authorization });
    if (/^\s*query/.test(b.query)) return reponse({ data: { currentUser: { slug: "elpredatooor", setBoard: p } } });
    if (panneEcriture) throw new Error("réseau coupé");
    if (modifierApres) p.steps[1].myLineups[0].taskAppearances[0].anyCard.slug = "autre-carte";
    return reponse({ data: { upsertStepLineup: { errors: erreursEcriture } } });
  };
  return { fetchFn, corps };
}
const lancer = async (nom, env, a) => {
  const S = path.join(tmp, nom), cons = [];
  const r = await executer({ env: { SORARE_JWT: SECRET, SORARE_API_KEY: "cle-secrete-test", SORTIE: S, GITHUB_STEP_SUMMARY: path.join(S + "-resume.md"), ...env },
    fetchFn: a.fetchFn, horloge: () => new Date(T0), attente: async () => {}, sortieConsole: (l) => cons.push(l) });
  const pub = [fs.readFileSync(path.join(S, "journal.txt"), "utf8"), cons.join("\n"), fs.existsSync(S + "-resume.md") ? fs.readFileSync(S + "-resume.md", "utf8") : ""].join("\n");
  return { r, pub, rapport: fs.readFileSync(path.join(S, "rapport.md"), "utf8") };
};
const ecritures = (corps) => corps.filter((b) => !/^\s*query/.test(b.query));
const sansNoms = (t) => !NOMS.some((n) => t.includes(n)) && !/-carte\b/.test(t) && !t.includes(SECRET) && !t.includes("cle-secrete-test");

// a. Confirmation absente, incorrecte ou approchante : aucun appel
for (const conf of [undefined, "", "renvoyer-a-l-identique", "RENVOYER-A-L-IDENTIQUE ", "OUI"]) {
  const a = api({ plateau: plateauType() });
  const { r } = await lancer("conf" + String(conf).length, conf === undefined ? {} : { CONFIRMATION: conf }, a);
  ok(r.statut === "refus" && a.corps.length === 0, `confirmation « ${conf ?? "(absente)"} » : arrêt, 0 appel`);
}
// b. Sans jeton : aucun appel
{ const a = api({ plateau: plateauType() }); const { r } = await lancer("sansjeton", { CONFIRMATION: CONFIRMATION_ATTENDUE, SORARE_JWT: "" }, a);
  ok(r.statut === "refus" && a.corps.length === 0, "jeton absent : arrêt, 0 appel"); }
// c. Succès : une seule écriture, strictement identique, compo la plus éloignée de son premier match
{ const a = api({ plateau: plateauType() });
  const { r, pub, rapport } = await lancer("succes", { CONFIRMATION: CONFIRMATION_ATTENDUE }, a);
  const w = ecritures(a.corps);
  const attendu = plateauType().steps[1].myLineups[0].taskAppearances.slice().sort((x, y) => x.index - y.index).map((x) => ({ index: x.index, cardSlug: x.anyCard.slug, gameId: x.game.id }));
  ok(r.statut === "succes" && a.corps.length === 3 && w.length === 1, `succès : 3 appels dont 1 écriture (${r.statut}, ${a.corps.length}, ${w.length})`);
  ok(w[0]?.variables.input.stepId === "s2" && w[0]?.variables.input.lineupId === "L1" && JSON.stringify(w[0]?.variables.input.appearances) === JSON.stringify(attendu)
    && Object.keys(w[0]?.variables.input).sort().join() === "appearances,lineupId,stepId" && w[0].variables.input.appearances.every((x) => !("captain" in x)),
    "écriture : même étape, même compo (L1, premier match le plus lointain), mêmes index, cartes et matchs, sans capitaine");
  ok(sansNoms(pub) && /SUCCÈS/.test(pub) && /Alpha Un/.test(rapport), "journal et résumé publics sans nom, carte ni secret ; noms dans le compte rendu (artifact)"); }
// d. Seule compo modifiable dont un match a commencé ou commence dans < 5 min : aucune écriture
{ const p = plateauType({ commence: true }); p.steps[1].myLineups[1].taskAppearances[0].game.date = "2026-11-04T23:03:00Z";
  const a = api({ plateau: p }); const { r } = await lancer("commence", { CONFIRMATION: CONFIRMATION_ATTENDUE }, a);
  ok(r.statut === "refus" && a.corps.length === 1 && !ecritures(a.corps).length, "matchs commencés ou dans moins de 5 min : arrêt après la lecture, aucune écriture"); }
// e. Erreurs renvoyées par Sorare : échec, erreurs affichées sans les cartes
{ const a = api({ plateau: plateauType(), erreursEcriture: [{ code: 422, message: "Card L1-0-carte is not eligible", path: ["appearances", "0"] }] });
  const { r, pub } = await lancer("erreurs", { CONFIRMATION: CONFIRMATION_ATTENDUE }, a);
  ok(r.statut === "echec" && /\[422\] Card carte n°\d is not eligible \(appearances\.0\)/.test(pub) && sansNoms(pub), "erreurs de l'écriture : échec, affichées (code, message, chemin) sans le cardSlug"); }
// f. Relecture différente : échec
{ const a = api({ plateau: plateauType(), modifierApres: true }); const { r, pub } = await lancer("difference", { CONFIRMATION: CONFIRMATION_ATTENDUE }, a);
  ok(r.statut === "echec" && /DIFFÉRENTS/.test(pub), "relecture différente : échec signalé"); }
// g. Panne réseau pendant l'écriture : aucune reprise
{ const a = api({ plateau: plateauType(), panneEcriture: true }); const { r } = await lancer("panne", { CONFIRMATION: CONFIRMATION_ATTENDUE }, a);
  ok(r.statut === "echec" && ecritures(a.corps).length === 1, "panne pendant l'écriture : une seule tentative, pas de reprise"); }

if (!process.env.GARDER) fs.rmSync(tmp, { recursive: true, force: true });
console.log(ko ? `${ko} ECHEC(S)` : "OK");
process.exit(ko ? 1 : 0);
