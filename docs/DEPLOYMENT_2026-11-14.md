# Déploiement groupé uploads / passwordless — 14 novembre 2026

## Version et périmètre

Backend actif sur `lmpdf-dev` :
`f75d7b3f0aae3f5f285d0dbfe486d7080a961815`.
Intervention terminée le **14 novembre 2026 à 00:36, Europe/Paris**.

- [PR #11](https://github.com/LounaMaili/lmpdf/pull/11), uploads : merge commit
  `c7fe4635689257f81306930aad033d8cca5e0418`.
- [PR #12](https://github.com/LounaMaili/lmpdf/pull/12), politique passwordless :
  merge commit `f75d7b3f0aae3f5f285d0dbfe486d7080a961815`.
- Une seule recréation du backend, avec l'image
  `lmpdf-release-backend:f75d7b3f0aae3f5f285d0dbfe486d7080a961815`.
- Image validée et réellement exécutée :
  `sha256:beba53db3b217bdd22a583237e35f09f85ce742cadd87187576afa7407c39764`.
- Frontend, PostgreSQL et Vision conservés. L'image frontend reste celle de
  `3ecac12…` ; ces PR ne modifient pas son code.

Le preflight a vérifié les sauvegardes, l'environnement, les images, les données
et les montages. La comparaison Compose ne montrait qu'une différence :
`services.backend.image`. La commande a conservé le projet `lmpdf-git`,
`.env.prod`, l'override historique hors Git et l'override préparé, avec
`up -d --no-deps --no-build --pull never backend`.

## Preuves de validation

| Contrôle au SHA de fusion exact, sur Debian | Résultat / portée |
|---|---|
| Build API, Prisma generate et image production | OK, lockfile figé ; aucune migration. |
| Suites API | 213/213 : auth 72, paramètres 12, permissions 43, exports 25, chemins d'export 18, uploads 43. |
| Runtime production non root | 115/115 : réexécution de 72 tests auth et 43 uploads ; ce ne sont pas 115 cas indépendants supplémentaires. |
| PostgreSQL/API/Vision temporaires | 4/4 : PNG/PDF synthétiques, insertion réelle, lecture, droits et Vision ; contrôle des checksums et du décodage en mode 0600. |
| Compose développement / production | OK. |
| Après bascule active | Frontend et `/api/health` 200 ; PostgreSQL sain et accessible depuis l'API ; API → Vision health 200. |
| Protection HTTP après bascule | `/api/auth/auth-methods` 200 ; templates, drafts et réglages admin sans JWT : 401 attendu. |
| Données | Empreintes de la base complète et des 29 fichiers de référence inchangées ; 6 documents conservés, fichiers lisibles par l'utilisateur API. |
| Logs et stabilité | Aucune erreur critique ou d'authentification inattendue observée ; zéro redémarrage du nouveau backend pendant les contrôles. |

Les tests isolés ne constituent pas une recette navigateur authentifiée.
Les 17 tests autosave et les validations frontend historiques restent acquis ;
ils n'ont pas été présentés comme relancés lors de cette intervention API.
Aucun compte ni document de test n'a été créé sur l'instance active.

## Conteneurs et persistances

Identifiants Docker abrégés ; les IDs complets figurent dans le rapport privé.

| Service | Avant | Après |
|---|---|---|
| Backend | `f71dc770fb2e` | `a74a221d74b4` |
| Frontend | `3b6bf58e2e4a` | `3b6bf58e2e4a` |
| PostgreSQL | `59081cbdebc9` | `59081cbdebc9` |
| Vision | `08bd13b6220e` | `08bd13b6220e` |

| Volume préservé | Montage |
|---|---|
| `lmpdf-git_postgres-data` | PostgreSQL : `/var/lib/postgresql/data` |
| `lmpdf-git_uploads-data` | API : `/app/apps/api/uploads` ; Vision : `/uploads` |
| `lmpdf-git_admin-config` | API : `/app/apps/api/config` |

Le répertoire administrateur reste en 0700, UID 100 / GID 101.
`admin-settings.json` était absent avant et après la bascule : le volume est
monté mais aucune sauvegarde de réglages UI n'a été effectuée pour cette recette.
Les valeurs effectives proviennent des défauts et de l'environnement existant.
Le fichier doit être en 0600 lorsqu'il est créé par le mécanisme de persistance.

## Sauvegardes et retour arrière

Les preuves restent hors Git sur `lmpdf-dev`, sous
`/home/erwan/lmpdf-release-backups/20261113T225921Z-f75d7b3-combined-preparation`.
Le rapport est `deployment-20261113T232819Z/technical-report.json` dans ce dossier.
Il distingue validation technique et recette utilisateur non effectuée.

Le dossier privé contient dump PostgreSQL cohérent, archive uploads, empreintes,
plan, overrides, preuves isolées et rapport post-bascule. Les 20 empreintes de
préparation et les preuves de l'intervention sont conservées. Aucune sauvegarde,
image historique ou donnée n'a été supprimée ; aucun secret n'est recopié ici.

Rollback documenté vers l'image précédemment exécutée `3ecac12…` ; image
intermédiaire `c7fe463…` également conservée pour une éventuelle reprise ciblée
sur décision explicite. **Aucun rollback n'a été nécessaire.** Ne jamais
restaurer automatiquement la base ou les fichiers après un rollback applicatif.

Le preflight préparé est un contrôle **avant bascule** : il attend les anciens
IDs et ne doit pas servir de healthcheck après déploiement. Le rapport
post-bascule atteste le nouvel état ; une future intervention doit préparer son
propre état de référence.

## Suite

La [recette navigateur préparée](BROWSER_ACCEPTANCE_PLAN.md) reste à autoriser
pour les opérations qui écrivent des données. WebAuthn réel, TOTP utilisateur,
permissions interactives, rendu et export ne sont pas déclarés validés par le
seul succès du déploiement.
