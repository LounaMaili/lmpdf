// Real HTTP + real client/guards/service, synthetic Prisma and JWT only.
require('reflect-metadata');
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { isDeepStrictEqual } = require('node:util');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory, APP_GUARD } = require('@nestjs/core');
const { PassportModule } = require('@nestjs/passport');
const { JwtService } = require('@nestjs/jwt');
const { loadWebDraftClient } = require('./helpers/web-draft-client.cjs');

const cwd = process.cwd();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lmpdf-draft-clear-'));
process.chdir(temporary);
Object.assign(process.env, { JWT_SECRET: 'synthetic-draft-clear-secret-at-least-32-characters',
  AUTH_MODE: 'local', LDAP_ENABLED: 'false', MFA_POLICY: 'optional' });
const { DraftsController } = require('../dist/drafts/drafts.controller');
const { DraftsService } = require('../dist/drafts/drafts.service');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const { JwtAuthGuard } = require('../dist/auth/auth.guard');
const user = { id: 'synthetic-user', role: 'editor', isActive: true, authSource: 'local' };
let app, base, token, web, rows, deletionFailure, lookupFailure, deleteCalls, stub, stubBase, stubStatus, stubBody, stubPaths;
function matches(row, where) {
  const key = where.userId_templateId || where.userId_sourceFileId || where;
  return row.userId === key.userId && (!key.templateId || row.templateId === key.templateId)
    && (!key.sourceFileId || row.sourceFileId === key.sourceFileId)
    && (!where.payload || isDeepStrictEqual(row.payload, where.payload.equals));
}
function remove(where, unique) {
  deleteCalls++;
  if (deletionFailure && deletionFailure !== 'after-commit') {
    throw Object.assign(new Error('synthetic deletion failure'), { code: deletionFailure });
  }
  const deleted = rows.filter(row => matches(row, where));
  if (unique && deleted.length === 0) throw Object.assign(new Error('synthetic missing row'), { code: 'P2025' });
  rows = rows.filter(row => !matches(row, where));
  if (deletionFailure === 'after-commit') throw Object.assign(new Error('synthetic lost acknowledgement'), { code: 'P1017' });
  return unique ? deleted[0] : { count: deleted.length };
}
const prisma = {
  user: { findUnique: async ({ where }) => where.id === user.id ? user : null },
  userWebAuthnCredential: { count: async () => 0 },
  draft: { delete: async ({ where }) => remove(where, true), deleteMany: async ({ where }) => remove(where, false),
    findUnique: async ({ where }) => {
      if (lookupFailure) throw new Error('synthetic absence check unavailable');
      return rows.find(row => matches(row, where)) || null;
    },
  },
};
class TestModule {}
Module({ imports: [PassportModule.register({ defaultStrategy: 'jwt' })], controllers: [DraftsController],
  providers: [DraftsService, JwtStrategy, { provide: PrismaService, useValue: prisma },
    { provide: APP_GUARD, useClass: JwtAuthGuard }],
})(TestModule);

before(async () => {
  app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('api'); app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  token = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: user.id, purpose: 'access' });
  web = loadWebDraftClient(base, () => token);
  stub = http.createServer((request, response) => {
    stubPaths.push(request.url);
    response.writeHead(stubStatus, { 'Content-Type': 'application/json' }); response.end(stubBody);
  });
  await new Promise(resolve => stub.listen(0, '127.0.0.1', resolve));
  stubBase = `http://127.0.0.1:${stub.address().port}`;
});
beforeEach(() => {
  rows = [{ id: 'own-source', userId: user.id, sourceFileId: 'source-A', templateId: null },
    { id: 'own-template', userId: user.id, templateId: 'template-A', sourceFileId: null },
    { id: 'other-source', userId: 'another-user', sourceFileId: 'source-A', templateId: null }];
  for (const row of rows) row.payload = { name: 'preserved', fields: [], rotation: 0, pageCount: 1 };
  deletionFailure = null; lookupFailure = false; deleteCalls = 0; stubStatus = 200; stubBody = '{}'; stubPaths = [];
});
after(async () => {
  await app?.close(); await new Promise(resolve => stub?.close(resolve));
  process.chdir(cwd); fs.rmSync(temporary, { recursive: true, force: true });
});
async function deletion(key, authenticated = true, preservedPayload) {
  const response = await fetch(base + '/api/drafts' + (preservedPayload ? '/if-unchanged' : '') + '?' + new URLSearchParams(key), {
    method: 'DELETE', headers: { ...(authenticated ? { Authorization: `Bearer ${token}` } : {}),
      ...(preservedPayload ? { 'Content-Type': 'application/json' } : {}) },
    body: preservedPayload ? JSON.stringify({ preservedPayload }) : undefined,
  });
  return { status: response.status, body: await response.json() };
}

for (const key of [{ sourceFileId: 'source-A' }, { templateId: 'template-A' }]) {
  test(`DELETE distinguishes a deleted row from established absence: ${Object.keys(key)[0]}`, async () => {
    assert.deepEqual({ ...await web.clearDraft(key) }, { cleared: true, outcome: 'deleted' });
    assert.deepEqual({ ...await web.clearDraft(key) }, { cleared: true, outcome: 'absent' });
    assert.equal(rows.some(row => row.id === 'other-source'), true);
  });
}
for (const code of ['P1001', 'P2025']) {
  test(`DELETE failure ${code} is never reported as absence or success`, async () => {
    deletionFailure = code;
    assert.equal((await deletion({ sourceFileId: 'source-A' })).status, 500);
    await assert.rejects(() => web.clearDraft({ sourceFileId: 'source-A' }));
    assert.equal(rows.length, 3);
  });
}
test('DELETE with lost commit acknowledgement is an error, only a successful retry establishes absence', async () => {
  deletionFailure = 'after-commit';
  const first = await deletion({ sourceFileId: 'source-A' });
  assert.equal(first.status, 500); assert.notEqual(first.body.cleared, true);
  deletionFailure = null;
  assert.deepEqual({ ...await web.clearDraft({ sourceFileId: 'source-A' }) }, { cleared: true, outcome: 'absent' });
});
test('DELETE without a key is rejected before touching Prisma', async () => {
  assert.equal((await deletion({})).status, 400); assert.equal(deleteCalls, 0);
  assert.equal((await deletion({}, true, rows[0].payload)).status, 400); assert.equal(deleteCalls, 0);
});
test('DELETE still requires an access JWT', async () => {
  assert.equal((await deletion({ sourceFileId: 'source-A' }, false)).status, 401); assert.equal(deleteCalls, 0);
  assert.equal((await deletion({ sourceFileId: 'source-A' }, false, rows[0].payload)).status, 401); assert.equal(deleteCalls, 0);
});
test('conditional DELETE requires its payload and never silently becomes unconditional', async () => {
  const response = await fetch(base + '/api/drafts/if-unchanged?sourceFileId=source-A', {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` },
  });
  assert.equal(response.status, 400); assert.equal(deleteCalls, 0); assert.equal(rows.length, 3);
});
test('conditional DELETE proves matching deletion and subsequent absence', async () => {
  const key = { sourceFileId: 'source-A' }, copy = structuredClone(rows[0].payload);
  assert.equal((await web.clearDraft(key, copy)).outcome, 'deleted');
  assert.equal((await web.clearDraft(key, copy)).outcome, 'absent');
});
test('conditional DELETE refuses a changed payload instead of claiming absence', async () => {
  const key = { sourceFileId: 'source-A' }, copy = structuredClone(rows[0].payload);
  rows[0].payload = { ...copy, name: 'newer old-key changes' };
  assert.equal((await deletion(key, true, copy)).status, 409);
  await assert.rejects(() => web.clearDraft(key, copy));
  assert.equal(rows[0].payload.name, 'newer old-key changes');
});
test('a failed absence lookup after conditional DELETE remains an error', async () => {
  const key = { sourceFileId: 'source-A' }, copy = { ...rows[0].payload, name: 'not current payload' };
  lookupFailure = true;
  assert.equal((await deletion(key, true, copy)).status, 500);
  await assert.rejects(() => web.clearDraft(key, copy)); assert.equal(rows.length, 3);
});
test('a backend without conditional deletion receives no fallback unconditional DELETE', async () => {
  stubStatus = 404; stubBody = '{"message":"route unavailable"}';
  await assert.rejects(() => loadWebDraftClient(stubBase, () => token).clearDraft({ sourceFileId: 'source-A' }, rows[0].payload));
  assert.deepEqual(stubPaths, ['/api/drafts/if-unchanged?sourceFileId=source-A']);
});
for (const [label, status, body] of [
  ['HTTP error', 500, '{"message":"synthetic failure"}'],
  ['HTTP 404', 404, '{"message":"not found"}'],
  ['legacy unproved success', 200, '{"cleared":true}'],
  ['invalid JSON', 200, 'invalid json'],
]) {
  test(`web clearDraft rejects ${label}`, async () => {
    stubStatus = status; stubBody = body;
    await assert.rejects(() => loadWebDraftClient(stubBase, () => token).clearDraft({ sourceFileId: 'source-A' }));
  });
}
