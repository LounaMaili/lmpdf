# Reprise Codex - LMPdf

## État au démarrage

Le dépôt est un monorepo applicatif complet pour LMPdf :

- `apps/web/` : React, Vite, TypeScript.
- `apps/api/` : NestJS, Prisma, PostgreSQL.
- `apps/vision/` : FastAPI, OpenCV, Tesseract.
- `infra/` : Docker Compose, Garage S3, données runtime locales.

La branche de travail prévue pour la configuration Codex est `codex-setup`.

## Lecture recommandée

1. `README.md`
2. `ARCHITECTURE.md`
3. `PROJECT_STRUCTURE.md`
4. `MAINTENANCE_UPDATES.md`
5. `CHANGELOG.md`
6. Les fichiers proches de la zone modifiée

## Commandes de reprise

```bash
cd /home/erwan/projects/lmpdf
git status --short --branch
pnpm install
docker compose up -d
pnpm dev
```

Vérifications fréquentes :

```bash
pnpm --filter @lmpdf/web build
pnpm --filter @lmpdf/api build
pnpm build
```

Pour Prisma :

```bash
cd apps/api
pnpm prisma:generate
pnpm prisma:deploy
```

## Points sensibles

- Ne pas afficher ni committer de secrets.
- Ne pas committer `.env`, `.env.*`, uploads, volumes Docker, clés S3/Garage, secrets JWT/MFA/LDAP.
- Ne pas modifier les fichiers de production ou de déploiement sans validation explicite.
- Ne pas toucher aux migrations Prisma sans demande explicite.
- Ne pas mettre à jour les artefacts générés : `apps/*/dist/`, `*.tsbuildinfo`, `__pycache__/`, `*.pyc`, `.bak*`.
- Garder `react-pdf` et `pdfjs-dist` compatibles.
- Vérifier particulièrement les accès document, l'authentification, l'export PDF, l'upload et les chemins fichiers.

## Validation minimale par type de changement

- Frontend : `pnpm --filter @lmpdf/web build`
- Backend : `pnpm --filter @lmpdf/api build`
- Monorepo : `pnpm build`
- Prisma : `pnpm prisma:generate` puis migration ou deploy selon le cas
- Docker : `docker compose up -d --build` uniquement si le changement touche Docker ou les services

## Notes de maintenance

Le dépôt contient historiquement des artefacts générés et des données runtime suivis par Git. Ne pas les supprimer ou les modifier dans une tâche Codex ordinaire. Une purge éventuelle doit être traitée comme une tâche dédiée, validée avant exécution.
