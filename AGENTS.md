# AGENTS.md - LMPdf

## Contexte du projet

LMPdf est une application web self-hosted pour importer, remplir, sauvegarder et exporter des formulaires PDF. Le projet est un monorepo pnpm avec trois applications principales :

- `apps/web/` : frontend React + Vite + TypeScript.
- `apps/api/` : backend NestJS + Prisma + PostgreSQL.
- `apps/vision/` : service Python FastAPI + OpenCV/Tesseract.
- `infra/` : configuration locale Docker, Garage S3, données runtime.

La documentation existante fait autorité, en particulier `README.md`, `ARCHITECTURE.md`, `PROJECT_STRUCTURE.md`, `CHANGELOG.md` et `MAINTENANCE_UPDATES.md`.

## Commandes utiles

- Installer les dépendances : `pnpm install`
- Lancer les services locaux : `docker compose up -d`
- Lancer le développement : `pnpm dev`
- Build complet : `pnpm build`
- Build web : `pnpm --filter @lmpdf/web build`
- Build API : `pnpm --filter @lmpdf/api build`
- Prisma generate : `cd apps/api && pnpm prisma:generate`
- Prisma deploy : `cd apps/api && pnpm prisma:deploy`
- Lint : `pnpm lint` (actuellement partiellement stub)
- Format : `pnpm format` (actuellement partiellement stub)

## Règles de travail Codex

- Travailler sur une branche dédiée, typiquement `codex-setup` ou une branche courte par changement.
- Lire la documentation et les fichiers proches avant de modifier un comportement.
- Ne pas modifier les artefacts générés sauf demande explicite : `apps/*/dist/`, `*.tsbuildinfo`, `__pycache__/`, `*.pyc`, fichiers `.bak*`.
- Ne pas modifier les migrations Prisma sans demande explicite. Toute évolution de schéma doit être cohérente avec `apps/api/prisma/schema.prisma` et les migrations.
- Ne pas changer les fichiers de production ou de déploiement sans validation explicite.
- Ne pas introduire `npm install` ni `package-lock.json` à la racine. Utiliser `pnpm`.
- Garder les changements frontend, backend et vision séparés quand c'est possible.
- Après une modification backend ou Prisma, vérifier au minimum le build API.
- Après une modification frontend, vérifier au minimum le build web.
- Après une modification touchant upload, export, auth, permissions, S3 ou chemins fichiers, relire les contrôles d'accès et les protections path traversal.

## Sécurité et données sensibles

- Ne jamais afficher, copier ni committer de secrets.
- Ne jamais committer `.env`, `.env.*`, clés JWT, clés MFA, identifiants LDAP, clés S3/Garage, données d'uploads ou volumes Docker.
- Les valeurs dans `.env.example` doivent rester des exemples sans secret réel.
- Les dossiers `infra/postgres-data/`, `infra/minio-data/`, `infra/garage-data/`, `infra/garage-meta/` et `uploads/` sont des données runtime locales.

## Notes techniques

- Le frontend rend les PDF via `react-pdf`/`pdfjs-dist`; ces versions doivent rester compatibles.
- Le backend expose les routes sous `/api` et utilise JWT, MFA/WebAuthn, rôles et permissions par document.
- Le service vision est un service interne appelé par l'API ; ne pas l'exposer publiquement.
- Garage fournit le stockage S3-compatible local.
- Les dossiers de build déjà suivis par Git peuvent exister dans l'historique, mais les nouveaux travaux ne doivent pas les mettre à jour sans raison validée.
