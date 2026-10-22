# Autorisations documentaires : correction proposée

La permission globale reste nécessaire ; elle est combinée à
`PermissionsService.requireDocRole(..., 'editor')` pour créer un template
référençant un document et pour résoudre/exécuter un export serveur.
L'admin conserve ses privilèges sur les documents existants, mais un ID inconnu
n'accorde jamais un rôle.

Les exports fournissent `sourceFileId` et/ou `templateId`. Le serveur vérifie
l'existence des objets et la relation entre eux, puis utilise le nom enregistré
pour les règles et les chemins. Un nom fourni seul n'autorise rien. Un template
sans document source ou un export sans contexte documentaire est refusé. Le
parcours actuel du frontend possède un document source lorsqu'il propose un
export. Ce choix restrictif ne crée aucune exception pour un contexte manquant.

Le PDF multipart est reçu en mémoire (limite conservée à 50 Mo), puis le contexte
et les droits sont contrôlés avant l'appel au writer. Une requête refusée ne
crée donc pas de temporaire disque. Le rendu PDF demeure fourni par le navigateur :
le serveur autorise le contexte, sans certifier que les octets correspondent
visuellement à ce document.

Les destinations de dossiers sont contrôlées selon la visibilité existante :
propriétaire personnel, membre du groupe ou admin. Un sous-dossier garde le même
propriétaire/groupe que son parent. Le déplacement de l'objet source reste réservé
à son propriétaire ou à l'admin, comme avant la correction.

Dans l'éditeur, un rôle non encore résolu sur un document échoue de manière
restrictive. Le filler conserve la modification des valeurs, y compris checkbox,
compteurs et texte riche, mais les handlers de géométrie, type, pages et styles de
structure sont bloqués. Le rôle résolu reste associé à l'ID du document pour
éviter d'utiliser une réponse tardive du document précédent.

## Validation

Tests exécutés sur les SHA poussés dans des images de build isolées sur Debian :

- API : build puis `pnpm --filter @lmpdf/api test:permissions` ;
- web : build puis `pnpm --filter @lmpdf/web test:permissions` et
  `pnpm --filter @lmpdf/web test:autosave`.

Les tests API utilisent Prisma simulé et un serveur Nest HTTP local au conteneur,
avec JWT synthétiques. Les tests UI exécutent les handlers réels des composants
avec hooks et dépendances DOM simulés. Ils ne remplacent pas les tests navigateur
avec plusieurs comptes, qui restent à réaliser avant déploiement.

Résultats du 22/10/2026 : build API et 43/43 tests API sur `9ba36ce…` ; build web,
13/13 tests frontend de permissions et 17/17 autosave sur `15c3c51…`. Les builds
utilisent le lockfile figé. Le warning de gros bundle Vite reste présent.
La revue a ajouté un garde contre les réponses de détection tardives après un
changement de document ou une perte de droit. Aucun déploiement effectué.
