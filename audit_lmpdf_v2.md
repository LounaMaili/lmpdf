# Audit de sécurité — LMPdf Backend (v2)
_Date : 2026-04-14_

---

## 1. `apps/api/src/main.ts`

| # | Sévérité | Fichier:Ligne | Description | Correction |
|---|----------|---------------|-------------|------------|
| 1 | **MEDIUM** | `main.ts:22-32` | **CSP contient `'unsafe-inline'` dans styleSrc** — permet l'injection de styles arbitraires via XSS. | Supprimer `'unsafe-inline'`; utiliser des nonces ou hashes CSS. |
| 2 | **MEDIUM** | `main.ts:38-48` | **CORS lax en dev** — hors production (ou `STRICT_CORS≠true`), **toute origine est acceptée**. Risque de CSRF si l'API est exposée. | Forcer `STRICT_CORS=true` par défaut; ne jamais accepter `*` même en dev. |
| 3 | **LOW** | `main.ts:1` | **Pas de rate limiting global** — seul le throttle par route existe (`@Throttle` sur les endpoints auth). Les autres endpoints (GET me, permissions, etc.) n'ont aucune protection. | Ajouter un `ThrottlerModule` global ou un middleware rate-limit. |
| 4 | **LOW** | `main.ts:71` | **Port hardcodé 3000** — pas configurable via env. | Utiliser `process.env.PORT \|\| 3000`. |

---

## 2. `apps/api/src/auth/auth.controller.ts`

| # | Sévérité | Fichier:Ligne | Description | Correction |
|---|----------|---------------|-------------|------------|
| 5 | **MEDIUM** | `auth.controller.ts:44` | **`body.password` non validé par DTO** — `LoginDto` et `RegisterDto` sont utilisés mais on ne voit pas les contraintes ici. Vérifier que `RegisterDto` impose un mot de passe assez long (sinon: brute-force facilité). | S'assurer d'une longueur min (≥8) et éventuellement complexité. |
| 6 | **MEDIUM** | `auth.controller.ts:42` | **bcrypt rounds = 10** — acceptable mais 12 est recommandé en 2026. | Augmenter à 12. |
| 7 | **LOW** | `auth.controller.ts:63-73` | **Premier utilisateur = admin** — un attaquant qui s'inscrit le premier devient admin si `ALLOW_SELF_REGISTER=true`. | Forcer la création du premier admin via CLI/seed, pas via l'API. |
| 8 | **LOW** | `auth.controller.ts:227` | **`body.response` typé `any`** dans `loginWebauthnVerify` et `passwordlessFinish` — pas de validation DTO. | Créer un DTO avec validation. |
| 9 | **MEDIUM** | `auth.controller.ts:122` | **`mfaChallengeToken` signé avec le même `JWT_SECRET`** que les tokens de session — si le secret fuit, un attaquant peut forger des challenge tokens ET des session tokens. | Utiliser une clé séparée ou un `issuer`/`audience` distinct pour les challenge tokens. |

---

## 3. `.env.example` — Secrets en dur / par défaut faibles

| # | Sévérité | Fichier:Ligne | Description | Correction |
|---|----------|---------------|-------------|------------|
| 10 | **HIGH** | `.env.example:3` | **`DATABASE_URL` avec identifiants par défaut `lmpdf:lmpdf`** — si utilisé tel quel en prod, la DB est compromise. | Générer des credentials uniques; ne jamais livrer de vrais mots de passe dans `.env.example`. |
| 11 | **HIGH** | `.env.example:12` | **`JWT_SECRET=change-me-in-prod`** — faible et prévisible. Si un déploiement oublie de le changer, tous les JWT sont forgerables. | Refuser le démarrage si `JWT_SECRET` == valeur par défaut ou < 32 chars. |
| 12 | **MEDIUM** | `.env.example:26` | **`LDAP_BIND_PASSWORD=changeme`** — mot de passe service LDAP en clair dans `.env`. | Documenter l'utilisation d'un secret manager; ne jamais committer le vrai `.env`. |
| 13 | **MEDIUM** | `.env.example:22` | **`MFA_ENCRYPTION_KEY` vide par défaut** — les secrets TOTP sont stockés en clair si non défini. | Refuser l'activation du MFA si la clé n'est pas configurée. |

---

## 4. `docker-compose.yml` — Problèmes

| # | Sévérité | Fichier:Ligne | Description | Correction |
|---|----------|---------------|-------------|------------|
| 14 | **HIGH** | `docker-compose.yml:8` | **`POSTGRES_PASSWORD: lmpdf`** en clair dans le compose — visible dans `docker inspect`, `docker-compose config`, etc. | Utiliser `POSTGRES_PASSWORD_FILE` ou un secret Docker. |
| 15 | **HIGH** | `docker-compose.yml:34` | **`S3_SECRET_KEY: ${GARAGE_SECRET_KEY:-lmpdf-secret-key-change-me-in-prod}`** — valeur par défaut faible et en clair. | Pas de fallback; échouer si la variable n'est pas définie. |
| 16 | **MEDIUM** | `docker-compose.yml:24` | **`NODE_ENV: development`** dans le compose — active le comportement dev (CORS lax, stack traces, etc.). | Passer à `production` par défaut. |
| 17 | **LOW** | `docker-compose.yml:42-44` | **`backend` expose le port 3000 sur `0.0.0.0`** (pas de `127.0.0.1:`) — contrairement à Postgres/Redis/Garage qui sont limités à localhost. | Ajouter `'127.0.0.1:3000:3000'` si l'API ne doit être accessible que via reverse proxy. |

---

## 5. `apps/api/src/auth/ldap.service.ts` — Exposition du bindPassword

| # | Sévérité | Fichier:Ligne | Description | Correction |
|---|----------|---------------|-------------|------------|
| 18 | **MEDIUM** | `ldap.service.ts:72` | **`bindPw` lu depuis `process.env.LDAP_BIND_PASSWORD` ou `runtimeSettings`** — le mot de passe de service LDAP transite en clair dans la mémoire du process Node. Un `process.env` dump ou un heap snapshot l'expose. | Utiliser un vault/secret manager; éviter de stocker le password dans les settings JSON. |
| 19 | **LOW** | `ldap.service.ts:50` | **`enabled` lit `admin-settings.json` de manière synchrone** (`readFileSync`) à chaque appel — pas de cache, et le path est relatif à `cwd`. Risque de leak du contenu si une erreur non gérée se produit. | Cacher le résultat; utiliser un accessor async. |
| 20 | **MEDIUM** | `ldap.service.ts:86` | **Pas de timeout sur les opérations LDAP** — un LDAP lent/injoignable peut bloquer indéfiniment les requêtes d'auth. | Configurer un timeout (`connectTimeout`, `timeout`) sur `createClient`. |

---

## Résumé

| Sévérité | Count |
|----------|-------|
| **HIGH** | 3 (#10, #11, #14) |
| **MEDIUM** | 9 |
| **LOW** | 5 |

### Actions prioritaires
1. **Refuser le démarrage avec des secrets par défaut** (`JWT_SECRET`, `POSTGRES_PASSWORD`, `S3_SECRET_KEY`)
2. **Limiter l'exposition réseau** du backend (port 3000 → localhost uniquement)
3. **Passer `NODE_ENV` à `production`** dans le compose
4. **Configurer `MFA_ENCRYPTION_KEY`** obligatoirement avant d'activer le MFA
5. **Séparer la clé de signature** des challenge tokens MFA
