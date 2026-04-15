#!/usr/bin/env bash
set -euo pipefail

TRAEFIK_IP="${1:-}"
if [ -z "$TRAEFIK_IP" ]; then
  echo "Usage: $0 <TRAEFIK_VM_IP>"
  echo "Exemple: $0 10.0.10.5"
  exit 1
fi

cat <<EOF
# Debian/Ubuntu (ufw) — autoriser uniquement Traefik VM vers LMPdf
sudo ufw default deny incoming
sudo ufw allow from ${TRAEFIK_IP} to any port 4173 proto tcp
sudo ufw allow from ${TRAEFIK_IP} to any port 3000 proto tcp
# Vision n'a normalement pas besoin d'être public
# sudo ufw allow from ${TRAEFIK_IP} to any port 8001 proto tcp
sudo ufw enable
sudo ufw status verbose

# Optionnel: si SSH existe déjà, ne pas se lockout
# sudo ufw allow OpenSSH
EOF
