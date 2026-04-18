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

## Déploiement sur une VM distante

Le déploiement se fait via **git** :

```bash
# 1. Installer les dépendances système (Docker, Compose)
bash scripts/install-host-deps-linux.sh

# 2. Cloner le dépôt sur la VM
git clone https://github.com/winpoks/lmpdf.git
cd lmpdf

# 3. Configurer l'environnement
cp .env.example .env
# Éditer .env avec les secrets de production

# 4. Lancer les conteneurs
docker compose up -d --build
```

Pour mettre à jour :
```bash
git pull origin main
docker compose up -d --build
```

> Les anciens scripts (`install-vm.sh`, `make-release.sh`) et `DEPLOY_VM.md` sont obsolètes depuis la migration git.

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
