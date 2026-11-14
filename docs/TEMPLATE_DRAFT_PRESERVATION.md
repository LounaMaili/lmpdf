# Préservation du brouillon après sauvegarde de structure

## Défaut reproduit le 14 novembre 2026

Sur la révision active `f75d7b3f0aae3f5f285d0dbfe486d7080a961815`, une
sauvegarde structurelle crée un nouveau template puis demande un brouillon
`{templateId: nouveau, sourceFileId: source}`. Un brouillon source déjà présent
pour l'utilisateur provoque `P2002` sur la contrainte unique du slot source.
Le catch masque l'échec et l'UI annonce pourtant que le brouillon est préservé.
Le cas a été reproduit uniquement avec les fixtures synthétiques autorisées.

## Correction proposée, sans migration

- Le nouveau brouillon est écrit avec sa seule clé `templateId`. Le template
  conserve sa relation au fichier source ; aucune donnée de schéma n'est changée.
- Clé précédente, révision et payload sont capturés avant la requête.
  Le payload sauvegardé est celui de cette capture, pas celui d'un document
  éventuellement ouvert pendant la requête.
- L'identité du payload éditable distingue aussi deux chargements propres sous
  une même clé source, sans provoquer artificiellement un autosave au chargement.
- L'éditeur n'adopte la nouvelle clé qu'après confirmation de l'upsert et si
  sa clé/révision courante correspond toujours à la capture. Cette adoption
  précède le nettoyage de l'ancien slot.
- En cas d'échec d'upsert, l'ancienne clé et son brouillon sont conservés et un
  avertissement remplace le faux succès. Si l'utilisateur a changé de document
  ou continué à éditer, l'ancien slot est gardé et le contexte courant respecté.
- Un changement de compte/logout empêche une écriture tardive avec l'identité
  suivante. L'authentification et les contrôles serveur restent inchangés.
- Une erreur HTTP de nettoyage après préservation produit un avertissement
  distinct ; elle ne remet pas en cause la copie déjà préservée.

## Suppression confirmée et concurrence

Le service ne masque plus les erreurs Prisma. `deleteMany` exécute un DELETE
atomique limité à l'utilisateur et à sa clé unique ; un compte de 0 établit
l'absence, 1 établit la suppression. Une erreur de connexion, de SQL ou d'accusé
de réception, même P2025 inattendu, n'est pas assimilée à une absence.

| Situation | HTTP / résultat |
|---|---|
| Ligne supprimée | 200, `{cleared:true, outcome:"deleted"}` |
| Absence réellement établie | 200, `{cleared:true, outcome:"absent"}` |
| Ancien brouillon modifié depuis sa copie | 409 ; ligne conservée |
| Erreur SQL, transport ou résultat indéterminé | Erreur ; aucune confirmation de suppression |
| Clé manquante ou condition invalide | 400 ; aucune suppression |

Le client vérifie HTTP **et** l'issue explicite. Il rejette aussi un 404, une
réponse legacy ambiguë ou un JSON invalide. Les autres parcours conservent leur
DELETE ordinaire ; seuls les transferts utilisent
`DELETE /api/drafts/if-unchanged` avec le `preservedPayload` requis. La comparaison
JSON (après la sanitation existante) fait partie du DELETE, donc une mise à jour
concurrente ne peut pas être supprimée entre lecture et écriture. Si aucune
ligne ne correspond à la condition, une lecture doit confirmer l'absence ; une
ligne différente donne 409, une lecture impossible reste une erreur.

La route distincte empêche un backend ancien d'ignorer silencieusement la
condition : il retourne 404 et le client ne tente aucun DELETE inconditionnel
de remplacement. Un déploiement futur doit néanmoins prévoir backend puis web.

Après préservation et adoption, le scheduler retire uniquement les révisions
de l'ancienne clé déjà copiées. Les révisions ultérieures restent autorisées.
Une écriture ancienne encore en vol ou précédemment échouée interdit le
nettoyage automatique ; l'ancien slot reste disponible pour rapprochement et
l'UI signale « nettoyage non confirmé ». La réponse tardive garde sa clé, ne
relance pas la révision retirée et ne marque pas le document courant sauvegardé.
Si l'éditeur a changé de document ou de révision avant adoption, aucun retrait
ni nettoyage n'a lieu. La condition SQL protège également les changements
provenant d'un autre onglet.

Limites conservées : aucun nettoyage n'est annoncé durable face à une nouvelle
édition légitime après le DELETE. Une ancienne requête d'issue indéterminée
conduit volontairement à conserver le slot ; aucune purge automatique. Il n'y
a pas de verrou distribué des éditions ni d'historique de versions. Le frontend
actif n'a pas été remplacé ; rendu multipage et ajout de page restent séparés.

## Validation Debian isolée

- Web : `pnpm --filter @lmpdf/web run test:template-draft`, `test:autosave`,
  `test:permissions`, `test:auth` et build production.
- API : build + Prisma generate, puis `pnpm --filter @lmpdf/api run
  test:template-draft` et `test:draft-clear`. L'application Nest écoute sur loopback éphémère dans
  le conteneur isolé ; JWT, utilisateur, payload et Prisma sont synthétiques.
  Les vrais guards, DTO, contrôleur et service de brouillon sont exécutés.
- Depuis l'image API au stage `build`, monter uniquement le fichier du helper
  web en lecture seule et fournir
  `TEMPLATE_DRAFT_HELPER_PATH=/qa/preserveTemplateDraft.ts`,
  `DRAFT_WEB_API_PATH=/qa/api.ts` et, pour PostgreSQL,
  `AUTOSAVE_SCHEDULER_PATH=/qa/autosaveScheduler.ts`. Ne monter aucun
  fichier `.env`, volume de contenu ou configuration réelle. Le helper doit
  provenir du même SHA GitHub que les tests.
- La suite HTTP reproduit d'abord l'ancienne requête refusée, puis valide le
  transfert, le slot legacy, les erreurs, le changement de contexte et le 401.
  Elle simule la contrainte Prisma ; elle ne constitue pas un test PostgreSQL
  réel ni une recette navigateur du correctif déployé.
- Test réel PostgreSQL : `python3 apps/api/tests/run-drafts-postgres.py --sha
  <SHA_EXACT> --output <NOUVEAU_REPERTOIRE_PRIVE_HORS_GIT>`. Requiert le stage API
  `build` étiqueté `lmpdf-qa-api-build:<SHA_EXACT>` et l'image postgres:16 locale.
  Le runner crée un réseau interne, PostgreSQL en tmpfs et un rôle API non
  superuser ; aucun port publié ni volume Docker monté. Le SQL de schéma est
  généré sans connexion depuis le schéma inchangé, puis appliqué seulement à
  cette base temporaire. Aucune migration du dépôt n'est appliquée.
- Les tests réels couvrent suppression/absence/legacy, refus SQL, accusé perdu
  après commit réel, conflit de payload et erreur de vérification d'absence.
  Ils combinent le vrai client web, le scheduler et les contrôleurs avec
  PostgreSQL : ancienne écriture retardée avant SQL, réponse retardée après SQL,
  et erreur injectée après commit. Les gates déterminent l'ordre, sans délais
  React artificiels. Les conteneurs et le réseau temporaires sont les seules
  ressources arrêtées ; aucune suppression de volume.

Aucun changement de dépendance, permission, politique MFA, schéma, migration ou
configuration de production. Le contrat DELETE reçoit une issue additive et
une route conditionnelle dédiée au transfert. Fusion et déploiement restent
soumis à revue et autorisation séparées.

## Revue de la branche QA indépendante

`codex/qa-browser-acceptance` reste à
`81843db2729181c40525e51ef28cbf12b9d21951` et n'est pas intégrée à ce correctif.
Ses quatre outils ont été relus : données synthétiques, lecture des entrées
privées hors Git, JWT uniquement en mémoire, mots de passe sortants chiffrés,
diagnostics Prisma expurgés. Contrôle statique des six versions de fichiers
dans ses six commits : aucun JWT littéral, jeton GitHub ou clé privée détecté.
Comparaison sur Debian, sans afficher les valeurs : aucun des quatre mots de
passe QA ni des quatre secrets actifs contrôlés n'apparaît dans les outils.
Les identifiants QA et les clés publiques/empreintes ne sont pas des secrets.
Ce constat porte sur ce périmètre audité ; aucune fusion n'est effectuée.
