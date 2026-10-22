#!/bin/sh
# Run only on the Debian validation VM with a built runtime image as argument.
# Uses two short-lived containers and one temporary bind directory; no Docker volume.
set -eu
image=${1:?Usage: admin-settings-container.sh image-tag}
task_dir=$(mktemp -d /tmp/lmpdf-admin-settings-validation.XXXXXX)
task_uid=$(id -u)
task_gid=$(id -g)
mkdir "$task_dir/config"
cleanup() {
  if docker run --rm --network none --user 0 --entrypoint sh \
    --mount "type=bind,src=$task_dir/config,dst=/app/apps/api/config" "$image" \
    -c 'chown -R "$1:$2" /app/apps/api/config' sh "$task_uid" "$task_gid" >/dev/null 2>&1; then
    rm -rf "$task_dir"
  else
    printf 'Répertoire de test synthétique conservé pour nettoyage : %s\n' "$task_dir" >&2
  fi
}
trap cleanup EXIT

docker run --rm -i --network none --memory 256m --cpus 1 \
  --mount "type=bind,src=$task_dir/config,dst=/app/apps/api/config" "$image" node <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { writeAdminSettingsFile, readAdminSettingsFile } = require('./dist/config/settings-file');
(async () => {
  assert.notEqual(process.getuid(), 0);
  assert.equal(await readAdminSettingsFile(), null);
  await writeAdminSettingsFile({ organization: { mode: 'personal' }, ldap: { bindPassword: 'synthetic-test-only' } });
  assert.equal(fs.statSync('config').mode & 0o777, 0o700);
  assert.equal(fs.statSync('config/admin-settings.json').mode & 0o777, 0o600);
  console.log('Initialisation et écriture non privilégiée : OK');
})().catch(() => { console.error('Échec du test isolé de création'); process.exit(1); });
NODE

docker run --rm -i --network none --memory 256m --cpus 1 \
  --mount "type=bind,src=$task_dir/config,dst=/app/apps/api/config" "$image" node <<'NODE'
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { loadRuntimeSettings } = require('./dist/config/runtime-settings');
const { writeAdminSettingsFile } = require('./dist/config/settings-file');
(async () => {
  const settings = await loadRuntimeSettings();
  assert.equal(settings.organization.mode, 'personal');
  assert.equal(settings.ldap.bindPassword, 'synthetic-test-only');
  assert.notEqual(process.getuid(), 0);
  assert.equal(fs.statSync('config/admin-settings.json').uid, process.getuid());
  assert.equal(fs.statSync('config/admin-settings.json').mode & 0o777, 0o600);
  const previous = fs.readFileSync('config/admin-settings.json');
  fs.chmodSync('config', 0o500);
  try {
    await assert.rejects(() => writeAdminSettingsFile({ organization: { mode: 'team' } }), /Impossible d’enregistrer/);
    assert.deepEqual(fs.readFileSync('config/admin-settings.json'), previous);
  } finally { fs.chmodSync('config', 0o700); }
  console.log('Recréation isolée : paramètres conservés, ownership, modes et refus réel d’écriture OK');
})().catch(() => { console.error('Échec du test isolé de relecture'); process.exit(1); });
NODE
