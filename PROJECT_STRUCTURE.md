# PROJECT_STRUCTURE.md

Guide rapide des dossiers/fichiers du projet **LMPdf**.

## Racine

- `apps/` — applications principales
- `infra/` — données PostgreSQL locales du Compose de développement
- `scripts/` — scripts d'installation des outils hôtes Linux
- `docker-compose.yml` — orchestration de développement
- `docker-compose.prod.yml` — orchestration de production autonome
- `package.json`, `pnpm-workspace.yaml`, `pnpm-lock.yaml` — monorepo pnpm
- `.env.example`, `.env.prod.example` — modèles de configuration sans secrets
- `AGENTS.md` — règles projet et workflow Fedora → GitHub → VM Debian
- `CHANGELOG.md` — historique des changements importants
- `README.md` — démarrage et usage global
- `ARCHITECTURE.md` — vue d’ensemble architecture

Le dépôt ne contient actuellement ni dossier `packages/` ni `TODO.md`.

## apps/

### `apps/web/` (Frontend React + Vite + TypeScript)

- `src/App.tsx` — éditeur principal (chargement doc, champs, rotation, détection, export)
- `src/components/PdfViewer.tsx` — rendu PDF via `react-pdf`
- `src/components/FieldOverlay.tsx` — overlays champs (drag/resize/saisie)
- `src/components/PropertiesPanel.tsx` — panneau propriétés/liste champs
- `src/exportPdf.ts` — génération du PDF rempli dans le navigateur (`pdf-lib`)
- `src/api.ts` — appels API backend
- `src/styles.css` — styles globaux

### `apps/api/` (Backend NestJS + Prisma)

- `src/main.ts` — bootstrap API (CORS, sécurité, validation)
- `src/app.module.ts` — modules/guards globaux
- `src/auth/` — authentification JWT, MFA, WebAuthn et LDAP
- `src/upload/upload.controller.ts` — upload et lecture des fichiers depuis `uploads/`
- `src/templates/` — CRUD templates/champs
- `src/detect/` — endpoint vers service vision
- `src/export/` — export serveur optionnel vers un chemin de fichiers configuré
- `src/drafts/`, `src/permissions/` — brouillons et droits documentaires
- `src/users/`, `src/groups/` — gestion comptes/groupes
- `prisma/schema.prisma` — schéma DB
- `prisma/migrations/` — migrations SQL versionnées

### `apps/vision/` (Service Python FastAPI)

- `main.py` — API vision
- `detector.py` — détection de zones (OpenCV/Tesseract)
- `requirements.txt` — dépendances Python

## infra/

- `infra/postgres-data/` — données PostgreSQL du Compose de développement

Les deux persistances critiques de l'application conteneurisée sont PostgreSQL
(`infra/postgres-data/` en développement, volume `postgres-data` en production)
et le volume Docker nommé `uploads-data`, partagé par l'API et Vision pour les
PDF et images. Elles ne doivent pas être supprimées ou recréées pendant une
mise à jour applicative.

## Notes maintenance

- `dist/`, `*.tsbuildinfo` et `__pycache__/` sont des artefacts régénérables,
  ignorés par Git.
- Les dépendances et les builds applicatifs sont gérés sur la VM `lmpdf-dev`,
  jamais sur le poste Fedora. Voir `AGENTS.md`.
