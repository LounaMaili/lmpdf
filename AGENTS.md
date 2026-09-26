# AGENTS.md — LMPdf

## Projet et sources de référence

LMPdf est une application de formulaires PDF. Le dépôt est un
monorepo pnpm : `apps/web/` contient le frontend React/Vite/TypeScript,
`apps/api/` l'API NestJS/Prisma/PostgreSQL, et `apps/vision/` le service interne
FastAPI/OpenCV/Tesseract. Docker Compose décrit les services. Aucun package de
code partagé n'existe actuellement dans le dépôt.

Avant de changer un comportement, lire les fichiers proches et les documents
utiles : `README.md`, `ARCHITECTURE.md`, `PROJECT_STRUCTURE.md`,
`MAINTENANCE_UPDATES.md`, `CHANGELOG.md` et, pour les champs date,
`RAPPORT_ANALYSE_DATE_FIELD.md`. Vérifier leurs affirmations contre le code et
la structure actuels : certaines descriptions sont historiques.

## Règles produit et architecture

- Préserver l'usage local et self-hosted. Ne pas imposer de SaaS, Firebase,
  cloud externe ou télémétrie sans demande explicite.
- Garder le PDF ou l'image en fond, les champs en overlay et un export fidèle.
  Préserver les champs texte, case à cocher, compteur et date, ainsi que la
  séparation entre structure du formulaire et valeurs remplies.
- Garder les responsabilités web, API et vision distinctes. La détection doit
  rester optionnelle : l'édition manuelle fonctionne sans le service vision.
  Documenter une décision structurante avant de la généraliser.
- Exprimer les positions des champs par rapport au document et à la page,
  plutôt qu'aux seuls pixels écran. Synchroniser les contrats de données entre
  applications sans présumer l'existence d'un package partagé.
- Placer la validation des entrées API près des DTO ou des contrôleurs.
  Respecter les rôles documentaires `owner`, `editor` et `filler` ; toute
  évolution des permissions passe par la matrice de permissions et une revue
  ou un test ciblé.
- Pour les uploads, vérifier type, taille, nom, stockage, droits d'accès et
  protections contre la traversée de chemins. Ne pas servir de PDF, d'upload
  ou d'export sans contrôle explicite des permissions. Pour l'export, vérifier
  le rendu visuel et les droits d'accès.
- Ne pas contourner JWT, MFA, WebAuthn ou LDAP. Maintenir la sanitation du
  contenu rich-text côté web et API, y compris avant l'export PDF.
- Garder `react-pdf` et `pdfjs-dist` compatibles ; ne pas modifier leurs
  versions séparément. Garage est configuré comme service S3 compatible, mais
  les uploads actuels utilisent un volume local partagé entre API et vision.

## GitHub est la source de vérité

Le code se modifie sur Fedora avec Codex Desktop. La VM Debian `lmpdf-dev` sert
uniquement à valider et exécuter une révision déjà présente sur GitHub ; elle
ne doit pas devenir une seconde copie de développement. Le parcours normal est
**Fedora → branche Git → commit → push GitHub → VM Debian → validation**.

### Travail sur Fedora

- Utiliser une branche dédiée ou celle explicitement indiquée par l'utilisateur.
  Ne jamais développer ni pousser directement sur `main`. Garder les changements
  petits et séparer web, API et vision quand c'est possible.
- Examiner `git status`, `git diff` et le diff indexé avant chaque commit.
  N'ajouter que les fichiers concernés. Ne pas modifier les artefacts générés
  (`apps/*/dist/`, `*.tsbuildinfo`, `__pycache__/`, `*.pyc`) ni les sauvegardes
  `*.bak*` sans demande explicite, même s'ils sont déjà suivis par Git.
- Ne pas installer de dépendances applicatives ou de paquets système pour LMPdf
  sur Fedora. Ne pas y exécuter Prisma, des migrations, des builds ou des tests
  nécessitant les dépendances applicatives.
- Une fois le changement prêt, créer un commit cohérent, pousser la branche
  sur GitHub et relever `git rev-parse HEAD`. Vérifier que la branche distante
  pointe vers ce SHA. Pousser une branche prête pour revue même sans PR.
  Ne pas ouvrir ou fusionner de PR, ni modifier `main`, sans instruction
  explicite.

### Synchronisation vers `lmpdf-dev`

Le projet de la VM se trouve dans `/home/erwan/LMPdf-git`. Après le push :

1. Se connecter avec `ssh lmpdf-dev` et exécuter `git status --short --branch`
   dans ce répertoire.
2. Si un fichier suivi est modifié ou indexé sur la VM, arrêter la
   synchronisation et le signaler. Ne jamais utiliser automatiquement
   `git reset --hard`, `git clean`, `git pull` ou `git merge` pour résoudre cet
   état. Conserver les fichiers non suivis tels que `.env` et `.env.prod`.
3. Si l'arbre suivi est propre, exécuter `git fetch origin --prune`, puis
   `git switch --detach <SHA_DU_COMMIT_POUSSE>`.
4. Vérifier `git rev-parse HEAD` et `git status --short --branch` avant les
   validations. Le SHA testé doit être celui du commit poussé sur GitHub.

Si une validation échoue, ne pas corriger les sources sur la VM. Revenir sur
Fedora, corriger sur la branche, créer et pousser un nouveau commit, puis
basculer la VM sur son SHA exact. La VM ne doit contenir aucun commit de
développement absent de GitHub.

### Validation sur Debian

Effectuer exclusivement sur `lmpdf-dev` les opérations nécessitant
l'environnement applicatif : installation des dépendances, pnpm/npm, Prisma
generate, builds, tests, Docker Compose et contrôles des services. Utiliser
pnpm pour le monorepo, ne pas introduire `npm install` ni de `package-lock.json`
à la racine, et éviter les mises à jour de dépendances non demandées.
`pnpm lint` et `pnpm format` sont actuellement partiellement factices : les
scripts web et API sont des placeholders et ne prouvent pas la qualité du code.

Après un changement web, vérifier au minimum le build web ; après un changement
API ou Prisma, le build API et, si nécessaire, Prisma generate. Adapter les
vérifications au périmètre et signaler celles qui ne peuvent pas être lancées.
Ne pas modifier les migrations Prisma sans demande explicite ; une évolution
autorisée du schéma doit avoir sa migration versionnée. Ne lancer de migration
sur la VM que si elle est explicitement autorisée, et ne pas modifier les
données ou lancer de migration destructive sans autorisation explicite. Ne pas
modifier la configuration de production ou de déploiement sans validation
explicite.

## Secrets et données locales

Ne jamais afficher, copier ou committer de secrets, ni le contenu des fichiers
`.env`. Ne pas inclure de jeton d'accès dans l'URL d'un remote Git. Ne pas
committer `.env`, `.env.*`, clés JWT/MFA/S3/Garage, identifiants LDAP, mots de
passe, uploads, exports utilisateur, dumps ou volumes Docker. Les dossiers
`infra/postgres-data/`, `infra/minio-data/`, `infra/garage-data/`,
`infra/garage-meta/` et `uploads/` sont des données runtime, même si certains
fichiers historiques sont déjà suivis par Git. Documenter toute nouvelle
variable dans `.env.example` avec une valeur d'exemple non sensible. Ne pas
exposer de données personnelles de PDF réels dans les logs, captures ou tests.

## Rapport de chaque itération

Indiquer la branche, le SHA poussé, la présence ou le lien de la branche sur
GitHub, les validations effectuées sur Debian, leur résultat et les problèmes
restants. Signaler explicitement les validations non effectuées.
