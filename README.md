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

L'objectif : fournir un outil local, léger et autonome pour générer des documents
PDF sans dépendre d'un service cloud.

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
| Détection automatique de zones (OCR/Vision) | Implémentée, à revalider |
| Authentification LDAP | Implémentée, à revalider |
| SSO | 🔜 |

---

## Architecture

```
apps/web        →  React + Vite + TypeScript  (frontend)
apps/api        →  NestJS + Prisma            (backend)
apps/vision     →  FastAPI + OpenCV/Tesseract (service OCR/vision)
docker-compose* →  Postgres, Redis, Garage et applications
infra           →  Configuration Garage et données runtime locales
```

Les uploads actuels utilisent un volume local partagé entre API et Vision.
Garage est configuré dans Compose mais n'est pas utilisé par ce flux.

Voir [ARCHITECTURE.md](./ARCHITECTURE.md) pour les détails.

---

## Prérequis

- **Docker** + **Docker Compose** pour l'exécution conteneurisée
- **Node.js** 22+ et **pnpm** 9.0.0 pour les commandes applicatives hors conteneur

Le développement du code se fait sur Fedora ; installations, builds et
validations applicatives se font uniquement sur la VM Debian `lmpdf-dev`.
Voir [AGENTS.md](./AGENTS.md). La VM actuelle exécute LMPdf dans Docker et ne
dispose pas de Node/pnpm sur l'hôte.

---

## Démarrage rapide

```bash
# Sur un nouvel environnement Debian dédié, pas sur Fedora :
git clone https://github.com/LounaMaili/lmpdf.git
cd lmpdf

# Configurer l'environnement de développement
cp .env.example .env
# Adapter .env sans y laisser de secrets par défaut

# Démarrer l'ensemble des services conteneurisés
docker compose up -d --build
```

Cette procédure concerne une nouvelle installation. Ne l'exécutez pas sur
l'instance `lmpdf-dev` déjà active dans le cadre d'une simple validation.
Le Compose de développement démarre déjà les conteneurs frontend et backend ;
ne lancez pas `pnpm dev` sur les mêmes ports en parallèle. Son Dockerfile API
utilise encore `npm install` sans lockfile npm : ce mode reste à rendre
reproductible et n'est pas utilisé pour la validation de cette baseline.

---

## URLs par défaut

| Service | URL |
|---|---|
| Web (frontend) | http://localhost:4173 |
| API (backend) | http://localhost:3000/api/health |
| Vision (OCR) | Service interne Docker sur le port 8001, non publié sur l'hôte |
| Garage S3 API | http://localhost:3900 (local uniquement) |
| Garage Admin | http://localhost:3903 (local uniquement) |

---

## Déploiement en production

Le déploiement utilise un Compose autonome (`docker-compose.prod.yml`) avec des
Dockerfiles multi-stage et nginx comme proxy interne. Choisir un SHA de commit
déjà poussé et validé sur GitHub ; ne pas revenir à l'ancienne branche
`fix/docker-prod`, supprimée.

```bash
# Sur une nouvelle installation uniquement :
git clone https://github.com/LounaMaili/lmpdf.git
cd lmpdf

# Sur une copie déjà installée, se placer dans son dossier et vérifier Git :
git status --short --branch
# Arrêter ici si un fichier suivi est modifié.

# Dans les deux cas, utiliser le SHA validé sur GitHub :
git fetch origin --prune
git switch --detach SHA_DU_COMMIT_VALIDE
```

Pour une **nouvelle installation seulement**, créer `.env.prod` puis renseigner
ses valeurs obligatoires. Sur une mise à jour, conserver le fichier existant.

```bash
cp .env.prod.example .env.prod
```

Après configuration de `.env.prod` :

```bash
docker compose --env-file .env.prod -f docker-compose.prod.yml config --quiet

# Déployer seulement après validation de la révision et planification du changement
docker compose --env-file .env.prod -f docker-compose.prod.yml up -d --build
```

Sur la VM existante, conserver `.env` et `.env.prod` : vérifier d'abord l'état
Git, puis faire `git fetch origin --prune` et `git switch --detach` vers le SHA
exact poussé. Les migrations, l'initialisation Garage et la création de comptes
sont des opérations distinctes, à planifier explicitement. Le conteneur API de
production **n'applique pas** automatiquement les migrations au démarrage.

### Architecture prod

```
Internet → Traefik (reverse proxy, TLS)
              ↓
         lmpdf-frontend (nginx:80, port hôte 8080)
              ├── /           → SPA React
              └── /api/       → proxy_pass vers backend:3000
                  └── /api/uploads/ → fichiers servis par l'API après contrôle d'accès

lmpdf-backend  (node, NestJS)
lmpdf-postgres (PostgreSQL 16)
lmpdf-redis    (Redis 7)
lmpdf-garage   (service S3 configuré, hors flux actuel des uploads)
lmpdf-vision   (FastAPI, OCR)
```

### Différences dev vs prod

| Aspect | Dev | Prod |
|--------|-----|------|
| Dockerfile | `Dockerfile` | `Dockerfile.prod` |
| Compose | `docker-compose.yml` | `docker-compose.prod.yml` + `--env-file .env.prod` |
| Ports | Web/API publiés ; Postgres/Redis/Garage sur `127.0.0.1` ; Vision interne | Frontend publié sur `8080`, API et Vision internes |
| Frontend | Vite dev server | nginx + build Vite |
| Backend | `NODE_ENV=development` | `NODE_ENV=production` |
| Secrets | `.env` avec valeurs par défaut | `.env.prod` avec `${VAR:?}` validation |
| CORS | Origines localhost configurées dans Compose | `https://lmpdf.gueguen.org` par défaut |
| Base de données | bind mount `./infra/postgres-data` | volume Docker nommé |
| User Docker API | root | `appuser:appgroup` |

Pour une mise à jour, reprendre la procédure au SHA approuvé après vérification
de l'arbre Git. Ne pas utiliser `git pull` ni déployer directement `main` sur la
VM de validation.

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

Le Dockerfile de développement lance `prisma migrate deploy` au démarrage de
l'API. Le conteneur de production ne le fait pas ; une migration de production
exige une décision et une commande explicites.

---

## Gestion des secrets

> ⚠️ **Ne jamais committer `.env` ni `.env.prod`.** Ils peuvent contenir des
> secrets JWT, S3/Garage, LDAP ou MFA.

Utiliser `.env.example` pour le développement et `.env.prod.example` pour la
production. Les exemples ne contiennent aucun secret utilisable ; leurs champs
vides doivent être renseignés avant un déploiement.

---

## Licence

MIT — Libre d'utilisation et de modification.
