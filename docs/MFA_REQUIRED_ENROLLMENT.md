# Enrôlement obligatoire MFA : contrôle serveur

Branche indépendante `fix/mfa-required-enrollment`, depuis le main contenant #9
(`9c3d3e05eebcdddacd9588b1ccd72bf1726e198d`). Ni #7 ni #8 ne sont incorporées.

## Périmètre de politique

La règle nouvelle s'applique à **`auth.mode = local`, `mfa.policy = required`,
compte `authSource = local`**. La connexion LDAP, le mode hybride et son fallback
ne changent pas : leur politique nécessite une décision distincte. Ces chemins
ne sont donc pas annoncés comme corrigés par cette branche. La politique optional
et ses sessions ordinaires existantes restent compatibles.

## Parcours

1. Connexion locale avec mot de passe valide, sans facteur actif, ou inscription
   locale autorisée : émission de `mfaEnrollmentToken`, jamais de `token` d'accès.
   Le JWT porte `purpose: mfa-enrollment`, `mfaEnrollment: true`, expire en 10 min.
2. Le guard autorise seulement les méthodes marquées `AllowMfaEnrollment` :
   - GET `/auth/me`, `/auth/mfa/status`, `/auth/webauthn/credentials` ;
   - POST `/auth/mfa/setup`, `/auth/mfa/confirm` ;
   - POST `/auth/webauthn/register/begin`, `/auth/webauthn/register/finish`.
   Aucune route de documents, brouillons, permissions ou administration n'est
   autorisée ; les refus sont HTTP 403 avec `MFA_ENROLLMENT_REQUIRED`.
   Aucun droit de suppression/désactivation/régénération de facteurs n'est accordé.
3. TOTP doit être confirmé par un code réel ; WebAuthn garde le contrôle du mot
   de passe au begin et la vérification cryptographique au finish. Une erreur
   n'active pas de facteur et ne délivre aucun accès.
4. L'activation initiale verrouille la ligne User dans une transaction
   (`SELECT ... FOR UPDATE`, paramétré), puis revérifie compte actif et absence
   de TOTP/clé. TOTP et WebAuthn utilisent le même verrou : une confirmation
   concurrente ne remplace pas le premier facteur enregistré. Aucun schéma ni
   migration n'est ajouté.
5. Après activation, la session d'enrôlement est refusée, y compris sur les
   opérations d'enrôlement. La confirmation ne délivre pas d'accès complet :
   conserver les codes de secours puis **se reconnecter avec le nouveau facteur**.
6. TOTP, code de secours ou WebAuthn vérifié délivrent un JWT `purpose: access`,
   `mfaVerified: true`. Passwordless WebAuthn vérifié fait de même. Durée d'accès
   7 jours et challenge de connexion 2 minutes inchangés.

## Sessions existantes et transitions

Le guard vérifie l'état actuel des facteurs et la politique à chaque requête.
Un ancien accès pour un compte non enrôlé devient restreint aux méthodes ci-dessus.
Une suppression/reset du dernier facteur retire immédiatement l'accès métier.

Lorsque le mode local obligatoire dispose déjà d'un facteur, un ancien JWT sans
preuve `mfaVerified: true` est refusé en HTTP 401 : une reconnexion est requise.
C'est nécessaire pour qu'un accès délivré avant l'enrôlement ne puisse pas devenir
complet après la simple activation du facteur. Les anciens JWT ne permettent pas
de distinguer cette situation d'une session réellement passée par le MFA.
Cette invalidation est limitée à la politique locale obligatoire.

Les JWT d'enrôlement ne sont pas des challenges de connexion et ne peuvent pas
être convertis via les endpoints publics TOTP/WebAuthn. Les claims contradictoires,
signatures invalides, expirations et utilisateurs désactivés restent refusés.

## Interface

Login et inscription conservent le jeton restreint dans l'emplacement de session
habituel, avec `mfaSetupRequired`. AppShell monte une page d'enrôlement, sans
éditeur ni administration ; une restauration de session vérifie le même état
via `/auth/me`. Le panneau MFA existant est réutilisé. Après confirmation, les
codes de secours restent visibles puis le bouton ramène à la connexion.
L'interface n'est pas la frontière d'autorisation : le guard impose la restriction.

## Validation isolée Debian

- Build API (avec client Prisma generate, sans migration) et build frontend.
- `pnpm --filter @lmpdf/api test:auth` : les 35 tests précédents sont conservés,
  avec des cas HTTP supplémentaires utilisant les vrais contrôleurs/guards,
  TOTP et WebAuthn (attestation none et assertions ES256 synthétiques).
- Cas : connexion/inscription dont premier admin, accès métier/admin refusé,
  ancien JWT, code/origine/mot de passe invalides, expiration, facteur activé puis
  reconnexion, passwordless, reset, confirmations concurrentes et politique
  LDAP/hybride inchangée. Prisma est simulé ; la transaction de test est sérialisée
  et vérifie le SQL de verrouillage, sans exécuter de requête sur PostgreSQL réel.
- Web `test:auth` : écran restreint sans éditeur, login et inscription avec
  stockage du seul jeton d'enrôlement. Les tests autosave existants sont rejoués.

Tous les comptes, clés, secrets et répertoires sont synthétiques. Aucun essai sur
l'authentification active, aucune configuration réelle modifiée. La recette avec
authenticator physique et l'intégration réunie avec #7/#8 restent à planifier.

## Intégration et déploiement ultérieur

Garder la PR en brouillon. Après revue, intégrer #8 pour préserver les réglages,
puis l'enrôlement obligatoire prioritaire, puis #7 ; rejouer l'ensemble des suites
sur le SHA réuni. API et frontend de cette branche doivent être livrés ensemble
pour que le nouvel état d'authentification soit compris par l'interface.

Avant toute future recréation backend : sauvegarder hors Git un éventuel fichier
admin existant et préparer le volume de #8 sans écrasement ; préserver PostgreSQL,
uploads-data et les sauvegardes historiques. Aucun déploiement n'est effectué
pendant cette tâche. Les utilisateurs concernés par la politique locale obligatoire
devront se reconnecter, et les non enrôlés devront activer leur facteur avant
l'accès aux documents.

## Validation combinée avec la persistance administrateur

Le main contenant #8 est intégré sans réécriture. La suite HTTP ajoute la lecture
réelle d'un admin-settings.json synthétique : la politique required du fichier
prime sur l'environnement optional, et un JSON corrompu bloque l'authentification
sans être écrasé. Les suites auth/settings et frontend sont rejouées ensemble.

`sh apps/api/tests/isolated-postgres.sh <image-build>` démarre PostgreSQL 16 sur
un réseau interne dédié, sans port publié, avec PGDATA en tmpfs. Les migrations
existantes sont appliquées uniquement à cette base jetable puis un diff vérifie
l'absence d'écart avec schema.prisma. Aucun fichier de migration n'est modifié.
Le script n'utilise aucun .env ni volume applicatif ; il supprime uniquement son
conteneur et son réseau temporaires. Les clients Prisma refusent toute URL qui
ne désigne pas le serveur et la base synthétiques explicitement attendus.

Les sept tests PostgreSQL couvrent les activations initiales réelles TOTP et
WebAuthn, la concurrence TOTP/TOTP et TOTP/WebAuthn, l'attente FOR UPDATE observée
dans pg_stat_activity avec des clients indépendants, le refus d'un second facteur
initial, le rollback après écritures et la désactivation pendant une attente de
verrou. Les secrets/facteurs et comptes sont exclusivement synthétiques.
