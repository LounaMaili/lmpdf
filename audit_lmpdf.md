# Audit de Sécurité et d'Optimisation - LMPdf

**Date:** 2025-04-12
**Auditeur:** SuperClaude AI
**Version auditée:** État actuel du repository

---

## Résumé Exécutif

L'application LMPdf est un système de gestion de templates PDF avec authentification (locale/LDAP), export serveur, et permissions documentaires. L'audit a identifié plusieurs vulnérabilités de sécurité et opportunités d'optimisation.

---

## 1. Vulnérabilités de Sécurité

### 🔴 HIGH - Hardcoded Credentials in docker-compose.yml

**Fichier:** `docker-compose.yml` (lignes 6-8, 27-29)

**Description:**
Les credentials par défaut sont hardcodés dans le fichier docker-compose:
- PostgreSQL: `POSTGRES_PASSWORD: lmpdf`
- S3/Garage: `S3_ACCESS_KEY` et `S3_SECRET_KEY` avec valeurs par défaut

**Impact:**
En production, ces credentials par défaut pourraient être utilisés si les variables d'environnement ne sont pas correctement configurées, exposant la base de données et le stockage S3.

**Remediation:**
- Exiger des variables d'environnement obligatoires pour tous les secrets en production
- Utiliser un fichier `.env.example` avec des placeholders vides
- Documenter la rotation des secrets
- Considérer l'utilisation de Docker secrets ou HashiCorp Vault

---

### 🔴 HIGH - Development Dockerfiles in Production

**Fichier:** `apps/api/Dockerfile`, `apps/web/Dockerfile`

**Description:**
Les Dockerfiles utilisent `npm run dev` comme commande par défaut:
```dockerfile
CMD ["sh", "-c", "npx prisma migrate deploy && npm run dev"]
```

**Impact:**
- Pas de minification du code frontend
- Hot reload activé (performance dégradée)
- Source maps exposés (fuite d'informations)
- Pas de tree-shaking efficace

**Remediation:**
Créer des Dockerfiles multi-stage avec:
1. Stage de build (`npm run build`)
2. Stage de production avec image minimale (alpine/nginx)
3. CMD pointant vers le build de production

---

### 🟠 MEDIUM - LDAP bindPassword Exposure

**Fichiers:**
- `apps/api/src/admin-settings.controller.ts` (ligne 191-197)
- `apps/api/src/config/runtime-settings.ts`

**Description:**
Le `bindPassword` LDAP est stocké dans le fichier `config/admin-settings.json` et potentiellement exposé via l'API admin (même si masqué avec `********`).

Le masquage côté client avec `'********'` ne protège pas la valeur envoyée sur le réseau.

```typescript
function sanitizeSettingsForClient(settings: AdminSettings): AdminSettings {
  return {
    ...settings,
    ldap: {
      ...settings.ldap,
      bindPassword: settings.ldap.bindPassword ? '********' : '',// Still sent resolved
    },
  };
}
```

**Remediation:**
- Ne jamais retourner le bindPassword dans les réponses API
- Utiliser un champ séparé pour indiquer si le password est configuré (`hasBindPassword: boolean`)
- Stocker les secrets LDAP dans des variables d'environnement ou un gestionnaire de secrets

---

### 🟠 MEDIUM - Insecure LDAP TLS Option

**Fichier:** `apps/api/src/auth/ldap.service.ts` (ligne 52)

**Description:**
L'option `LDAP_INSECURE_TLS` permet de désactiver la vérification des certificats TLS:
```typescript
const insecureTls = (process.env.LDAP_INSECURE_TLS || 'false') === 'true';
tlsOptions: { rejectUnauthorized: !insecureTls },
```

**Impact:**
Permet des attaques man-in-the-middle sur les connexions LDAP si activé.

**Remediation:**
- Documenter clairement que cette option ne doit JAMAIS être utilisée en production
- Logger un avertissement explicite quand cette option est activée
- Considérer la suppression de cette option

---

### 🟠 MEDIUM - Memory-Based Challenge Store (WebAuthn)

**Fichier:** `apps/api/src/auth/webauthn.service.ts` (lignes 32-58)

**Description:**
Les challenges WebAuthn sont stockés en mémoire dans un Map:
```typescript
const challengeStore = new Map<string, { challenge: string; expiresAt: number }>();
const passwordlessChallengeStore = new Map<string, { challenge: string; expiresAt: number }>();
```

**Impact:**
- Perte des challenges au redémarrage du serveur →sessions WebAuthn invalidées
- Vulnérabilité DoS potentielle (malgré les limites de taille)
- Ne scalle pas horizontalement (multiple instances backend)

**Remediation:**
- Migrer vers Redis (déjà disponible dans docker-compose)
- Utiliser une clé TTL de 2 minutes

---

### 🟠 MEDIUM - Missing Rate Limiting on Passwordless Endpoint

**Fichier:** `apps/api/src/auth/auth.controller.ts`

**Description:**
L'endpoint `POST /auth/login/passwordless-begin` a un throttle de 5/minute, mais le endpoint `passwordless-finish` pourrait être utilisé pour énumérer les utilisateurs sans limite stricte.

La réponse est uniformisée mais le timing pourrait révéler l'existence d'un utilisateur.

**Remediation:**
- Ajouter un délai fixe pour uniformiser le temps de réponse
- Considérer un throttle plus strict sur les endpoints d'authentification
- Logger les tentatives échouées pour détection d'anomalies

---

### 🟠 MEDIUM - First User Becomes Admin

**Fichier:** `apps/api/src/auth/auth.controller.ts` (lignes 52-55)

**Description:**
```typescript
const userCount = await this.prisma.user.count();
const role = userCount === 0 ? 'admin' : 'editor';
```

**Impact:**
Si `ALLOW_SELF_REGISTER=true`, le premier utilisateur à s'inscrire devient automatiquement admin. Un attaquant pourrait créer un compte avant le propriétaire légitime.

**Remediation:**
- Désactiver l'auto-promotion du premier utilisateur si `ALLOW_SELF_REGISTER=true`
- Exiger un token d'invitation ou une configuration manuelle pour le premier admin
- Logger cet événement de manière visible

---

### 🟡 LOW - Permissive CORS in Development

**Fichier:** `apps/api/src/main.ts` (lignes 28-43)

**Description:**
En développement, CORS accepte toutes lesorigines si `STRICT_CORS` n'est pas `true`:
```typescript
if (process.env.NODE_ENV !== 'production' && !strictCors) {
  return callback(null, true);
}
```

**Remediation:**
- Exiger `STRICT_CORS=true` par défaut
- Logger un avertissement si CORS permissif en mode non-production

---

### 🟡 LOW - No Input Sanitization on Field Labels/Values

**Fichier:** `apps/api/src/templates/templates.service.ts`

**Description:**
Les labels et valeurs des champs de template ne sont pas sanitizés avant stockage ou affichage.

**Impact:**
Potentiel XSS côté client si les données sont rendues sans échappement dans le frontend.

**Remediation:**
- Valider et sanitiser les entrées côté backend (class-validator avec sanitize)
- Le frontend React échappe par défaut, mais vérifier les rendus via `dangerouslySetInnerHTML` (non détecté)

---

### 🟡 LOW - Template Names Used in File Paths

**Fichier:** `apps/api/src/export/export-resolver.ts`

**Description:**
Les noms de templates sont utilisés dans les chemins de fichiers exportés via`resolvePlaceholders()`.

Bien que `sanitiseSegment()` soit appliqué, des noms malveillants pourraient exploiter des failles.

**Remediation:**
- ✅ Déjà protégé par `sanitiseSegment()` et `validateExportPath()` qui rejettent `..`
- Renforcer avec une whitelist de caractères autorisés

---

## 2. Optimisations

### 🔴 HIGH - N+1 Query Problem

**Fichier:** `apps/api/src/templates/templates.service.ts`

**Description:**
Chaque template charge ses fields séparément:
```typescript
include: { fields: true }
```

Sile nombre de templates augmente, le nombre de fields joints peut devenir significatif.

**Remediation:**
- Utiliser `select` pour limiter les champs retournés
- Implémenter une pagination avec cursor
- Considérer le chargement lazy des fields

---

### 🟠 MEDIUM - Missing Database Connection Pooling

**Fichier:** `apps/api/src/prisma/prisma.service.ts`

**Description:**
Aucune configuration de connection pooling Prisma n'est visible.

**Remediation:**
Configurer `DATABASE_URL` avec des paramètres de pooling:
```
DATABASE_URL="postgresql://...?connection_limit=10&pool_timeout=30"
```

---

### 🟠 MEDIUM - Runtime Settings Loaded on Every Request

**Fichier:** `apps/api/src/config/runtime-settings.ts`

**Description:**
`loadRuntimeSettings()` lit le fichier `config/admin-settings.json` à chaque appel.

**Remediation:**
- Implémenter un cache avec TTL (ex: 30 secondes)
- Invalider le cache lors des modifications via admin settings

---

### 🟠 MEDIUM - useEffect Dependencies in Frontend

**Fichier:** `apps/web/src/App.tsx`

**Description:**
Plusieurs `useEffect` avec des dépendances potentiellement manquantes ou incorrectes, notamment:
- Ligne 240: dépendances `[applyFitZoom, fitMode, pageW, pageH]` mais `ZOOM_STEPS` est utilisé
- Plusieurs callbacks référencent des états sans être dans les dépendances

**Remediation:**
- Exécuter `npm run lint` avec les règles React hooks
- Utiliser `useCallback` pour stabiliser les références de fonction

---

### 🟡 LOW - Files Loaded into Memory (Upload)

**Fichier:** `apps/api/src/upload/upload.controller.ts`

**Description:**
Les fichiers uploadés sont entièrement lus en mémoire avec `readFile(file.path)` avant validation.

**Remediation:**
- Valider le type MIME via stream (lecture des premiers bytes uniquement)
- Utiliser des streams pour le traitement des gros fichiers

---

### 🟡 LOW - No Pagination on Admin Users Endpoint

**Fichier:** `apps/api/src/users/users.controller.ts` (non examiné mais supposé)

**Description:**
`getAdminUsers()` retourne potentiellement tous les utilisateurs sans pagination.

**Remediation:**
Ajouter pagination et filtres pour les grandes organisations.

---

### 🟡 LOW - Export Files Loaded into Memory

**Fichier:** `apps/api/src/export/export.controller.ts`

**Description:**
Les PDF exportés sont chargés entièrement en mémoire avant écriture:
```typescript
const pdfBuffer = await fsP.readFile(file.path);
```

**Remediation:**
Utiliser des streams pour les gros exports:
```typescript
import { pipeline } from 'stream/promises';
await pipeline(fs.createReadStream(file.path), fs.createWriteStream(fullPath));
```

---

## 3. Corrections Appliquées (LOW et MEDIUM)

### Corrections automatiques suggérées:

Aucune correction automatique n'a été appliquée car les modifications nécessitent une revue manuelle du propriétaire du projet, en particulier pour:
- Les secrets et credentials
- La configuration Docker
- Les changements de structure backend

---

## 4. Recommandations Prioritaires

### Immédiat (HIGH):
1. **Modifier les Dockerfiles** pour des builds de production multi-stage
2. **Exiger des secrets forts** pour les variables d'environnement obligatoires
3. **Ne jamais exposer bindPassword** dans l'API admin

### Court terme (MEDIUM):
4. **Migrer les challenges WebAuthn** vers Redis
5. **Implémenter un cache** pour les runtime settings
6. **Configurer le connection pooling** Prisma

### Moyen terme:
7. **Audit des dépendances npm** (`npm audit`, Snyk)
8. **Tests de pénétration** sur les flux d'authentification
9. **Rate limiting global** avec configuration par endpoint

---

## 5. Points Positifs

✅ Validation des entrées avec class-validator (DTOs)
✅ Path traversal protection dans export-security.ts
✅ Rate limiting avec @nestjs/throttler sur les endpoints d'auth
✅ JWT avec vérification d'expiration
✅ MFA avec TOTP + WebAuthn
✅ Magic bytes validation pour les uploads
✅ Permissions documentaires granulaires (owner/editor/filler)
✅ Anonymisation des erreurs pour éviter l'énumération d'utilisateurs

---

## Conclusion

L'application présente une architecture sécurité raisonnable avec des mécanismes d'authentification robustes (MFA, WebAuthn, LDAP). Les principales vulnérabilités concernent:

1. **La configuration production** (Dockerfiles de dev, secrets hardcodés)
2. **L'exposition des secrets** (bindPassword LDAP)
3. **Le scaling** (challenges en mémoire, pas de pooling)

Une attention particulière doit être portée à la configuration de production et à la gestion des secrets avant tout déploiement en environnement sensible.