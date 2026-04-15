#!/usr/bin/env bash
set -euo pipefail

if [ "${EUID:-$(id -u)}" -ne 0 ]; then
  echo "⚠️  Lance ce script en root/sudo:"
  echo "   sudo bash scripts/install-host-deps-linux.sh"
  exit 1
fi

if [ ! -f /etc/os-release ]; then
  echo "❌ /etc/os-release introuvable, distro non supportée automatiquement."
  exit 1
fi

# shellcheck disable=SC1091
. /etc/os-release
ID_LIKE_VAL="${ID_LIKE:-}"

install_docker_apt() {
  export DEBIAN_FRONTEND=noninteractive
  apt-get update
  apt-get install -y ca-certificates curl gnupg lsb-release git

  install -m 0755 -d /etc/apt/keyrings
  if [ ! -f /etc/apt/keyrings/docker.gpg ]; then
    curl -fsSL https://download.docker.com/linux/${1}/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
    chmod a+r /etc/apt/keyrings/docker.gpg
  fi

  echo \
    "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/${1} \
    ${VERSION_CODENAME} stable" \
    > /etc/apt/sources.list.d/docker.list

  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

install_docker_dnf() {
  dnf -y install dnf-plugins-core curl git
  dnf config-manager --add-repo https://download.docker.com/linux/centos/docker-ce.repo
  dnf -y install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
}

case "$ID" in
  debian)
    install_docker_apt debian
    ;;
  ubuntu)
    install_docker_apt ubuntu
    ;;
  rocky|rhel|almalinux|centos)
    install_docker_dnf
    ;;
  *)
    if echo "$ID_LIKE_VAL" | grep -qi debian; then
      install_docker_apt debian
    elif echo "$ID_LIKE_VAL" | grep -Eqi 'rhel|fedora|centos'; then
      install_docker_dnf
    else
      echo "❌ Distro non supportée automatiquement: ID=$ID ID_LIKE=$ID_LIKE_VAL"
      echo "   Installe Docker manuellement puis relance scripts/install-vm.sh"
      exit 1
    fi
    ;;
esac

systemctl enable --now docker

TARGET_USER="${SUDO_USER:-${USER:-}}"
if [ -n "$TARGET_USER" ]; then
  usermod -aG docker "$TARGET_USER" || true
  echo "✅ Utilisateur ajouté au groupe docker: $TARGET_USER"
  echo "ℹ️  Reconnecte-toi pour appliquer le groupe docker."
fi

echo "✅ Dépendances installées (Docker + Compose + Git + Curl)."
