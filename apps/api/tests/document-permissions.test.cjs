const { test, before, after, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
require('reflect-metadata');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory, APP_GUARD } = require('@nestjs/core');
const { PassportModule } = require('@nestjs/passport');
const { JwtService } = require('@nestjs/jwt');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { PermissionsService } = require('../dist/permissions/permissions.service');
const { TemplatesService } = require('../dist/templates/templates.service');
const { TemplatesController } = require('../dist/templates/templates.controller');
const { FoldersController } = require('../dist/folders.controller');
const { ExportController } = require('../dist/export/export.controller');
const { JwtAuthGuard } = require('../dist/auth/auth.guard');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const writer = require('../dist/export/export-writer');

const docId = '11111111-1111-4111-8111-111111111111';
const templateId = '22222222-2222-4222-8222-222222222222';
const otherId = '33333333-3333-4333-8333-333333333333';
const user = { id: 'test-user', role: 'editor', email: 'test@example.invalid', displayName: 'Test' };
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmpdf-permissions-'));
const originalCwd = process.cwd();
process.chdir(root);
fs.mkdirSync('config');

function settings(overrides = {}) {
  fs.writeFileSync('config/admin-settings.json', JSON.stringify({
    export: { enabled: true, allowedRoots: [root], destinations: [{ name: 'test', enabled: true, rootPath: root, pathTemplate: '', fileNameTemplate: '{templateName}', conflictStrategy: 'rename' }], rules: [{ enabled: true, label: 'test', destinationName: 'test' }] },
    ...overrides,
  }));
}

function fixture({ role = 'editor', owner = false, direct = null, groups = [] } = {}) {
  const actor = { ...user, role };
  const doc = { id: docId, ownerId: owner ? actor.id : 'other-owner', originalName: 'stored-document.pdf' };
  const template = { id: templateId, sourceFileId: docId, name: 'Stored template', ownerId: actor.id, fields: [] };
  const calls = { creates: 0, moves: 0, logs: 0 };
  const prisma = {
    document: { findUnique: async ({ where }) => where.id === docId ? doc : null, update: async (args) => { calls.moves++; return args; } },
    template: { findUnique: async ({ where }) => where.id === templateId ? template : null, create: async ({ data }) => { calls.creates++; return { ...data, fields: [] }; }, update: async (args) => { calls.moves++; return args; } },
    documentPermission: { findUnique: async () => direct ? { docRole: direct } : null, findMany: async () => groups.map(docRole => ({ docRole })) },
    groupMember: { findMany: async () => groups.map((_, i) => ({ groupId: String(i), group: { name: 'test' } })), findUnique: async ({ where }) => where.userId_groupId.groupId === 'member-group' ? {} : null },
    group: { findUnique: async ({ where }) => ['member-group', 'other-group'].includes(where.id) ? { id: where.id } : null },
    folder: { findUnique: async ({ where }) => ({
      personal: { id: 'personal', ownerId: actor.id, groupId: null },
      private: { id: 'private', ownerId: 'other-owner', groupId: null },
      shared: { id: 'shared', ownerId: null, groupId: 'member-group' },
      inaccessible: { id: 'inaccessible', ownerId: null, groupId: 'other-group' },
    })[where.id] ?? null, create: async ({ data }) => { calls.creates++; return data; } },
    exportLog: { create: async () => { calls.logs++; } },
    user: { findUnique: async ({ where }) => where.id === actor.id ? { ...actor, isActive: true } : null },
  };
  const permissions = new PermissionsService(prisma);
  const templates = new TemplatesService(prisma, permissions);
  return { actor, doc, template, calls, prisma, permissions, templates, export: new ExportController(prisma, permissions), folders: new FoldersController(prisma) };
}
const rejectsStatus = (fn, status) => assert.rejects(fn, e => e.getStatus?.() === status);
beforeEach(() => { settings(); mock.restoreAll(); });
after(() => { process.chdir(originalCwd); fs.rmSync(root, { recursive: true, force: true }); });

for (const [name, options, allowed] of [
  ['admin', { role: 'admin' }, true], ['owner', { owner: true }, true],
  ['editor direct', { direct: 'editor' }, true], ['owner partagé', { direct: 'owner' }, true],
  ['filler', { direct: 'filler' }, false], ['aucun accès', {}, false],
  ['editor via groupe', { groups: ['filler', 'editor'] }, true], ['filler via groupe', { groups: ['filler'] }, false],
]) {
  test(`template + export : matrice ${name}`, async () => {
    const f = fixture(options);
    const controller = new TemplatesController(f.templates);
    const create = () => controller.create({ name: 'Test', sourceFileId: docId, fields: [] }, { user: f.actor });
    const resolve = () => f.export.resolve({ sourceFileId: docId }, { user: f.actor });
    if (allowed) { await create(); assert.equal((await resolve()).matched, true); }
    else { await rejectsStatus(create, 403); await rejectsStatus(resolve, 403); }
    assert.equal(f.calls.creates, allowed ? 1 : 0);
  });
}

test('permission globale refusée malgré owner documentaire', async () => {
  const f = fixture({ role: 'viewer', owner: true });
  await rejectsStatus(() => new TemplatesController(f.templates).create({ name: 'Test', sourceFileId: docId, fields: [] }, { user: f.actor }), 403);
  await rejectsStatus(() => f.export.resolve({ sourceFileId: docId }, { user: f.actor }), 403);
  assert.equal(f.calls.creates, 0);
});
test('override global refusé même pour admin', async () => {
  settings({ permissions: { admin: { createTemplate: false, exportPdf: false } } });
  const f = fixture({ role: 'admin' });
  await rejectsStatus(() => new TemplatesController(f.templates).create({ name: 'Test', sourceFileId: docId, fields: [] }, { user: f.actor }), 403);
  await rejectsStatus(() => f.export.resolve({ sourceFileId: docId }, { user: f.actor }), 403);
});
test('document inconnu : aucun rôle même pour admin, aucun template créé', async () => {
  const f = fixture({ role: 'admin' });
  assert.equal(await f.permissions.resolveDocRole(otherId, f.actor), null);
  await rejectsStatus(() => f.templates.create({ name: 'Test', sourceFileId: otherId, fields: [] }, f.actor), 404);
  assert.equal(f.calls.creates, 0);
});
test('le partage direct conserve sa priorité sur le groupe', async () => {
  const f = fixture({ direct: 'filler', groups: ['owner'] });
  assert.equal(await f.permissions.resolveDocRole(docId, f.actor), 'filler');
});
test('contexte export : ID template seul accepté et nom du navigateur ignoré', async () => {
  const f = fixture({ owner: true });
  const result = await f.export.resolve({ templateId, templateName: 'spoofed' }, { user: f.actor });
  assert.equal(result.resolvedFileName, 'Stored template.pdf');
});
for (const [name, body, status] of [
  ['absence de contexte', { templateName: 'not-authorization' }, 400],
  ['template inconnu', { templateId: otherId }, 404],
  ['document inconnu', { sourceFileId: otherId }, 404],
  ['relation incohérente', { templateId, sourceFileId: otherId }, 400],
]) test(`export : ${name} refusé sans écriture`, async () => {
  const f = fixture({ owner: true });
  const write = mock.method(writer, 'writeExportFile', async () => assert.fail('écriture interdite'));
  await rejectsStatus(() => f.export.resolve(body, { user: f.actor }), status);
  await rejectsStatus(() => f.export.runExport({ buffer: Buffer.from('%PDF-test') }, body, { user: f.actor }), status);
  assert.equal(write.mock.callCount(), 0);
  assert.equal(f.calls.logs, 0);
});
test('template sans document refusé, sans contournement par un autre sourceFileId', async () => {
  const f = fixture({ owner: true }); f.template.sourceFileId = null;
  await rejectsStatus(() => f.export.resolve({ templateId, sourceFileId: docId }, { user: f.actor }), 400);
});
test('run refuse filler avant toute écriture, même avec un PDF valide', async () => {
  const f = fixture({ direct: 'filler' });
  const write = mock.method(writer, 'writeExportFile', async () => assert.fail('écriture interdite'));
  await rejectsStatus(() => f.export.runExport({ buffer: Buffer.from('%PDF-test') }, { sourceFileId: docId }, { user: f.actor }), 403);
  assert.equal(write.mock.callCount(), 0);
  assert.equal(f.calls.logs, 0);
});
test('run autorisé transmet le PDF et le contexte canonique au writer', async () => {
  const f = fixture({ owner: true });
  const write = mock.method(writer, 'writeExportFile', async finalPath => ({ written: true, finalPath }));
  const result = await f.export.runExport({ buffer: Buffer.from('%PDF-test') }, { templateId, sourceFileId: docId, templateName: 'spoofed' }, { user: f.actor });
  assert.equal(result.ok, true); assert.equal(write.mock.callCount(), 1);
  assert.equal(path.basename(result.finalPath), 'Stored template.pdf');
  assert.equal(f.calls.logs, 1);
});
test('PDF invalide refusé avant le writer', async () => {
  const f = fixture({ owner: true });
  const write = mock.method(writer, 'writeExportFile', async () => assert.fail());
  await rejectsStatus(() => f.export.runExport({ buffer: Buffer.from('bad') }, { sourceFileId: docId }, { user: f.actor }), 400);
  assert.equal(write.mock.callCount(), 0);
});

test('création personnelle et sous-dossier personnel autorisés', async () => {
  const f = fixture();
  assert.equal((await f.folders.create({ name: 'test' }, { user: f.actor })).ownerId, f.actor.id);
  await f.folders.create({ name: 'child', parentId: 'personal' }, { user: f.actor });
});
test('création groupe membre et sous-dossier cohérent autorisés', async () => {
  const f = fixture();
  const folder = await f.folders.create({ name: 'test', ownerScope: 'group', groupId: 'member-group', parentId: 'shared' }, { user: f.actor });
  assert.equal(folder.groupId, 'member-group'); assert.equal(folder.ownerId, null);
});
for (const [name, body, status] of [
  ['groupe non membre', { ownerScope: 'group', groupId: 'other-group' }, 403],
  ['groupe inconnu', { ownerScope: 'group', groupId: 'unknown' }, 404],
  ['groupe requis', { ownerScope: 'group' }, 400],
  ['personnel avec groupe', { ownerScope: 'me', groupId: 'member-group' }, 400],
  ['parent inconnu', { parentId: 'unknown' }, 404],
  ['parent inaccessible', { parentId: 'private' }, 403],
  ['parent groupe incohérent', { parentId: 'shared' }, 400],
]) test(`dossier : ${name}`, async () => {
  const f = fixture();
  await rejectsStatus(() => f.folders.create({ name: 'test', ...body }, { user: f.actor }), status);
  assert.equal(f.calls.creates, 0);
});
for (const kind of ['Document', 'Template']) {
  test(`déplacement ${kind} : destination accessible et source owner`, async () => {
    const f = fixture({ owner: true });
    await f.folders[`move${kind}`]('shared', { [kind === 'Document' ? 'documentId' : 'templateId']: kind === 'Document' ? docId : templateId }, { user: f.actor });
    assert.equal(f.calls.moves, 1);
  });
  for (const [folder, status] of [['private', 403], ['inaccessible', 403], ['unknown', 404]]) {
    test(`déplacement ${kind} refusé vers ${folder}`, async () => {
      const f = fixture({ owner: true });
      await rejectsStatus(() => f.folders[`move${kind}`](folder, { [kind === 'Document' ? 'documentId' : 'templateId']: kind === 'Document' ? docId : templateId }, { user: f.actor }), status);
      assert.equal(f.calls.moves, 0);
    });
  }
}
test('déplacement préserve le contrôle du propriétaire source', async () => {
  const f = fixture({ direct: 'editor' });
  await rejectsStatus(() => f.folders.moveDocument('personal', { documentId: docId }, { user: f.actor }), 403);
  await rejectsStatus(() => f.folders.moveTemplate('personal', { templateId: otherId }, { user: f.actor }), 404);
});
test('admin peut viser un groupe non membre mais pas un ID inexistant', async () => {
  const f = fixture({ role: 'admin' });
  await f.folders.create({ name: 'test', ownerScope: 'group', groupId: 'other-group' }, { user: f.actor });
  await rejectsStatus(() => f.folders.moveDocument('unknown', { documentId: docId }, { user: f.actor }), 404);
});

test('HTTP réel : JWT requis et multipart filler refusé sans fichier sur disque', async () => {
  const f = fixture({ direct: 'filler' });
  process.env.JWT_SECRET = 'test-only-permissions-key-not-a-production-secret';
  class TestModule {}
  Module({ imports: [PassportModule.register({ defaultStrategy: 'jwt' })],
    controllers: [TemplatesController, ExportController, FoldersController],
    providers: [{ provide: PrismaService, useValue: f.prisma }, PermissionsService, TemplatesService, JwtStrategy, { provide: APP_GUARD, useClass: JwtAuthGuard }],
  })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  const url = await app.getUrl();
  try {
    for (const route of ['/export/resolve', '/export/run', '/templates', '/folders']) {
      const response = await fetch(`${url}/api${route}`, { method: 'POST' });
      assert.equal(response.status, 401, route);
    }
    const token = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: f.actor.id });
    const form = new FormData(); form.append('sourceFileId', docId); form.append('file', new Blob(['%PDF-test']), 'test.pdf');
    const response = await fetch(`${url}/api/export/run`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
    assert.equal(response.status, 403);
    assert.equal(fs.existsSync(path.join(root, 'uploads')), false);
    const invalid = await fetch(`${url}/api/export/resolve`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceFileId: 'invalid' }) });
    assert.equal(invalid.status, 400);
  } finally { await app.close(); }
});
