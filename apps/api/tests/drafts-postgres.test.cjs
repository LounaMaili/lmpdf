// Real PostgreSQL + HTTP app. Only the explicitly isolated database is accepted.
require('reflect-metadata');
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PrismaClient } = require('@prisma/client');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory, APP_GUARD } = require('@nestjs/core');
const { PassportModule } = require('@nestjs/passport');
const { JwtService } = require('@nestjs/jwt');
const { loadWebDraftClient, loadTemplateDraftHelper, loadAutosaveScheduler } = require('./helpers/web-draft-client.cjs');

assert.equal(process.env.LMPDF_ISOLATED_DRAFT_TESTS, '1');
for (const [name, username] of [['DATABASE_URL', 'lmpdf_draft_validation'], ['DRAFT_TEST_ADMIN_URL', 'lmpdf_draft_admin']]) {
  const url = new URL(process.env[name] || 'http://invalid');
  assert.equal(url.protocol, 'postgresql:'); assert.match(url.hostname, /^lmpdf-isolated-drafts-pg-\d+-\d+$/);
  assert.equal(url.pathname, '/lmpdf_draft_validation'); assert.equal(url.username, username); assert.equal(url.port, '5432');
}
const db = new PrismaClient({ log: [] });
const admin = new PrismaClient({ log: [], datasources: { db: { url: process.env.DRAFT_TEST_ADMIN_URL } } });
const cwd = process.cwd(), temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lmpdf-drafts-pg-'));
process.chdir(temporary);
Object.assign(process.env, { JWT_SECRET: 'synthetic-postgres-drafts-secret-at-least-32-characters',
  AUTH_MODE: 'local', LDAP_ENABLED: 'false', MFA_POLICY: 'optional' });
const { DraftsController } = require('../dist/drafts/drafts.controller');
const { DraftsService } = require('../dist/drafts/drafts.service');
const { TemplatesController } = require('../dist/templates/templates.controller');
const { TemplatesService } = require('../dist/templates/templates.service');
const { PermissionsService } = require('../dist/permissions/permissions.service');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const { JwtAuthGuard } = require('../dist/auth/auth.guard');
const { preserveTemplateDraft } = loadTemplateDraftHelper();
const { AutosaveScheduler } = loadAutosaveScheduler();
let app, base, web, token, actor, document, lostDeleteAck, failedLookup, delayedWrite, deletes, writes;
const actual = {
  user: db.user, userWebAuthnCredential: db.userWebAuthnCredential,
  document: db.document, template: db.template, groupMember: db.groupMember,
  documentPermission: db.documentPermission,
  draft: {
    findUnique: args => {
      if (failedLookup) throw new Error('synthetic lost absence lookup');
      return db.draft.findUnique(args);
    },
    async upsert(args) {
      const data = args.create;
      writes.push({ key: data.templateId || data.sourceFileId, name: data.payload.name });
      const held = delayedWrite;
      const slow = held && data.sourceFileId === document.id && data.payload.name === 'old in-flight snapshot';
      if (slow && held.mode === 'late-write') { held.entered.resolve(); await held.release.promise; }
      const result = await db.draft.upsert(args);
      if (slow && held.mode !== 'late-write') { held.entered.resolve(); await held.release.promise; }
      if (slow && held.mode === 'lost-write-ack') throw new Error('synthetic lost write acknowledgement after real commit');
      return result;
    },
    async deleteMany(args) {
      deletes++;
      const result = await db.draft.deleteMany(args);
      if (lostDeleteAck) throw new Error('synthetic lost delete acknowledgement after real commit');
      return result;
    },
  },
};
class TestModule {}
Module({ imports: [PassportModule.register({ defaultStrategy: 'jwt' })], controllers: [DraftsController, TemplatesController],
  providers: [DraftsService, TemplatesService, PermissionsService, JwtStrategy,
    { provide: PrismaService, useValue: actual }, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})(TestModule);
function gate() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
const payload = name => ({ name, fields: [{ id: randomUUID(), label: 'Synthetic QA', value: '<div>QA <strong>filled</strong></div>',
  type: 'text', x: 10, y: 20, w: 100, h: 30, style: {}, pageNumber: 1 }], rotation: 0, pageCount: 2 });
const stored = key => db.draft.findUnique({ where: key.templateId
  ? { userId_templateId: { userId: actor.id, templateId: key.templateId } }
  : { userId_sourceFileId: { userId: actor.id, sourceFileId: key.sourceFileId } } });
async function createTemplate(data) {
  return web.saveTemplate({ name: data.name, sourceFileId: document.id, rotation: 0,
    fields: data.fields.map(f => ({ ...f, value: '' })) });
}
function transport(adopt = () => true, prepareCleanup = () => true) {
  return { upsert: web.upsertDraft, clear: web.clearDraft, sameSession: () => true, adopt, prepareCleanup };
}

before(async () => {
  await Promise.all([db.$connect(), admin.$connect()]);
  assert.equal((await db.$queryRaw`SELECT current_database() AS name`)[0].name, 'lmpdf_draft_validation');
  const role = (await db.$queryRaw`SELECT rolsuper FROM pg_roles WHERE rolname = current_user`)[0];
  assert.equal(role.rolsuper, false);
  app = await NestFactory.create(TestModule, { logger: false }); app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  web = loadWebDraftClient(base, () => token);
});
beforeEach(async () => {
  lostDeleteAck = false; failedLookup = false; delayedWrite = null; deletes = 0; writes = [];
  actor = await db.user.create({ data: { email: `${randomUUID()}@draft-isolated.invalid`,
    passwordHash: 'synthetic-not-used-for-login', displayName: 'Synthetic draft test', role: 'editor' } });
  token = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: actor.id, purpose: 'access' });
  document = await db.document.create({ data: { ownerId: actor.id, originalName: 'SYNTHETIC.pdf',
    mimeType: 'application/pdf', path: 'synthetic-no-file-read-or-write', size: 0 } });
});
after(async () => {
  delayedWrite?.release.resolve();
  await app?.close(); await Promise.all([db.$disconnect(), admin.$disconnect()]);
  process.chdir(cwd); fs.rmSync(temporary, { recursive: true, force: true });
});

for (const kind of ['sourceFileId', 'templateId']) {
  test(`PostgreSQL DELETE: deleted then established absence for ${kind}`, async () => {
    const key = { [kind]: randomUUID() };
    await web.upsertDraft(kind === 'templateId' ? { ...key, sourceFileId: document.id } : key, payload('delete once'));
    assert.equal((await web.clearDraft(key)).outcome, 'deleted'); assert.equal(await stored(key), null);
    assert.equal((await web.clearDraft(key)).outcome, 'absent');
  });
}
test('PostgreSQL DELETE is scoped to the authenticated user', async () => {
  const other = await db.user.create({ data: { email: `${randomUUID()}@draft-isolated.invalid`, passwordHash: 'synthetic', displayName: 'Other' } });
  await db.draft.create({ data: { userId: other.id, sourceFileId: document.id, payload: payload('other user') } });
  assert.equal((await web.clearDraft({ sourceFileId: document.id })).outcome, 'absent');
  assert.equal(await db.draft.count({ where: { userId: other.id, sourceFileId: document.id } }), 1);
});
test('PostgreSQL permission rejection is an HTTP error, never an absence', async () => {
  const key = { sourceFileId: document.id }; await web.upsertDraft(key, payload('retain on SQL failure'));
  await admin.$executeRawUnsafe('REVOKE DELETE ON TABLE public."Draft" FROM lmpdf_draft_validation');
  try {
    const response = await fetch(base + '/api/drafts?' + new URLSearchParams(key), { method: 'DELETE', headers: { Authorization: `Bearer ${token}` } });
    assert.equal(response.status, 500); await assert.rejects(() => web.clearDraft(key));
    assert.notEqual(await stored(key), null);
  } finally { await admin.$executeRawUnsafe('GRANT DELETE ON TABLE public."Draft" TO lmpdf_draft_validation'); }
});
test('PostgreSQL committed deletion with lost acknowledgement remains unconfirmed until retry', async () => {
  const key = { sourceFileId: document.id }, data = payload('confirmed new copy'); await web.upsertDraft(key, data);
  const template = await createTemplate(data); lostDeleteAck = true;
  const result = await preserveTemplateDraft(template.id, { key, revision: 1, payload: data }, transport());
  assert.equal(result.cleanupFailed, true); assert.equal(await stored(key), null);
  assert.deepEqual((await stored({ templateId: template.id })).payload, data);
  lostDeleteAck = false; assert.equal((await web.clearDraft(key)).outcome, 'absent');
});
test('PostgreSQL structural save preserves values before clearing the existing source slot', async () => {
  const key = { sourceFileId: document.id }, data = payload('new template draft'); await web.upsertDraft(key, data);
  const template = await createTemplate(data);
  assert.equal(template.fields[0].value, '');
  const result = await preserveTemplateDraft(template.id, { key, revision: 1, payload: data }, transport());
  assert.equal(result.cleanupFailed, false); assert.equal(await stored(key), null);
  const saved = await stored({ templateId: template.id }); assert.equal(saved.sourceFileId, null); assert.deepEqual(saved.payload, data);
});

test('PostgreSQL compare-and-delete retains a concurrently changed old draft', async () => {
  const key = { sourceFileId: document.id }, copy = payload('preserved copy'), newer = payload('other writer newer content');
  await web.upsertDraft(key, copy); const template = await createTemplate(copy);
  const ports = transport();
  ports.clear = async (oldKey, preservedPayload) => {
    await web.upsertDraft(oldKey, newer);
    return web.clearDraft(oldKey, preservedPayload);
  };
  const result = await preserveTemplateDraft(template.id, { key, revision: 1, payload: copy }, ports);
  assert.equal(result.cleanupFailed, true);
  assert.deepEqual((await stored(key)).payload, newer);
  assert.deepEqual((await stored({ templateId: template.id })).payload, copy);
});

test('PostgreSQL conditional absence is not assumed when its follow-up lookup fails', async () => {
  const key = { sourceFileId: document.id }, old = payload('existing old content');
  await web.upsertDraft(key, old); failedLookup = true;
  await assert.rejects(() => web.clearDraft(key, payload('different preserved copy')));
  assert.deepEqual((await stored(key)).payload, old);
});

for (const mode of ['late-write', 'late-response', 'lost-write-ack']) {
  test(`PostgreSQL + HTTP: old autosave ${mode} cannot overwrite the new draft or lose later edits`, { timeout: 15000 }, async t => {
    const keyA = { sourceFileId: document.id }, initial = payload('initial source slot');
    await web.upsertDraft(keyA, initial);
    const held = { mode, entered: gate(), release: gate() }; delayedWrite = held;
    const scheduler = new AutosaveScheduler({ debounceMs: 60000, intervalMs: 60000,
      save: s => web.upsertDraft(s.key, s.data), onStateChange: () => {} });
    scheduler.start(); let inFlight;
    t.after(async () => { held.release.resolve(); scheduler.stop(); await inFlight; });
    const old = payload('old in-flight snapshot');
    scheduler.observe({ dirty: true, revision: 1, key: keyA, getData: () => old });
    inFlight = scheduler.saveNow(); await held.entered.promise;
    const latest = payload('latest preserved snapshot');
    scheduler.observe({ dirty: true, revision: 2, key: keyA, getData: () => latest });
    const template = await createTemplate(latest), keyB = { templateId: template.id };
    const result = await preserveTemplateDraft(template.id, { key: keyA, revision: 2, payload: latest }, transport(() => {
      scheduler.observe({ dirty: false, revision: 2, key: keyB, getData: () => latest }); return true;
    }, (key, revision) => scheduler.retireKey(key, revision)));
    assert.equal(result.cleanupFailed, true); assert.equal(deletes, 0);
    assert.deepEqual((await stored(keyB)).payload, latest);
    const newer = { ...latest, name: 'newer edits on B' };
    scheduler.observe({ dirty: true, revision: 3, key: keyB, getData: () => newer });
    await web.upsertDraft(keyB, newer); // explicit save while the old autosave is still waiting
    held.release.resolve(); await inFlight;
    assert.deepEqual((await stored(keyB)).payload, newer);
    await scheduler.saveNow(); await scheduler.saveNow();
    assert.deepEqual((await stored(keyB)).payload, newer); assert.notEqual(await stored(keyA), null);
    assert.equal(writes.filter(w => w.key === document.id && w.name === old.name).length, 1);
    assert.equal(writes.filter(w => w.key === document.id && w.name === latest.name).length, 0);
    assert.equal(scheduler.hasPendingChanges(), false);
  });
}
