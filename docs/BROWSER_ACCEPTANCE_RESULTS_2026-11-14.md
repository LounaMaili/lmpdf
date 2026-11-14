# Recette navigateur réelle du 14 novembre 2026

## Révision et méthode

Application active : `f75d7b3f0aae3f5f285d0dbfe486d7080a961815` (#11 et #12).
Le frontend conserve l'image consolidée précédente, compatible avec ce backend.
Recette sur `https://lmpdf.gueguen.org/`, navigateur Codex réel. Le bypass
Authelia du VLAN a été mis en place par l'utilisateur avant la recette ; aucune
modification réseau, Authelia, Traefik ou OPNsense pendant cette intervention.

Références : [plan](BROWSER_ACCEPTANCE_PLAN.md),
[checklist](REGRESSION_CHECKLIST.md), [déploiement](DEPLOYMENT_2026-11-14.md).
Les validations isolées déjà acquises ne sont pas recomptées comme nouvelles.

- **B14** : interactions dans le navigateur réel, imports par sélecteur de
  fichier, UI React, authentification normale et téléchargement PDF.
- **H14** : requêtes HTTPS réelles sur l'instance de test, avec login normal des
  comptes QA ; 42 contrôles de permissions/refus, plus 7 contrôles complémentaires.
- **D14-QA** : inventaires et empreintes en lecture seule sur Debian, toutes
  tables historiques et les 29 fichiers antérieurs ; rendu PDF par Poppler.
- Les tests simulés historiques restent identifiés comme tels. Aucun geste
  WebAuthn, code TOTP, changement de politique MFA ou contournement JWT.

Les outils QA ont été écrits sur Fedora, poussés, puis exécutés sur Debian au
SHA `90b855ddc49c1bd6143e9c12c70048a03bb906b6` (provisionnement initial
`81312d7f035bcc54e13c86341f1470f04b26f8b1`). Ce checkout documentaire/de recette
ne change pas la révision de l'image active. Aucun build applicatif sur Fedora.

## Protection et conservation

Avant la première écriture : sauvegarde de préparation vérifiée (20 empreintes),
inventaire privé des 3 utilisateurs historiques, dump PostgreSQL cohérent et
archive des 29 fichiers contrôlés. Le dump a été lu avec `pg_restore --file=-`,
sans restauration ; son empreinte logique correspondait à la base.

Racine privée Debian : `/home/erwan/lmpdf-qa/recette-20261114`, mode 0700.
Fichiers privés en 0600, notamment `private-accounts.json`, inventaires, dumps
et preuves. Aucun mot de passe, cookie, JWT, secret MFA ou dump dans Git.
Le transfert des mots de passe QA vers la mémoire du pilote a été chiffré pour
une clé éphémère de session ; seules les connexions normales ont été utilisées.

Les sauvegardes avant QA sont dans `backups/` (2 empreintes vérifiées), celles
du jeu QA conservé dans `backups/post-qa/`. Les anciennes sauvegardes et
overrides de déploiement sont conservés. Aucun nettoyage automatique des objets
QA, compte historique modifié, migration, déploiement ou redémarrage de service.

### Comptes persistants créés

| Acteur | Email synthétique | UUID | Rôle global / documentaire |
|---|---|---|---|
| QA Owner | qa-owner-20261114@lmpdf.test | `f10d7065-96d4-4be2-97b8-260ec3ad21f2` | editor / owner des 2 imports |
| QA Editor | qa-editor-20261114@lmpdf.test | `41ae755f-c9cb-49eb-bfbf-e026fec2062b` | editor / editor sur les 2 imports |
| QA Filler | qa-filler-20261114@lmpdf.test | `b14d1992-c509-484b-9815-dfe4b6c89c5a` | editor / filler sur les 2 imports |
| QA Outsider | qa-outsider-20261114@lmpdf.test | `2b0beeb2-b5ba-46a1-bcfc-c4efec842d18` | viewer / aucun partage |

Provisionnement ciblé Prisma : uniquement `User.create`, aucune mise à jour,
suppression ou réactivation d'un compte existant. Collisions refusées. Les
mots de passe robustes restent dans le ledger privé Debian. L'inscription
publique et les politiques actives n'ont pas été changées.

### Fixtures et objets créés

| Objet | Identifiant / référence |
|---|---|
| PDF statique synthétique A4, 2 pages, sans AcroForm | `RECETTE-20261114-deux-pages.pdf`, 372263 octets ; document `2b505d4d-c3f9-48e7-a612-edd2c6b3fd85` |
| PNG synthétique, 1240 × 1754 | `RECETTE-20261114-image.png`, 58264 octets ; document `9e06b727-861d-425f-a952-6a9b8e120e88` |
| Template PDF de base vide, créé via HTTPS pour rouvrir l'import | `79b75669-60a4-438a-b3cc-9af7f3a29003` |
| Template PDF, 5 champs : texte, checkbox, numérique, date, texte riche | `fad30d47-8aa2-4027-b76a-0ade8ade0433` |
| Template PNG, 13 suggestions Vision, créé dans le navigateur | `52288bae-eb07-4f36-83fa-4eedb2f62a80` |
| Template dérivé créé par QA Editor, 6 champs | `39455276-ceea-442e-8eb7-9acb50918397` |

Les deux pages ont un repère imprimé différent pour détecter une duplication
du fond. Les valeurs sont exclusivement synthétiques. Les fichiers de fixtures,
exports et captures restent hors Git.

Partages : PDF → editor `fcf925f6-aa5a-4327-abdd-c0aa19405e14`, filler
`b935c85c-f3cb-4252-92ce-8eaeafc3a3fb` ; PNG → editor
`d92ab897-a806-4900-b32a-20657c47e69d`, filler
`9fa28268-25a4-43e9-b999-ebe9c9a657f3`. Créés par l'API HTTPS normale du
propriétaire ; interface de création/révocation du partage pas encore recettée.

Les 8 brouillons QA conservés sont inventoriés dans `qa-objects.json` privé :

| Acteur / clé | UUID du brouillon |
|---|---|
| Owner / source PDF | `915694f1-e90f-4c70-b846-a512fc4f9675` |
| Owner / source PNG | `acf37716-8c41-4b9f-8a11-f24fc4c8b8e9` |
| Owner / template PDF de base | `d8a614bd-3125-467b-b2e7-74729af8aa42` |
| Owner / template PDF à champs, 6 champs dans le brouillon, 2 pages | `73d98faf-3e83-4d5d-af83-defcbdfb1497` |
| Owner / template PNG | `40f76425-0fd9-4aea-adf8-ddbcd5f50bc1` |
| Editor / source PDF | `c937db0e-dfda-4a93-8595-60179b186dcc` |
| Editor / template dérivé | `9a804706-debd-4aa1-8f1a-440fae26d4d4` |
| Filler / source PDF | `8c551359-249c-4eaf-8082-a555a85b63f2` |

## Parcours réellement exécutés

| Cas | Méthode / résultat | Limites |
|---|---|---|
| HTTPS et administration | B14 : application atteinte sans alerte TLS, session admin déjà présente ; lecture du panneau admin. | Ce premier accès ne prouve pas une nouvelle saisie du mot de passe admin. Aucun paramètre sauvegardé. |
| Login/logout | B14 : logins frais des 4 QA, changements de session normaux ; identités/rôles affichés conformes. | MFA facultatif, QA sans facteurs ; TOTP et expiration non testés ici. |
| Owner | B14 : 2 imports, champs, sauvegardes et export ; H14 : rôle owner, métadonnées et fichier accessibles. | Aucun document historique ouvert. |
| Editor | B14 : document partagé chargé, champ ajouté, template dérivé et brouillon sauvegardés ; rôle Éditeur visible. | Ne prouve pas la modification en place d'un template d'un autre propriétaire. |
| Filler | B14 : valeur QA enregistrée ; nom/type/structure/rotation bloqués, boutons Template/Exporter/Imprimer désactivés. H14 : structure, détection et partage refusés 403. | Le fichier source reste lisible conformément aux droits documentaires ; ce n'est pas une protection DRM. |
| Outsider | B14 : bibliothèque vide, import/édition bloqués ; H14 : métadonnées/fichiers QA, structure et détection refusés 403. | Aucun partage ajouté à cet acteur. |
| Admin réservé | H14 : GET admin/settings refusé 403 pour les 4 QA ; B14 : aucun bouton admin pour ces acteurs. | Pas de mutation des réglages. |
| Accès anonyme | H14 : métadonnées et fichier PDF QA refusés 401 sans JWT. | Aucun essai de challenge forgé sur l'instance. |
| Uploads | B14 : import et rendu PDF + PNG ; H14 : viewer refusé 403, pseudo-PDF minuscule refusé 400. D14-QA : exactement 2 nouveaux fichiers. | Pas de stress stockage/concurrence sur l'instance active ; preuves isolées #11 conservées. |
| Champs | B14 : création/édition texte, checkbox cochée, compteur numérique 0→3, date 14/11/2026, rich-text compatible `div/strong`, coordonnées et dimensions saisies. | Suppression, compteur tally, bornes et dates par défaut non testés ; aucun champ QA nettoyé. |
| Saisie overlay | B14 : édition réelle `contentEditable`, valeur « QA saisie navigateur » visible et sauvegardée. | Tab n'a pas démontré le passage au champ suivant ; navigation clavier complète reste à revalider. |
| Zoom / rotation | B14 : 209 %→83 %, alignement simple vérifié ; rotation 0→90→0. | Drag/resize à la souris et exports aux quatre angles non recettés. |
| Autosaves successifs | B14 + D14-QA : première valeur à `09:10:48.045Z`, deuxième à `09:11:09.584Z`, même clé, deuxième payload en base. Indicateur dans la barre supérieure. | Rafales, pagehide et erreurs forcées restent les 17 tests isolés existants. |
| Changement A→B | B14 : édition PNG puis ouverture PDF avant debounce ; D14-QA : valeur PNG uniquement sous sa clé, date/payload PDF inchangés avant restauration. | Cas d'erreur réseau pendant transition non forcé sur l'instance. |
| Chargement propre | B14 + D14-QA : chargement du PDF sans restauration n'a pas modifié le brouillon existant. | Cas `dateDefaultToday` non testé. |
| Restauration | B14 : offre puis restauration du seul brouillon QA, 6 champs/2 pages/valeurs retrouvés ; `div/strong` conservés après rechargement. | Les 3 brouillons historiques sont intacts. |
| Sauvegarde explicite | B14 : bouton Brouillon réussi pour Owner/Editor/Filler ; D14-QA : lignes et valeurs correspondantes présentes. | Sauvegarde structurelle : bug ci-dessous. |
| Vision PNG | B14 : appel réel, sensibilité normale + pointillés, 13 suggestions ajoutées ; édition manuelle possible ensuite. | Faux positifs sur libellés, aucune suggestion checkbox ; précision non validée. |
| Vision PDF | H14 : première page réelle, sensibilités low/normal/high → 9/17/23 suggestions, HTTP 201 sans erreur. | Toutes de type texte sur cette fixture ; pas de détection des pages suivantes. |
| Export PDF navigateur | B14 : téléchargement réel, Poppler sur Debian : 2 pages A4, texte/case/3/date/page 2 présents et visuellement alignés à rotation 0. | Gras perdu et lignes concaténées : bug connu confirmé visuellement. Impression système non exécutée. |
| Export serveur | Désactivé, aucune destination ajoutée. | Non testé sur l'instance ; tests isolés antérieurs conservés. |

## Bugs et limites observés

### P1 — brouillon non transféré après sauvegarde structurelle (confirmé)

1. Importer une fixture QA et la modifier jusqu'à création d'un brouillon sous
   `sourceFileId`, ou charger un template puis modifier ses valeurs.
2. Sauvegarder la structure avec le menu Fichier → Template.
3. Un nouveau template est créé, puis `onSave()` envoie à `PUT /drafts` le couple
   `{templateId: nouveau, sourceFileId: source}`.
4. Si un slot source existe déjà pour cet utilisateur, la contrainte unique
   `Draft(userId, sourceFileId)` provoque `P2002`. Le catch silencieux laisse
   l'interface annoncer « brouillon de travail préservé » sans brouillon associé
   au nouveau template.
5. Réouvrir ce nouveau template ne propose donc pas ces valeurs. Les anciennes
   lignes restent en base ; la sauvegarde explicite sous la nouvelle clé a
   permis de conserver le jeu QA, sans réparation SQL ni effacement historique.

Preuves : `evidence/structural-save.json`, `post-png-vision.json` et inventaires
des clés ; 3 occurrences P2002 corrélées dans les logs de cette recette. La
concurrence du scheduler n'est pas la cause du refus unique observé.
Correction à isoler : utiliser uniquement la clé template du nouveau brouillon,
ne nettoyer l'ancienne clé qu'après succès, signaler distinctement une erreur de
préservation. Ne pas modifier Prisma ni les migrations pour ce problème.

### P2 — pages PDF incorrectes dans l'éditeur (confirmé)

Importer le PDF de référence : Poppler confirme 2 pages, le sélecteur éditeur
n'en propose qu'une. Ajouter manuellement une page : le deuxième fond affiche
encore le repère imprimé « PAGE 1 ». Dans `App.tsx`, chaque `PdfViewer` est créé
sans numéro de page contrôlé ni remontée du nombre de pages ; son état interne
reste sur la première page et sa pagination est cachée. Le téléchargement
exporté contient bien les deux fonds distincts, contrairement à leur aperçu.
La capture `browser-owner-reference.jpg` montre la duplication.

### P2 — ajout de page vierge non marqué comme modification (confirmé)

Après une sauvegarde propre, cliquer « + Page » sans champ reporté : nouvelle
page visible mais badge « À jour ». `addPage()` n'appelle `setDirty(true)` que
si des champs sont clonés. Le simple ajout ne suffit donc pas à l'autosave.
L'ajout du champ QA Page 2 puis une sauvegarde explicite ont conservé cette
page de recette. À traiter dans une correction dédiée aux pages.

### P1 — fidélité rich-text de l'export (déjà connu, reproduit)

Dans l'éditeur et le brouillon restauré :
`<div>QA <strong>gras</strong></div><div>ligne 2</div>` est affiché en deux lignes,
avec gras. Le PDF téléchargé contient « QA grasligne 2 » en texte ordinaire.
Ne pas annoncer ce parcours comme entièrement validé. Des balises `p` saisies
dans le panneau sont échappées par la whitelist API actuelle ; elles ne sont
pas utilisées comme preuve de compatibilité rich-text.

### Autres observations à distinguer

- Vision : suggestions réelles mais précision insuffisante sur cette fixture ;
  pas de métrique de qualité ni seuil d'acceptation adopté. Ce n'est pas une
  panne du partage de volume ou une preuve de détection fidèle.
- Ergonomie : clé `toolbar.fitPage` affichée telle quelle ; icônes Détecter et
  Partager encore disponibles pour Filler alors que les handlers/API refusent
  l'opération. Pas de contournement démontré.
- Le pilote a subi des délais lors des transferts de fichiers ; les deux
  imports ont finalement été constatés en UI et en base. Ne pas les confondre
  avec une erreur du service. Aucune erreur console applicative capturée à la
  fin de la recette.

## Intégrité et état final

| Contrôle D14-QA | Résultat |
|---|---|
| Toutes les lignes historiques, toutes tables | Empreintes identiques, aucune suppression/mutation |
| 29 fichiers historiques | Contenus identiques |
| Base finale | 7 users, 8 documents, 5 templates, 11 drafts, 126 fields, 4 partages ; 0 groupe, credential WebAuthn ou code de secours |
| Uploads finaux | 31 fichiers = 29 historiques + PDF et PNG QA |
| Conteneurs | IDs, images, montages et états inchangés ; backend 0 redémarrage |
| Volumes critiques | postgres-data, uploads-data et admin-config conservés |
| Configuration | `.env.prod` inchangé ; admin-settings.json toujours absent ; aucune sauvegarde de paramètre admin |
| HTTP | Frontend 200, /api/health 200 ; accès PostgreSQL réel via Prisma/API, accès Vision réel via détections |
| Logs | Aucune réapparition du TypeError sanitize-html ; erreurs P2002 du bug de brouillon ci-dessus, pas de redémarrage |

Le contrôle final confirme également `ALLOW_SELF_REGISTER=false`, mode local et
MFA optional. Le dump après QA correspond encore à l'empreinte logique de la
base ; ses deux archives passent leurs empreintes. Les builds isolés suivants
n'ont modifié ni la base, ni les comptes, ni les fichiers de l'instance.

Les preuves brutes sont hors Git, dans `evidence/` sous la racine QA privée.
Captures utiles : `browser-owner-reference.jpg`, `browser-editor-qa.jpg`,
`browser-filler-permissions.jpg`, `browser-outsider-qa.jpg`,
`browser-vision-qa.jpg`. Elles ne contiennent que l'interface et les données QA.

## Correctif P1 préparé après la recette, non déployé

Branche indépendante de `main` : `codex/fix-template-draft-preservation`.
SHA poussé et validé sur Debian :
`1c6eaaf0ce725516ed40dfae29fbdd6537cd8d39`.
Le diff concerne le flux web de sauvegarde de template/brouillon, ses messages
FR/EN, les tests et leur documentation. Aucune source métier API, dépendance,
permission, migration ou configuration de production modifiée.

Le nouveau brouillon utilise uniquement `templateId`. Une capture indépendante
conserve clé/révision/données ; les réponses tardives n'adoptent pas un document
ou une session qui a changé. L'ancien slot n'est nettoyé qu'après préservation
et adoption ; un refus conserve l'ancien contexte et affiche un avertissement.

| Validation isolée sur ce SHA | Résultat |
|---|---|
| Build frontend production | Réussi ; avertissement de gros bundle conservé |
| Build API et Prisma generate | Réussis ; aucune migration |
| Autosave existant | 17/17 |
| Permissions frontend existantes | 13/13 |
| MFA frontend existant | 4/4 |
| Transfert de brouillon : snapshots, refus, nettoyage, changement de contexte/session | 11/11 |
| HTTP Nest avec vrais guards/DTO/controller/service, JWT et Prisma synthétiques | 6/6, dont reproduction du refus de l'ancienne requête puis succès du transfert corrigé |

Total : **51 tests réussis**, en plus des contrôles B14/H14 sur l'application
active. Aucun accès réseau externe ou volume réel dans les conteneurs de tests.
Le helper web monté en lecture seule dans la suite HTTP provient de ce même SHA.
Disque vérifié avant chaque build ; aucune purge Docker globale.

Les 213 tests API historiques et Compose inchangés n'ont pas été rejoués pour
ce correctif web. Les six nouveaux tests HTTP simulent Prisma : ils ne sont pas
une nouvelle validation PostgreSQL réelle ni une recette navigateur du correctif
actif. Le nettoyage DELETE existant et les modifications concurrentes depuis
plusieurs onglets restent des limites documentées dans
`docs/TEMPLATE_DRAFT_PRESERVATION.md` de la branche de correction.

Les deux branches sont poussées pour revue. Aucune PR ouverte ou fusionnée
automatiquement, aucun déploiement du correctif. L'image backend active reste
`f75d7b3f0aae3f5f285d0dbfe486d7080a961815`, les quatre IDs de conteneurs et
les trois volumes sont inchangés ; Fedora et le checkout Debian sont propres.
Preuve privée complémentaire : `evidence/fix-validation.json`.

## Suite priorisée

1. Corriger la préservation des brouillons après sauvegarde structurelle, tests
   de collision/refus et validation Debian isolée ; aucune bascule automatique.
2. Corriger le rendu/compte des pages et le signal de modification de `addPage`,
   puis refaire la comparaison des deux fonds et l'autosave de page vierge.
3. Traiter la fidélité rich-text dans une branche dédiée, avec références PDF.
4. Sur décision séparée : RP/origin WebAuthn + geste matériel, enrôlement TOTP QA
   humain, LDAP manquant et politique du fallback hybride à clarifier. Aucun
   changement de politique active pour faciliter une recette.
5. Compléter les fonctions non testées : groupes/dossiers, révocation par UI,
   drag/resize souris, tally, overflow, dates par défaut, clavier, rotations
   d'export, impression. Garder les défauts démontrés séparés de ces inconnues.
6. Ajouter les gates CI et mesures de qualité ; les risques de crash brutal
   d'upload, révocation JWT et latence/concurrence restent des dettes documentées,
   sans panne supplémentaire démontrée pendant cette recette.
