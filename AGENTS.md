# AGENTS.md - LMPdf

## Contexte du projet

LMPdf est une application web self-hosted pour créer, remplir et exporter des
formulaires PDF à partir d'un PDF ou d'une image de fond. L'objectif est de
fournir un outil local, léger et autonome, sans dépendance obligatoire à un
service cloud externe.

Stack actuelle :

- Frontend : React + Vite + TypeScript dans `apps/web/`.
- Backend : NestJS + Prisma + PostgreSQL dans `apps/api/`.
- Service vision : Python FastAPI + PIL/OpenCV dans `apps/vision/`.
- Stockage fichiers : Garage compatible S3.
- Orchestration locale : Docker Compose.
- Monorepo : pnpm workspaces.

## Source de vérité

Avant toute modification, lire les documents utiles dans cet ordre :

1. `README.md`
2. `ARCHITECTURE.md`
3. `PROJECT_STRUCTURE.md`
4. `MAINTENANCE_UPDATES.md`
5. `CHANGELOG.md`
6. `RAPPORT_ANALYSE_DATE_FIELD.md` si le changement touche les champs date.
7. Le code du package concerné : `apps/web/`, `apps/api/`, `apps/vision/` ou
   `packages/shared/`.

## Règles produit

- Garder LMPdf self-hosted et utilisable localement.
- Ne pas ajouter de dépendance obligatoire à un SaaS, à Firebase, à un cloud
  externe ou à de la télémétrie sans demande explicite.
- Préserver l'approche produit : PDF ou image en fond, champs positionnés en
  overlay, export PDF fidèle au document original.
- Ne pas casser les types de champs existants : texte, case à cocher, compteur,
  date.
- Préserver la séparation entre structure du formulaire et valeurs saisies.
- Respecter les rôles documentaires : `owner`, `editor`, `filler`.
- Toute évolution des permissions doit passer par la matrice de permissions et
  être vérifiable par tests ou revue ciblée.
- Toute décision structurante doit être documentée dans l'architecture ou dans un
  document dédié avant d'être généralisée.

## Règles d'architecture

- Garder une séparation claire entre `apps/web`, `apps/api`, `apps/vision` et
  `packages/shared`.
- Ne pas dupliquer les contrats de données : extraire ou synchroniser les types
  communs dans `packages/shared` quand c'est pertinent.
- Côté frontend, éviter de coupler les coordonnées de champs aux pixels écran :
  privilégier des coordonnées relatives au document/page.
- Côté API, garder les validations d'entrée proches des DTO ou des contrôleurs
  NestJS.
- Côté Prisma, toute modification de schéma doit être accompagnée d'une
  migration versionnée.
- Côté vision, garder le service optionnel : l'édition manuelle des champs doit
  rester possible même si la détection automatique est indisponible.
- Pour les exports PDF, vérifier à la fois le rendu visuel et les règles
  d'accès avant de modifier le flux.

## Commandes attendues

Depuis la racine du dépôt :

- Installer les dépendances : `pnpm install`
- Lancer le développement : `pnpm dev`
- Builder tout le monorepo : `pnpm build`
- Linter tout le monorepo : `pnpm lint`
- Formater tout le monorepo : `pnpm format`
- Lancer l'infrastructure locale : `docker compose up -d`

Commandes ciblées utiles :

- API : `pnpm --filter @lmpdf/api build`
- Web : `pnpm --filter @lmpdf/web build`
- Prisma generate : `pnpm --filter @lmpdf/api prisma:generate`
- Migrations dev : `pnpm --filter @lmpdf/api prisma:migrate`
- Migrations prod : `pnpm --filter @lmpdf/api prisma:deploy`

Avant d'ouvrir une PR, lancer au minimum les commandes pertinentes au périmètre
modifié et mentionner celles qui n'ont pas pu être exécutées.

## Sécurité et fichiers à ne pas committer

- Ne jamais committer `.env`, `.env.prod`, secrets JWT, clés S3, mots de passe,
  exports PDF utilisateur, uploads ou dumps de base.
- Ne pas committer les données runtime : `infra/postgres-data/`,
  `infra/garage-data/`, `infra/garage-meta/`, `infra/minio-data/`, `uploads/`.
- Ne pas exposer de données personnelles issues de PDF réels dans les logs,
  captures, fixtures ou rapports.
- Valider les uploads côté API : type, taille, nom de fichier, stockage et
  droits d'accès.
- Ne pas contourner l'authentification JWT, MFA, WebAuthn ou LDAP existante.
- Ne pas servir un fichier PDF, un export ou un upload sans contrôle de
  permission explicite.
- Garder la sanitation du contenu riche côté API et frontend, notamment pour les
  champs texte et exports.
- Les nouvelles variables d'environnement doivent être documentées dans
  `.env.example` avec des valeurs non sensibles.

## Travail Git et revue

- Travailler sur une branche dédiée, jamais directement sur `main`.
- Ouvrir une PR pour toute modification destinée au dépôt.
- Garder les changements petits, testables et documentés.
- Mettre à jour `README.md`, `ARCHITECTURE.md` ou `PROJECT_STRUCTURE.md` si le
  comportement, la structure ou les commandes changent.
- Si une commande de test ou build échoue, corriger la cause racine ou documenter
  précisément le blocage dans la PR.
