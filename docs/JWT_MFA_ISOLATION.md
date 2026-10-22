# Isolation des JWT d'accès et des challenges MFA

## Périmètre

Hotfix indépendant des PR #7 et #8, issu de `main`
`587c66732b8bf0a3d22c028325361b2837e5c949`.
Le défaut était confirmé dans le code : `JwtStrategy.validate()` ne distinguait
pas le challenge MFA signé d'une session authentifiée. Un rôle admin dans un
challenge ne doit jamais rendre celui-ci utilisable sur les routes admin.

## Contrat

| JWT | Routes protégées | Vérification TOTP/WebAuthn publique |
|---|---|---|
| Nouveau : `purpose: access`, aucun `mfaChallenge` | Oui, signature/expiration et utilisateur actif vérifiés | Non |
| Session ancienne sans `purpose`, `type`, ni `mfaChallenge` | Oui, mêmes contrôles | Non |
| Nouveau : `purpose: mfa-challenge`, `mfaChallenge: true` | HTTP 401 avant lecture Prisma | Oui, puis second facteur obligatoire |
| Ancien challenge : `mfaChallenge: true`, sans purpose/type | HTTP 401 | Oui jusqu'à son expiration existante |
| Purpose/type inattendu, contradictoire, ou marqueur mal formé | HTTP 401 | HTTP 401 |

Un claim `type` explicite, s'il existe, doit correspondre au même usage que
`purpose`. Il s'agit du payload, pas du header JWT standard `typ: JWT`.
Sur les routes protégées, la simple présence de `mfaChallenge`, même `false`,
est refusée. Un sujet absent, vide ou non textuel est refusé aussi.

La signature commune, les secrets, la durée d'accès de 7 jours, le challenge de
2 minutes et les comptes existants sont conservés. Les rôles proviennent toujours
de PostgreSQL et non du claim du JWT. La vérification réelle TOTP, les codes de
secours et la vérification cryptographique WebAuthn ne sont pas modifiés.

## Tests isolés

`pnpm --filter @lmpdf/api test:auth` après compilation API. Le fichier
`apps/api/tests/jwt-mfa.test.cjs` démarre une application Nest sur loopback avec
les vrais contrôleurs auth/users, guards JWT/rôles, stratégie Passport et services
MFA/WebAuthn. Seul Prisma est simulé ; aucune base n'est connectée. Les secrets,
utilisateurs et facteurs sont synthétiques, la configuration est lue dans un
répertoire temporaire. Les assertions WebAuthn sont réellement signées ES256 et
vérifiées par `@simplewebauthn/server` ; aucun authenticator physique n'est requis.

Couverture : accès normal et sessions anciennes, challenges nouveaux/anciens et
admin refusés, expiration, signature incorrecte, utilisateur désactivé/inexistant,
types inconnus, facteur TOTP valide/invalide, assertions WebAuthn valides/invalides,
non-rejeu WebAuthn, passwordless et accès avec le jeton final. Les tests unitaires
vérifient aussi la séparation des claims et le refus avant lecture utilisateur.
La suite HTTP isolée n'active pas le throttler : elle vérifie l'autorisation,
sans assouplir la limitation de débit de l'application réelle.

## Audit des autres délivrances de jetons

Tous les accès sont émis par `AuthController.signToken()` ; ils portent donc le
nouveau purpose, y compris inscription, LDAP et passwordless. Les constats
ci-dessous restent à traiter séparément : ce hotfix ne change aucune politique.

| Chemin | Contrôles actuels / anomalie | Suite proposée |
|---|---|---|
| Connexion locale avec facteur enrôlé | Mot de passe, compte actif, challenge puis TOTP/code de secours ou WebAuthn | Couvert par ce hotfix et les tests |
| Connexion locale, politique `required`, sans enrôlement | Un accès complet est quand même émis avec `mfaSetupRequired: true` ; le guard ne limite pas cet accès à l'enrôlement | P1 : définir puis imposer côté serveur une session d'enrôlement restreinte |
| Inscription locale autorisée | Émet directement un accès sans vérifier la politique MFA requise | P1 : inclure dans la même décision d'enrôlement ; inscription désactivée par défaut |
| Connexion LDAP | `tryLdapLogin()` émet directement un accès, sans passer par le challenge même si un facteur LMPdf est enrôlé | P1 : préciser la politique MFA pour LDAP ; constat de code, pas de connexion AD testée |
| Synchronisation LDAP existante | `isActive: true` est imposé à chaque connexion réussie ; une désactivation locale peut être annulée | P1 : décider quelle source gouverne l'activation ; ne pas réactiver implicitement |
| Vérifications TOTP/WebAuthn | Signature/expiration, challenge strict, compte actif et facteur vérifié avant accès | Conservées ; tests cryptographiques synthétiques |
| Passwordless | Compte local actif et assertion WebAuthn vérifiée ; le mode d'authentification est vérifié au begin mais pas au finish | P2 : revalider la politique au finish si elle change entre les deux étapes |
| Fallback hybride | `allowLocalAdminFallback` autorise la voie locale sans condition explicite `role === admin` | Décision requise ; politique inchangée conformément à la demande |

Ces anomalies sont indépendantes de la confusion challenge/accès et ne sont pas
considérées corrigées par ce hotfix. Le LDAP reste aussi dépendant de la dette de
bibliothèque runtime signalée dans la checklist de régression.

## Validation Debian et déploiement

Après commit/push, checkout détaché sur le SHA exact, build du stage `build` du
Dockerfile API avec une étiquette distincte, puis tests dans un conteneur
éphémère `--network none` sans volume applicatif ni environnement réel.
La génération du client Prisma pendant le build n'exécute aucune migration.
Aucun backend actif ne doit être recréé pour cette validation.
