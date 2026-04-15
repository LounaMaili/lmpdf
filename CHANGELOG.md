# CHANGELOG

Toutes les modifications significatives du projet sont documentées ici. Format `AAAA-MM-DD`.

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
- **Drag & drop fichier** depuis le bureau/explorateur non fonctionnel (overlay visuel présent mais upload incomplet)

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
