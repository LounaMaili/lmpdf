# Checklist de régression — reprise LMPdf

Audit initial du 27 septembre 2026, complété par la validation combinée du
22 octobre 2026 ci-dessous. Base de l’audit initial : `main` au commit
`d945ca1b390e33dae3760d84080e0c978907250b` (PR autosave #5, merge commit).
Au début des contrôles, la VM `lmpdf-dev` exécutait encore
`d8b41f189e3218c4144baadc071b790feb62efb9` : ces deux commits ont **le
même arbre Git**. Aucun code ni donnée applicative n’avait été modifié pour
cet audit initial ; les corrections ultérieures sont distinguées ci-dessous.

## Validation combinée des PR #8, #10 et #7 — 22 octobre 2026

**Aucun déploiement sur les services actifs.** Les preuves nouvelles viennent de
conteneurs jetables sur `lmpdf-dev`, sans fichiers `.env`, données réelles ni
volumes applicatifs montés. La recette navigateur authentifiée reste à faire.
Les observations `V` et les comptages de l’audit initial restent historiques.

| Étape | Révision / résultat |
|---|---|
| PR #8, persistance | SHA vérifié `bd7d711e84b5bb9e76dea121249bc02cfcd790fd` : 35 JWT/MFA, 12 paramètres, 17 autosave, Compose dev/prod et deux conteneurs runtime successifs réussis. Merge commit `1bdcf8be88b6e0c4be795acfa793cdf187e3b38d`. |
| PR #10 après intégration de #8 | SHA `6aaf03a9fbd737cbbff9bd8b7ea3002a96863591` : 56 JWT/MFA/configuration, 12 paramètres, 7 PostgreSQL réels, 4 MFA frontend et 17 autosave réussis ; builds et Compose réussis. Merge commit `ef1524e8d444c8117c13ceacfaf32b2750b8d9bc`. |
| PR #7 après intégration de #10 | Code corrigé au SHA `9a94db540e71a8ceb27dc983e9dd1e3c894b382c` : toutes les suites ci-dessous réussies. Recette Docker complète ajoutée et exécutée au SHA `93043886e019af98e1bbf1773f33067819bf0c86` : 7/7 succès. La checklist est documentaire ; le SHA exact de fusion et sa revalidation sont consignés dans le rapport d’intégration. |

### Suites et portée des preuves nouvelles (`I` = validation isolée Debian)

| Suite / commande | Résultat | Ce qui est réellement couvert |
|---|---|---|
| API `test:auth` | 56/56 | JWT accès/challenge/enrôlement, ancien accès compatible, refus HTTP métier/admin avant MFA, TOTP/WebAuthn synthétiques, comptes désactivés et lecture des réglages required/corrompus. Les 35 tests JWT/MFA initiaux sont conservés. |
| API `test:settings` | 12/12 | Écriture atomique, lecture, erreurs et permissions privées du fichier de réglages. |
| API `test:permissions` | 43/43 | Matrice documentaire, templates, dossiers, IDs et contexte d’export ; Nest HTTP et Prisma simulé. |
| API `test:exports` | 25/25 | Fichier 25 Mio, deux exports simultanés, surplus 429 et reprise, interruption, refus sans temporaire, noms libres/canoniques, extensions et collisions. |
| API `test:export-paths` | 18/18 | Vraies opérations disque dans un bac temporaire : racine, traversée, symlinks répertoire/fichier, hardlinks, remplacements entre validation/ouverture/écriture, overwrite/rename/skip, nettoyage I/O. |
| `isolated-postgres.sh` / `test:enrollment:postgres` | 7/7 | PostgreSQL 16 temporaire en tmpfs : premières activations TOTP et WebAuthn réelles, deux TOTP concurrents, TOTP/WebAuthn concurrents, attente du verrou observée dans PostgreSQL, refus d’une seconde activation, rollback complet et désactivation pendant l’attente. |
| Web `test:permissions`, `test:auth`, `test:autosave` | 13/13, 4/4, 17/17 | Décisions/handlers de permissions, session d’enrôlement frontend et scheduler autosave ; pas une recette navigateur. |
| `isolated-stack.sh` | 7/7 | Quatre services isolés : connexion mot de passe + TOTP, enrôlement initial, refus métier/admin, upload/lecture PNG, droits owner/editor/filler, API → Vision, export effectif et nom canonique, plafond nginx 30 Mio, réglage admin appliqué aux droits. |
| Builds et Compose | OK | API build + runtime, web build + runtime, image Vision ; configurations dev/prod valides. |
| `admin-settings-container.sh` | OK | Deux conteneurs non root successifs : relecture conservée, répertoire 0700, fichier 0600 appartenant à appuser, refus réel d’écriture sans altérer le précédent fichier. |

Les tests PostgreSQL et de démarrage n’appliquent les migrations **existantes**
qu’à leurs bases temporaires. `prisma migrate diff` y constate un schéma sans
écart ; ni schéma ni migration Prisma n’est modifié par ces PR. Aucun besoin de
nouvelle migration identifié pour leur déploiement.

Le volume `admin-config` est déclaré à `/app/config` en développement (WORKDIR
`/app`) et `/app/apps/api/config` en production (WORKDIR `/app/apps/api`). Les
tests de persistance et de démarrage emploient un bind mount temporaire au
chemin de production. Aucun volume nommé actif n’a été créé, supprimé ou
reconfiguré pour ces tests. Sauvegarder/importer un éventuel réglage non monté
avant la première bascule, en conservant ownership et modes privés.

L’audit a reproduit puis corrigé les écritures via symlinks/hardlinks et les
remplacements de chemins ; voir [EXPORT_PATH_SECURITY.md](EXPORT_PATH_SECURITY.md).
Il a aussi révélé une réservation d’export conservée après interruption d’une
requête : la libération et la reprise immédiate sont désormais testées. Le writer
exige Linux avec `/proc/self/fd`, des racines sans symlink et des droits POSIX
maîtrisés. L’overwrite d’un fichier existant n’est pas transactionnel en cas
d’erreur I/O ; aucune garantie de rollback de ses octets n’est annoncée.

La mémoire des exports reste bornée par **25 Mio de fichier et deux requêtes par
processus** : environ 100 Mio de buffers transitoires au plafond, en plus de la
baseline et du GC ; ce n’est pas une limite de RSS. nginx accepte une enveloppe
multipart de 30 Mio. Les PDF du test d’export sont synthétiques : fidélité visuelle,
rich-text, impression et parcours navigateur multi-utilisateur restent à recetter.

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
(relancés lors de la validation combinée). `I` = nouvelles preuves isolées
détaillées ci-dessus. `P1` = risque d'accès ou de perte
fonctionnelle élevé ; `P2` = fonction importante ; `P3` = qualité/ergonomie.
« Aucun test » signifie aucun test automatisé suivi dans le dépôt pour ce
parcours. Une preuve `C` seule ne valide pas le comportement en production.

Les contrôles historiques `V` de septembre ont observé : frontend `200`, `/api/health` `200`, Vision
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
| Login local | OK | I : 56 tests auth et connexions mot de passe + TOTP dans le stack isolé | Recette navigateur et paramètres de l’instance réelle encore à vérifier. | P2 |
| Garde JWT et accès anonyme | OK | C : [`jwt.strategy.ts`](../apps/api/src/auth/jwt.strategy.ts), garde global ; V : trois routes protégées répondent `401` sans jeton | Ne prouve pas les droits après authentification. | P1 |
| Expiration et isolation JWT | OK | I : accès valide/ancien compatible, challenge MFA, enrollment, type inattendu, signature invalide et expiration testés en HTTP | Retour à la connexion dans le navigateur à revalider. | P1 |
| Logout / révocation | Dette technique | C : [`auth.ts`](../apps/web/src/auth.ts) efface le jeton du stockage local | Pas de révocation serveur ; un JWT copié reste valable jusqu'à expiration ou désactivation du compte. | P2 |
| MFA TOTP et codes de secours | OK | I : enrôlement/connexion réels synthétiques, erreurs, génération des codes et transactions PostgreSQL | Recette utilisateur et récupération sur navigateur restent à faire. | P1 |
| Enrôlement MFA obligatoire | OK | I : session restreinte, aucune route métier/admin avant activation, TOTP/WebAuthn, concurrence et désactivation testés ; config admin required prioritaire | Politique LDAP/hybride conservée ; configuration réelle à recetter. | P1 |
| WebAuthn et passkeys | Bug confirmé | C : [`webauthn.service.ts`](../apps/api/src/auth/webauthn.service.ts) a pour défaut RP `localhost` / origin `http://localhost:4173` ; [`docker-compose.prod.yml`](../docker-compose.prod.yml) ne transmet aucun `WEBAUTHN_RP_ID`/`WEBAUTHN_RP_ORIGIN` | Le domaine/origin de l'instance de test ne correspond pas à ces défauts ; l'enrôlement/vérification WebAuthn ne peut pas aboutir dans cette configuration. Aucun test avec authentificateur réel. | P1 |
| LDAP / Active Directory | Bug confirmé | C : [`ldap.service.ts`](../apps/api/src/auth/ldap.service.ts) fait `require('ldapjs')` ; absent de [`apps/api/package.json`](../apps/api/package.json) et du lockfile ; V : `ldapjs_resolvable=false` dans le backend | Si LDAP est activé, `authenticate()` retourne `null` avant de contacter l'annuaire. Aucun annuaire de test sollicité. | P1 |
| Fallback admin local en mode hybride | Bug confirmé | C : [`auth.controller.ts`](../apps/api/src/auth/auth.controller.ts), condition `allowLocal` | Le drapeau nommé `allowLocalAdminFallback` permet la connexion de **tout** compte local valide en mode hybride ; aucun filtre `role === 'admin'`. À clarifier et tester selon la politique voulue. | P1 |

## Documents et stockage

| Fonction | Statut | Validation / test | Anomalie et risque | Priorité |
|---|---|---|---|---|
| Upload PDF | À revalider | C : [`upload.controller.ts`](../apps/api/src/upload/upload.controller.ts), limite 25 Mo, nom UUID ; V : PDF historiques présents | Aucun nouvel upload de test ni vérification rendu/métadonnées ; aucun test automatisé. | P2 |
| Upload image | À revalider | I : PNG synthétique valide uploadé, relu et traité par Vision dans le stack | Autres formats et affichage navigateur non validés. | P2 |
| MIME / magic bytes | À revalider | C : détection par signature, extension dérivée, SVG exclu | Signatures courtes : la validité interne d'un PDF ou d'une image n'est pas prouvée. Ajouter des fixtures valides, tronquées et malformées. | P1 |
| Lecture d'un document existant | À revalider | C : [`api.ts`](../apps/web/src/api.ts) récupère le fichier protégé puis crée une blob URL ; V : route protégée inaccessible sans JWT | Pas de téléchargement authentifié ni rendu du document existant pendant cet audit. | P1 |
| Permissions d’accès au fichier | OK | I : matrice API et lecture authentifiée d’un PNG partagé dans le stack | La matrice complète des partages reste à recetter au navigateur. | P1 |
| Persistance `uploads-data` | OK | V : même volume nommé monté dans API et Vision ; 28 PDF et 1 image comptés | Contrôle de présence seulement, pas de comparaison de checksum ni de restauration. | P1 |
| Upload refusé après réception | Dette technique | C : l'intercepteur écrit sur disque avant le contrôle `canUser()` dans le contrôleur | Un utilisateur authentifié sans droit d'upload peut laisser un fichier temporaire orphelin. Scénario non exécuté. | P2 |

## Éditeur

Sources principales : [`App.tsx`](../apps/web/src/App.tsx),
[`FieldOverlay.tsx`](../apps/web/src/components/FieldOverlay.tsx),
[`PropertiesPanel.tsx`](../apps/web/src/components/PropertiesPanel.tsx).
Depuis le 22/10, des tests de décisions et de handlers de composants avec
hooks/DOM simulés sont suivis. Aucun test navigateur complet n'est encore suivi.

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
| Dossier de groupe et déplacement entre dossiers | OK | Correction du 22/10 : tests API sur membre/non-membre/admin, parent cohérent, destination inaccessible et IDs inconnus | Décisions automatisées validées ; parcours dossiers dans le navigateur encore à revalider. | P1 |

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
L’audit initial comptait 0 permission documentaire et 0 groupe : une matrice
multi-utilisateur nécessite des données de test isolées et nettoyées ensuite.

| Fonction | Statut | Validation / test | Anomalie et risque | Priorité |
|---|---|---|---|---|
| Rôle documentaire `owner` | OK | I : matrice API et template/export autorisés dans le stack | Partage/retrait via l’interface à revalider. | P1 |
| Rôle `editor` | OK | I : 43 tests API, 13 frontend et création de template partagé dans le stack | Édition structurelle interactive à revalider. | P1 |
| Rôle `filler` | OK | Correction du 22/10 : permissions frontend combinées, handlers réels de FieldOverlay et panneau testés avec dépendances simulées | Structure bloquée même sur champ non verrouillé ; valeurs conservées. Validation dans le navigateur encore nécessaire. | P1 |
| Partage direct utilisateur | À revalider | C : `DocumentPermission` et contrôle owner pour partager/révoquer | Aucun test avec deux utilisateurs. | P1 |
| Partage par groupe | À revalider | C : résolution des appartenances, rôle le plus élevé parmi groupes | Aucun groupe ni permission dans l'instance observée ; aucun test automatisé. | P1 |
| Création de template depuis un document `filler` | OK | Correction du 22/10 : permission globale + `requireDocRole(editor)` ; matrice owner/editor/filler/aucun/admin testée | Filler refusé ; existence du document vérifiée même pour admin. Pas de déploiement. | P1 |
| Restrictions d'export / impression | À revalider | Correction du 22/10 : resolve/run exigent contexte cohérent et rôle editor ; refus avant écriture testés. Flags export/print frontend testés | Correctif automatisé validé ; export visuel et impression restent à vérifier dans le navigateur. | P1 |

## Vision

Sources : [`detect.controller.ts`](../apps/api/src/detect/detect.controller.ts),
[`main.py`](../apps/vision/main.py), [`detector.py`](../apps/vision/detector.py).

| Fonction | Statut | Validation / test | Anomalie et risque | Priorité |
|---|---|---|---|---|
| Communication API → Vision | OK | V historique : health 200 ; I : appel /detect sur PNG partagé réellement traité | Précision et timeout/panne restent à mesurer. | P2 |
| Accès au fichier partagé | OK | V historique : montages ; I : PNG uploadé par l’API puis lu réellement par Vision dans le stack | Précision de détection non évaluée. | P2 |
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
| Export serveur | OK | I : resolve/run réels avec octets PDF synthétiques écrits et relus dans une destination temporaire ; tests HTTP des refus et limites | Rendu PDF fourni par le navigateur et recette visuelle non couverts. | P2 |
| `allowedRoots` et chemins | OK | I : 18 tests disque de chemins, symlinks/hardlinks et remplacements ; writer vérifie aussi les racines | Linux requis ; racines et droits POSIX à contrôler au déploiement. | P1 |
| Règles de destination | À revalider | I : nom canonique vérifié distinct du nom de sortie, règle réelle dans le stack ; tests de contexte et droits | Combinaisons de règles utilisateur/groupe non exhaustives. | P2 |
| Conflits overwrite/rename/skip | OK | I : trois stratégies sur disque, collisions concurrentes rename/skip et normalisation des extensions | Overwrite existant non transactionnel en erreur I/O. | P2 |
| Journaux d'export | À revalider | C : création asynchrone, liste/statistiques/purge admin | `fire-and-forget` peut perdre un journal en cas d'arrêt ; 0 journal observé. | P2 |
| Fichier temporaire d’un export refusé | OK | I : refus filler, dépassement 25 Mio, saturation à deux requêtes (429), interruption et reprise ; aucun temporaire disque | Environ 100 Mio de buffers transitoires à deux ; dette d’upload classique distincte. | P2 |

## Administration

| Fonction | Statut | Validation / test | Anomalie et risque | Priorité |
|---|---|---|---|---|
| Lecture/modification des réglages admin | OK | I : enrôlement admin puis connexion TOTP, GET/PATCH réels dans le stack ; refus de session restreinte | Validation exhaustive des valeurs de PATCH et UI à compléter. | P1 |
| Permissions configurables | OK | I : override editor.exportPdf désactivé par PATCH puis refus serveur 403 observé | Autres overrides et recette UI à compléter. | P1 |
| Paramètres LDAP | Bug confirmé | C : formulaire et test LDAP existent ; bibliothèque runtime absente (voir Authentification) | Le test de connexion LDAP ne peut pas réussir dans l'image actuelle si activé. | P1 |
| Configuration export | À revalider | I : réglages privés relus par le backend, destination temporaire et règle canonique testées | Formulaire admin, preview et toutes combinaisons de règles à recetter. | P2 |
| Persistance `config/admin-settings.json` | OK | I : 12 tests, deux conteneurs successifs, stack complet, modes 0700/0600 et refus d’écriture ; volume admin-config déclaré dans les deux Compose | Non déployé. Sauvegarder/importer tout fichier existant avant bascule. | P1 |

## Historique — persistance admin validée séparément (non déployée)

La branche indépendante `fix/admin-settings-persistence`, issue du main documentaire,
ajoute le volume `admin-config` et une écriture atomique privée. Sur Debian : build
API et runtime réussis, 12/12 tests Node, test de relecture dans deux conteneurs
éphémères et validations des deux Compose. Ces preuves couvrent le stockage ; la
recette UI et le déploiement restent à faire. Voir
[ADMIN_SETTINGS_PERSISTENCE.md](ADMIN_SETTINGS_PERSISTENCE.md).
Ce suivi décrit la validation indépendante initiale. Les preuves combinées plus
récentes et les fusions sont consignées en tête du document.

## Infrastructure

| Fonction | Statut | Validation / test | Anomalie et risque | Priorité |
|---|---|---|---|---|
| PostgreSQL | OK | V : conteneur sain, volume `lmpdf-git_postgres-data` monté, requête en lecture seule depuis le backend réussie | Sauvegarde/restauration non testées pendant cet audit. | P1 |
| `uploads-data` | OK | V : volume monté dans API et Vision ; 29 fichiers présents | Même réserve sur sauvegarde/restauration. | P1 |
| API | OK | V : conteneur actif sans restart ; `/api/health` `200`, lecture PostgreSQL réussie | Endpoint santé ne contrôle pas lui-même la DB. | P1 |
| Frontend | OK | V : conteneur actif, page HTTP `200` | Flux authentifié et navigateur non couverts. | P1 |
| Vision | OK | V historique : health 200 ; I : démarrage de l’image et /detect sur PNG partagé | PDF et qualité des résultats à revalider. | P2 |
| Garage / Redis absents | OK | C : aucun service dans les Compose actifs ; V : aucun conteneur actif ni volume nommé de ces services | Absence volontaire, aucune dépendance à réintroduire. | P3 |
| Recréation d’un conteneur applicatif | À revalider | I : persistance des réglages entre deux conteneurs et démarrage complet temporaire ; V : montages actifs inchangés | Aucune recréation active effectuée ; recette après déploiement encore requise. | P1 |

## Dettes transversales et niveau de preuve

| Point | Statut | Validation / test | Anomalie et risque | Priorité |
|---|---|---|---|---|
| CI | Dette technique | C : aucun workflow `.github/workflows` suivi | Aucun gate automatique de build/tests avant merge. | P2 |
| Lint et format | Dette technique | C : scripts web/API `echo 'todo …'` | `pnpm lint` et `pnpm format` ne vérifient pas réellement ces applications. | P2 |
| Couverture de tests | Dette technique | I : 154 tests API, 7 PostgreSQL réels, 34 frontend et 7 stack ; détail en tête du document | Pas de navigateur complet ni d’export visuel ; Vision limitée à un PNG synthétique. | P1 |
| Taille de `App.tsx` | Dette technique | C : 3 049 lignes | État, rendu, droits et overflow fortement couplés ; rend les corrections difficiles à isoler. | P2 |
| Bundle frontend | Dette technique | V : asset JS principal servi d'environ 1,8 Mo non compressé sur disque | Performance à mesurer dans le navigateur ; optimisation hors audit. | P3 |
| Warning `canvas` facultatif | À revalider | Mention historique ; builds isolés réussis | Impact sur un rendu PDF réel non couvert par ces tests. | P3 |
| Favicon | Bug confirmé | V : `GET /favicon.ico` → `404`, log nginx correspondant | Défaut cosmétique, pas d'impact métier. | P3 |
| Documentation Vision | Dette technique | C : [`apps/vision/README.md`](../apps/vision/README.md) dit encore « placeholder » alors que `detector.py` est implémenté | Documentation trompeuse ; correction documentaire distincte possible. | P3 |

## Prochaines étapes après intégration

1. Recette navigateur authentifiée : enrôlement MFA, restauration/autosave,
   matrice owner/editor/filler, partage, export et impression, sans contourner Authelia.
2. Déploiement explicitement autorisé : sauvegarder les réglages non montés,
   préparer le volume admin-config privé, préserver PostgreSQL et uploads-data,
   puis ne recréer que les services approuvés avec rollback disponible. Aucune
   migration nouvelle n’est requise par ces corrections.
3. Traiter séparément les bugs restants : LDAP manquant et politique fallback
   à clarifier, RP/origin WebAuthn, fidélité rich-text, puis parcours éditeur/Vision.
4. Ajouter les gates CI et compléter les tests visuels/navigateur.

## Ordre historique proposé pour les petites PR de correction

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

## Historique — branche permissions validée séparément (non déployée)

La correction documentée dans [DOCUMENT_PERMISSION_ENFORCEMENT.md](DOCUMENT_PERMISSION_ENFORCEMENT.md)
a été testée dans des images Docker de build isolées sur Debian : 43/43 tests API,
13/13 tests frontend de permissions, 17/17 tests autosave, builds API et web réussis.
La source API validée est `9ba36ce4d37da2daab5b70da01369f68d9fc25c9` ; le dernier
ajout frontend validé est `15c3c51b586d3e970e4b47c592272dbfcb0b8b8a`.
Les tests HTTP emploient Prisma simulé et des JWT synthétiques ; aucun compte réel,
volume applicatif ou service actif n'a été utilisé. Les états OK ajoutés ci-dessus
couvrent les décisions testées, pas une recette multi-utilisateur dans le navigateur.
