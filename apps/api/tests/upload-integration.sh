#!/bin/sh
# Debian only. Disposable PostgreSQL in tmpfs, private binds, no active volumes.
set -eu
build=${1:?build image}; runtime=${2:?runtime image}; vision_image=${3:?current Vision image ID}; sha=${4:?pushed SHA}
test "${LMPDF_ISOLATED_UPLOAD_TESTS:-}" = 1
test "${#sha}" -eq 40
case "$sha" in *[!0-9a-f]*) exit 1;; esac
test "$(git rev-parse HEAD)" = "$sha"
test -z "$(git status --porcelain --untracked-files=no)"
for image in "$build" "$runtime"; do
  test "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$sha"
done
case "$vision_image" in sha256:*) docker image inspect "$vision_image" >/dev/null;; *) exit 1;; esac

suffix="$(date +%s)-$$"
network="lmpdf-upload-network-$suffix"; database="lmpdf-upload-pg-$suffix"
backend="lmpdf-upload-api-$suffix"; vision="lmpdf-upload-vision-$suffix"
initializer="lmpdf-upload-init-$suffix"; runner="lmpdf-upload-tests-$suffix"
directory=$(mktemp -d /tmp/lmpdf-upload-integration.XXXXXX)
owner_uid=$(id -u); owner_gid=$(id -g)
cleanup() {
  result=$?
  trap - EXIT HUP INT TERM
  if [ "$result" -ne 0 ]; then
    for container in "$backend" "$vision"; do docker logs --tail 20 "$container" 2>&1 || true; done
  fi
  # Only these unique test resources; never use compose down/prune or rm -v.
  for container in "$runner" "$initializer" "$backend" "$vision" "$database"; do docker rm -f "$container" >/dev/null 2>&1 || true; done
  docker network rm "$network" >/dev/null 2>&1 || true
  if docker run --rm --network none --user 0 --entrypoint sh --mount "type=bind,src=$directory,dst=/validation" \
    "$runtime" -c 'chown -R "$1:$2" /validation' sh "$owner_uid" "$owner_gid" >/dev/null 2>&1; then
    rm -rf "$directory"
  else
    echo "Synthetic fixture directory retained: $directory" >&2
  fi
  exit "$result"
}
trap cleanup EXIT
trap 'exit 130' HUP INT TERM
mkdir "$directory/config" "$directory/uploads" "$directory/results"
docker network create --internal --label lmpdf.validation=true "$network" >/dev/null
docker run -d --name "$database" --label lmpdf.validation=true --network "$network" --memory 384m --cpus 1 \
  --tmpfs /var/lib/postgresql/data:rw,size=256m -e POSTGRES_USER=lmpdf_upload_validation \
  -e POSTGRES_DB=lmpdf_upload_validation -e POSTGRES_PASSWORD=synthetic-upload-pg-only postgres:16 >/dev/null
attempt=0
until docker exec "$database" pg_isready -U lmpdf_upload_validation -d lmpdf_upload_validation >/dev/null 2>&1; do
  attempt=$((attempt + 1)); if [ "$attempt" -ge 30 ]; then echo 'Temporary PostgreSQL unavailable' >&2; exit 1; fi; sleep 1
done
connection="postgresql://lmpdf_upload_validation:synthetic-upload-pg-only@$database:5432/lmpdf_upload_validation?schema=public"
# Initialize only this empty test database from the unchanged schema. No migration.
docker run --rm --name "$initializer" --network "$network" --memory 512m --cpus 1 -w /app/apps/api \
  -e "DATABASE_URL=$connection" -e LMPDF_ISOLATED_UPLOAD_TESTS=1 \
  -e MFA_ENCRYPTION_KEY=abababababababababababababababababababababababababababababababab \
  "$build" sh -c 'pnpm exec prisma db push --skip-generate && node tests/upload-integration.test.cjs seed'
docker run -d --name "$vision" --label lmpdf.validation=true --network "$network" --network-alias vision --memory 512m --cpus 1 \
  -e UPLOADS_DIR=/uploads --mount "type=bind,src=$directory/uploads,dst=/uploads,readonly" \
  --mount "type=bind,src=$directory/results,dst=/validation/results,readonly" "$vision_image" >/dev/null
docker run -d --name "$backend" --label lmpdf.validation=true --network "$network" --network-alias backend --memory 512m --cpus 1 \
  -e "DATABASE_URL=$connection" -e POSTGRES_PASSWORD=synthetic-upload-pg-only \
  -e JWT_SECRET=synthetic-upload-jwt-only-0123456789abcdef0123456789abcdef \
  -e MFA_ENCRYPTION_KEY=abababababababababababababababababababababababababababababababab \
  -e MFA_POLICY=optional -e AUTH_MODE=local -e LDAP_ENABLED=false -e ALLOW_SELF_REGISTER=false \
  -e VISION_URL=http://vision:8001 -e CORS_ORIGINS=http://backend:3000 \
  --mount "type=bind,src=$directory/config,dst=/app/apps/api/config" \
  --mount "type=bind,src=$directory/uploads,dst=/app/apps/api/uploads" "$runtime" >/dev/null
upload_uid=$(docker run --rm --network none --entrypoint id "$runtime" -u appuser)
upload_gid=$(docker run --rm --network none --entrypoint id "$runtime" -g appuser)
docker run --rm --name "$runner" --network "$network" --memory 512m --cpus 1 -w /app/apps/api \
  -e "DATABASE_URL=$connection" -e LMPDF_ISOLATED_UPLOAD_TESTS=1 \
  -e "UPLOAD_OWNER_UID=$upload_uid" -e "UPLOAD_OWNER_GID=$upload_gid" \
  --mount "type=bind,src=$directory/uploads,dst=/validation/uploads,readonly" \
  --mount "type=bind,src=$directory/results,dst=/validation/results" \
  "$build" node --test tests/upload-integration.test.cjs

# Do not accept an empty suggestedFields response as proof of file access:
# OpenCV can return None without a structured error. Read/hash/decode as Vision.
docker exec -i "$vision" python3 - "$upload_uid" "$upload_gid" <<'PY'
import hashlib, json, os, pathlib, stat, sys
from detector import load_image
root = pathlib.Path('/uploads')
files = sorted(root.iterdir())
assert len(files) == 2
manifest = {entry['path']: entry['sha256'] for entry in json.loads(pathlib.Path('/validation/results/manifest.json').read_text())}
assert {file.name for file in files} == set(manifest)
assert os.getuid() == 0, 'Revalidate when the current Vision user changes'
for file in files:
    metadata = file.stat()
    assert stat.S_IMODE(metadata.st_mode) == 0o600 and metadata.st_uid == int(sys.argv[1])
    assert metadata.st_gid == int(sys.argv[2])
    checksum = hashlib.sha256(file.read_bytes()).hexdigest()
    assert checksum == manifest[file.name]
    mime = 'application/pdf' if file.suffix == '.pdf' else 'image/png'
    image = load_image(str(file), mime)
    assert image is not None and image.size > 0
    print(json.dumps({'visionUid': os.getuid(), 'file': file.name, 'mode': '0600', 'sha256': checksum, 'decoded': True}))
PY
# A different non-root UID must not gain access to those private files.
docker exec --user 65534:65534 -i "$vision" python3 - <<'PY'
import pathlib
for file in pathlib.Path('/uploads').iterdir():
    try:
        file.read_bytes()
    except PermissionError:
        continue
    raise AssertionError('Unrelated UID can read a private upload')
print('UNRELATED_UID_READ_DENIED')
PY
docker inspect -f '{{.Name}} {{.State.Status}} restarts={{.RestartCount}}' "$backend" "$vision" "$database"
