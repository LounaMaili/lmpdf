#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

STAMP="$(date +%Y-%m-%d_%H%M%S)"
OUT="${1:-/tmp/lmpdf-release-${STAMP}.tar.gz}"

# Build a clean transfer archive for another VM
# (exclude local runtime data/secrets/deps caches)
PROJECT_NAME="$(basename "$ROOT_DIR")"
PARENT_DIR="$(dirname "$ROOT_DIR")"

# Exclusions must match paths from PARENT_DIR tar root (PROJECT_NAME/...).
tar -czf "$OUT" \
  --exclude="${PROJECT_NAME}/node_modules" \
  --exclude="${PROJECT_NAME}/**/node_modules" \
  --exclude="${PROJECT_NAME}/.env" \
  --exclude="${PROJECT_NAME}/infra/postgres-data" \
  --exclude="${PROJECT_NAME}/infra/garage-data" \
  --exclude="${PROJECT_NAME}/infra/garage-meta" \
  --exclude="${PROJECT_NAME}/apps/api/uploads" \
  --exclude="${PROJECT_NAME}/apps/web/dist" \
  --exclude="${PROJECT_NAME}/apps/api/dist" \
  -C "$PARENT_DIR" "$PROJECT_NAME"

echo "✅ Archive créée: $OUT"
ls -lh "$OUT"
