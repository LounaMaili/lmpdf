# Recette persistante du 14 novembre 2026

Ces outils ne sont pas des commandes de déploiement. Leur exécution exige une
autorisation explicite sur l'instance de test. Aucune migration ni modification
des services, paramètres actifs ou utilisateurs historiques.

- Exécuter uniquement sur Debian, depuis le contenu d'un commit poussé sur GitHub.
- Avant `accounts.cjs provision` : sauvegarde vérifiée, inventaire `inventory`
  privé, ledger durable privé contenant quatre UUID et mots de passe aléatoires.
- Stocker toute entrée/sortie JSON dans un répertoire hors Git, mode 0700,
  fichiers 0600 ; transmettre l'entrée par stdin, jamais dans argv ou les logs.
- Le JSON de provisionnement exige `authorization=create-four-persistent-qa-users`,
  `campaign=RECETTE-20261114`, `baseline` produit par `inventory`, les quatre
  `accounts` et une clé publique `transportPublicKey` RSA-OAEP-SHA256 de la session.
  Les mots de passe ne ressortent que chiffrés pour cette session de navigateur.
- Les comptes QA sont exclusivement locaux : owner/editor/filler globaux editor,
  outsider global viewer. Aucun compte admin supplémentaire. Aucun upsert/update.
  Une collision d'identité interrompt le provisionnement ; une répétition exige
  le même UUID, rôle et mot de passe. Aucun secret ne figure dans ce dépôt.
- `verify` reçoit `{baseline: ...}` et confirme que chaque ligne historique
  (toutes tables) conserve son empreinte. Les ajouts QA sont permis.
- `fixtures.py` produit un tar contenant uniquement un PDF statique de deux pages
  et un PNG synthétique. Utiliser Pillow/Poppler déjà disponibles dans Vision,
  sans écrire dans `/uploads` ; importer ensuite avec le navigateur normal.
- Garder comptes, documents, brouillons et partages QA. Inventorier leurs IDs
  séparément. Aucun nettoyage automatique ; ne pas utiliser des données réelles.

Ne pas publier les inventaires bruts, dumps, empreintes individuelles,
identifiants historiques, mots de passe, JWT, cookies ou secrets MFA. Les
rapports ne contiennent que les résultats agrégés et les objets synthétiques.
