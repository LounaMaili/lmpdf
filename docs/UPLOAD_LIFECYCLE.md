# Uploads refusés : correction et preuves ciblées

## Défaut reproduit

La référence est `main` au SHA
`3ecac12ce04e45df67c16fe251729ad4b9006fb4`. Le commit de reproduction
`a564696159f0ff8e3faf639cee6d6c285ac362fc` ajoute uniquement des tests et leur
commande : **11 échecs sur 23 tests HTTP**, exécutés sur Debian.

L'intercepteur Multer écrivait avant le contrôle `canUser(uploadDocument)`.
Un utilisateur authentifié sans ce droit pouvait donc accumuler des fichiers
malgré des réponses 403. Les rejets de base de données, certaines erreurs I/O
et les déconnexions laissaient également des fichiers temporaires ou finaux.
Cela démontre un risque d'épuisement du stockage partagé ; aucun essai de
remplissage ni scénario d'abus n'a été exécuté sur l'instance active.

## Comportement corrigé

- Les gardes JWT/MFA et la permission configurable s'appliquent avant le
  traitement multipart et l'ouverture d'un fichier. Le droit est relu après
  réception pour prendre en compte une révocation pendant le transfert.
- Une requête possède exclusivement ses chemins générés côté serveur. Les
  écritures utilisent une création exclusive, des fichiers 0600 et un flux
  avec backpressure. La vérification de signature ne lit que 12 octets.
- Le plafond reste **25 Mio inclus**, avec un seul fichier et des champs
  multipart bornés. Les signatures, extensions dérivées et l'exclusion SVG
  restent contrôlées côté serveur ; le nom client ne définit aucun chemin.
- La promotion utilise un lien exclusif sur le même système de fichiers, puis
  retire le nom temporaire. Une collision n'écrase aucun fichier existant.
- Le nettoyage attend la fermeture des écritures et s'exécute après refus,
  erreur, multipart tronqué ou déconnexion. Il ne parcourt ni ne purge les
  documents existants. Après insertion confirmée, le fichier est conservé même
  si la réponse au client échoue.
- L'identifiant de métadonnées est un UUID généré côté serveur, comme le
  prévoit déjà le schéma. Après une erreur d'insertion, une lecture par cet
  identifiant, vérifiant aussi propriétaire et chemin, distingue une insertion
  confirmée d'un rejet avant de décider du nettoyage.

### Limites explicites

Après une erreur réseau ou une autre issue indéterminée de l'insertion, le
serveur conserve le fichier et journalise son UUID pour rapprochement, même si
une lecture immédiate ne voit pas encore de ligne : l'insertion peut toujours
être en cours. Seul un rejet certain de validation/contrainte permet alors le
nettoyage. Supprimer aveuglément pourrait détruire un document effectivement
enregistré. Une erreur
persistante d'unlink est également journalisée et renvoyée comme échec. Ces
deux cas nécessitent une intervention ; aucune purge automatique n'est ajoutée.

Un arrêt brutal du processus/hôte ne peut exécuter un `finally`. Le système de
fichiers et PostgreSQL ne constituent pas une transaction commune. Une future
procédure de rapprochement devra vérifier la base avant toute suppression.
La limitation des quotas ou du nombre d'uploads autorisés concurrents est un
chantier distinct. Le débit disque global et la disponibilité face à un abus
d'un compte autorisé ne sont donc pas garantis par ce correctif.

## Tests et validation reproductible

`apps/api/tests/upload-lifecycle.test.cjs` démarre une application Nest HTTP
isolée avec les gardes réels, Prisma simulé et des fichiers/JWT synthétiques.
Chaque scénario utilise un répertoire temporaire privé avec un fichier témoin
préexistant. Les tests ne montent ni uploads, ni base, ni configuration réelle.

La suite couvre autorisations et overrides, JWT/MFA, refus MIME/taille,
multipart malformé, collisions, révocation, erreurs lecture/promotion/ENOSPC,
déconnexions pendant réception/validation/insertion, concurrence succès/échec,
accusé d'insertion perdu et nettoyage impossible signalé. Les octets PDF/PNG
testent le contrat de signature existant, pas le décodage complet des formats.

Sur Debian, après checkout détaché du SHA poussé et contrôle de capacité disque :

```bash
docker build --pull=false --target build -f apps/api/Dockerfile.prod \
  -t lmpdf-upload-build:<SHA> .
docker run --rm --network none --memory 768m --cpus 1 \
  --tmpfs /tmp:rw,nosuid,nodev,size=128m lmpdf-upload-build:<SHA> \
  sh -c 'pnpm --filter @lmpdf/api test:uploads'
```

Le build utilise le lockfile figé, Prisma generate et TypeScript, sans migration.
Relancer également `test:auth`, `test:settings`, `test:permissions`,
`test:exports` et `test:export-paths` ; la suite exports nécessite le fichier
nginx du même checkout monté en lecture seule via `LMPDF_TEST_NGINX_CONFIG`.
Consigner les résultats et le SHA exact dans la PR. Aucun déploiement actif
n'est nécessaire à cette validation.

## File priorisée des anomalies restantes

Cette liste complète l'audit historique `REGRESSION_CHECKLIST.md` sans en
réécrire les observations. Une constatation de code ne vaut pas une recette
réussie ni une exploitation démontrée.

| Priorité | Sujet | Niveau de preuve / suite |
|---|---|---|
| P1 conditionnel | LDAP/hybride : client LDAP absent, réactivation de compte, MFA local non appliqué au chemin LDAP, fallback plus large que son nom « admin » | Établi par lecture ; LDAP désactivé sur l'instance inventoriée. Clarifier la politique avant activation/correction ; aucun test sur annuaire réel. |
| P2, prochaine étape | Passwordless : revérification du mode d'authentification au finish | Écart établi par le code ; reproduire en HTTP isolé avec changement de mode, puis corriger séparément. |
| P2 | WebAuthn : RP/origin par défaut incompatibles avec le domaine de test | Configuration constatée ; parcours HTTPS avec authentificateur réel non testé. Ne pas contourner les protections pour la recette. |
| P2 | Export rich-text : formatage et sauts de paragraphes | Implémentation incomplète constatée ; ajouter comparaison visuelle avec documents synthétiques. |
| P2 | Validation interne PDF/image, quotas, rapprochement fichiers/base après crash | Risques ou protections absentes, distincts du défaut HTTP reproduit. Quantifier et tester avant d'annoncer une vulnérabilité supplémentaire. |
| P2 | Recette navigateur MFA, owner/editor/filler, restauration, autosaves et rendu/export | Couverture automatisée partielle ; les parcours humains non observés restent à valider. |
| P3 | Overlay mobile de debug gênant la barre d'outils | Anomalie observée précédemment ; reproduire avec viewport synthétique et corriger séparément. |
| P3 | CI absente, lint/format placeholders, App.tsx et bundle volumineux | Dettes de qualité établies ; aucun traitement dans cette branche. |

Les correctifs JWT/MFA, permissions/export et persistance administrateur déjà
intégrés ne sont pas à recommencer. Passwordless et actualisation documentaire
générale restent des travaux séparés.
