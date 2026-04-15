# PROJECT_STRUCTURE.md

Guide rapide des dossiers/fichiers du projet **LMPdf**.

## Racine

- `apps/` — applications principales
- `packages/` — code partagé entre apps
- `infra/` — données/infrastructure locale (volumes Docker)
- `scripts/` — scripts utilitaires projet
- `docker-compose.yml` — orchestration locale (backend/frontend/postgres/redis/garage/vision)
- `CHANGELOG.md` — historique des changements importants
- `README.md` — démarrage et usage global
- `ARCHITECTURE.md` — vue d’ensemble architecture
- `TODO.md` — backlog court

## apps/

### `apps/web/` (Frontend React + Vite + TypeScript)

- `src/App.tsx` — éditeur principal (chargement doc, champs, rotation, détection, export)
- `src/components/PdfViewer.tsx` — rendu PDF via `react-pdf`
- `src/components/FieldOverlay.tsx` — overlays champs (drag/resize/saisie)
- `src/components/PropertiesPanel.tsx` — panneau propriétés/liste champs
- `src/exportPdf.ts` — export PDF rempli (`pdf-lib`)
- `src/api.ts` — appels API backend
- `src/styles.css` — styles globaux

### `apps/api/` (Backend NestJS + Prisma)

- `src/main.ts` — bootstrap API (CORS, sécurité, validation)
- `src/app.module.ts` — modules/guards globaux
- `src/auth/` — auth JWT + guards/roles
- `src/upload/upload.controller.ts` — upload/serve documents
- `src/templates/` — CRUD templates/champs
- `src/detect/` — endpoint vers service vision
- `src/users/`, `src/groups/` — gestion comptes/groupes
- `prisma/schema.prisma` — schéma DB
- `prisma/migrations/` — migrations SQL versionnées

### `apps/vision/` (Service Python FastAPI)

- `main.py` — API vision
- `detector.py` — détection de zones (OpenCV/Tesseract)
- `requirements.txt` — dépendances Python

## packages/

### `packages/shared/`

- utilitaires/types partagés (base pour code commun)

## infra/

- `infra/postgres-data/` — données PostgreSQL locales (volume)
- `infra/garage-data/` — données Garage (objets)
- `infra/garage-meta/` — métadonnées Garage

> Ces dossiers sont des données runtime. À ne pas nettoyer à la légère.

## Notes maintenance

- Les dossiers `dist/` sont des artefacts de build (recréés automatiquement).
- `__pycache__/` est un cache Python (recréé automatiquement).
- `node_modules/` est réinstallable (`pnpm install`).
- Avant gros changement: faire une sauvegarde horodatée dans `/home/openclaw/save_LMPdf/`.
