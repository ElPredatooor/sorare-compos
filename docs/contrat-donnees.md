# Contrat de données : collecte → modèle → dashboard

Version 8 (02/11/2026, orchestrateur : priorité des compétitions NBA) ; version 7 (02/11/2026, orchestrateur) ; version 6 (02/11/2026, agent `donnees`) ; version 5 (25/10/2026, orchestrateur) ; version 4 (25/10/2026, orchestrateur) ; version 3 (25/10/2026, orchestrateur) ; version 2 (25/10/2026, agent `donnees`) ; version 1 (24/10/2026) relevée dans `core.mjs` et `dashboard/index.html` (v7).
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
| modes | texte | F+N | Codes séparés par une espace : `NBA`, `JPL`, `SET`. v7 (02/11/2026, séparation Pro / Set) : `NBA` = le joueur a au moins une carte NBA **Limited ou plus rare** (vue Pro NBA) ; `JPL` = joueur d'un club de Jupiler Pro League **avec au moins une carte Limited ou plus rare** ; `SET` = au moins une Common **du set en cours de son sport**. Un joueur qui n'a que des Common n'a donc ni `NBA` ni `JPL` ; un joueur sans Common du set en cours n'a pas `SET` ; un joueur qui n'a que des Common d'un ancien set a `modes` vide et n'est dans aucune vue. Le sport se lit dans `sport`, jamais dans `modes` |
| club | texte | F+N | Club actuel |
| poste | texte | F | Gardien, Défenseur, Milieu, Attaquant ; vide en NBA. Depuis le 25/10/2026 (v5) : poste de la carte (`Card.anyPositions`) de la saison la plus récente, `Player.position` seulement en repli (le poste du joueur peut dater d'une ancienne saison : ex. Guilherme Smith, milieu chez le joueur, attaquant sur sa carte 2026) |
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
v5 : lignes football aussi pour les joueurs Limited (et plus) dont le match de Ligue Europa / Conference League tombe dans la période `europe_*` ; nouvelle colonne `competition_match` (F : nom de la compétition du match ; vide en NBA).
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
| rang | entier | Ordre de priorité d'affectation des cartes (dans le sport). v8 (N) : compétitions NBA Pro = position (1, 2, 3…) dans `sorare-compos/priorite-nba.json` (section « Priorité des compétitions NBA ») ; football inchangé |
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
| in_season, set_courant | booléen | v7 : `set_courant` vaut aussi pour les cartes Common NBA du set NBA en cours (`resume.set_nba`) |

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

## plan_arcade (v4 ; plans de piste football et NBA ; clé : `mode` + `depart` + `etape` + `compo`)
v7 (02/11/2026, set Divination) : `mode` = `arcade_nba` pour la piste Set NBA (cartes Common NBA du set NBA en cours ; règles plus bas). Les lignes `arcade_nba` sont des lignes **NBA** (fusion d'une collecte d'un seul sport, dashboard : vue NBA uniquement) ; `arcade` et `europe` restent football.
v5 : colonne `mode` = `arcade` (Set, cartes Common, seuils 260/300/360/400/440/480, sans capitaine) ou `europe` (Pro « European Contenders », cartes Limited et plus, matchs de Ligue Europa et Conference League, seuils 350/390/410/450/470/500, capitaine +50 % additif). Mêmes règles de piste : 4 compos par palier, un succès fait monter, 4 échecs ramènent au palier 1, récompense redonnée à chaque passage, 1h50 après le dernier coup d'envoi. Lignes sans `mode` = `arcade` (collectes v4). En mode `europe`, si aucune compo n'est possible, une seule ligne d'information : `etape` = 0, `compo` = 0, `joueurs` vide, raison dans `conseil` (ex. « aucun attaquant parmi tes cartes Limited… »).
Plans calculés pour chaque palier de départ possible (l'utilisateur indique le sien dans la page ; la progression n'est pas lisible dans l'API).
| Colonne | Type | Contenu |
|---|---|---|
| mode | `arcade`/`europe`/`arcade_nba` | v5 (v7 : `arcade_nba`). Piste concernée |
| depart | entier 1-6 | Palier où se trouve l'utilisateur au moment du plan |
| etape | entier ≥ 1 | Ordre de la tentative dans le plan |
| palier, seuil | entier, nombre | Palier visé et son seuil (260, 300, 360, 400, 440, 480) |
| creneau | date | Premier coup d'envoi des joueurs du lot |
| resultat_vers | date | Dernier coup d'envoi du lot + 1h50 (marge choisie par l'utilisateur) : heure à partir de laquelle l'étape suivante peut être jouée |
| compo | entier 1-4 | Compo du lot (4 vies = 4 compos en même temps) |
| joueurs | texte | « Poste Nom (club, heure) score » séparés par « ; ». `arcade_nba` : « Nom (équipe, heure, N★) score », N = étoiles du joueur (`joueurs.etoiles`), sans poste |
| score_attendu | nombre | Score attendu de la compo |
| proba_compo | nombre (%) | Chance que cette compo dépasse le seuil |
| proba_palier | nombre (%) | Chance qu'au moins une compo du lot dépasse le seuil (même valeur sur les lignes du lot) |
| conseil | texte | Phrase courte (« Jouer 4 compos dès 15h00 : rien à perdre au palier 1 », « Attendre le créneau de 18h30 : 61 % au lieu de 38 % ») |
Vide (CSV d'en-tête) si aucun joueur du Set ne joue avant la fin de la période Arcade.

**Piste Set NBA (`arcade_nba`, v7 ; utilisateur 02/11/2026 + aide Sorare « What is Sorare Set (NBA)? »)** : 6 paliers aux seuils **150, 180, 210, 240, 280, 300** (180 à 300 lus sur la piste de l'utilisateur, 150 donné par lui) ; 4 vies (4 compos par palier en même temps), un succès fait monter, 4 échecs ramènent au palier 1, récompense redonnée à chaque passage ; compo de **5 joueurs NBA sans poste** ; **une carte par compo** et une carte jouée ne resert plus (l'utilisateur aligne 3 cartes Dončić distinctes dans 3 compos) ; **plafond : somme des étoiles des 5 joueurs ≤ 16** et **au plus 4 joueurs d'une même équipe**, comme l'In-Season Champion NBA (étoiles = `joueurs.etoiles`, par demi-points ; correction de l'utilisateur du 02/11/2026 : pas de MVP, pas de plafond L10) ; pas de capitaine ; valeur d'une carte = score attendu × puissance × skin, comme l'Arcade football ; bonus de collection (jusqu'à 5 %) ignoré. Résultat : 3 h après le dernier entre-deux du lot (`ARCADE_NBA_DELAI`, valeur par défaut à faire confirmer par l'utilisateur). Période : gameweek NBA en cours (`resume.arcade_nba_debut` / `arcade_nba_fin`). Vide pour ce mode si aucune carte Common NBA ne joue dans la période.

## jours (top 5 par mode et par jour ; clé : `mode` + `jour` + `rang`)
mode (`NBA`, `Jupiler` ou `Set <nom du set>`), jour, rang (1 à 5), joueur, poste (vide en NBA), adversaire, match,
score_attendu, adv_attaque_rang, adv_defense_rang, adv_nb_equipes.
v7 : `NBA` et `Jupiler` = joueurs aux `modes` contenant `NBA` / `JPL` (Pro) ; `Set <nom>` = football, `modes` contenant `SET`. Modes non exclusifs : un joueur football mixte peut figurer dans `Jupiler` et dans `Set <nom>`. Pas de mode Set NBA dans `jours`.

## changements (clé : `joueur` + `type`)
joueur, modes, type (`Nouvelle blessure`, `Retour de blessure`, `Suspension`, `Statut modifié`,
`Projection en hausse`, `Projection en baisse`), detail. Le sport se déduit de `modes` (contient `NBA` → NBA).
v7 : ajoute `sport` (`FOOTBALL`/`NBA`, celui de `joueurs.sport`) et `slug` ; `modes` suit la définition v7 de `joueurs.modes`. Vue Pro = `modes` contient `NBA` ou `JPL` ; vue Set = `modes` contient `SET`. Un changement d'un joueur aux `modes` vides n'est pas produit.

## calibration (une ligne par date et sport)
date, sport (`FOOTBALL`/`NBA`), matchs, erreur_modele, erreur_sorare, erreur_forme, poids_sorare (0 à 1).

## resume (une seule ligne)
v7 : ajoute `set_nba` (nom du set Common NBA en cours, ex. « Divination » ; vide si aucune carte Common NBA), `arcade_nba_debut`, `arcade_nba_fin` (fenêtre de la gameweek NBA en cours, `so5Fixture(type: LIVE, sport: NBA)`, à défaut la gameweek à venir) : champs NBA pour la fusion d'un seul sport. `set` reste le set football. Set en cours d'un sport = le `cardSet` des Common de ce sport le plus récent (à défaut le plus fréquent) : les Common d'un ancien set (HyperGlitch, 194 cartes encore en galerie au 02/11) ne comptent plus.
v6 : ajoute `maj_football` (F) et `maj_nba` (N) : date ISO de la collecte dont viennent les lignes de ce sport. Collecte complète : les deux = `maj`. Collecte d'un seul sport (workflows manuels « Collecte NBA seule » / « Collecte football seule », `SPORT=nba|football`) : `maj` et `maj_<sport collecté>` = maintenant ; `maj_<autre sport>` et les champs de l'autre sport (football : `set`, `gw_football`, `limite_football`, `gw_debut_football`, `gw_fin_football`, `arcade_*`, `europe_*` ; NBA : `gw_nba`, `limite_nba`, `gw_debut_nba`, `gw_fin_nba`) sont repris de la collecte précédente (`maj_<autre>` vide s'il n'y en avait pas). Le bilan choisit ses archives d'après `maj_<sport>` (à défaut `maj`).
v5 : ajoute `europe_slug`, `europe_debut`, `europe_fin` (période de la compétition European Contenders en cours ou à venir ; vides si aucune).
v4 : ajoute `arcade_debut`, `arcade_fin` (fenêtre de la gameweek football en cours, `so5Fixture(type: LIVE)`, pendant laquelle se joue l'Arcade / Set).
v3 : ajoute `gw_debut_football`, `gw_fin_football`, `gw_debut_nba`, `gw_fin_nba` (dates ISO de la fenêtre de chaque gameweek, lues dans `so5Fixture.startDate` / `endDate`).

maj, cartes, joueurs, set, gw_football, gw_nba, limite_football, limite_nba, poids_sorare, cotes_externes (`oui`/`non`), appels_api.

## Collecte d'un seul sport (v6)
Tous les jeux de `data/latest/` et l'archive du jour (`data/archive/<date>/`) sont alors **fusionnés** : lignes du sport collecté = nouvelle collecte ; lignes de l'autre sport = collecte précédente, telles quelles (jeu sans ligne de l'autre sport : seulement le sport collecté). Sport d'une ligne : colonne `sport` ; `jours` : `mode` contient `NBA` ; `changements` : sport du joueur (à défaut `modes` contient `NBA`) ; `plan_arcade` : `mode` = `arcade_nba` → NBA, sinon football (v7). Colonnes et formats inchangés ; `resume` : voir v6 ci-dessus. `history.json` garde les échantillons et la calibration de l'autre sport.

## Priorité des compétitions NBA (v8, N ; demande de l'utilisateur du 02/11/2026)
Fichier `sorare-compos/priorite-nba.json` (projet local, recopié dans le dépôt GitHub par `outils/prepare-depot.sh`) :
`{ "ordre": ["NBA In-Season Champion", "NBA Classic Champion", "NBA Classic Contender", "NBA Rooms Champion"], "maj": "AAAA-MM-JJ", "note": "…" }`.
- `ordre` = noms des compétitions NBA Pro (`NBA_COMPS[].nom` de `collecte.mjs`), de la première servie à la dernière. L'ordre ci-dessus est l'ordre par défaut (celui d'avant la v8).
- Lu par les points d'entrée Node (`collect.mjs`, `outils/collecte-locale.mjs`) et passé à `collect({ prioriteNba })` → `calculeCompos` (contexte `prioriteNba`, tableau de noms). Absent, illisible, ou nom inconnu : ordre par défaut pour ce qui manque (compétitions absentes de `ordre` placées après, dans l'ordre par défaut), avec un message dans le journal de collecte ; jamais d'échec de la collecte. Collecteur navigateur : ordre par défaut.
- Effets : ordre d'affectation des cartes NBA (une carte ne sert qu'une fois), `competitions.rang`, textes « priorité N ». **In-Season Champion se place où l'utilisateur veut** et garde le choix A / B : option A = l'ordre du fichier, option B = le même ordre sans In-Season (cartes In-Season libres pour les autres). Football : aucun effet.
- Dashboard (vue NBA Pro) : l'ordre de la collecte se lit dans `competitions.rang`. L'utilisateur peut le changer sur la page (réglage enregistré dans son navigateur, `sx-reglages-v2`, champ `NBA.ordre`) : la page recalcule alors les compos NBA dans cet ordre. Pour que la collecte l'utilise, la page affiche l'ordre à recopier dans `priorite-nba.json` (l'utilisateur le donne à Claude). Le type Dashboard ne permet pas à la page d'écrire dans un fichier partagé.

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
| 8 | 02/11/2026 | orchestrateur | Priorité des compétitions NBA : fichier `sorare-compos/priorite-nba.json`, `competitions.rang` NBA = position dans ce fichier ; réglage de la page `NBA.ordre` |
| 7 | 02/11/2026 | orchestrateur | Séparation Pro / Set : `joueurs.modes` redéfini (NBA / JPL seulement avec une carte Limited+, SET seulement avec une Common du set en cours) ; `changements.sport` et `slug` ; `jours` modes non exclusifs. Set Divination football et NBA : `plan_arcade.mode` = `arcade_nba` (lignes NBA) ; `resume.set_nba`, `arcade_nba_debut`, `arcade_nba_fin` ; `cartes.set_courant` NBA ; fusion d'un seul sport selon `mode` |
| 6 | 02/11/2026 | donnees | `resume.maj_football` (F) / `resume.maj_nba` (N) ; collectes d'un seul sport fusionnées avec la précédente (section « Collecte d'un seul sport ») |
| 5 | 25/10/2026 | orchestrateur | `plan_arcade.mode` (arcade / europe) ; `resume.europe_*` ; `matchs` football Pro européen + `competition_match` |
| 4 | 25/10/2026 | orchestrateur | `matchs` étendu au football (Set) ; `resume.arcade_debut` / `arcade_fin` ; nouveau jeu `plan_arcade` |
| 3 | 25/10/2026 | orchestrateur | Colonnes déjà produites ajoutées (joueurs, compos, competitions) ; jeux `cartes` et `paliers` décrits ; `competitions` : cout_inscription, gains_esperes, gain_net_espere, autres_recompenses, rentable, recommandation, alternative ; nouveau jeu `bilan` ; `resume` : fenêtres des gameweeks |
