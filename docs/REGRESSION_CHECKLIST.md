# Checklist de régression — reprise LMPdf

Audit documentaire du 27 septembre 2026. Base examinée : `main` au commit
`d945ca1b390e33dae3760d84080e0c978907250b` (PR autosave #5, merge commit).
Au début des contrôles, la VM `lmpdf-dev` exécutait encore
`d8b41f189e3218c4144baadc071b790feb62efb9` : ces deux commits ont **le
même arbre Git**. Aucun code ni donnée applicative n'a été modifié pour cet audit.

## Lecture de la checklist

- **OK** : comportement précisément indiqué vérifié sur la VM, ou couvert par
  les 17 tests ciblés de l'autosave validés lors de la branche précédente.
  Ce statut ne vaut pas validation de tout le parcours utilisateur.
- **À revalider** : code présent, mais résultat fonctionnel ou matrice de cas
  encore non observés avec une session authentifiée et des documents de test.
- **Bug confirmé** : écart déterministe constaté par le code ou par un contrôle
  non destructif sur la VM. Sauf mention contraire, aucun scénario d'exploitation
  ou de corruption des données n'a été exécuté.
- **Incomplet** : fonction annoncée ou attendue sans implémentation complète.
- **Dette technique** : couverture, architecture ou exploitation à améliorer.

**Méthodes** : `C` = lecture du code ; `V` = vérification en lecture seule sur
`lmpdf-dev` ; `T17` = les 17 tests dans
[`apps/web/tests/autosaveScheduler.test.ts`](../apps/web/tests/autosaveScheduler.test.ts)
(validés avant cet audit, pas relancés ici). `P1` = risque d'accès ou de perte
fonctionnelle élevé ; `P2` = fonction importante ; `P3` = qualité/ergonomie.
« Aucun test » signifie aucun test automatisé suivi dans le dépôt pour ce
parcours. Une preuve `C` seule ne valide pas le comportement en production.

Les contrôles `V` ont observé : frontend `200`, `/api/health` `200`, Vision
`/health` appelé depuis l'API `200`, PostgreSQL accessible depuis l'API (3
utilisateurs comptés), et routes templates/drafts/admin sans JWT `401`.
PostgreSQL est sain ; ses données comprennent 6 documents, 1 template, 3
brouillons et 102 champs. Le volume d'uploads contient 28 PDF et 1 image.
Les quatre conteneurs actifs sont PostgreSQL, backend, frontend et Vision ;
Garage et Redis ne sont pas actifs. Aucun test authentifié de l'éditeur n'a été
réalisé : l'accès navigateur externe passe par Authelia et son second facteur.
Le `pnpm` de l'hôte VM n'est pas disponible dans la session SSH non interactive,
donc `T17` n'a pas été relancé pendant cet audit. Aucun contournement de
l'authentification, écriture de données, migration, build ou redémarrage n'a été
effectué.

## Authentification

| Fonction | Statut | Validation / test | Anomalie et risque | Priorité |
|---|---|---|---|---|
| Login local | À revalider | C : [`auth.controller.ts`](../apps/api/src/auth/auth.controller.ts) (bcrypt, throttling) ; aucun test de connexion dans cet audit | Flux réel avec compte local et MFA éventuel non testé. | P2 |
| Garde JWT et accès anonyme | OK | C : [`jwt.strategy.ts`](../apps/api/src/auth/jwt.strategy.ts), garde global ; V : trois routes protégées répondent `401` sans jeton | Ne prouve pas les droits après authentification. | P1 |
| Expiration JWT | À revalider | C : durée de 7 jours, `ignoreExpiration: false` ; aucun test d'un jeton expiré | Vérifier refus et retour à l'écran de connexion. | P2 |
| Logout / révocation | Dette technique | C : [`auth.ts`](../apps/web/src/auth.ts) efface le jeton du stockage local | Pas de révocation serveur ; un JWT copié reste valable jusqu'à expiration ou désactivation du compte. | P2 |
| MFA TOTP et codes de secours | À revalider | C : [`mfa.service.ts`](../apps/api/src/auth/mfa.service.ts) chiffre le secret et hache les codes ; aucun test d'enrôlement/connexion | Parcours complet et récupération non éprouvés sur VM. | P1 |
| WebAuthn et passkeys | Bug confirmé | C : [`webauthn.service.ts`](../apps/api/src/auth/webauthn.service.ts) a pour défaut RP `localhost` / origin `http://localhost:4173` ; [`docker-compose.prod.yml`](../docker-compose.prod.yml) ne transmet aucun `WEBAUTHN_RP_ID`/`WEBAUTHN_RP_ORIGIN` | Le domaine/origin de l'instance de test ne correspond pas à ces défauts ; l'enrôlement/vérification WebAuthn ne peut pas aboutir dans cette configuration. Aucun test avec authentificateur réel. | P1 |
| LDAP / Active Directory | Bug confirmé | C : [`ldap.service.ts`](../apps/api/src/auth/ldap.service.ts) fait `require('ldapjs')` ; absent de [`apps/api/package.json`](../apps/api/package.json) et du lockfile ; V : `ldapjs_resolvable=false` dans le backend | Si LDAP est activé, `authenticate()` retourne `null` avant de contacter l'annuaire. Aucun annuaire de test sollicité. | P1 |
| Fallback admin local en mode hybride | Bug confirmé | C : [`auth.controller.ts`](../apps/api/src/auth/auth.controller.ts), condition `allowLocal` | Le drapeau nommé `allowLocalAdminFallback` permet la connexion de **tout** compte local valide en mode hybride ; aucun filtre `role === 'admin'`. À clarifier et tester selon la politique voulue. | P1 |

## Documents et stockage

| Fonction | Statut | Validation / test | Anomalie et risque | Priorité |
|---|---|---|---|---|
| Upload PDF | À revalider | C : [`upload.controller.ts`](../apps/api/src/upload/upload.controller.ts), limite 25 Mo, nom UUID ; V : PDF historiques présents | Aucun nouvel upload de test ni vérification rendu/métadonnées ; aucun test automatisé. | P2 |
| Upload image | À revalider | C : PNG/JPEG/GIF/WebP/BMP/TIFF acceptés ; V : une image historique dans `uploads-data` | Décodage/affichage par type non testé ; aucun test automatisé. | P2 |
| MIME / magic bytes | À revalider | C : détection par signature, extension dérivée, SVG exclu | Signatures courtes : la validité interne d'un PDF ou d'une image n'est pas prouvée. Ajouter des fixtures valides, tronquées et malformées. | P1 |
| Lecture d'un document existant | À revalider | C : [`api.ts`](../apps/web/src/api.ts) récupère le fichier protégé puis crée une blob URL ; V : route protégée inaccessible sans JWT | Pas de téléchargement authentifié ni rendu du document existant pendant cet audit. | P1 |
| Permissions d'accès au fichier | À revalider | C : propriétaire/admin/partage utilisateur/groupe dans `assertDocumentAccess`, contrôle de traversée de chemin ; V : garde JWT `401` | Les cas owner/editor/filler/absence de droit ne sont pas testés avec des comptes distincts ; 0 permission de document dans les données observées. | P1 |
| Persistance `uploads-data` | OK | V : même volume nommé monté dans API et Vision ; 28 PDF et 1 image comptés | Contrôle de présence seulement, pas de comparaison de checksum ni de restauration. | P1 |
| Upload refusé après réception | Dette technique | C : l'intercepteur écrit sur disque avant le contrôle `canUser()` dans le contrôleur | Un utilisateur authentifié sans droit d'upload peut laisser un fichier temporaire orphelin. Scénario non exécuté. | P2 |

## Éditeur

Sources principales : [`App.tsx`](../apps/web/src/App.tsx),
[`FieldOverlay.tsx`](../apps/web/src/components/FieldOverlay.tsx),
[`PropertiesPanel.tsx`](../apps/web/src/components/PropertiesPanel.tsx).
Aucun test automatisé de composant ou de navigateur n'est suivi dans le dépôt.

| Fonction | Statut | Validation / test | Anomalie et risque | Priorité |
|---|---|---|---|---|
| Création, modification, suppression de champs | À revalider | C : handlers présents dans `App.tsx` ; aucun test interactif | Tester chaque type, page et mode édition/remplissage. | P2 |
| Texte riche et sanitation | À revalider | C : `RichTextEditor`, DOMPurify côté web, `sanitize-html` côté API pour templates/brouillons | Tester formatage, rechargement, contenu hostile et rendu ; l'export a un défaut confirmé plus bas. | P1 |
| Checkbox | À revalider | C : overlay et export PDF spécialisés | Valeur, taille de coche et rotations 0/90/180/270 non comparées visuellement. | P2 |
| Compteurs tally/numeric | À revalider | C : rendu et valeurs par défaut présents | Incrément, remise à zéro, export et bornes non testés. | P2 |
| Dates | À revalider | C : formats DD/MM/YYYY, MM/DD/YYYY, YYYY-MM-DD, valeur du jour optionnelle | L'initialisation `dateDefaultToday` appelle `onValueChange` au montage d'un champ vide : vérifier si ouvrir un template vierge provoque un brouillon voulu. | P2 |
| Déplacement/redimensionnement | À revalider | C : conversion coordonnées écran→page et limites | Zoom et rotations non testés visuellement ; cas filler décrit dans Permissions. | P2 |
| Rotation | À revalider | C : transformations CSS et export PDF dédiés | Superposition champ/fond et export à quatre angles non vérifiés. | P2 |
| Multi-page | À revalider | C : pages empilées et `pageNumber` par champ | Ajout, duplication, suppression, navigation et export de plusieurs pages non testés. | P2 |
| Zoom | À revalider | C : facteur 0,25–5 et ajustement à la largeur | Alignement des champs après zoom/resize non testé. | P2 |
| Navigation clavier | À revalider | C : écouteur clavier, navigation et raccourcis | Focus, sélection multiple, suppression et chaînes d'overflow non testés. | P2 |
| Overflow `distributed` | À revalider | C : distribution et estimation de capacité dans `App.tsx` | Risque de troncature/reflow non mesuré ; aucun test automatisé. | P2 |
| Overflow `continuous` | À revalider | C : état et ancre locale dans `App.tsx` | Non vérifié avec édition au milieu, changement de page et export. | P2 |
| Mode expérimental `fused` | Incomplet | C : `ENABLE_FUSED_MODE = false` ; code historique toujours présent | Fonction volontairement désactivée, couverture absente ; décider de la retirer ou de la stabiliser séparément. | P3 |

## Templates et dossiers

| Fonction | Statut | Validation / test | Anomalie et risque | Priorité |
|---|---|---|---|---|
| Création de template | À revalider | C : DTO validé, `POST /templates`, sanitation des textes ; V : 1 template existant | Création et relecture non testées pendant cet audit. | P2 |
| Chargement vierge | À revalider | C : `loadTemplate(..., 'template')` remet les valeurs à blanc et ne marque pas dirty | Aucun test UI ; vérifier cas date « aujourd'hui » et changement de document. | P2 |
| Chargement avec valeurs | À revalider | C : `loadTemplate(..., 'document')` charge les valeurs et cherche un brouillon | Aucun test UI avec document rempli et permissions partagées. | P2 |
| Modification de la structure d'un template existant | Incomplet | C : `onSave()` crée toujours un nouveau template ; API expose `POST`, `PATCH` nom et `DELETE`, sans mise à jour des champs | La modification crée une autre entrée plutôt qu'une nouvelle version du même template. Confirmer la sémantique produit attendue. | P2 |
| Renommage / suppression | À revalider | C : contrôle propriétaire/admin dans [`templates.service.ts`](../apps/api/src/templates/templates.service.ts) | Aucun test de droit ni de suppression sur donnée temporaire. | P2 |
| Dossiers : liste/création/renommage/suppression | À revalider | C : [`folders.controller.ts`](../apps/api/src/folders.controller.ts) ; V : 0 groupe, aucun scénario partagé | Le renommage/suppression est contrôlé, mais droits de création et hiérarchie restent à tester. | P2 |
| Dossier de groupe et déplacement entre dossiers | Bug confirmé | C : création accepte un `groupId` sans vérifier l'appartenance ; `move-document`/`move-template` vérifient l'objet déplacé mais pas le droit sur le dossier destination | Un appel authentifié peut viser un dossier/groupe hors de son périmètre. Aucun déplacement réel exécuté. | P1 |

## Brouillons

Sources : [`useAutosave.ts`](../apps/web/src/hooks/useAutosave.ts),
[`autosaveScheduler.ts`](../apps/web/src/hooks/autosaveScheduler.ts),
[`drafts.service.ts`](../apps/api/src/drafts/drafts.service.ts).

| Fonction | Statut | Validation / test | Anomalie et risque | Priorité |
|---|---|---|---|---|
| Première modification → autosave | OK | T17 : debounce et première révision | Test du scheduler, pas du navigateur dans cet audit. | P2 |
| Modifications successives, rafale et périodicité | OK | T17 : deuxième save, coalescence, intervalle sans modification, save périodique utile | Intégration React/API à revalider sur compte de test. | P2 |
| Masquage d'onglet, `pagehide`, concurrence, erreurs/réessai | OK | T17 : `saveNow`, écriture série, états `error` puis `saved` | Fermeture effective du navigateur non testée ici. | P2 |
| Changement de document/template A → B | OK | T17 : snapshot clé+payload de A, flush de A, édition B, transition pendant requête, erreur de A | Test d'intégration UI/API à refaire avec deux documents temporaires avant toute évolution. | P1 |
| Chargement simple sans édition | À revalider | T17 : scheduler n'enregistre pas un load propre ; C : `loadTemplate()` fait `setDirty(false)` | L'effet `dateDefaultToday` peut créer une modification réelle au montage ; cas non couvert par T17. | P2 |
| Restauration d'un brouillon | À revalider | C : comparaison `draft.updatedAt > tpl.updatedAt`, modal de restauration ; V : 3 brouillons existants | Pas de restauration authentifiée ni vérification des données. | P2 |
| Sauvegarde explicite | À revalider | C : `onSaveDraft()` → `PUT /drafts` | Résultat et interaction avec autosave non testés ; aucun test API. | P2 |
| Nettoyage après sauvegarde structurelle | À revalider | C : création d'un template, upsert du nouveau brouillon, puis clear de l'ancienne clé en `best-effort` | Vérifier erreurs/réponses tardives et cohérence des deux clés. Aucun scénario mutatif exécuté. | P2 |

## Permissions et partage

Sources : [`permissions.service.ts`](../apps/api/src/permissions/permissions.service.ts),
[`permission-matrix.ts`](../apps/api/src/config/permission-matrix.ts),
[`ShareModal.tsx`](../apps/web/src/components/ShareModal.tsx).
La VM compte actuellement 0 permission documentaire et 0 groupe : une matrice
multi-utilisateur nécessite des données de test isolées et nettoyées ensuite.

| Fonction | Statut | Validation / test | Anomalie et risque | Priorité |
|---|---|---|---|---|
| Rôle documentaire `owner` | À revalider | C : propriétaire/admin ont rôle owner | Partage et retrait de droits non testés. | P1 |
| Rôle `editor` | À revalider | C : hiérarchie owner > editor > filler dans l'API de permissions | Édition structurelle et export selon partage non testés de bout en bout. | P1 |
| Rôle `filler` | Bug confirmé | C : `FieldOverlay` ne bloque déplacement/redimensionnement pour filler que si le champ est verrouillé ; bascule de `fillMode` disponible | Un filler peut modifier localement la géométrie d'un champ non verrouillé en mode édition ; persistance et effets indirects restent à mesurer. | P1 |
| Partage direct utilisateur | À revalider | C : `DocumentPermission` et contrôle owner pour partager/révoquer | Aucun test avec deux utilisateurs. | P1 |
| Partage par groupe | À revalider | C : résolution des appartenances, rôle le plus élevé parmi groupes | Aucun groupe ni permission dans l'instance observée ; aucun test automatisé. | P1 |
| Création de template depuis un document `filler` | Bug confirmé | C : `POST /templates` vérifie le rôle global et **un accès quelconque** au document, sans exiger `editor` ; l'UI est plus restrictive | Un utilisateur globalement autorisé à créer des templates peut appeler directement l'API avec un document partagé en `filler`. Scénario non exécuté. | P1 |
| Restrictions d'export / impression | Bug confirmé | C : l'UI interdit export/print au filler ; `POST /export/run` vérifie seulement le rôle global `exportPdf`, sans identifiant ni rôle documentaire | Une requête API directe peut contourner l'interdiction documentaire d'export. L'impression est côté navigateur et n'a pas de garde serveur. | P1 |

## Vision

Sources : [`detect.controller.ts`](../apps/api/src/detect/detect.controller.ts),
[`main.py`](../apps/vision/main.py), [`detector.py`](../apps/vision/detector.py).

| Fonction | Statut | Validation / test | Anomalie et risque | Priorité |
|---|---|---|---|---|
| Communication API → Vision | OK | V : appel `/health` depuis le conteneur backend `200` ; C : endpoint `/detect` et timeout 180 s | Ne prouve pas une détection réelle. | P2 |
| Accès au fichier partagé | OK | V : volume `lmpdf-git_uploads-data` monté dans API et Vision, fichiers présents | Lecture effective d'un document par l'algorithme non exécutée. | P2 |
| Détection de champs | À revalider | C : extraction grille/contours et OCR | Mesurer précision et faux positifs sur PDF/image de test ; aucun test automatisé. | P2 |
| Sensibilité et lignes pointillées | À revalider | C : profils low/normal/high et `dottedAsLine` | Aucun comparatif sur documents de référence. | P2 |
| PDF multi-page | Incomplet | C : `load_image()` ne convertit que `first_page=1, last_page=1` | La détection ne parcourt pas les pages suivantes ; première page à valider sur référence. | P2 |
| Détection sur image | À revalider | C : chemins OpenCV puis PIL présents dans `load_image()` | Aucun résultat comparé à une image de référence. | P2 |
| Erreurs Vision | À revalider | C : exception renvoyée dans `{ error, suggestedFields: [] }`, API convertit les échecs HTTP/timeout | Les exceptions internes renvoient `200` avec `error` ; UI les affiche, mais observabilité et tests de panne manquent. | P2 |

## Export

Sources : [`exportPdf.ts`](../apps/web/src/exportPdf.ts),
[`export.controller.ts`](../apps/api/src/export/export.controller.ts),
[`export-resolver.ts`](../apps/api/src/export/export-resolver.ts),
[`export-security.ts`](../apps/api/src/export/export-security.ts),
[`export-writer.ts`](../apps/api/src/export/export-writer.ts).

| Fonction | Statut | Validation / test | Anomalie et risque | Priorité |
|---|---|---|---|---|
| PDF navigateur | À revalider | C : `pdf-lib`, conversion coordonnées page→PDF, fichier téléchargé | Comparaison visuelle avec source, rotations et tous types de champs absente. | P1 |
| Rich-text dans le PDF final | Bug confirmé | C : les deux chemins d'export convertissent le HTML en texte brut via [`richTextToPlainText.ts`](../apps/web/src/utils/richTextToPlainText.ts) | Gras/couleurs/surlignage disparaissent. En outre `div`/`p` ne produisent pas de saut de ligne dans `textContent`, sauf `<br>` ; risque de concaténation. | P1 |
| Export serveur | À revalider | C : le navigateur génère le PDF, l'API dépose les octets sous une destination configurée ; V : 0 journal d'export | Fonction désactivée par défaut, pas de destination testée ; écritures non lancées dans cet audit. | P2 |
| `allowedRoots` et chemins | À revalider | C : racine absolue, segments nettoyés, validation après résolution | Tests de traversée, symlinks et configuration erronée absents. | P1 |
| Règles de destination | À revalider | C : premier match, contexte utilisateur/groupe/template | Priorité des règles et droits sur template à tester. | P2 |
| Conflits overwrite/rename/skip | À revalider | C : trois stratégies dans `export-writer.ts` | Aucun test disque isolé ; collisions simultanées non couvertes. | P2 |
| Journaux d'export | À revalider | C : création asynchrone, liste/statistiques/purge admin | `fire-and-forget` peut perdre un journal en cas d'arrêt ; 0 journal observé. | P2 |
| Fichier temporaire d'un export refusé | Dette technique | C : intercepteur multipart écrit avant `canUser()` ; ce refus précède le bloc `finally` qui supprime le temporaire | Un utilisateur authentifié sans droit d'export peut laisser un fichier sous `uploads/tmp-export`. Non provoqué sur la VM. | P2 |

## Administration

| Fonction | Statut | Validation / test | Anomalie et risque | Priorité |
|---|---|---|---|---|
| Lecture/modification des réglages admin | À revalider | C : [`admin-settings.controller.ts`](../apps/api/src/admin-settings.controller.ts), `@Roles('admin')` ; V : `401` sans JWT | Aucun test avec rôle admin ni validation exhaustive des valeurs de `PATCH`. | P1 |
| Permissions configurables | À revalider | C : overrides chargés à chaque contrôle de rôle | Pas de test de propagation et de garde serveur après modification. | P1 |
| Paramètres LDAP | Bug confirmé | C : formulaire et test LDAP existent ; bibliothèque runtime absente (voir Authentification) | Le test de connexion LDAP ne peut pas réussir dans l'image actuelle si activé. | P1 |
| Configuration export | À revalider | C : validation/preview admin et paramètres chargés de `admin-settings.json` | Pas de test de destination réelle ; dépend de la persistance suivante. | P2 |
| Persistance `config/admin-settings.json` | Bug confirmé | C : fichier écrit sous le filesystem du backend ; [`docker-compose.prod.yml`](../docker-compose.prod.yml) ne monte que `uploads-data` dans l'API ; V : fichier absent actuellement | Les réglages enregistrés par l'UI seraient perdus lors d'une recréation du backend. Dette déjà prévue pour une tâche distincte. | P1 |

## Infrastructure

| Fonction | Statut | Validation / test | Anomalie et risque | Priorité |
|---|---|---|---|---|
| PostgreSQL | OK | V : conteneur sain, volume `lmpdf-git_postgres-data` monté, requête en lecture seule depuis le backend réussie | Sauvegarde/restauration non testées pendant cet audit. | P1 |
| `uploads-data` | OK | V : volume monté dans API et Vision ; 29 fichiers présents | Même réserve sur sauvegarde/restauration. | P1 |
| API | OK | V : conteneur actif sans restart ; `/api/health` `200`, lecture PostgreSQL réussie | Endpoint santé ne contrôle pas lui-même la DB. | P1 |
| Frontend | OK | V : conteneur actif, page HTTP `200` | Flux authentifié et navigateur non couverts. | P1 |
| Vision | OK | V : conteneur actif, `/health` `200` depuis backend | Algorithme `/detect` non testé. | P2 |
| Garage / Redis absents | OK | C : aucun service dans les Compose actifs ; V : aucun conteneur actif ni volume nommé de ces services | Absence volontaire, aucune dépendance à réintroduire. | P3 |
| Recréation d'un conteneur applicatif | À revalider | C : volumes critiques nommés ; V : montages actuels confirmés | Ne pas recréer pour ce seul audit ; régler la persistance admin avant une prochaine recréation si des réglages sont utilisés. | P1 |

## Dettes transversales et niveau de preuve

| Point | Statut | Validation / test | Anomalie et risque | Priorité |
|---|---|---|---|---|
| CI | Dette technique | C : aucun workflow `.github/workflows` suivi | Aucun gate automatique de build/tests avant merge. | P2 |
| Lint et format | Dette technique | C : scripts web/API `echo 'todo …'` | `pnpm lint` et `pnpm format` ne vérifient pas réellement ces applications. | P2 |
| Couverture de tests | Dette technique | C : un seul fichier de tests suivi, 17 cas pour le scheduler autosave | Pas de tests API, permissions, export, éditeur UI ou Vision. | P1 |
| Taille de `App.tsx` | Dette technique | C : 3 049 lignes | État, rendu, droits et overflow fortement couplés ; rend les corrections difficiles à isoler. | P2 |
| Bundle frontend | Dette technique | V : asset JS principal servi d'environ 1,8 Mo non compressé sur disque | Performance à mesurer dans le navigateur ; optimisation hors audit. | P3 |
| Warning `canvas` facultatif | À revalider | Mentionné lors de builds précédents ; aucun build lancé pour cet audit | Origine et impact actuels non reconfirmés. | P3 |
| Favicon | Bug confirmé | V : `GET /favicon.ico` → `404`, log nginx correspondant | Défaut cosmétique, pas d'impact métier. | P3 |
| Documentation Vision | Dette technique | C : [`apps/vision/README.md`](../apps/vision/README.md) dit encore « placeholder » alors que `detector.py` est implémenté | Documentation trompeuse ; correction documentaire distincte possible. | P3 |

## Ordre proposé pour les petites PR de correction

1. **Droits documentaires côté serveur** : tests API sur owner/editor/filler,
   création de templates, exports et dossiers de groupe. Traiter d'abord les
   chemins où le frontend est plus strict que l'API.
2. **Persistance des réglages admin** : choisir un volume/stockage durable,
   sauvegarder l'état existant, puis tester une recréation contrôlée sans toucher
   à PostgreSQL ni à `uploads-data`.
3. **Authentification secondaire** : installer/déclarer `ldapjs` si LDAP est
   réellement voulu, borner le fallback local aux administrateurs selon la
   politique validée, configurer les origines WebAuthn et tester TOTP/passkeys.
4. **Fidélité et sécurité de l'export** : tests PDF de référence pour texte
   riche, dates, checkbox et rotations ; tests isolés d'`allowedRoots`, des
   stratégies de conflit et du nettoyage des temporaires.
5. **Parcours documents/templates/brouillons** : fixtures temporaires nettoyées
   ensuite pour upload→lecture, chargement vierge/avec valeurs, restauration et
   sauvegardes successives avec date par défaut. Clarifier l'édition d'un
   template existant.
6. **Éditeur et Vision** : tests navigateur des champs, zoom, pages et overflow ;
   échantillons PDF/image de référence pour sensibilité, pointillés et pages
   multiples.
7. **Gates et entretien** : vraie CI, lint/format effectifs, mesure du bundle,
   découpage progressif d'`App.tsx`, favicon et documentation Vision.

Chaque PR doit garder un périmètre étroit, inclure des tests du comportement
modifié, suivre Fedora → GitHub → SHA exact sur `lmpdf-dev`, puis consigner la
validation avant merge. Les scénarios à plusieurs comptes ou écritures doivent
utiliser des objets temporaires clairement nommés et être nettoyés après test.
