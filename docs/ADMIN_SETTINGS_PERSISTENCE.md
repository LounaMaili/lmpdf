# Persistance des réglages administrateur

## Stockage et comportement

Le volume Docker nommé `admin-config` contient `admin-settings.json` :

| Environnement | Répertoire monté dans l'API |
|---|---|
| Compose développement | `/app/config` |
| Compose production | `/app/apps/api/config` |

Le nom réel avec le projet de la VM est `lmpdf-git_admin-config`. Ce volume
contient potentiellement un mot de passe de bind LDAP et doit être sauvegardé et
protégé comme une configuration sensible. PostgreSQL et `uploads-data` gardent
leurs noms et montages existants.

Une installation neuve sans fichier charge les valeurs par défaut. La lecture
n'écrit pas ces défauts sur disque et ne remplace pas une configuration existante.
Un JSON invalide ou un fichier illisible provoque une erreur générique : il reste
intact, et un PATCH ne le remplace pas silencieusement par les défauts. Le message
d'erreur ne contient pas d'extrait JSON ni de secret.

L'enregistrement utilise un temporaire dans le même répertoire, mode `0600`, puis
`fsync` et `rename`. Les lecteurs voient l'ancienne ou la nouvelle version
complète. Le répertoire est privé (`0700`) et le fichier reste `0600`. L'entrypoint
production prépare l'ownership puis exécute le backend comme `appuser` ; il
échoue si la préparation du stockage échoue. Aucune migration de base n'est liée
à ce changement.

Les configurations runtime sont exclues de Git et des contextes Docker pour
éviter de les incorporer dans une couche d'image.

## Déploiement ultérieur : préserver un fichier non encore monté

**Cette branche n'a pas été déployée.** Le contrôle en lecture seule du 22/10/2026
sur le backend actif indiquait l'absence de `config/admin-settings.json` et de
répertoire `config`. Cela doit être vérifié à nouveau juste avant une bascule :
un administrateur peut avoir enregistré des réglages entre-temps.

1. Relever le SHA approuvé, les IDs des conteneurs et les montages actuels. Vérifier
   la présence du fichier dans le backend sans en afficher le contenu.
2. Si le fichier existe, le copier **avant toute recréation** hors du dépôt Git,
   dans un répertoire de sauvegarde dédié du home utilisateur, mode `0700` ;
   protéger le fichier copié en `0600`. Vérifier sa présence et son checksum sans
   afficher son contenu. Conserver également les fichiers `.env` et `.env.prod`.
3. Construire l'image approuvée sans recréer les services actifs. Préparer le
   volume `lmpdf-git_admin-config` avec un conteneur temporaire isolé. Si une
   sauvegarde existe, la monter en lecture seule et l'importer uniquement si
   `admin-settings.json` est absent de la destination. **Ne jamais écraser un
   fichier existant dans le volume** ; si les deux copies diffèrent, interrompre
   l'import et décider quelle copie préserver. Vérifier checksum et modes après
   import, avec ownership `appuser:appgroup` de l'image.
4. En installation neuve, laisser le volume sans fichier : les défauts seront
   utilisés. Ne pas y écrire un fichier de défauts par-dessus un réglage réel.
5. Après autorisation de bascule, recréer uniquement le backend avec l'image
   validée, `--no-deps --no-build`. Vérifier santé, lecture des réglages masqués
   et montages. Ne pas recréer PostgreSQL ou les autres services pour cette tâche.
6. Conserver la sauvegarde hors Git et le volume `admin-config`, y compris en cas
   de rollback. Un rollback vers une ancienne définition Compose qui ne monte
   pas ce volume ne l'utilisera pas : adapter explicitement le montage lors de
   la préparation du rollback, sans effacer le volume.

Ces opérations sont à planifier ; aucun conteneur actif n'a été recréé pendant
la validation de cette branche.

## Tests reproductibles sur Debian

Depuis le SHA exact déjà poussé sur GitHub :

```sh
docker build --target build -f apps/api/Dockerfile.prod -t lmpdf-settings-build:<sha> .
docker run --rm --network none lmpdf-settings-build:<sha> \
  sh -lc 'pnpm --filter @lmpdf/api test:settings'
docker build -f apps/api/Dockerfile.prod -t lmpdf-settings-runtime:<sha> .
sh apps/api/tests/admin-settings-container.sh lmpdf-settings-runtime:<sha>
docker compose --env-file .env -f docker-compose.yml config --quiet
docker compose --env-file .env.prod -f docker-compose.prod.yml config --quiet
```

Les tests Node utilisent des répertoires temporaires et des réglages synthétiques.
Ils couvrent défauts, relecture, secret masqué, JSON invalide, refus d'écriture,
remplacement atomique, modes et conservation d'un fichier existant. Le script
Docker utilise deux conteneurs éphémères et un bind mount temporaire sous `/tmp`,
avec `appuser`, pour vérifier la persistance après recréation. Il ne monte aucun
volume applicatif, ne crée aucun compte et ne lance aucune migration. Aucun
`pnpm` installé sur l'hôte n'est nécessaire.
