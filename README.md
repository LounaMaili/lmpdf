# LMPdf

Scaffold monorepo pour une application web d'édition de formulaires PDF/images.

## Structure

- `apps/web` : React + Vite + TypeScript (éditeur visuel)
- `apps/api` : NestJS (API templates/upload)
- `apps/vision` : FastAPI placeholder (OpenCV/OCR plus tard)
- `packages/shared` : types partagés
- `infra` : données locales Docker (Postgres/Garage)

## Prérequis

- Node.js 22+
- pnpm
- Docker / Docker Compose

## Démarrage rapide

```bash
cp .env.example .env
pnpm install
docker compose up -d
pnpm dev
```

## Installer facilement sur une autre VM

Voir `DEPLOY_VM.md`.

Scripts prêts à l'emploi :
- `scripts/make-release.sh` → crée une archive portable du projet
- `scripts/install-host-deps-linux.sh` → installe Docker/Compose sur Debian/Ubuntu/Rocky
- `scripts/install-vm.sh` → initialise `.env`, secrets, CORS/API URL puis lance `docker compose up -d --build`
- `scripts/print-firewall-rules.sh` → génère des règles UFW (VM Traefik distante)

URLs utiles :
- Web: http://localhost:4173
- API: http://localhost:3000/api/health
- Vision: http://localhost:8001/health
- Garage S3 API: http://localhost:3900 (local only)
- Garage Admin API: http://localhost:3903 (local only)

## Base de données (Prisma)

Depuis `apps/api` :

```bash
DATABASE_URL="postgresql://lmpdf:lmpdf@localhost:5432/lmpdf" npx prisma migrate dev --name init
DATABASE_URL="postgresql://lmpdf:lmpdf@localhost:5432/lmpdf" npx prisma generate
```

En Docker, les migrations sont appliquées au démarrage du backend (`prisma migrate deploy`).

## MVP visé

1. Import PDF/image
2. Affichage fond + champs superposés
3. Ajout/édition manuelle des champs
4. Sauvegarde de modèles réutilisables
5. Export PDF final

## État actuel (déjà en place)

- API NestJS
  - `GET /api/health`
  - `POST /api/uploads/document` (PDF/image, stockage local `apps/api/uploads` + entrée DB)
  - `POST /api/templates` (sauvegarde template en Postgres)
  - `GET /api/templates` et `GET /api/templates/:id`
  - `POST /api/detect` (pont API -> service Vision)
- Web React
  - import fichier PDF/image
  - overlay de champs sur page A4
  - déplacement souris + redimensionnement (poignée)
  - double-clic sur un champ pour suppression
  - sauvegarde template + rechargement d'un template récent
- Vision
  - `GET /health`
  - `POST /detect` placeholder (contrat `suggestedFields[]`)
