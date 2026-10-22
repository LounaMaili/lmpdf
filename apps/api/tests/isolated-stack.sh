#!/bin/sh
# Entire runtime validation, Debian only. No production env file or Docker volume.
set -eu
build=${1:?build image}; runtime=${2:?runtime image}; web=${3:?web image}; vision_image=${4:?vision image}
suffix="$(date +%s)-$$"
network="lmpdf-isolated-stack-$suffix"; database="lmpdf-isolated-pg-$suffix"
backend="lmpdf-isolated-api-$suffix"; frontend="lmpdf-isolated-web-$suffix"; vision="lmpdf-isolated-vision-$suffix"
directory=$(mktemp -d /tmp/lmpdf-isolated-stack.XXXXXX)
owner_uid=$(id -u); owner_gid=$(id -g)
cleanup() {
  result=$?
  if [ "$result" -ne 0 ]; then
    for container in "$backend" "$vision"; do docker logs --tail 25 "$container" 2>&1 || true; done
  fi
  for container in "$frontend" "$backend" "$vision" "$database"; do docker rm -f "$container" >/dev/null 2>&1 || true; done
  docker network rm "$network" >/dev/null 2>&1 || true
  if docker run --rm --network none --user 0 --entrypoint sh --mount "type=bind,src=$directory,dst=/validation" \
    "$runtime" -c 'chown -R "$1:$2" /validation' sh "$owner_uid" "$owner_gid" >/dev/null 2>&1; then rm -rf "$directory"; fi
}
trap cleanup EXIT
mkdir "$directory/config" "$directory/uploads" "$directory/exports"
docker network create --internal --label lmpdf.validation=true "$network" >/dev/null
docker run -d --name "$database" --network "$network" --memory 384m --cpus 1 \
  --tmpfs /var/lib/postgresql/data:rw,size=256m -e POSTGRES_USER=lmpdf_validation \
  -e POSTGRES_DB=lmpdf_validation -e POSTGRES_PASSWORD=synthetic-isolated-only postgres:16 >/dev/null
attempt=0
until docker exec "$database" pg_isready -U lmpdf_validation -d lmpdf_validation >/dev/null 2>&1; do
  attempt=$((attempt + 1)); if [ "$attempt" -ge 30 ]; then echo 'Temporary PostgreSQL unavailable' >&2; exit 1; fi; sleep 1
done
connection="postgresql://lmpdf_validation:synthetic-isolated-only@$database:5432/lmpdf_validation?schema=public"
docker run --rm --network "$network" --memory 512m --cpus 1 -w /app/apps/api \
  -e "DATABASE_URL=$connection" -e LMPDF_ISOLATED_STACK_TESTS=1 -e MFA_ENCRYPTION_KEY=abababababababababababababababababababababababababababababababab \
  --mount "type=bind,src=$directory/config,dst=/app/apps/api/config" "$build" sh -lc \
  'pnpm exec prisma migrate deploy && pnpm exec prisma migrate diff --from-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --exit-code && node tests/isolated-stack.test.cjs seed'
docker run --rm --network none --user 0 --entrypoint sh \
  --mount "type=bind,src=$directory/exports,dst=/exports" "$runtime" -c 'chown appuser:appgroup /exports; chmod 700 /exports'
docker run -d --name "$vision" --network "$network" --network-alias vision --memory 512m --cpus 1 \
  -e UPLOADS_DIR=/uploads --mount "type=bind,src=$directory/uploads,dst=/uploads,readonly" "$vision_image" >/dev/null
docker run -d --name "$backend" --network "$network" --network-alias backend --memory 512m --cpus 1 \
  -e "DATABASE_URL=$connection" -e POSTGRES_PASSWORD=synthetic-isolated-only \
  -e JWT_SECRET=validation-only-0123456789abcdef0123456789abcdef \
  -e MFA_ENCRYPTION_KEY=abababababababababababababababababababababababababababababababab \
  -e MFA_POLICY=optional -e AUTH_MODE=local -e LDAP_ENABLED=false -e ALLOW_SELF_REGISTER=false \
  -e VISION_URL=http://vision:8001 -e CORS_ORIGINS=http://frontend \
  --mount "type=bind,src=$directory/config,dst=/app/apps/api/config" \
  --mount "type=bind,src=$directory/uploads,dst=/app/apps/api/uploads" \
  --mount "type=bind,src=$directory/exports,dst=/exports" "$runtime" >/dev/null
docker run -d --name "$frontend" --network "$network" --network-alias frontend --memory 128m --cpus 1 "$web" >/dev/null
docker run --rm --network "$network" --memory 512m --cpus 1 -w /app/apps/api \
  -e "DATABASE_URL=$connection" -e LMPDF_ISOLATED_STACK_TESTS=1 \
  --mount "type=bind,src=$directory/exports,dst=/exports,readonly" "$build" node --test tests/isolated-stack.test.cjs
docker exec "$backend" sh -c 'test "$(stat -c %a config)" = 700; test "$(stat -c %a config/admin-settings.json)" = 600; test "$(stat -c %U config/admin-settings.json)" = appuser; echo ADMIN_CONFIG_PRIVATE_OK'
docker inspect -f '{{.Name}} {{.State.Status}} restarts={{.RestartCount}}' "$backend" "$frontend" "$vision" "$database"
