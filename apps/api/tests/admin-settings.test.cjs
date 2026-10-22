const { test, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { readAdminSettingsFile, writeAdminSettingsFile, adminSettingsPath } = require('../dist/config/settings-file');
const { defaultRuntimeSettings, loadRuntimeSettings } = require('../dist/config/runtime-settings');
const { AdminSettingsController } = require('../dist/admin-settings.controller');
const originalCwd = process.cwd();
let directory;
beforeEach(() => {
  directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lmpdf-admin-settings-'));
  process.chdir(directory);
  process.env.AUTH_MODE = 'local'; process.env.LDAP_ENABLED = 'false';
});
afterEach(() => {
  mock.restoreAll(); process.chdir(originalCwd);
  fs.rmSync(directory, { recursive: true, force: true });
});
const controller = () => new AdminSettingsController({}, {});

test('installation neuve : absence du fichier et valeurs par défaut, sans écriture implicite', async () => {
  assert.equal(await readAdminSettingsFile(), null);
  assert.deepEqual(await loadRuntimeSettings(), defaultRuntimeSettings());
  assert.equal((await controller().getSettings()).auth.mode, 'local');
  assert.equal(fs.existsSync(path.join(directory, 'config')), false);
});
test('création privée du répertoire et du fichier, puis relecture', async () => {
  const settings = { organization: { mode: 'personal' }, permissions: { editor: { exportPdf: false } } };
  await writeAdminSettingsFile(settings);
  assert.deepEqual(await readAdminSettingsFile(), settings);
  assert.equal(fs.statSync(path.dirname(adminSettingsPath())).mode & 0o777, 0o700);
  assert.equal(fs.statSync(adminSettingsPath()).mode & 0o777, 0o600);
  const loaded = await loadRuntimeSettings();
  assert.equal(loaded.organization.mode, 'personal'); assert.equal(loaded.permissions.editor.exportPdf, false);
});
test('PATCH sauvegarde, GET masque le secret synthétique et PATCH masqué le conserve', async () => {
  const api = controller();
  const value = 'synthetic-test-only-ldap';
  const first = await api.updateSettings({ ldap: { bindPassword: value }, governance: { retentionDays: 17 } });
  assert.equal(first.settings.ldap.bindPassword, '********');
  assert.equal((await api.getSettings()).ldap.bindPassword, '********');
  await api.updateSettings({ ldap: { bindPassword: '********' }, organization: { mode: 'personal' } });
  const loaded = await loadRuntimeSettings();
  assert.equal(loaded.ldap.bindPassword, value); assert.equal(loaded.governance.retentionDays, 17);
  assert.equal(loaded.organization.mode, 'personal');
});
test('nouveau processus : les paramètres enregistrés survivent à la recréation simulée', async () => {
  await writeAdminSettingsFile({ organization: { mode: 'personal' } });
  const modulePath = require.resolve('../dist/config/runtime-settings');
  const code = `require(${JSON.stringify(modulePath)}).loadRuntimeSettings().then(s=>{if(s.organization.mode!=='personal')process.exit(1)}).catch(()=>process.exit(2))`;
  const result = spawnSync(process.execPath, ['-e', code], { cwd: directory });
  assert.equal(result.status, 0);
});
test('lecture ne remplace pas une configuration existante par les défauts', async () => {
  await writeAdminSettingsFile({ auth: { mode: 'hybrid' }, ldap: { searchBase: 'test-only' } });
  const before = fs.readFileSync(adminSettingsPath());
  const inode = fs.statSync(adminSettingsPath()).ino;
  await loadRuntimeSettings(); await controller().getSettings();
  assert.deepEqual(fs.readFileSync(adminSettingsPath()), before);
  assert.equal(fs.statSync(adminSettingsPath()).ino, inode);
});
for (const invalid of ['{ "ldap": "synthetic-sensitive-value"', 'null', '[]']) {
  test(`JSON invalide (${invalid === 'null' ? 'null' : invalid === '[]' ? 'tableau' : 'syntaxe'}) conservé et erreur expurgée`, async () => {
    fs.mkdirSync('config'); fs.writeFileSync(adminSettingsPath(), invalid);
    for (const action of [() => readAdminSettingsFile(), () => loadRuntimeSettings(), () => controller().updateSettings({ auth: { mode: 'local' } })]) {
      await assert.rejects(action, e => e.message.includes('invalide') && !e.message.includes('synthetic-sensitive-value'));
    }
    assert.equal(fs.readFileSync(adminSettingsPath(), 'utf8'), invalid);
    assert.deepEqual(fs.readdirSync(path.dirname(adminSettingsPath())), ['admin-settings.json']);
  });
}
test('erreur de lecture : pas de fallback silencieux', async () => {
  mock.method(fs.promises, 'readFile', async () => { const e = new Error('denied'); e.code = 'EACCES'; throw e; });
  await assert.rejects(() => loadRuntimeSettings(), /Impossible de lire/);
});
test('refus d’écriture : ancien contenu intact et erreur sans données', async () => {
  await writeAdminSettingsFile({ organization: { mode: 'personal' } });
  const before = fs.readFileSync(adminSettingsPath());
  mock.method(fs.promises, 'open', async () => { const e = new Error('EACCES'); e.code = 'EACCES'; throw e; });
  await assert.rejects(() => writeAdminSettingsFile({ ldap: { bindPassword: 'synthetic-only' } }), /Impossible d’enregistrer/);
  assert.deepEqual(fs.readFileSync(adminSettingsPath()), before);
  assert.deepEqual(fs.readdirSync(path.dirname(adminSettingsPath())), ['admin-settings.json']);
});
test('échec du remplacement : ancien JSON intact et temporaire nettoyé', async () => {
  await writeAdminSettingsFile({ organization: { mode: 'personal' } });
  const before = fs.readFileSync(adminSettingsPath());
  mock.method(fs.promises, 'rename', async () => { throw new Error('simulated rename failure'); });
  await assert.rejects(() => writeAdminSettingsFile({ organization: { mode: 'team' } }), /Impossible d’enregistrer/);
  assert.deepEqual(fs.readFileSync(adminSettingsPath()), before);
  assert.deepEqual(fs.readdirSync(path.dirname(adminSettingsPath())), ['admin-settings.json']);
});
test('remplacement atomique : nouveau JSON complet avant rename, ancien encore lisible', async () => {
  const old = { organization: { mode: 'personal' } }, next = { organization: { mode: 'team' } };
  await writeAdminSettingsFile(old);
  const rename = fs.promises.rename.bind(fs.promises);
  mock.method(fs.promises, 'rename', async (from, to) => {
    assert.deepEqual(JSON.parse(fs.readFileSync(to, 'utf8')), old);
    assert.deepEqual(JSON.parse(fs.readFileSync(from, 'utf8')), next);
    return rename(from, to);
  });
  await writeAdminSettingsFile(next);
  assert.deepEqual(await readAdminSettingsFile(), next);
  assert.equal(fs.statSync(adminSettingsPath()).mode & 0o777, 0o600);
});
