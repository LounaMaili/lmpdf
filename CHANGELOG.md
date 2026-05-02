# CHANGELOG

Toutes les modifications significatives du projet sont documentées ici. Format `AAAA-MM-DD`.

---
## [2026-05-02] Déploiement Docker production

### Added
- **Dockerfile.prod (backend)** : build multi-stage (deps → Prisma generate + TypeScript → runtime), user non-root `appuser`, `NODE_ENV=production`
- **Dockerfile.prod (frontend)** : build Vite avec `ARG VITE_API_URL=/api`, servi par `nginx:alpine` avec SPA fallback + proxy `/api/` et `/uploads/`
- **nginx.prod.conf** : configuration nginx production — `try_files` pour SPA, proxy pass vers backend
- **docker-compose.prod.yml** : compose standalone (pas d'overlay dev/prod), `expose` uniquement (pas de ports publiés), healthcheck Postgres, validation des secrets `${VAR:?}`
- **.env.prod** : variables de production avec secrets générés (`openssl rand`), CORS strict, self-register désactivé
- **Validation des secrets prod** : `POSTGRES_PASSWORD` et `S3_SECRET_KEY` ajoutés aux checks obligatoires dans `main.ts`
- **MFA_ENCRYPTION_KEY** : générée aléatoirement en prod (64 hex chars)

### Fixed
- **React 19 TypeScript** : `useRef<HTMLDivElement>(null)` → `useRef<HTMLDivElement | null>(null)` (ref readonly en TS 5.x)
- **React 19 TypeScript** : `createPortal()` retourne `ReactPortal`, cast en `React.ReactNode` pour compat JSX
- **Prisma client en prod** : copie complète de `node_modules` + `apps/api/node_modules` (symlinks pnpm) au lieu de `pnpm prune` qui cassait la résolution
- **docker.draft.dto.ts** : retrait `@IsOptional()`/`@IsObject()` sur l'index signature (TS1206)
- **runtime-settings.ts** : ajout `governance` au type `RuntimeAdminSettings`

### Changed
- **Port frontend** : `0.0.0.0:8080:80` pour accès Traefik externe (au lieu de `127.0.0.1`)
- **Garage** : layout cluster configuré, bucket `lmpdf` créé, clé S3 dédiée
- **Traefik** : config simplifiée — un seul router+service vers `10.0.1.201:8080` (nginx gère `/api/` en interne)

---
## [2026-05-01c] Sécurité : contrôle d'accès /detect + protection path traversal

### Fixed
- **Contrôle d'accès /detect** : injection de `PermissionsService` dans `DetectController` — vérification `requireDocRole(documentId, user, 'editor')` avant toute détection. Un utilisateur ne peut plus lancer une détection sur un document auquel il n'a pas accès.
- **Path traversal upload** : ajout d'une vérification `resolve()` + `startsWith()` dans `streamDocument` pour s'assurer que le chemin absolu du fichier reste dans le répertoire `uploads/`, même si `doc.path` venait à être compromis en base.
- **Vision path renforcé** : le path envoyé à Vision provient désormais uniquement du document vérifié en base, jamais du payload client.


## [2026-05-01b] Sécurité : validation des secrets en production + Vision interne uniquement

### Fixed
- **Vision exposé publiquement** : port 8001 changé de `ports` à `expose` dans docker-compose — le service n'est plus accessible en dehors du réseau Docker interne
- **Secrets faibles en production** : l'API refuse de démarrer en production si JWT_SECRET, POSTGRES_PASSWORD ou S3_SECRET_KEY utilisent des valeurs par défaut ou faibles. JWT_SECRET doit faire au moins 32 caractères.
- **MFA_ENCRYPTION_KEY obligatoire en production** : si MFA_POLICY n'est pas "disabled", l'API refuse de démarrer sans MFA_ENCRYPTION_KEY valide (64 hex chars). Vérification de la longueur aussi.
- Contrôle explicite des variables sensibles (pas de scan global de process.env)


## [2026-05-01] Correction orientation coche checkbox en paysage (90/270)

### Fixed
- **Checkbox coche inversée en paysage** : `drawCheckboxMarkLandscape` réécrit — au lieu d'un swap d'axes + inversion partielle qui retournait la coche, la nouvelle version prend la géométrie de base identique au mode portrait et applique une contre-rotation autour du centre de la case pour compenser la rotation de page (90deg -> -PI/2, 270deg -> +PI/2). La coche apparaît désormais dans le bon sens à la fois en portrait (0/180) et en paysage (90/270).
- **Fallback sécurité** : `drawCheckboxMarkLandscape` appelle `drawCheckboxMark` (portrait) si jamais appelé avec une rotation autre que 90/270, au lieu de silencieusement produire un résultat incorrect.


## [2026-04-30] Corrections d'alignement export et ergonomie éditeur

### Fixed
- **`isText` non déclaré** : ajout de `const isText = field.type === 'text'` dans FieldOverlay.tsx — corrigeait un `ReferenceError` causant une page blanche dès qu'un champ texte/date devait être rendu
- **Styles partiels** : `normalizeField()` merge désormais `defaultFieldStyle` avec les styles partiels au lieu de les remplacer entirely (`{ ...defaultFieldStyle, ...(f.style ?? {}) }`)
- **Champ date séparé de RichTextEditor** : le champ date utilise désormais un `<textarea>` mono-ligne stylé comme `.field-input.field-textarea` au lieu de passer par `contentEditable`, ce qui corrige le bug de curseur qui sautait à chaque frappe
- **Fond jaune sur les champs** : `highlightColor` n'est plus appliqué en mode préparation ; les champs sont transparents. En mode remplissage, le highlight reste possible. `maskBackground` continue d'afficher un fond blanc
- **Sélection checkbox/counter** : en mode préparation, un clic sur une checkbox ou un compteur sélectionne le champ au lieu de toggler la valeur ; en mode remplissage, le comportement toggle est conservé
- **Drag sur checkbox/counter** : le handler mousedown ne bloque plus le drag en mode préparation sur `.checkbox-display` / `.counter-display`
- **Poignée de déplacement** : visible au survol (`selected || hovered`) au lieu de seulement quand sélectionné
- **Export checkbox portrait** : `drawCheckboxMark` reçoit un guard `Number.isFinite` pour skipper les checkbox aux coordonnées invalides au lieu de crasher l'export
- **Export checkbox paysage** : `drawCheckboxMarkLandscape` corrigé — transformation basée sur `pdfX/pdfY` à l'intérieur de la boîte du champ au lieu de `pdfW/pdfH` globaux qui envoyaient la coche hors de sa case
  - 90° : `x = pdfX + boxW - dy`, `y = pdfY + dx`
  - 270° : `x = pdfX + dy`, `y = pdfY + boxH - dx`
  - Points SVG recalés sur la géométrie éditeur (0.25/0.52, 0.42/0.70, 0.75/0.30)
- **Export 0°/180° : debug logging** : `try/catch` autour de `drawFieldPortrait` / `drawFieldLandscape` pour logger l'id, type, rotation et coordonnées du champ qui fait échouer l'export

### Changed
- **`TEXT_Y_NUDGE`** : -2.8 → -2.4 (texte légèrement remonté)
- **`DATE_EXTRA_Y_NUDGE`** : ajout de +0.8 (la date était trop haute, maintenant légèrement poussée vers le bas)
- **`LANDSCAPE_TEXT_Y_NUDGE`** : -2.4 et **`LANDSCAPE_DATE_EXTRA_Y_NUDGE`** : +0.8 (calibration paysage alignée sur portrait)
- **`drawFieldPortrait`** : appelle `drawCheckboxMark` (portrait) pour les checkbox, pas `drawCheckboxMarkLandscape`
---

## [2026-04-16] Corrections toolbar + drag & drop fonctionnel

### Fixed
- **Toolbar multiple** : `SelectionToolbar` n'était montée que pour le champ sélectionné (`selected === true`)
- **Toolbar position invalide** : guard `rect.top === 0 && rect.left === 0` + position offscreen `(-9999, -9999)` quand masquée
- **Toolbar hors éditeur** : ajout guard explicite `if (!containerRef) return`
- **Overflow prématuré** : `stripHtml()` dans `estimateFieldCapacity` et `takeFieldChunk` — le HTML (mark, b, etc.) n'est plus comptabilisé dans la capacité du champ

### Confirmed
- **Drag & drop fichier** : fonctionnel depuis le bureau/explorateur — overlay "📥 Déposez le fichier ici", upload au drop

---

## [2026-04-15] Éditeur rich text + toolbar de formatage

### Added
- **RichTextEditor** : composant `contentEditable` avec support inline formatting (gras, italique, souligné, barré)
- **SelectionToolbar** : toolbar flottante apparaissant à côté de la sélection de texte (B/I/U/S, surlignage, couleur texte)
- **Surlignage** : 8 couleurs de surlignage via `hiliteColor`
- **Couleur du texte** : 8 couleurs via `foreColor`
- **Palette de couleurs** : 10 couleurs dans le panneau propriétés (en plus de la toolbar)
- **Boutons de style** : I (italique), U (souligné), S (barré) dans le panneau propriétés
- **Alignement** : boutons gauche/centre/droite/justifié dans le panneau propriétés
- **Zoom fin** : pas de zoom à 10% (au lieu de 25%) pour un contrôle plus précis
- **Drag & drop fichier** : overlay visuel pendant le drag, upload au drop
- **Indicateur mode remplissage** : badge ✏️ édition / 🔒 remplissage + badge rôle
- **user-select:text** en fillMode pour permettre la sélection native du texte
- **SelectionToolbar via Portal** : rendu dans `document.body` pour éviter les conflits avec `transform: scale()`

### Changed
- `FieldStyle` étendu avec `fontStyle`, `textDecoration`, `highlightColor`
- Le champ texte en fillMode utilise un `RichTextEditor` (contentEditable) au lieu d'un simple `div`
- `paddingLeft: 4px` dans le RichTextEditor pour éviter le rognage du texte
- Correction de la perte de texte en fillMode via `key={field.id}-${fillMode}`
- Ménage projet : suppression de `audit_lmpdf.md`, `audit_lmpdf_v2.md`, `services/processing/`, `packages/shared/`
- `.gitignore` mis à jour avec `infra/`

### Fixed
- Texte qui disparaissait en mode remplissage quand fillMode changeait
- Toolbar invisible à cause de `transform: scale()` sur le container PDF → corrigé via React Portal
- Sélection impossible à cause de `user-select: none` sur `.field` → corrigé en fillMode
- Formatage (`execCommand`) ne fonctionnait pas car `activeElement` n'était plus le contentEditable → sauvegarde/restauration de la sélection
- Marge gauche du texte trop réduite dans les champs

### Known Issues
- Le **gras** peut être peu visible selon la police et la taille de caractère utilisées
- Le `user-select: text` en fillMode pourrait interférer avec le drag des champs dans certains cas marginaux
---

## [2026-03-29] Authentification MFA

### Added
- **MFA TOTP** : support des codes temporaires (Google Authenticator, Authy…) via `mfa.service.ts`
- **WebAuthn** : enregistrement de clés sécurité (YubiKey, Touch ID…) via `webauthn.service.ts`
- **Porte-mots de passe condamné** : route `/auth/register` + endpoint admin MFA

### Changed
- `auth.module.ts` réorganisé pour intégrer MFA + WebAuthn
- Schéma Prisma étendu avec `User.mfaEnabled`, `User.webauthnCredentials`

---

## [2026-03-25] Authentification par source (phase 1)

### Added
- `User.authSource` : distingue les comptes locaux (`local`) des comptes LDAP
- Support de l'authentification LDAP dans `ldap.service.ts`

---

## [2026-03-11] Auto-sauvegarde des drafts

### Added
- **Sauvegarde automatique** des brouillons toutes les 30 secondes
- Restauration d'un brouillon après rechargement de page ou reconnexion
- Indicateur visuel "Brouillon restauré" dans l'interface

---

## [2026-02-16] Permissions et verrouillage

### Added
- **Système de permissions** : `owner` / `editor` / `filler` par document
- `DocumentPermission` table : partage par utilisateur ET/OU groupe
- **Verrouillage de champs** : propriété `locked` sur `Field` — empêche la modification de la structure par les remplisseurs
- **Recherche d'utilisateurs** : `GET /users/search?q=...`
- **Modal de partage** : bouton partage, recherche user/groupe, attribution de rôle, révocation

### Changed
- Les remplisseurs (`filler`) ne peuvent plus modifier les paramètres de verrouillage
- Le badge de rôle (`Propriétaire / Éditeur / Remplisseur`) s'affiche dans le panneau gauche

---

## [2026-02-15] Navigation clavier et réorganisation des champs

### Added
- **Navigation au clavier** : Tab / Shift+Tab parcourt les champs dans l'ordre du document
- **Réorganisation des champs** : boutons ▲/▼ dans le panneau droit — l'ordre définit la séquence Tab
- **Type champ date** : nouveau type `date` avec masque automatique `DD/MM/YYYY`

### Changed
- Les champs vides (texte et date) ne sont pas inclus dans l'export PDF
- Le visualiseur PDF attend le buffer complet avant rendu (évite les échecs post-upload)

---

## [2026-02-14] Sécurité et exports

### Added
- **Renforcement JWT** : blocage en production si `JWT_SECRET` encore par défaut
- **Ownership scoping** : les documents/templates ont un propriétaire, règles d'accès admin owner-only
- Support des propriétés `value` et `style` persistées sur les champs de template

### Changed
- Champs texte : support multiligne (textarea avec retour à la ligne automatique)
- Rotation des pages mieux gérée dans le viewer et l'export
- Coche PDF passée du style "✗" à "✓" avec adaptation de taille automatique
- Logging et commentaires homogénéisés dans le code

---

## [2026-02-11] Fondation monorepo

### Added
- Architecture monorepo pnpm (`apps/web`, `apps/api`, `apps/vision`, `packages/shared`)
- API NestJS fonctionnelle : santé, upload, templates, détection
- Frontend React avec éditeur drag & drop
- Service Vision placeholder avec contrat `suggestedFields[]`
- Schéma Prisma complet : Users, Documents, Templates, Fields, Groups, Permissions

---

## Versions antérieures

Les entrées précédentes sont conservées dans l'historique git du dépôt.
