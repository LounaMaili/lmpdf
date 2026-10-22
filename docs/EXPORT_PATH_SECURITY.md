# Export : racines, liens et remplacements de chemins

## Défaut reproduit dans un bac à sable

L'audit du SHA `dd38eddbd778b1e3b02ecdeb6e5f7cc28b412b04` a utilisé un
répertoire temporaire contenant `allowed/` et `outside/`. Ce dernier était hors
de la racine autorisée, mais restait dans le même bac à sable jetable : aucun
fichier réel ou chemin hors de ce bac n'a été visé.

La suite de 18 cas donnait 3 succès normaux et 15 refus attendus non satisfaits.
En particulier, overwrite suivait les liens symboliques et les hardlinks vers la
sentinelle extérieure. La validation lexicale du resolver bloquait déjà un chemin
simple hors racine, mais ne protégeait pas contre ces alias ou un remplacement
après validation. Le writer n'imposait pas lui-même une liste de racines.

## Décision ciblée pour l'exécution Linux/Docker

- La validation vérifie les composants existants avec lstat et refuse les liens
  symboliques, les cibles non régulières et les fichiers avec plusieurs hardlinks.
- Le writer reçoit obligatoirement les allowedRoots depuis la configuration
  administrateur. Aucun champ client n'alimente ce paramètre.
- Les répertoires sont parcourus sans symlink avec O_DIRECTORY/O_NOFOLLOW.
  Les descripteurs restent ouverts pendant l'opération ; les accès relatifs
  utilisent `/proc/self/fd/<fd>/<composant>`, jamais un lien fourni par l'utilisateur.
- Les créations restent exclusives pour rename/skip. Overwrite ouvre sans suivre
  de symlink et sans tronquer avant d'avoir vérifié le descripteur, l'inode nommé,
  les hardlinks et la position réelle du répertoire.
- Ces identités sont vérifiées avant et après l'écriture. Un remplacement détecté
  provoque un refus ; seule la création propre au writer est nettoyée, en vérifiant
  son inode. Tous les descripteurs sont fermés dans les chemins de sortie.
- Une création rejetée ou en erreur I/O est supprimée ; aucun temporaire disque
  n'est utilisé. L'atomicité transactionnelle d'un overwrite existant en erreur
  I/O n'est pas ajoutée par cette correction.

Cette implémentation exige Linux avec `/proc/self/fd` accessible et échoue de
manière restrictive ailleurs. Les racines et leurs parents ne doivent contenir
aucun symlink, même vers une autre partie de la racine. Les administrateurs doivent
conserver la maîtrise des volumes et droits POSIX ; cette vérification applicative
ne remplace pas l'isolation du compte système exécutant l'API.

## Validation

`pnpm --filter @lmpdf/api test:export-paths` utilise uniquement des répertoires
mkdtemp et des sentinelles synthétiques. Il couvre normal/hors racine/traversée,
préfixe voisin, symlinks répertoire et fichier pour les trois stratégies,
hardlinks, remplacement avant le writer, après ouverture du parent, après
ouverture du fichier et pendant l'écriture, ainsi que le nettoyage après erreur.
Les injections utilisent les vraies opérations filesystem dans le bac à sable.

Les suites permissions/exports existantes conservent les limites 25 Mio / deux
requêtes / HTTP 429, l'absence d'écriture sur refus, le nom de sortie distinct
du contexte canonique, les extensions et les collisions. L'ensemble est à rejouer
sur le SHA combinant MFA, permissions et réglages avant fusion.

## Recette runtime isolée

`sh apps/api/tests/isolated-stack.sh <api-build> <api-runtime> <web-runtime> <vision>`
lance quatre nouveaux conteneurs sur un réseau interne sans port publié :
PostgreSQL en tmpfs, backend, nginx et Vision. Aucun .env ni volume applicatif
n'est monté. Les uploads, exports et réglages sont dans un mkdtemp dédié ; le
script ne supprime que ses conteneurs/réseau et ses fichiers synthétiques.

Les comptes de recette se connectent normalement avec mot de passe et TOTP.
Le parcours vérifie l'enrôlement d'un admin, les droits owner/editor/filler,
un upload PNG synthétique, sa lecture par l'API et Vision, un export réel dans
la destination temporaire, le nom libre distinct de la règle canonique, le
plafond nginx 30 Mio et la propagation d'un override administrateur. Le backend
fonctionne en NODE_ENV=production avec des valeurs de test, la configuration
requiert MFA même si l'environnement est optional. Les modes/ownership du
répertoire administrateur sont contrôlés sans afficher son contenu.
