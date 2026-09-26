# Workflow LMPdf : Fedora, GitHub, Debian

GitHub est la source de vérité entre le dépôt Fedora et la VM `lmpdf-dev`.
Le code se modifie sur Fedora avec Codex Desktop. La VM Debian sert uniquement
à valider et exécuter une révision déjà présente sur GitHub ; elle ne doit pas
devenir une seconde copie de développement.

## Travail sur Fedora

- Créer une branche dédiée pour chaque tâche approuvée. Ne pas développer ni
  pousser directement sur `main`.
- Modifier les sources sur Fedora et examiner `git status`, `git diff` et le
  diff indexé avant chaque commit. N'ajouter que les fichiers concernés.
- Ne pas installer de dépendances applicatives ni de paquets système pour
  LMPdf sur Fedora. Ne pas y exécuter Prisma, les migrations, les builds ou
  les tests nécessitant ces dépendances.
- Quand le changement est prêt pour validation, créer un commit cohérent,
  pousser la branche sur GitHub et relever le SHA exact du commit poussé avec
  `git rev-parse HEAD`. Vérifier que la branche distante pointe vers ce SHA.
- Pousser une branche prête pour revue même si aucune PR n'est encore créée.
  Ne pas ouvrir ou fusionner de PR, ni modifier `main`, sans instruction
  explicite.

## Synchronisation vers `lmpdf-dev`

Le projet de la VM se trouve dans `/home/erwan/LMPdf-git`. Après avoir poussé
le commit sur GitHub :

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

Ne pas afficher les valeurs des secrets ni le contenu des fichiers `.env`.
Ne pas placer de jeton d'accès dans l'URL du remote Git.

## Validation sur Debian

Exécuter sur `lmpdf-dev` toutes les opérations qui exigent l'environnement
applicatif : installation des dépendances, pnpm/npm, Prisma generate, builds,
tests, Docker Compose et contrôles des services. Les migrations ne sont lancées
que si elles sont explicitement autorisées. Ne pas lancer de migration
destructive ni modifier les données sans autorisation explicite.

Si une validation échoue, ne pas corriger les sources sur la VM. Revenir sur la
branche Fedora, corriger, créer un nouveau commit, le pousser sur GitHub, puis
basculer la VM sur ce nouveau SHA et reprendre la validation. Aucun commit de
développement propre à la VM ne doit rester absent de GitHub.

## Rapport de chaque itération

Indiquer la branche, le SHA poussé, la présence ou le lien de la branche sur
GitHub, les validations effectuées sur Debian, le résultat de chacune et les
problèmes qui restent à corriger. Signaler explicitement les validations non
effectuées.
