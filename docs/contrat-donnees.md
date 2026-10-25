# Contrat de données : collecte → modèle → dashboard

Version 4 (25/10/2026, orchestrateur) ; version 3 (25/10/2026, orchestrateur) ; version 2 (25/10/2026, agent `donnees`) ; version 1 (24/10/2026) relevée dans `core.mjs` et `dashboard/index.html` (v7).
Ce fichier fait foi. Toute colonne ajoutée, renommée ou supprimée est d'abord écrite ici,
avec la version et le nom de l'agent, puis implémentée. `outils/verifier.mjs` contrôle ce contrat.

## Conventions
- Sept jeux : `joueurs`, `compos`, `competitions`, `jours`, `changements`, `calibration`, `resume`.
  Stockés en JSON (`data/latest/<nom>.json`, GitHub) ou en CSV (assets du dashboard, `historique-dashboard/vN/donnees/`).
- Un jeu vide est un CSV avec seulement la ligne d'en-tête.
- Dates : ISO 8601 en UTC (`2026-10-25T18:00:00Z`) ; `match` est tronqué à 16 caractères (`2026-10-25T18:00`) ; `jour` = `AAAA-MM-JJ`.
- Valeur absente : `null` en JSON, cellule vide en CSV.
- Attention, deux écritures du sport coexistent (à garder telles quelles, le dashboard en dépend) :
  `joueurs.sport` = `FOOTBALL` | `NBA` ; `compos.sport` et `competitions.sport` = `Football` | `NBA`.
- Colonnes propres à un sport : elles sont **toujours présentes** mais valent `null` pour l'autre sport.

Légende du tableau : **F** football seulement, **N** NBA seulement, **F+N** les deux.

## joueurs (une ligne par joueur pertinent ; clé : `slug`)
| Colonne | Type | Sport | Contenu |
|---|---|---|---|
| joueur | texte | F+N | Nom affiché |
| slug | texte | F+N | Identifiant Sorare (unique) |
| sport | `FOOTBALL`/`NBA` | F+N | |
| modes | texte | F+N | Codes séparés par une espace : `NBA`, `JPL`, `SET` |
| club | texte | F+N | Club actuel |
| poste | texte | F | Gardien, Défenseur, Milieu, Attaquant ; vide en NBA |
| etoiles | nombre | N | 1 à 5 par demi-points |
| plancher_etoiles | nombre | N | Score de référence du niveau (0 à 50) |
| gain_etoiles | nombre | N | score_attendu − plancher_etoiles |
| gain_sorare | nombre | N | gainOnProjection Sorare |
| back_to_back | entier | N | Matchs de la GW joués le 2e soir d'affilée |
| espn_statut, espn_info, espn_retour | texte | N | Blessure ESPN (retour en `AAAA-MM-JJ`) |
| minutes_5 | nombre | N | Minutes moyennes sur 5 matchs (ESPN) |
| minutes_tendance | texte | N | `en baisse`, `stable`, `en hausse` ou vide |
| statut | texte | F | playingStatus Sorare (STARTER, REGULAR…) |
| blessure | texte | F+N | Blessures Sorare actives |
| suspension | texte | F | Suspensions actives |
| l5, l15 | nombre | F+N | Moyennes Sorare |
| l10 | nombre | N | Moyenne des 10 derniers matchs joués |
| forme10 | texte | F+N | 10 derniers scores, entiers séparés par une espace |
| minutes_moy | nombre | F+N | Football : moyenne Sorare ; NBA : = minutes_5 |
| part_decisive | nombre (%) | F | Part du score venant des actions décisives |
| regularite | nombre (%) | F+N | Coefficient de variation des scores |
| matchs_gw | entier | F+N | Matchs dans la gameweek |
| adversaire | texte | F+N | `vs X` (domicile) ou `@ X` (extérieur) |
| match | date | F+N | Prochain match retenu |
| adv_attaque_rang, adv_defense_rang, adv_nb_equipes | entier | F+N | Rangs ESPN de l'adversaire |
| adv_ligue | texte | F+N | Championnat de l'adversaire |
| adv_attaque_val, adv_defense_val | nombre | F+N | Buts ou points marqués / encaissés par match |
| competition_match | texte | F | Compétition du match |
| proba_victoire | nombre (%) | F+N | |
| proba_victoire_adv | nombre (%) | F | |
| clean_sheet | nombre (%) | F | |
| total_match | nombre | F+N | Buts attendus (F) ou ligne de points (N) |
| proba_titulaire | entier (%) | F+N | Football : titularisation ; NBA : probabilité de jouer |
| source_titulaire | texte | F | Origine de `proba_titulaire` : `cote Sorare` (footballPlayingStatusOdds du match retenu) ou `statut` (repli sur playingStatus, blessure ou suspension) ; `null` en NBA. Depuis la v2 |
| grade_sorare | texte | F | Note de projection Sorare |
| proj_sorare, proj_forme | nombre | F+N | Projection Sorare et forme (60 % L5 + 40 % L15) |
| score_attendu | nombre | F+N | Projection × probabilité de jouer (NBA : meilleur match de la GW) |
| carte, carte_label | texte | F+N | Meilleure carte (slug et libellé) |
| bonus | nombre (%) | F+N | Bonus de la carte |
| bonus_skin | nombre (%) | F | Bonus de skin (Set) |
| score_final | nombre | F+N | score_attendu × bonus de carte |
| nb_cartes | entier | F+N | Cartes possédées du joueur |
| proj_match | nombre | F+N | Projection moyenne par match de la gameweek (forme si aucun match) |
| matchs_probables | entier | N | Matchs de la GW avec une probabilité de jouer ≥ 50 % |
| coequipiers_absents | texte | N | Coéquipiers Out (ESPN) et leurs minutes habituelles (« rôle élargi ») |
| minutes_liberees | nombre | N | Somme des minutes de ces coéquipiers |

## matchs (calendrier : une ligne par joueur et par match ; clé : `slug` + `date`)
v4 : aussi des lignes **football** (`sport` = `Football`) pour les joueurs du Set, sur la période Arcade en cours (de la collecte à `resume.arcade_fin`) : `jour` = date à Bruxelles, `proba` = probabilité de titularisation, `proj` = projection du match ; `b2b`, `proba_victoire` et `total` selon disponibilité.
Jeu en plus des sept ci-dessus, écrit par compos.mjs (section 12). NBA seulement pour l'instant.

| Colonne | Type | Sport | Contenu |
|---|---|---|---|
| sport | `NBA` | N | |
| slug, joueur | texte | N | Joueur (doit exister dans `joueurs.slug`) |
| date | date | N | Coup d'envoi, tronqué à 16 caractères |
| jour | `AAAA-MM-JJ` | N | Soirée américaine (date UTC − 5 h) |
| adversaire | texte | N | `vs X` ou `@ X` |
| proj | nombre | N | Projection du match |
| proba | entier (%) | N | Probabilité de jouer ce match |
| b2b | booléen | N | 2e soir d'affilée |
| adv_attaque_rang, adv_defense_rang, adv_nb_equipes | entier | N | Rangs ESPN de l'adversaire |
| proba_victoire | nombre (%) | N | Probabilité de victoire de l'équipe du joueur (The Odds API, moyenne des bookmakers sans marge) ; `null` si pas de cote. Depuis la v2 |
| total | nombre | N | Ligne de points du match (over/under le plus proposé) ; `null` si pas de cote. Depuis la v2 |

Les bookmakers ne publient les cotes NBA qu'environ 24 h avant le match : `proba_victoire` et `total` ne sont remplis
que pour les matchs du lendemain au moment de la collecte (collecte du jour de la date limite conseillée).

## compos (une ligne par joueur aligné ; clé : `competition` + `numero` + `slot`)
| Colonne | Type | Sport | Contenu |
|---|---|---|---|
| competition | texte | F+N | Doit exister dans `competitions.competition` |
| sport | `Football`/`NBA` | F+N | |
| numero | entier ≥ 1 | F+N | Numéro de la compo dans la compétition |
| slot | texte | F+N | F : Gardien, Défenseur, Milieu, Attaquant, Extra ; N : Joueur 1 à Joueur 5 |
| joueur | texte | F+N | |
| carte | texte | F+N | Libellé de la carte (ex. `Limited 2025 In-Season`) |
| capitaine | `Oui`/vide | F | Toujours vide en NBA |
| score_attendu, score_final | nombre | F+N | |
| gain_etoiles, etoiles | nombre | N | |
| bonus | nombre (%) | F+N | |
| moyenne_cap | nombre | F | L15 du joueur, seulement dans les compétitions à plafond (Cap 260) |
| adversaire, match | texte, date | F+N | |
| adv_attaque_rang, adv_defense_rang, adv_nb_equipes | entier | F+N | |
| slug, carte_id | texte | F+N | Joueur et carte exacte (contrôle « une carte par compo ») |

## competitions (une ligne par compétition ; clé : `competition`)
| Colonne | Type | Contenu |
|---|---|---|
| competition, slug | texte | Nom affiché et slug Sorare |
| sport | `Football`/`NBA` | |
| date_limite | date | Fermeture des inscriptions |
| joueurs_eligibles | entier | Avant la 1re compo |
| contraintes | texte | Lu par le vérificateur : `somme des étoiles ≤ N`, `somme des moyennes ≤ N`, `min N cartes In-Season`, `max N par équipe`, `capitaine +N %` |
| max_compos, nb_compos | entier | Compos possibles et proposées (nb_compos ≤ max_compos) |
| scores_compos | texte | Scores des compos séparés par une espace |
| score_compo | nombre | Score de la compo 1 |
| statut | texte | Avec la raison si nb_compos < max_compos |
| regles | texte | Règles Sorare lues dans l'API |
| type | `NBA`/`JPL`/`SET` | Famille de compétition |
| rang | entier | Ordre de priorité d'affectation des cartes (dans le sport) |
| cap_points, cap_etoiles, min_in_season, max_par_club, capitaine_pct | nombre | Règles numériques lues dans `displayedTypedRules` (null si absentes) |
| cout_inscription | entier | v3. Essences Limited à payer par compo (Rooms NBA : 150) ; 0 sinon |
| gains_esperes | texte | v3. Gain espéré de chaque compo, en essences Limited, séparé par une espace et aligné sur `scores_compos`. Seules les récompenses en essences comptent ; probabilité d'atteindre chaque palier = loi normale (moyenne = score de la compo, écart-type = celui de la fourchette 10–90 %). Vide si aucun palier connu |
| gain_net_espere | nombre | v3. Somme de `gains_esperes` − `cout_inscription` × `nb_compos` (essences Limited) ; null si aucun palier |
| autres_recompenses | texte | v3. Chances des récompenses hors essences (ex. « 9 % d'au moins 25 $ ; 2 % d'une carte Limited 5★ ») ; vide sinon |
| rentable | `oui`/`non`/vide | v3. `non` si le gain espéré d'une compo est inférieur à son coût d'inscription ; vide si pas de coût ou pas de palier |
| recommandation | texte | v3. Décision en une phrase (« Inscrire les 2 compos », « Ne pas inscrire la compo 2 : 120 essences espérées pour 150 payées », « Jouer In-Season : +X essences espérées par rapport à l'option sans In-Season ») |
| alternative | texte | v3. NBA In-Season : comparaison chiffrée avec l'option où les cartes In-Season restent en Classic / Rooms (points et essences espérées) ; vide sinon |

## bilan (v3 ; une ligne par compo proposée lors de la dernière gameweek terminée ; clé : `sport` + `competition` + `numero` + `gw`)
| Colonne | Type | Sport | Contenu |
|---|---|---|---|
| sport | `Football`/`NBA` | F+N | |
| gw | texte | F+N | Slug de la gameweek terminée |
| competition, numero | texte, entier | F+N | Compo telle que proposée avant la date limite |
| score_prevu, score_reel | nombre | F+N | Score attendu proposé ; score réel calculé avec les vrais scores des joueurs (NBA : meilleur match de la GW ; football : capitaine compris) |
| ecart | nombre | F+N | score_reel − score_prevu |
| palier_vise, palier_atteint | texte | F+N | Meilleur palier que la compo avait plus de 50 % de chances d'atteindre ; palier réellement atteint avec score_reel (classement de cette gameweek) |
| joueurs | texte | F+N | « Nom prévu→réel » séparés par « ; » |
| source_compos | texte | F+N | Dossier de collecte dont viennent les compos (dernière collecte avant la date limite) |
Vide (CSV d'en-tête) tant qu'aucune gameweek proposée n'est terminée.

## cartes (une ligne par carte utilisable ; clé : `carte_id`)
| Colonne | Type | Contenu |
|---|---|---|
| sport | `Football`/`NBA` | |
| slug, joueur | texte | Joueur |
| carte_id, label | texte | Carte Sorare et libellé (ex. « Limited 2026 In-Season ») |
| rarete | texte | limited, rare, common… |
| saison | entier | |
| puissance, skin | nombre | Bonus de carte (×) et de skin (×) |
| in_season, set_courant | booléen | |

## paliers (scores réels des récompenses lors de la dernière gameweek terminée ; clé : `competition` + `rang`)
| Colonne | Type | Contenu |
|---|---|---|
| sport, competition | texte | |
| gw_reference | texte | Gameweek mesurée (salons : « … (médiane de N salons) ») |
| type | `classement`/`salon` | |
| rang, score | entier, nombre | Score du N-ième (salon : médiane du N-ième des salons de 10) |
| recompense | texte | Libellé de la récompense |
| participants | entier | Compos inscrites (salon : 10) |

Formats du jeu `bilan` : `palier_vise` / `palier_atteint` = « top N : récompense », « Ne du salon : récompense » ou « aucun palier » ; `joueurs` = « Nom (C) prévu→réel » séparés par « ; » (virgule décimale).

## plan_arcade (v4 ; plan de piste du mode Set / Arcade, football ; clé : `depart` + `etape` + `compo`)
Plans calculés pour chaque palier de départ possible (l'utilisateur indique le sien dans la page ; la progression n'est pas lisible dans l'API).
| Colonne | Type | Contenu |
|---|---|---|
| depart | entier 1-6 | Palier où se trouve l'utilisateur au moment du plan |
| etape | entier ≥ 1 | Ordre de la tentative dans le plan |
| palier, seuil | entier, nombre | Palier visé et son seuil (260, 300, 360, 400, 440, 480) |
| creneau | date | Premier coup d'envoi des joueurs du lot |
| resultat_vers | date | Dernier coup d'envoi du lot + 1h50 (marge choisie par l'utilisateur) : heure à partir de laquelle l'étape suivante peut être jouée |
| compo | entier 1-4 | Compo du lot (4 vies = 4 compos en même temps) |
| joueurs | texte | « Poste Nom (club, heure) score » séparés par « ; » |
| score_attendu | nombre | Score attendu de la compo |
| proba_compo | nombre (%) | Chance que cette compo dépasse le seuil |
| proba_palier | nombre (%) | Chance qu'au moins une compo du lot dépasse le seuil (même valeur sur les lignes du lot) |
| conseil | texte | Phrase courte (« Jouer 4 compos dès 15h00 : rien à perdre au palier 1 », « Attendre le créneau de 18h30 : 61 % au lieu de 38 % ») |
Vide (CSV d'en-tête) si aucun joueur du Set ne joue avant la fin de la période Arcade.

## jours (top 5 par mode et par jour ; clé : `mode` + `jour` + `rang`)
mode (`NBA`, `Jupiler` ou `Set <nom du set>`), jour, rang (1 à 5), joueur, poste (vide en NBA), adversaire, match,
score_attendu, adv_attaque_rang, adv_defense_rang, adv_nb_equipes.

## changements (clé : `joueur` + `type`)
joueur, modes, type (`Nouvelle blessure`, `Retour de blessure`, `Suspension`, `Statut modifié`,
`Projection en hausse`, `Projection en baisse`), detail. Le sport se déduit de `modes` (contient `NBA` → NBA).

## calibration (une ligne par date et sport)
date, sport (`FOOTBALL`/`NBA`), matchs, erreur_modele, erreur_sorare, erreur_forme, poids_sorare (0 à 1).

## resume (une seule ligne)
v4 : ajoute `arcade_debut`, `arcade_fin` (fenêtre de la gameweek football en cours, `so5Fixture(type: LIVE)`, pendant laquelle se joue l'Arcade / Set).
v3 : ajoute `gw_debut_football`, `gw_fin_football`, `gw_debut_nba`, `gw_fin_nba` (dates ISO de la fenêtre de chaque gameweek, lues dans `so5Fixture.startDate` / `endDate`).

maj, cartes, joueurs, set, gw_football, gw_nba, limite_football, limite_nba, poids_sorare, cotes_externes (`oui`/`non`), appels_api.

## Calculs du dashboard (ne pas fournir, calculés par la page)
- `nb_changements` : {sport, n} depuis `changements`.
- `nb_compos` : {sport, n} = somme de `competitions.nb_compos` par sport.
- `gain_net` : somme de `competitions.gain_net_espere` par sport.
- `kpi_mode` : {cle = SPORT-MODE (ex. FOOTBALL-SET), compos, gain net} pour les chiffres clés des sous-onglets Pro / Set (v13).
- `bilan_synthese` : une ligne par sport et par sous-onglet (`cle`), écart moyen, paliers atteints, total prévu → réel.
- `progression_l10` : L10 estimée après la gameweek (NBA).

## Évolutions proposées (à valider par l'utilisateur)
- (fait en v3 : `compos.carte_id` remplace la proposition `carte_slug` ; le club se lit dans `joueurs` via `slug`.)
- `joueurs.dernier_club` (champ Sorare `lastClub`) pour les joueurs NBA libres : à valider.

## Journal du contrat
| Version | Date | Agent | Changement |
|---|---|---|---|
| 1 | 24/10/2026 | orchestrateur | Relevé initial depuis la v7 |
| 2 | 25/10/2026 | donnees | `joueurs.source_titulaire` (F) ; jeu `matchs` décrit, avec `proba_victoire` et `total` par match (N) |
| 4 | 25/10/2026 | orchestrateur | `matchs` étendu au football (Set) ; `resume.arcade_debut` / `arcade_fin` ; nouveau jeu `plan_arcade` |
| 3 | 25/10/2026 | orchestrateur | Colonnes déjà produites ajoutées (joueurs, compos, competitions) ; jeux `cartes` et `paliers` décrits ; `competitions` : cout_inscription, gains_esperes, gain_net_espere, autres_recompenses, rentable, recommandation, alternative ; nouveau jeu `bilan` ; `resume` : fenêtres des gameweeks |
