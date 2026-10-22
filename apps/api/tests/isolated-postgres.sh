#!/bin/sh
# Debian only. Creates no Docker volume and never connects to the application DB.
set -eu
image=${1:?Usage: isolated-postgres.sh build-image}
suffix="$(date +%s)-$$"
network="lmpdf-isolated-net-$suffix"
database="lmpdf-isolated-pg-$suffix"
cleanup() {
  docker rm -f "$database" >/dev/null 2>&1 || true
  docker network rm "$network" >/dev/null 2>&1 || true
}
trap cleanup EXIT
docker network create --internal --label lmpdf.validation=true "$network" >/dev/null
docker run -d --name "$database" --network "$network" --memory 384m --cpus 1 \
  --tmpfs /var/lib/postgresql/data:rw,size=256m \
  -e POSTGRES_USER=lmpdf_validation -e POSTGRES_DB=lmpdf_validation \
  -e POSTGRES_PASSWORD=synthetic-isolated-only postgres:16 >/dev/null
attempt=0
until docker exec "$database" pg_isready -U lmpdf_validation -d lmpdf_validation >/dev/null 2>&1; do
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 30 ]; then echo 'PostgreSQL temporaire indisponible' >&2; exit 1; fi
  sleep 1
done
docker run --rm --network "$network" --memory 768m --cpus 1 \
  -e "DATABASE_URL=postgresql://lmpdf_validation:synthetic-isolated-only@$database:5432/lmpdf_validation?schema=public" \
  -e LMPDF_ISOLATED_POSTGRES_TESTS=1 "$image" sh -lc '
    set -eu
    pnpm --filter @lmpdf/api exec prisma migrate deploy
    pnpm --filter @lmpdf/api exec prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code
    pnpm --filter @lmpdf/api test:enrollment:postgres
  '
