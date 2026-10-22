# Revue complémentaire des PR #7 et #8 — 22 octobre 2026

Revue en lecture seule ; aucune modification de leurs branches, aucune fusion,
aucun déploiement. Les deux PR ciblent `main` et restent ouvertes en brouillon.

| PR | Branche | SHA revu |
|---|---|---|
| [#7](https://github.com/LounaMaili/lmpdf/pull/7) | `fix/document-permission-enforcement` | `2017bfefe8bc20a706325f9beae24012eb5e8a5b` |
| [#8](https://github.com/LounaMaili/lmpdf/pull/8) | `fix/admin-settings-persistence` | `829a0f45fe4681f3cf9392f20fa82ca598e65f68` |

## PR #7 : mémoire des exports multipart

`FileInterceptor` utilise `memoryStorage()` et conserve une limite de
`50 * 1024 * 1024` octets, soit **50 Mio** par fichier. Le contrôleur transmet
ensuite `file.buffer` au writer, sans seconde copie explicite dans ce code.
L'assemblage Multer/concat-stream garde cependant les chunks d'entrée pendant
la création du buffer contigu final : environ **100 Mio de buffers transitoires**
pour un fichier au plafond, en plus du processus et des autres requêtes.

Sonde synthétique exécutée sur Debian dans l'image déjà validée
`lmpdf-permissions-api:2017bfe`, sans volume, réseau ni endpoint actif :

| Mesure pour un fichier de 50 Mio | Résultat |
|---|---|
| RSS initial du processus minimal Node + Multer | 59,50 Mio |
| RSS avant `Buffer.concat` | 114,25 Mio |
| RSS juste après `Buffer.concat` | 164,29 Mio |
| `arrayBuffers` juste après concaténation | 100,02 Mio |
| Buffer reçu par le callback Multer | 50 Mio |

Méthode : `docker run --rm -i --network none --memory 512m --cpus 1
-w /app/apps/api lmpdf-permissions-api:2017bfe node --expose-gc` ; appel de
`memoryStorage()._handleFile()` avec un `Readable` produisant 800 chunks de
64 Kio, remplis en mémoire. Une sonde autour de `Buffer.concat` relève
`process.memoryUsage()` avant/après. Le générateur et le buffer sont entièrement
synthétiques ; aucun PDF réel n'a été lu ni écrit.

Ce n'est ni un benchmark HTTP complet ni un plafond RSS garanti. Le RSS Nest
réel sera supérieur au processus minimal ; la récupération des buffers par le
GC n'est pas immédiate. Le coût peut se multiplier avec les exports simultanés.
La limite V8 de heap seule ne borne pas les buffers natifs.

Le guard JWT s'exécute avant l'interceptor, mais le contrôle documentaire de
`authorizeExport()` est dans le contrôleur : un utilisateur authentifié dont
l'export sera refusé peut déjà avoir fait bufferiser le fichier. La limitation
de débit existante n'est pas une limite de concurrence/mémoire.

**Décision à prendre avant validation finale de #7 :** accepter explicitement
ce budget, ou traiter séparément un plafond adapté et/ou un streaming temporaire
avec quotas et nettoyage. Tester la concurrence dans un environnement isolé.
Ne pas déplacer ou supprimer des contrôles documentaires pour économiser la RAM.

`nginx.prod.conf` fixe par ailleurs `client_max_body_size 30M` : via le frontend,
la requête multipart entière doit rester sous 30 Mio, donc un fichier de 50 Mio
sera refusé en HTTP 413 avant l'API. Aucun seuil n'a été changé par cette revue.

## PR #7 : changement de nommage serveur

Avant #7, le frontend transmettait le nom éditable `name` comme `templateName`.
Après #7, le serveur ignore ce nom fourni par le navigateur et dérive le contexte :

- `templateId` présent : nom du template enregistré en PostgreSQL ;
- sinon : `document.originalName` du `sourceFileId` autorisé.

Le changement concerne les exports serveur (`resolve` et `run`), les règles
`templateNameContains`, les placeholders de chemin/nom et les logs d'export.
Le téléchargement PDF local dans le navigateur conserve son nommage précédent.
La preview administrateur accepte toujours un contexte hypothétique ; elle ne
prouve pas à elle seule le contexte réel d'un export utilisateur.

Impacts à faire valider :

1. Renommer seulement le formulaire ouvert ne renomme plus l'export serveur.
2. Une règle basée sur l'ancien nom libre peut sélectionner une autre destination
   ou ne plus correspondre ; revoir les règles existantes avant bascule.
3. Deux exports auparavant distingués par ce nom libre peuvent maintenant viser
   le même chemin : vérifier les effets `overwrite`, `rename`, `skip`.
4. Le resolver ajoute toujours `.pdf`. Avec `fileNameTemplate: {templateName}`,
   `originalName: scan.pdf` donne `scan.pdf.pdf`, et une image peut donner
   `scan.png.pdf`. Un template déjà nommé avec l'extension a le même risque.
5. Aucun ancien export n'est renommé automatiquement. Les clients API externes
   doivent fournir `sourceFileId`/`templateId` ; un nom seul n'autorise plus l'export.

La suppression du nom client comme source d'autorisation/contexte de confiance
reste justifiée. Une éventuelle règle de nommage de présentation distincte
nécessite une décision explicite ; cette revue ne l'implémente pas.

## Ordre d'intégration proposé

1. Revoir et intégrer d'abord le hotfix d'isolation JWT (PR #9), indépendant.
2. Revoir puis intégrer #8 : persistance des réglages avant les prochaines
   recréations backend liées aux autres changements.
3. Après décision sur mémoire et nommage, intégrer #7 ; elle nécessite la recette
   couplée web/API et les contrôles documentaires avec plusieurs rôles.

Aucune de ces fusions n'est autorisée par ce document. Un déploiement d'urgence
du seul hotfix peut être approuvé séparément ; il impose lui aussi de sauvegarder
et préserver tout réglage admin présent avant de recréer le backend.

Les branches #7/#8 partent du même main documentaire, aucune ne dépend de l'autre.
Les trois PR ajoutent des scripts dans `apps/api/package.json` : lors de la
réunion, conserver `test:auth`, `test:settings` et `test:permissions`. #9 et #8
ajoutent au même emplacement après `build`, donc prévoir une résolution de ce
conflit. Conserver aussi les preuves indépendantes dans la checklist de
régression et éviter de présenter une validation isolée comme une recette active.

## Tests à rejouer sur le SHA réunissant les changements

- Build API et client Prisma (generate uniquement), build web, Compose dev/prod.
- JWT/MFA : `pnpm --filter @lmpdf/api test:auth` ; sessions anciennes, challenges
  refusés sur routes protégées et admin, TOTP/WebAuthn/passwordless compatibles.
- Permissions : API `test:permissions` (43 tests sur #7) et web
  `test:permissions` (13 tests sur #7), plus tests autosave (17).
- Réglages : API `test:settings` (12 tests sur #8), puis le script
  `apps/api/tests/admin-settings-container.sh` avec une image runtime isolée.
- Recette navigateur avec comptes/données temporaires : owner/editor/filler,
  override global, groupe et partage direct, chargement du rôle, changement de
  document, détection tardive, structure interdite et valeurs autorisées au filler.
- Autosaves successifs, changement de clé et restauration ; exports navigateur
  et serveur avec document/template cohérents et refus pour les autres rôles.
- Destinations et logs sur un répertoire temporaire autorisé : noms canoniques,
  extensions, règles existantes, collisions overwrite/rename/skip, ID inexistant,
  contexte contradictoire, nom client ignoré, absence d'écriture après refus.
- Taille multipart : limites API/proxy cohérentes, dépassement refusé et budget
  mémoire sous concurrence ; pas de test de charge sur l'instance active.

Les suites indépendantes déjà passées sur #7/#8 ne valident pas leur combinaison
avec #9 : la recette réunie reste à faire après les intégrations approuvées.

## Plan de déploiement ultérieur — non exécuté

1. SHA approuvé poussé sur GitHub, checkout Debian propre et détaché, préserver
   `.env`/`.env.prod` sans les afficher. Relever IDs, redémarrages et montages.
2. **Avant toute recréation backend**, vérifier le fichier admin dans le conteneur
   actif sans lire son contenu dans la sortie. S'il existe, sauvegarde hors Git,
   répertoire `0700`, fichier `0600`, checksum et présence vérifiés.
3. Pour #8, préparer `lmpdf-git_admin-config` et importer l'éventuelle sauvegarde
   uniquement si la destination est absente, sans écraser un fichier existant.
   Vérifier ownership/modes avec l'image approuvée. Voir
   [ADMIN_SETTINGS_PERSISTENCE.md](https://github.com/LounaMaili/lmpdf/blob/829a0f45fe4681f3cf9392f20fa82ca598e65f68/docs/ADMIN_SETTINGS_PERSISTENCE.md).
4. Construire les images exactes sans toucher à l'instance : API seule pour
   #9/#8 ; API et frontend pour #7. Garder les images précédentes pour rollback.
5. Après autorisation explicite de bascule, recréer uniquement les services
   concernés, avec `--no-deps --no-build`. Ni PostgreSQL ni Vision ne nécessitent
   de recréation pour ces PR. Aucun `down`, aucune migration, aucune suppression
   de volume ni de répertoire historique.
6. Contrôler HTTP 200 frontend/santé, stabilité backend, logs expurgés, connexion
   ordinaire et MFA avec un compte de recette autorisé ; vérifier les paramètres
   masqués et la recette permissions/export. Les probes de challenge restent dans
   l'application isolée, sans essai de contournement sur l'instance active.
7. Confirmer l'ID PostgreSQL inchangé, `lmpdf-git_postgres-data` toujours monté,
   `lmpdf-git_uploads-data` toujours dans API et Vision, et les fichiers existants.
   Préserver également le nouveau volume admin et la sauvegarde historique.
8. En cas d'échec, arrêter la bascule et rapporter le problème. Préparer tout
   rollback sur les images précédentes en conservant les montages et réglages
   admin ; aucune correction de sources directement sur Debian.
