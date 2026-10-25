// Résumé des compos à inscrire, séparé en football et NBA, à partir d'un dossier de données (10 jeux).
// Usage : node outils/resume-gw.mjs <dossier> [--sport FOOTBALL|NBA]  -> Markdown sur la sortie standard
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";

const dir = resolve(process.argv[2] || ".");
const i = process.argv.indexOf("--sport"); const seul = i > 0 ? process.argv[i + 1] : null;
const lire = async (n) => { try { return JSON.parse(await readFile(join(dir, n + ".json"), "utf8")); } catch { return []; } };
const [joueurs, compos, competitions, paliers, resume] = await Promise.all(["joueurs", "compos", "competitions", "paliers", "resume"].map(lire));
const J = new Map(joueurs.map((r) => [r.slug, r])); const parNom = new Map(joueurs.map((r) => [r.joueur, r]));
const R = resume[0] || {};
const fr = (s) => (s ? new Date(s).toLocaleString("fr-BE", { timeZone: "Europe/Brussels", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "?");
const n1 = (x) => (x == null ? "" : (Math.round(x * 10) / 10).toLocaleString("fr-BE"));
const doute = (r) => /GTD|questionable|day|doubt/i.test((r.blessure || "") + " " + (r.espn_statut || ""));
function risque(r, nba) {
  if (!r) return null;
  if (nba) {
    if (/^out/i.test(r.espn_statut || "")) return "Out (ESPN)";
    if (Number(r.matchs_gw) === 0) return "aucun match dans la gameweek";
    if (doute(r)) return (r.espn_statut || "incertain") + " (ESPN)";
    if (r.minutes_tendance === "en baisse") return "minutes en baisse";
    return null;
  }
  if (r.suspension) return r.suspension;
  if (r.blessure && !doute(r)) return "blessé : " + r.blessure;
  if (r.statut === "NOT_PLAYING" || r.statut === "RESERVE") return "non aligné";
  if (Number(r.matchs_gw) === 0) return "aucun match dans la gameweek";
  if (doute(r)) return "incertain : " + r.blessure;
  if (r.proba_titulaire != null && r.proba_titulaire < 60) return `titulaire à ${r.proba_titulaire} %`;
  return null;
}
// Ecart-type d'un joueur : variabilité de ses scores et risque de ne pas jouer (même formule que le dashboard)
function ecart(r, final, nba) {
  const p = Math.min(1, Math.max(0.05, r?.proba_titulaire == null ? 0.8 : r.proba_titulaire / 100));
  const cv = (r?.regularite == null ? 40 : r.regularite) / 100 * (nba ? 0.8 : 1);
  const proj = final / p;
  return Math.sqrt(p * (proj * cv) ** 2 + p * (1 - p) * proj ** 2);
}
const erf = (x) => { const t = 1 / (1 + 0.3275911 * Math.abs(x)); const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; };
const pAu = (m, s, t) => (s > 0 ? 0.5 * (1 - erf((t - m) / (s * Math.SQRT2))) : m >= t ? 1 : 0);

const out = [`# Compos à inscrire (données du ${fr(R.maj)})`, ""];
for (const sport of ["FOOTBALL", "NBA"]) {
  if (seul && seul !== sport) continue;
  const nba = sport === "NBA";
  const comps = competitions.filter((c) => (c.sport === "NBA") === nba).sort((a, b) => (a.rang ?? 9) - (b.rang ?? 9));
  const limite = nba ? R.limite_nba : R.limite_football;
  const reste = limite ? Date.parse(limite) - Date.now() : null;
  out.push(`## ${nba ? "NBA" : "Football"} : gameweek ${nba ? R.gw_nba || "?" : R.gw_football || "?"}`, "");
  out.push(`Date limite : ${fr(limite)}${reste != null ? (reste > 0 ? ` (dans ${Math.floor(reste / 36e5)} h)` : " (verrouillée)") : ""}.`, "");
  const alertes = [];
  for (const c of comps) {
    const lignes = compos.filter((l) => l.competition === c.competition);
    const nums = [...new Set(lignes.map((l) => l.numero))].sort((a, b) => a - b);
    out.push(`### ${c.competition} : ${nums.length} compo${nums.length > 1 ? "s" : ""} sur ${c.max_compos ?? "?"}`);
    if (nums.length < (c.max_compos || 0) && c.statut) out.push(`_${c.statut}_`);
    const pal = paliers.filter((p) => p.competition === c.competition).sort((a, b) => a.rang - b.rang);
    for (const n of nums) {
      const L = lignes.filter((l) => l.numero === n);
      const tot = L.reduce((s, l) => s + (l.score_final || 0), 0);
      const sd = Math.sqrt(L.reduce((s, l) => s + ecart(J.get(l.slug) || parNom.get(l.joueur), l.score_final || 0, nba) ** 2, 0));
      const etoiles = nba ? ` · ${L.reduce((s, l) => s + (l.etoiles || 0), 0)}★` : "";
      out.push("", `**Compo ${n}** : ${n1(tot)} pts attendus (10–90 % : ${n1(tot - 1.28 * sd)} à ${n1(tot + 1.28 * sd)})${etoiles}`);
      for (const l of L) {
        const r = J.get(l.slug) || parNom.get(l.joueur);
        const rq = risque(r, nba); if (rq) alertes.push(`${l.joueur} (${c.competition}, compo ${n}) : ${rq}`);
        out.push(`- ${nba ? "" : l.slot + " : "}${l.joueur}${l.capitaine ? " (capitaine)" : ""} · ${l.carte}${nba ? ` · ${l.etoiles}★` : ""} · ${l.adversaire || ""} · ${n1(l.score_final)} pts${rq ? ` · ⚠ ${rq}` : ""}`);
      }
      if (pal.length) {
        const avec = pal.map((p) => ({ ...p, pr: pAu(tot, sd, p.score) }));
        const sur = avec.filter((p) => p.pr >= 0.5).sort((a, b) => a.rang - b.rang)[0];
        const vise = sur ? avec.filter((p) => p.rang < sur.rang).sort((a, b) => b.rang - a.rang)[0] : avec.sort((a, b) => b.rang - a.rang)[0];
        const txt = (p) => `${p.type === "salon" ? p.rang + "e du salon" : "top " + p.rang} (${n1(p.score)} pts, ${p.recompense}) : ${Math.round(p.pr * 100)} %`;
        out.push(`Objectifs : ${[sur, vise].filter(Boolean).map(txt).join(" · ")}`);
      }
    }
    out.push("");
  }
  out.push(alertes.length ? "**Joueurs à surveiller avant la date limite :**\n" + alertes.map((a) => "- " + a).join("\n") : "Aucun joueur à risque dans les compos proposées.", "");
}
console.log(out.join("\n"));
