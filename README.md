# LMPdf

> **LMPdf** — Éditeur local de formulaires PDF avec champs interactifs, modèles sauvegardables et export automatisé.

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
![Status: En développement](https://img.shields.io/badge/Status-Development-blue.svg)

---

## C'est quoi ?

**LMPdf** est une application web self-hosted permettant de :

- **Importer** un PDF ou une image comme fond de formulaire
- **Positionner** des champs interactifs (texte, case à cocher, compteur, date) par drag & drop
- **Sauvegarder** des modèles réutilisables en base de données
- **Exporter** un PDF rempli avec les valeurs saisies
- **Partager** des documents avec contrôle d'accès par utilisateur ou groupe

L'objectif : fournir un outil local, léger et autonome pour générer des documentsPDF sans dependre d'un service cloud.

---

## Fonctionnalités

| Fonctionnalité | État |
|---|---|
| Import PDF / image | ✅ |
| Éditeur drag & drop de champs | ✅ |
| Types de champs : texte, case à cocher, compteur, date | ✅ |
| Verrouillage de champs (structure vs contenu) | ✅ |
| Sauvegarde de modèles (templates) | ✅ |
| Export PDF rempli | ✅ |
| Authentification JWT + MFA | ✅ |
| Gestion d'utilisateurs et groupes | ✅ |
| Permissions par document (owner/editor/filler) | ✅ |
| Détection automatique de zones (OCR/Vision) | 🔜 |
| LDAP / SSO | 🔜 |

---

## Architecture

```
apps/web        →  React + Vite + TypeScript  (frontend)
apps/api        →  NestJS + Prisma            (backend)
apps/vision     →  FastAPI + OpenCV           (service OCR/vision)
packages/shared →  Types partagés
infra           →  Docker (Postgres, Garage S3)
```

Voir [ARCHITECTURE.md](./ARCHITECTURE.md) pour les détails.

---

## Prérequis

- **Node.js** 22+
- **pnpm** 8+
- **Docker** + **Docker Compose**

---

## Démarrage rapide

```bash
# 1. Cloner le dépôt (si pas déjà fait)
git clone https://github.com/winpoks/lmpdf.git
cd lmpdf

# 2. Configurer l'environnement
cp .env.example .env
# Éditer .env : ajuster les secrets et URLs si nécessaire

# 3. Installer les dépendances
pnpm install

# 4. Lancer les services (Postgres + Garage)
docker compose up -d

# 5. Démarrer en développement
pnpm dev
```

---

## URLs par défaut

| Service | URL |
|---|---|
| Web (frontend) | http://localhost:4173 |
| API (backend) | http://localhost:3000/api/health |
| Vision (OCR) | http://localhost:8001/health |
| Garage S3 API | http://localhost:3900 (local uniquement) |
| Garage Admin | http://localhost:3903 (local uniquement) |

---

## Déploiement en production

Le déploiement prod utilise un compose standalone (`docker-compose.prod.yml`) avec des Dockerfiles multi-stage optimisés et nginx comme reverse proxy interne.

```bash
# 1. Cloner le dépôt sur le serveur
git clone https://github.com/LounaMaili/lmpdf.git
cd lmpdf
git checkout fix/docker-prod

# 2. Configurer l'environnement de production
cp .env.prod.example .env.prod
# Éditer .env.prod : générer des secrets uniques
#   openssl rand -hex 32  # pour JWT_SECRET, MFA_ENCRYPTION_KEY
#   openssl rand -hex 16  # pour POSTGRES_PASSWORD

# 3. Lancer les services
#    --env-file .env.prod est requis car .env contient les valeurs dev
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build

# 4. Appliquer les migrations Prisma
docker exec lmpdf-backend npx prisma migrate deploy

# 5. Configurer Garage S3 (première fois uniquement)
docker exec lmpdf-garage /garage layout assign <NODE_ID> -z dc1 -c 1G
docker exec lmpdf-garage /garage layout apply --version 1
docker exec lmpdf-garage /garage bucket create lmpdf
docker exec lmpdf-garage /garage key create lmpdf-s3
docker exec lmpdf-garage /garage bucket allow lmpdf --key <KEY_ID> --read --write

# 6. Créer un compte admin
docker exec lmpdf-backend node -e "const bcrypt = require('bcryptjs'); bcrypt.hash('VOTRE_MOT_DE_PASSE', 10).then(h => console.log(h))"
# Puis insérer en base :
docker exec lmpdf-postgres psql -U lmpdf -c "INSERT INTO ..."
```

### Architecture prod

```
Internet → Traefik (reverse proxy, TLS)
              ↓
         lmpdf-frontend (nginx:80)
              ├── /           → SPA React
              └── /api/       → proxy_pass vers backend:3000
              └── /uploads/   → proxy_pass vers backend:3000

lmpdf-backend  (node, NestJS)
lmpdf-postgres (PostgreSQL 16)
lmpdf-redis    (Redis 7)
lmpdf-garage   (S3-compatible storage)
lmpdf-vision   (FastAPI, OCR)
```

### Différences dev vs prod

| Aspect | Dev | Prod |
|--------|-----|------|
| Dockerfile | `Dockerfile` | `Dockerfile.prod` |
| Compose | `docker-compose.yml` | `docker-compose.prod.yml` + `--env-file .env.prod` |
| Ports | publiés sur `127.0.0.1` | `expose` uniquement (8080 pour Traefik) |
| Frontend | Vite dev server | nginx + build Vite |
| Backend | `NODE_ENV=development` | `NODE_ENV=production` |
| Secrets | `.env` avec valeurs par défaut | `.env.prod` avec `${VAR:?}` validation |
| CORS | `localhost:*` | `https://lmpdf.gueguen.org` |
| Base de données | bind mount `./infra/postgres-data` | volume Docker nommé |
| User Docker | root | `appuser:appgroup` |

Pour mettre à jour :
```bash
git pull origin fix/docker-prod
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
docker exec lmpdf-backend npx prisma migrate deploy
```

---

## Base de données (Prisma)

```bash
# Générer le client Prisma
cd apps/api
npx prisma generate

# Créer une migration
npx prisma migrate dev --name ma_migration

# Appliquer les migrations (en prod / Docker)
npx prisma migrate deploy
```

En environnement Docker, les migrations sont appliquées automatiquement au démarrage du conteneur API.

---

## Gestion des secrets

> ⚠️ **Jamais commiter le fichier `.env`.** Il contient des secrets (JWT, credentials S3, clés API).

Utiliser `.env.example` comme modèle — toutes les variables obligatoires y sont documentées.

---

## Licence

MIT — Libre d'utilisation et de modification.
