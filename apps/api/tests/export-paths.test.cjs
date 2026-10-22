const { test, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { validateExportPath } = require('../dist/export/export-security');
const { writeExportFile } = require('../dist/export/export-writer');
// "outside" is outside the policy root, but still inside this disposable sandbox.
const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'lmpdf-export-paths-'));
const allowed = path.join(sandbox, 'allowed'), outside = path.join(sandbox, 'outside');
const target = path.join(allowed, 'report.pdf'), sentinel = path.join(outside, 'report.pdf');
const bytes = Buffer.from('%PDF-synthetic-output');
beforeEach(() => {
  mock.restoreAll();
  fs.rmSync(allowed, { recursive: true, force: true }); fs.rmSync(outside, { recursive: true, force: true });
  fs.mkdirSync(allowed); fs.mkdirSync(outside); fs.writeFileSync(sentinel, 'synthetic sentinel');
});
after(() => { mock.restoreAll(); fs.rmSync(sandbox, { recursive: true, force: true }); });
const write = (file = target, strategy = 'overwrite') => writeExportFile(file, bytes, strategy, [allowed]);
const intact = () => assert.equal(fs.readFileSync(sentinel, 'utf8'), 'synthetic sentinel');

for (const strategy of ['overwrite', 'rename', 'skip']) {
  test(`chemin normal et conflit ${strategy}`, async () => {
    assert.equal(validateExportPath(target, [allowed]).valid, true);
    const first = await write(target, strategy); assert.equal(first.written, true);
    const next = await write(target, strategy);
    assert.equal(next.skipped === true, strategy === 'skip');
    assert.equal(next.renamed === true, strategy === 'rename'); intact();
  });
}
for (const [name, file] of [
  ['hors racine', sentinel], ['traversée', `${allowed}/../outside/report.pdf`],
  ['préfixe voisin', path.join(sandbox, 'allowed-sibling', 'report.pdf')],
]) test(`refus ${name} à la validation et dans le writer`, async () => {
  assert.equal(validateExportPath(file, [allowed]).valid, false);
  let error; try { await write(file); } catch (caught) { error = caught; }
  intact(); assert.ok(error, 'writer must enforce allowedRoots independently');
});
for (const strategy of ['overwrite', 'rename', 'skip']) {
  test(`répertoire symbolique vers extérieur refusé : ${strategy}`, async () => {
    fs.symlinkSync(outside, path.join(allowed, 'link'), 'dir');
    let error; try { await write(path.join(allowed, 'link', 'report.pdf'), strategy); } catch (caught) { error = caught; }
    intact(); assert.ok(error); assert.equal(validateExportPath(path.join(allowed, 'link', 'report.pdf'), [allowed]).valid, false);
  });
  test(`fichier cible symbolique refusé : ${strategy}`, async () => {
    fs.symlinkSync(sentinel, target);
    let error; try { await write(target, strategy); } catch (caught) { error = caught; }
    intact(); assert.ok(error); assert.equal(validateExportPath(target, [allowed]).valid, false);
    assert.deepEqual(fs.readdirSync(allowed), ['report.pdf']);
  });
}
test('hardlink vers un fichier extérieur refusé avant troncature', async () => {
  fs.linkSync(sentinel, target);
  let error; try { await write(); } catch (caught) { error = caught; }
  intact(); assert.ok(error);
});
test('remplacement de répertoire après validation, avant entrée dans le writer', async () => {
  const directory = path.join(allowed, 'sub'); fs.mkdirSync(directory);
  const file = path.join(directory, 'report.pdf'); assert.equal(validateExportPath(file, [allowed]).valid, true);
  fs.renameSync(directory, path.join(allowed, 'saved')); fs.symlinkSync(outside, directory, 'dir');
  let error; try { await write(file); } catch (caught) { error = caught; }
  intact(); assert.ok(error); assert.deepEqual(fs.readdirSync(path.join(allowed, 'saved')), []);
});
test('remplacement après ouverture du répertoire : aucune redirection ni fichier résiduel', async () => {
  const directory = path.join(allowed, 'sub'); fs.mkdirSync(directory);
  const file = path.join(directory, 'report.pdf'); const open = fs.promises.open.bind(fs.promises); let changed = false;
  mock.method(fs.promises, 'open', async (name, ...args) => {
    if (!changed && String(name).startsWith('/proc/self/fd/') && String(name).endsWith('/report.pdf')) {
      changed = true; fs.renameSync(directory, path.join(allowed, 'saved')); fs.symlinkSync(outside, directory, 'dir');
    }
    return open(name, ...args);
  });
  let error; try { await write(file); } catch (caught) { error = caught; }
  intact(); assert.equal(changed, true); assert.ok(error); assert.deepEqual(fs.readdirSync(path.join(allowed, 'saved')), []);
});
test('remplacement de cible après ouverture : descripteur non redirigé, aucune troncature extérieure', async () => {
  fs.writeFileSync(target, 'original'); const open = fs.promises.open.bind(fs.promises); let changed = false;
  mock.method(fs.promises, 'open', async (name, ...args) => {
    const handle = await open(name, ...args);
    if (!changed && String(name).startsWith('/proc/self/fd/') && String(name).endsWith('/report.pdf')) {
      changed = true; fs.renameSync(target, path.join(allowed, 'saved.pdf')); fs.symlinkSync(sentinel, target);
    }
    return handle;
  });
  let error; try { await write(); } catch (caught) { error = caught; }
  intact(); assert.equal(changed, true); assert.ok(error); assert.equal(fs.readFileSync(path.join(allowed, 'saved.pdf'), 'utf8'), 'original');
});
test('remplacement pendant écriture : aucun suivi du symlink, création rejetée nettoyée', async () => {
  const directory = path.join(allowed, 'sub'); fs.mkdirSync(directory);
  const file = path.join(directory, 'report.pdf'); const open = fs.promises.open.bind(fs.promises); let changed = false;
  mock.method(fs.promises, 'open', async (name, ...args) => {
    const handle = await open(name, ...args);
    if (!changed && String(name).startsWith('/proc/self/fd/') && String(name).endsWith('/report.pdf')) {
      const actualWrite = handle.writeFile.bind(handle);
      mock.method(handle, 'writeFile', async data => {
        changed = true; fs.renameSync(directory, path.join(allowed, 'saved')); fs.symlinkSync(outside, directory, 'dir');
        return actualWrite(data);
      });
    }
    return handle;
  });
  let error; try { await write(file); } catch (caught) { error = caught; }
  intact(); assert.equal(changed, true); assert.ok(error); assert.deepEqual(fs.readdirSync(path.join(allowed, 'saved')), []);
});
test('erreur I/O sur création : aucun fichier partiel laissé', async () => {
  const open = fs.promises.open.bind(fs.promises);
  mock.method(fs.promises, 'open', async (name, ...args) => {
    const handle = await open(name, ...args);
    if (String(name).endsWith('/report.pdf')) mock.method(handle, 'writeFile', async () => { throw new Error('synthetic I/O failure'); });
    return handle;
  });
  await assert.rejects(() => write()); assert.deepEqual(fs.readdirSync(allowed), []); intact();
});
