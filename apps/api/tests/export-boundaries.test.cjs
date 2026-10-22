const { test, before, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
require('reflect-metadata');
const originalCwd = process.cwd();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmpdf-export-boundaries-'));
process.chdir(root);
fs.mkdirSync('config');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory, APP_GUARD } = require('@nestjs/core');
const { PassportModule } = require('@nestjs/passport');
const { JwtService } = require('@nestjs/jwt');
const { ExportController } = require('../dist/export/export.controller');
const { MAX_EXPORT_BYTES, MAX_CONCURRENT_EXPORTS } = require('../dist/export/export-capacity.interceptor');
const { pdfOutputFileName } = require('../dist/export/export-filename');
const { PermissionsService } = require('../dist/permissions/permissions.service');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const { JwtAuthGuard } = require('../dist/auth/auth.guard');
const writer = require('../dist/export/export-writer');
const docId = '11111111-1111-4111-8111-111111111111';
const templateId = '22222222-2222-4222-8222-222222222222';
const actor = { id: 'synthetic-owner', role: 'editor', email: 'synthetic@example.invalid', displayName: 'Synthetic', isActive: true };
const destination = path.join(root, 'destination');
let allowed, docName, app, base, jwt;
process.env.JWT_SECRET = 'synthetic-export-only-secret-more-than-32-characters';
const prisma = {
  user: { findUnique: async () => actor },
  document: { findUnique: async ({ where }) => where.id === docId ? { id: docId,
    ownerId: allowed ? actor.id : 'other', originalName: docName } : null },
  template: { findUnique: async ({ where }) => where.id === templateId ? { id: templateId, sourceFileId: docId, name: 'Trusted template.pdf' } : null },
  documentPermission: { findUnique: async () => allowed ? null : { docRole: 'filler' }, findMany: async () => [] },
  groupMember: { findMany: async () => [] },
  exportLog: { create: async () => ({}) },
};
class ExportTestModule {}
Module({ imports: [PassportModule.register({ defaultStrategy: 'jwt' })], controllers: [ExportController],
  providers: [{ provide: PrismaService, useValue: prisma }, PermissionsService, JwtStrategy,
    { provide: APP_GUARD, useClass: JwtAuthGuard }],
})(ExportTestModule);
before(async () => {
  app = await NestFactory.create(ExportTestModule, { logger: false });
  app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  jwt = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: actor.id, purpose: 'access' });
});
beforeEach(() => {
  mock.restoreAll(); allowed = true; docName = 'Trusted scan.pdf';
  fs.rmSync(destination, { recursive: true, force: true });
  fs.writeFileSync('config/admin-settings.json', JSON.stringify({ export: { enabled: true,
    allowedRoots: [destination], destinations: [{ name: 'trusted', enabled: true, rootPath: destination,
      pathTemplate: '', fileNameTemplate: '{templateName}', conflictStrategy: 'rename' }],
    rules: [{ enabled: true, label: 'trusted-rule', templateNameContains: 'Trusted', destinationName: 'trusted' }],
  } }));
});
after(async () => {
  mock.restoreAll(); if (app) await app.close(); process.chdir(originalCwd);
  fs.rmSync(root, { recursive: true, force: true });
});
function form({ size = 9, content, fields = { sourceFileId: docId } } = {}) {
  const body = new FormData();
  for (const [key, value] of Object.entries(fields)) body.append(key, value);
  const bytes = content ?? Buffer.alloc(size, 65); if (!content) bytes.write('%PDF-');
  body.append('file', new Blob([bytes]), 'synthetic.pdf'); return body;
}
async function run(body = form()) {
  const response = await fetch(`${base}/api/export/run`, { method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body });
  return { status: response.status, body: await response.json() };
}
function noDiskOutput() {
  assert.equal(fs.existsSync(destination), false);
  assert.deepEqual(fs.readdirSync(root).sort(), ['config']);
}
function fakeWrite() {
  return mock.method(writer, 'writeExportFile', async finalPath => ({ written: true, finalPath }));
}

for (const [input, expected] of [
  ['scan.pdf', 'scan.pdf'], ['scan.png', 'scan.pdf'], ['scan.PNG.PDF', 'scan.pdf'],
  ['Invoice.2026.pdf', 'Invoice.2026.pdf'], ['a/b\\c.png', 'a_b_c.pdf'],
  ['..', '_.pdf'], ['', 'document.pdf'],
]) test(`nom de sortie : ${JSON.stringify(input)}`, () => assert.equal(pdfOutputFileName(input), expected));

test('HTTP : plafond fichier 25 Mio, sous enveloppe proxy 30 Mio', async () => {
  assert.equal(MAX_EXPORT_BYTES, 25 * 1024 * 1024);
  const nginx = fs.readFileSync(process.env.LMPDF_TEST_NGINX_CONFIG ?? path.resolve(__dirname, '../../web/nginx.prod.conf'), 'utf8');
  assert.match(nginx, /client_max_body_size 30M;/);
  const write = fakeWrite();
  assert.equal((await run(form({ size: MAX_EXPORT_BYTES + 1 }))).status, 413);
  assert.equal(write.mock.callCount(), 0); noDiskOutput();
  assert.equal((await run()).status, 201); // rejected upload released its capacity
});
test('HTTP : un fichier de 25 Mio reste accepté', async () => {
  const write = fakeWrite();
  assert.equal((await run(form({ size: MAX_EXPORT_BYTES }))).status, 201);
  assert.equal(write.mock.calls[0].arguments[1].length, MAX_EXPORT_BYTES); noDiskOutput();
});
test('HTTP : champs multipart trop gros refusés sans sortie, capacité libérée', async () => {
  const write = fakeWrite();
  assert.equal((await run(form({ fields: { sourceFileId: docId, outputFileName: 'x'.repeat(1025) } }))).status, 400);
  assert.equal(write.mock.callCount(), 0); noDiskOutput();
  assert.equal((await run()).status, 201);
});
test('HTTP : refus de droits et PDF invalide ne laissent aucun temporaire', async () => {
  const write = fakeWrite(); allowed = false;
  assert.equal((await run()).status, 403); noDiskOutput(); allowed = true;
  assert.equal((await run(form({ content: Buffer.from('not a PDF') }))).status, 400);
  assert.equal(write.mock.callCount(), 0); noDiskOutput();
  assert.equal((await run()).status, 201);
});
test('HTTP : deux exports de 25 Mio maximum, surplus 429, puis reprise', async () => {
  assert.equal(MAX_CONCURRENT_EXPORTS, 2);
  let release, ready;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { ready = resolve; });
  let count = 0;
  mock.method(writer, 'writeExportFile', async (finalPath, bytes) => {
    if (count < 2) assert.equal(bytes.length, MAX_EXPORT_BYTES);
    if (++count === 2) ready(); await gate; return { written: true, finalPath };
  });
  const pending = [run(form({ size: MAX_EXPORT_BYTES })), run(form({ size: MAX_EXPORT_BYTES }))];
  try {
    await Promise.race([started, Promise.all(pending).then(() => assert.fail('exports did not reach the writer'))]);
    assert.equal((await run()).status, 429); assert.equal(count, 2); noDiskOutput();
  } finally { release(); }
  assert.deepEqual((await Promise.all(pending)).map(r => r.status), [201, 201]);
  assert.equal((await run()).status, 201);
});
test('HTTP : erreur writer libère aussi la capacité, sans temporaire', async () => {
  const write = mock.method(writer, 'writeExportFile', async () => { throw new Error('synthetic write failure'); });
  assert.equal((await run()).status, 500); noDiskOutput(); write.mock.restore(); fakeWrite();
  assert.deepEqual((await Promise.all([run(), run()])).map(r => r.status), [201, 201]);
});
test('HTTP : upload interrompu libère sa place et ne laisse aucun fichier', async () => {
  fakeWrite();
  let received, closed;
  const incoming = new Promise(resolve => { received = resolve; });
  const disconnected = new Promise(resolve => { closed = resolve; });
  const server = app.getHttpServer();
  const observe = req => {
    if (req.headers['x-synthetic-abort']) {
      req.once('data', received); req.once('close', closed);
    }
  };
  server.on('request', observe);
  const client = http.request(`${base}/api/export/run`, { method: 'POST', headers: {
    Authorization: `Bearer ${jwt}`, 'Content-Type': 'multipart/form-data; boundary=synthetic',
    'Content-Length': MAX_EXPORT_BYTES, 'x-synthetic-abort': '1',
  } });
  client.on('error', () => {});
  try {
    client.write('--synthetic\r\nContent-Disposition: form-data; name="file"; filename="test.pdf"\r\nContent-Type: application/pdf\r\n\r\n%PDF-incomplete');
    await incoming; client.destroy(); await disconnected;
    assert.deepEqual((await Promise.all([run(), run()])).map(r => r.status), [201, 201]);
    noDiskOutput();
  } finally { client.destroy(); server.removeListener('request', observe); }
});
test('HTTP : nom libre nettoyé, contexte canonique inchangé pour les règles', async () => {
  fakeWrite();
  const result = await run(form({ fields: { sourceFileId: docId, outputFileName: 'a/b\\Chosen.png' } }));
  assert.equal(result.status, 201); assert.equal(path.dirname(result.body.finalPath), destination);
  assert.equal(path.basename(result.body.finalPath), 'a_b_Chosen.pdf');
  assert.equal(result.body.ruleLabelMatched, 'trusted-rule');
  noDiskOutput();
});
test('HTTP : nom de sortie ne constitue ni autorisation ni règle de destination', async () => {
  const write = fakeWrite();
  assert.equal((await run(form({ fields: { outputFileName: 'Trusted' } }))).status, 400);
  docName = 'Unmatched.pdf';
  assert.equal((await run(form({ fields: { sourceFileId: docId, outputFileName: 'Trusted' } }))).status, 400);
  assert.equal(write.mock.callCount(), 0); noDiskOutput();
});
test('HTTP : nom de sortie trop long refusé', async () => {
  fakeWrite(); assert.equal((await run(form({ fields: { sourceFileId: docId, outputFileName: 'x'.repeat(201) } }))).status, 400);
  noDiskOutput();
});
test('HTTP : fallback document et template ne doublent plus les extensions', async () => {
  fakeWrite();
  for (const name of ['Trusted scan.pdf', 'Trusted scan.png']) {
    docName = name;
    assert.equal(path.basename((await run()).body.finalPath), 'Trusted scan.pdf');
  }
  assert.equal(path.basename((await run(form({ fields: { templateId } }))).body.finalPath), 'Trusted template.pdf');
});
for (const strategy of ['overwrite', 'rename', 'skip']) {
  test(`collision disque : ${strategy}`, async () => {
    const target = path.join(destination, 'scan.pdf');
    await writer.writeExportFile(target, Buffer.from('old'), 'overwrite');
    const result = await writer.writeExportFile(target, Buffer.from('new'), strategy);
    assert.equal(fs.readFileSync(target, 'utf8'), strategy === 'overwrite' ? 'new' : 'old');
    if (strategy === 'rename') assert.equal(fs.readFileSync(result.finalPath, 'utf8'), 'new');
    if (strategy === 'skip') assert.equal(result.skipped, true);
    assert.equal(fs.readdirSync(destination).length, strategy === 'rename' ? 2 : 1);
  });
}
test('collision concurrente : rename ne peut pas écraser un autre export', async () => {
  const target = path.join(destination, 'scan.pdf');
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => writer.writeExportFile(target, Buffer.from(String(i)), 'rename')));
  assert.equal(new Set(results.map(r => r.finalPath)).size, 6);
  assert.deepEqual(results.map(r => fs.readFileSync(r.finalPath, 'utf8')).sort(), ['0', '1', '2', '3', '4', '5']);
});
test('collision concurrente : skip ne crée qu’un fichier sans écrasement', async () => {
  const target = path.join(destination, 'scan.pdf');
  const results = await Promise.all(Array.from({ length: 6 }, (_, i) => writer.writeExportFile(target, Buffer.from(String(i)), 'skip')));
  assert.equal(results.filter(r => r.written).length, 1); assert.equal(fs.readdirSync(destination).length, 1);
});
