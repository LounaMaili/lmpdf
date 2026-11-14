# Recette navigateur authentifiée LMPDF — préparation du 14 novembre 2026

## Périmètre et acquis

Version backend cible et active :
`f75d7b3f0aae3f5f285d0dbfe486d7080a961815`.
La [checklist de régression](REGRESSION_CHECKLIST.md) et le
[rapport de déploiement](DEPLOYMENT_2026-11-14.md) restent les références.
Les 213 tests API, 115 réexécutions runtime, 4 tests d'intégration et 17 tests
autosave historiques ne sont pas à recommencer sans changement ou anomalie.

Cette préparation n'a créé aucun compte, facteur MFA, document, partage ou
brouillon. Aucun document existant n'a été ouvert dans l'éditeur, aucune
configuration active n'a été modifiée. Les parcours ci-dessous sont un plan,
pas des résultats acquis.

## Accès constaté et configuration utile

| Point | Observation en lecture seule | Conséquence |
|---|---|---|
| HTTPS / Authelia | Navigation vers `https://lmpdf.gueguen.org/` : redirection vers `https://login.gueguen.org/`, page « Connexion - Authelia », sans alerte TLS. Aucun identifiant saisi. | Le portail est joignable ; la session Authelia du navigateur de recette reste à établir par l'utilisateur. Le second facteur Authelia n'a pas été observé à cette étape. |
| Sonde Debian HTTPS | Validation TLS normale ; requête acceptant HTML : 302 puis portail 200. Requête sans préférence HTML : 401. | Différence normale de réponse au client non authentifié ; ne pas traiter ce 401 comme une panne ou contourner la protection. |
| Authentification LMPDF | Mode `local`, MFA `optional`, clé de chiffrement MFA configurée ; CORS autorise l'origine canonique. | Connexion locale envisageable après passage d'Authelia. LMPDF et Authelia ont leurs propres comptes et facteurs. |
| Facteurs LMPDF | 3 comptes locaux actifs : un admin, un editor, un viewer. Aucun TOTP actif ni credential WebAuthn sur ces comptes. | Une vraie connexion TOTP LMPDF nécessite d'abord un enrôlement explicitement autorisé sur un compte QA. Ne pas réutiliser un secret ni modifier un compte existant implicitement. |
| WebAuthn LMPDF | RP effectif `localhost`, origin `http://localhost:4173`. | Incompatible avec l'origine HTTPS LMPDF ; recette réelle bloquée avant correction de configuration autorisée. |
| Comptes QA | Auto-inscription désactivée ; `UsersController` ne propose pas de création de compte. | Choisir explicitement le provisionnement des acteurs ; ne pas activer l'inscription publique pour faciliter le test. |
| Données | 6 documents, 29 fichiers, 1 template, 3 brouillons ; aucun groupe ni partage documentaire. | Ne pas utiliser ces objets comme fixtures. Une matrice de partage nécessite des données dédiées et un accord. |
| Export serveur | Désactivé, aucune racine ni destination configurée. | Son absence est attendue. Le téléchargement PDF navigateur est un parcours distinct, testable après accord sur le jeu QA. |

La compatibilité HTTPS réelle est confirmée jusqu'à Authelia, pas jusqu'à une
session authentifiée LMPDF. Ne pas réutiliser les identifiants LMPDF sur le
portail Authelia ni demander des mots de passe, OTP ou secrets MFA dans Git/chat.

## Prérequis à faire approuver

1. **Session humaine** : accès d'un compte Authelia existant au domaine LMPDF,
   second facteur si demandé, puis choix du compte LMPDF autorisé. Les saisies
   de facteurs, QR/recovery codes, biométrie et gestes de clé restent humains.
2. **Acteurs QA dédiés** : owner, editor et filler avec le rôle global `editor`,
   plus un outsider avec le rôle global `viewer`. Le rôle documentaire est
   attribué sur la fixture, indépendamment du rôle global. L'administrateur
   existant peut observer les réglages, après accord, sans créer un nouvel admin.
   Aucun compte existant n'est identifié ici comme jetable ou autorisé à servir
   de fixture. Les comptes actuels ne suffisent pas à cette matrice indépendante.
3. **Provisionnement** : méthode à convenir sur Debian, limitée aux comptes QA
   approuvés, sans migration ni activation de l'inscription publique. Le rôle
   admin et le rôle global d'un utilisateur existant ne seront pas changés.
4. **Fixtures synthétiques** : un PDF de deux pages et un PNG scanné factice,
   avec grilles, pointillés et zones de référence ; préparation/validation sur
   Debian, sans donnée personnelle. Préfixe proposé `RECETTE-20261114-…` pour
   comptes, templates et objets ; aucun fichier n'est encore importé.
5. **Écritures autorisées** : liste convenue des imports, champs, templates,
   brouillons et partages QA ; groupe temporaire seulement si le scénario groupe
   est approuvé. Conserver un inventaire d'IDs réservé au jeu QA.
6. **Conservation / nettoyage** : l'API ne propose pas de suppression de
   document uploadé ; supprimer un template ne supprime pas son PDF. Le DELETE
   utilisateur désactive le compte sans le purger. Choisir la conservation d'un
   jeu QA réutilisable ou autoriser séparément une procédure ciblée de retrait.
   Ne pas promettre un nettoyage intégral par l'UI, lancer de purge ou toucher
   aux fichiers historiques. Un environnement de recette HTTPS/Authelia séparé
   est une autre option, mais son installation/routage exige aussi un accord.

Un enrôlement TOTP QA serait compatible avec la politique actuelle facultative ;
il écrit un facteur et demande une autorisation distincte. Les scénarios
`MFA_POLICY=required`, changement `auth.mode` / fallback et pannes forcées restent
dans l'environnement isolé déjà validé, sans bascule de politique sur l'instance.

Pour WebAuthn, proposer séparément un RP lié au domaine (par exemple
`lmpdf.gueguen.org`) et l'origin `https://lmpdf.gueguen.org`, à transmettre
effectivement au backend : le Compose actuel ne relaie pas ces variables.
Un ajout dans `.env.prod` seul ne suffirait pas. Aucun changement Authelia,
désactivation TLS, assouplissement CORS ou origine artificielle n'est prévu.

## Séquence et critères de recette

`Automatisable` signifie pilotage navigateur / contrôle API normal après
autorisation et session adéquate, pas exécution de builds ou dépendances sur
Fedora. Toutes les installations, suites et analyses applicatives restent sur
Debian. Les étapes marquées QA ne sont pas autorisées par cette préparation.

| ID / parcours | Contrôle et résultat attendu | Exécution / prérequis |
|---|---|---|
| A00 — entrée HTTPS | Domaine canonique, certificat accepté normalement, Authelia avant l'application ; aucune exposition anonyme des documents. | Lecture seule réalisée jusqu'au portail ; pas une connexion complète. |
| A01 — Authelia puis login local | L'utilisateur termine la connexion et le facteur Authelia, puis le login LMPDF ; identité/rôle attendus, lecture seule de l'accueil et des réglages autorisés. | Humain pour les credentials/facteurs ; automatisable ensuite. Choix du compte/session requis. |
| A02 — TOTP LMPDF | Sur un compte QA approuvé : enrôlement humain, challenge après mot de passe, aucun accès métier avant le code, connexion après code valide, refus contrôlé d'un code invalide sans brute force. | Bloqué par l'absence d'enrôlement et l'accord manquant. Ne pas consommer des codes de secours réels. |
| A03 — WebAuthn / passwordless | Enrôlement et connexion sur origine correcte, geste utilisateur, annulation/refus par l'authentificateur sans accès métier ; distinguer le facteur Authelia du facteur LMPDF. | Bloqué par RP/origin et absence de credential ; humain matériel et accord de configuration nécessaires. Signature/rejeu restent les preuves synthétiques acquises, sans rejouer d'assertion sur l'instance active. |
| A04 — JWT/MFA et changements de politique | Conserver les preuves des 72 tests : challenge/enrollment refusés, révocation avant/pendant finish, corruption fail-closed, sessions ordinaires compatibles. | Automatisé isolé déjà réussi ; ne pas changer la politique active pour rejouer ces cas. |
| P10 — droits documentaires | Owner gère sa fixture ; editor peut modifier la structure ; filler remplit sans modifier la structure, avec export/impression refusés dans les parcours intégrés ; outsider n'accède pas au document non partagé. Vérifier UI et refus serveur par parcours normaux. | Automatisable avec quatre acteurs QA et partages approuvés. Ne pas utiliser admin comme acteur owner/editor/filler : son accès étendu fausserait la matrice. |
| P11 — partage par groupe | Groupe QA, membre/non-membre, puis retrait d'un partage QA ; aucun accès gagné par un non-membre. | Mutation supplémentaire à approuver ; pas indispensable au premier parcours individuel. |
| D20 — import PDF/image | Upload QA valide, lecture et rendu corrects, métadonnées cohérentes ; viewer refusé ; petit fichier à signature invalide refusé sans nouveau fichier persistant. | Automatisable après accord d'import et d'acteurs. Les limites 25 Mio, ENOSPC et saturation restent les tests isolés acquis, sans remplissage du disque actif. |
| E30 — éditeur | Créer/modifier/supprimer sur QA les champs texte, checkbox, compteurs et date ; déplacer/redimensionner, rotations, zoom, clavier et deux pages ; comparer les valeurs et la structure. | Pilotage automatisable, comparaison visuelle humaine. Aucun document existant ouvert dans l'éditeur pendant la préparation. |
| S40 — autosaves successifs | Première édition → saved + heure ; deuxième édition → nouvelle sauvegarde ; rafale → debounce ; absence d'édition → pas d'écriture inutile ; masquage d'onglet → flush utile. | Automatisable sur QA. S'appuyer sur les 17 tests historiques ; vérifier l'indicateur visible dans le navigateur. |
| S41 — A/B et chargement propre | Éditer A, passer à B ; aucun payload de A sous la clé B ; éditer B puis vérifier sa sauvegarde. Un chargement sans édition ne doit pas déclencher un autosave superflu. | Deux fixtures QA. Isoler le cas date « aujourd'hui », dont l'initialisation peut déclencher un changement ; pas d'ouverture d'un document réel supposée sans effet. |
| R50 — restauration / sauvegarde | Réouvrir uniquement un brouillon QA, accepter sa restauration et vérifier champs/valeurs/page ; sauvegarde explicite puis structurelle, vérifier le bon brouillon et la bonne clé. | Automatisable après accord ; ne jamais restaurer/effacer les trois brouillons existants. Une sauvegarde structurelle peut créer un nouveau template : l'inventorier. |
| V60 — Vision / OCR de champs | PNG et première page du PDF QA : détection, sensibilité, pointillés, application des overlays et cohérence des coordonnées. L'édition manuelle reste possible. | Appel automatisable, exactitude humaine. Appliquer les suggestions modifie l'éditeur et peut autosauver. Le PDF multi-page complet reste incomplet : Vision ne traite actuellement que la première page. |
| X70 — PDF navigateur | Télécharger le PDF rempli, comparer texte, cases, compteurs, dates, pages et rotations ; vérifier le refus filler/viewer. Analyse/rendu avec les outils déjà disponibles sur Debian. | Automatisable pour le téléchargement, comparaison visuelle humaine. Dette connue rich-text : formatage perdu, paragraphes susceptibles d'être concaténés ; consigner sans corriger ici. |
| X71 — export serveur | L'UI ne doit pas proposer une destination inexistante. Pour écrire un PDF côté serveur, exiger ensuite une racine/destination QA explicitement autorisée. | Désactivé actuellement. Ne pas activer/configurer ni tester overwrite sur des fichiers réels. Les tests de chemins et collisions restent acquis en isolation. |
| ADM80 — administration | Lire les réglages et vérifier que seul admin dispose de l'accès ; distinguer valeurs effectives et persistance. | GET automatisable après session autorisée ; aucun PATCH ni création de `admin-settings.json` pour cette étape. |

## Trace, arrêt et limites

Pour chaque cas exécuté : noter SHA, navigateur/origine, alias d'acteur, fixture
synthétique, résultat attendu/observé, horaire et IDs QA utiles. Captures et
preuves ne doivent montrer ni PDF personnel, mot de passe, QR/secret MFA, code
de secours, cookie ou JWT. Conserver seulement des extraits réseau expurgés.

Une régression d'accès, une écriture sur un document non QA, une perte de données
ou un service instable impose l'arrêt de la recette et un rapport ; pas de
correction directe sur la VM, reset, migration, redémarrage ou rollback implicite.
Un refus conforme à la politique ou un parcours non configuré n'est pas une panne.

Les validations autorisées immédiatement restent l'accès HTTPS non authentifié,
la lecture des preuves et l'inventaire anonymisé. La prochaine autorisation doit
préciser session humaine, acteurs, objets QA et conservation/nettoyage avant
toute création, édition, partage, restauration ou activation d'un facteur.
