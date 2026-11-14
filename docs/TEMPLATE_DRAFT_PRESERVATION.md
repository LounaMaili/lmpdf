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

Limites conservées : le nettoyage n'est pas une transaction entre deux requêtes,
et le service DELETE existant masque des erreurs Prisma. Ce correctif ne
garantit pas la disparition de tout ancien slot ni la coordination entre deux
onglets concurrents. Les tests ne prouvent pas une bascule active : le frontend
en service n'a pas été remplacé. Rendu multipage et rich-text restent séparés.

## Validation Debian isolée

- Web : `pnpm --filter @lmpdf/web run test:template-draft`, `test:autosave`,
  `test:permissions`, `test:auth` et build production.
- API : build + Prisma generate, puis `pnpm --filter @lmpdf/api run
  test:template-draft`. L'application Nest écoute sur loopback éphémère dans
  le conteneur isolé ; JWT, utilisateur, payload et Prisma sont synthétiques.
  Les vrais guards, DTO, contrôleur et service de brouillon sont exécutés.
- Depuis l'image API au stage `build`, monter uniquement le fichier du helper
  web en lecture seule et fournir
  `TEMPLATE_DRAFT_HELPER_PATH=/qa/preserveTemplateDraft.ts`. Ne monter aucun
  fichier `.env`, volume de contenu ou configuration réelle. Le helper doit
  provenir du même SHA GitHub que les tests.
- La suite HTTP reproduit d'abord l'ancienne requête refusée, puis valide le
  transfert, le slot legacy, les erreurs, le changement de contexte et le 401.
  Elle simule la contrainte Prisma ; elle ne constitue pas un test PostgreSQL
  réel ni une recette navigateur du correctif déployé.

Aucun changement de dépendance, API métier, permission, politique MFA, schéma,
migration ou configuration de production. Fusion et déploiement restent soumis
à revue et autorisation séparées.
