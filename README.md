# Compos Sorare d'Elpredatooor

Chaque matin (05:15 UTC), GitHub Actions collecte les données Sorare du compte `elpredatooor`
(football et NBA, lecture seule : aucun achat, aucune vente), calcule les projections et les compos conseillées,
puis publie un site public.

**Site : https://elpredatooor.github.io/sorare-compos/**

## Fonctionnement
- `.github/workflows/collecte.yml` : vérifie que l'API Sorare est joignable, lance la collecte
  (`sorare-compos/collect.mjs`), contrôle les données (`outils/verifier.mjs`), les enregistre dans `data/`,
  construit le site (`site/build.mjs`) et le déploie sur GitHub Pages. Si le contrôle trouve une erreur bloquante,
  rien n'est publié.
- `sorare-compos/` : collecte (API Sorare, ESPN, The Odds API), modèle de projection et calcul des compos.
- `data/latest/` : dernières données ; `data/archive/AAAA-MM-JJ/` : compos du jour, gardées 30 jours pour le bilan
  des gameweeks terminées ; `data/history.json` : projections passées et scores réels.
- `docs/contrat-donnees.md` : format des jeux de données.

## Lancer à la main
Onglet **Actions** > « Collecte Sorare quotidienne » > **Run workflow**.

Les clés API sont des secrets du dépôt (`SORARE_API_KEY`, `ODDS_API_KEY`) et ne figurent dans aucun fichier.
