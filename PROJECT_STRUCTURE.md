# PROJECT_STRUCTURE.md

Guide rapide des dossiers/fichiers du projet **LMPdf**.

## Racine

- `apps/` — applications principales
- `infra/` — configuration Garage et données runtime Docker
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

- `infra/garage.toml`, `infra/garage-init.sh` — configuration et initialisation Garage
- `infra/postgres-data/` — données PostgreSQL du Compose de développement
- `infra/garage-data/`, `infra/garage-meta/` — données Garage créées à l'exécution
- `infra/minio-data/` — anciennes données MinIO encore partiellement suivies par Git

Ces dossiers de données runtime ne sont pas à nettoyer dans une tâche de
maintenance documentaire. Le retrait des anciens fichiers MinIO suivis par Git
fera l'objet d'une tâche distincte.

## Notes maintenance

- `dist/`, `*.tsbuildinfo` et `__pycache__/` sont des artefacts régénérables,
  ignorés par Git.
- Les dépendances et les builds applicatifs sont gérés sur la VM `lmpdf-dev`,
  jamais sur le poste Fedora. Voir `AGENTS.md`.
