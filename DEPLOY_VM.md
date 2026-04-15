# Déploiement rapide LMPdf sur une autre VM

## 1) Préparer une archive depuis la VM source

Dans le repo LMPdf :

```bash
bash scripts/make-release.sh
```

Le script génère une archive `.tar.gz` (par défaut dans `/tmp`).

## 2) Copier l’archive sur la VM cible

Exemple :

```bash
scp /tmp/lmpdf-release-YYYY-mm-dd_HHMMSS.tar.gz user@VM_CIBLE:/opt/
```

## 3) Installer les prérequis sur VM cible (Debian / Ubuntu / Rocky Linux)

```bash
cd /opt
sudo tar -xzf lmpdf-release-*.tar.gz
cd LMPdf
sudo bash scripts/install-host-deps-linux.sh
```

> Reconnecte-toi ensuite (pour que le groupe `docker` soit pris en compte), puis :

## 4) Démarrer l’application

### Cas A — accès local seulement (localhost)

```bash
cd /opt/LMPdf
bash scripts/install-vm.sh
```

### Cas B — accès depuis ton poste vers l’IP de la VM

```bash
cd /opt/LMPdf
PUBLIC_HOST=<IP_OU_DNS_VM> bash scripts/install-vm.sh
```

Ce mode configure automatiquement :
- `VITE_API_URL=http://<IP_OU_DNS_VM>:3000/api`
- `CORS_ORIGINS` incluant l’origin frontend de la VM

### Cas C — derrière Traefik/Authelia (autre VM/stack)

```bash
cd /opt/LMPdf
PUBLIC_BASE_URL=https://pdf.mondomaine.tld \
API_PUBLIC_URL=https://pdf.mondomaine.tld/api \
bash scripts/install-vm.sh
```

Ce mode configure automatiquement :
- `VITE_API_URL` vers l’URL proxy publique
- `CORS_ORIGINS` avec le domaine public

Tu peux ensuite limiter l’accès réseau de cette VM à l’IP Traefik :

```bash
bash scripts/print-firewall-rules.sh <IP_VM_TRAEFIK>
```

(copie/colle les commandes affichées)

## 5) Vérifier

- Web: `http://<IP_OU_DNS_VM>:4173`
- API health: `http://<IP_OU_DNS_VM>:3000/api/health`
- Vision health: `http://<IP_OU_DNS_VM>:8001/health`

## Notes

- Le script génère automatiquement des secrets (`JWT_SECRET`, clés Garage) si absents/invalides.
- Les services DB/Redis restent bindés en local VM (`127.0.0.1`) pour limiter l’exposition.
- Pour mettre à jour : recopier une nouvelle archive et relancer `bash scripts/install-vm.sh`.
