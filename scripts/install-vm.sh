#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

if ! command -v docker >/dev/null 2>&1; then
  echo "❌ Docker n'est pas installé."
  echo "   Lance d'abord: scripts/install-host-deps-linux.sh"
  exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
  echo "❌ Docker Compose plugin manquant (docker compose)."
  exit 1
fi

if [ ! -f .env ]; then
  cp .env.example .env
  echo "ℹ️  .env créé depuis .env.example"
fi

set_env() {
  local key="$1"
  local value="$2"
  if grep -q "^${key}=" .env; then
    sed -i "s#^${key}=.*#${key}=${value}#" .env
  else
    echo "${key}=${value}" >> .env
  fi
}

rand_hex() {
  local len="$1"
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex "$len"
  else
    head -c "$((len*2))" /dev/urandom | od -An -tx1 | tr -d ' \n'
  fi
}

get_env() {
  local key="$1"
  grep -E "^${key}=" .env | tail -n1 | cut -d= -f2- || true
}

jwt="$(get_env JWT_SECRET)"
if [ -z "$jwt" ] || [ "${#jwt}" -lt 32 ]; then
  set_env JWT_SECRET "$(rand_hex 32)"
  echo "✅ JWT_SECRET généré"
fi

gak="$(get_env GARAGE_ACCESS_KEY)"
if [ -z "$gak" ] || [[ "$gak" == "GKxxxxxxxxxxxxx" ]]; then
  set_env GARAGE_ACCESS_KEY "GK$(rand_hex 10 | cut -c1-18)"
  echo "✅ GARAGE_ACCESS_KEY généré"
fi

gsk="$(get_env GARAGE_SECRET_KEY)"
if [ -z "$gsk" ] || [[ "$gsk" == "xxxxxxxxxxxxxxx" ]]; then
  set_env GARAGE_SECRET_KEY "$(rand_hex 32)"
  echo "✅ GARAGE_SECRET_KEY généré"
fi

# Safe defaults
set_env STRICT_CORS "true"
set_env ALLOW_SELF_REGISTER "false"

PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-}"
API_PUBLIC_URL="${API_PUBLIC_URL:-}"
PUBLIC_HOST="${PUBLIC_HOST:-}"

if [ -n "$PUBLIC_BASE_URL" ]; then
  PUBLIC_BASE_URL="${PUBLIC_BASE_URL%/}"
  if [ -z "$API_PUBLIC_URL" ]; then
    API_PUBLIC_URL="${PUBLIC_BASE_URL}/api"
  fi
  set_env CORS_ORIGINS "${PUBLIC_BASE_URL},http://localhost:4173,http://127.0.0.1:4173"
  set_env VITE_API_URL "$API_PUBLIC_URL"
  echo "✅ Config reverse proxy appliquée"
  echo "   - PUBLIC_BASE_URL=${PUBLIC_BASE_URL}"
  echo "   - API_PUBLIC_URL=${API_PUBLIC_URL}"
elif [ -n "$PUBLIC_HOST" ]; then
  set_env CORS_ORIGINS "http://localhost:4173,http://127.0.0.1:4173,http://${PUBLIC_HOST}:4173,http://${PUBLIC_HOST}:3000"
  set_env VITE_API_URL "http://${PUBLIC_HOST}:3000/api"
  echo "✅ Config réseau public appliquée pour host: ${PUBLIC_HOST}"
else
  set_env CORS_ORIGINS "http://localhost:4173,http://127.0.0.1:4173,http://localhost:3000"
  set_env VITE_API_URL "http://localhost:3000/api"
fi

mkdir -p infra/postgres-data infra/garage-data infra/garage-meta

echo "🚀 Build et démarrage des services..."
docker compose up -d --build

if command -v curl >/dev/null 2>&1; then
  echo "⏳ Vérification santé API..."
  for i in $(seq 1 60); do
    if curl -fsS "http://localhost:3000/api/health" >/dev/null 2>&1; then
      echo "✅ API OK"
      break
    fi
    sleep 2
  done
fi

echo
echo "Installation terminée."
if [ -n "${PUBLIC_BASE_URL:-}" ]; then
  echo "- Web (proxy): ${PUBLIC_BASE_URL}"
  echo "- API (proxy): ${API_PUBLIC_URL}/health"
else
  echo "- Web    : http://${PUBLIC_HOST:-localhost}:4173"
  echo "- API    : http://${PUBLIC_HOST:-localhost}:3000/api/health"
fi
echo "- Vision : http://${PUBLIC_HOST:-localhost}:8001/health"
