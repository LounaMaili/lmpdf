// Isolated HTTP app with real guards/controller/service and synthetic Prisma.
// Never mount real config, uploads or PostgreSQL. The web helper is read from
// this revision (mount its single file when using the API build-stage image).
require('reflect-metadata');
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory, APP_GUARD } = require('@nestjs/core');
const { PassportModule } = require('@nestjs/passport');
const { JwtService } = require('@nestjs/jwt');

const originalCwd = process.cwd();
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lmpdf-template-draft-'));
process.chdir(temporary);
Object.assign(process.env, { JWT_SECRET: 'synthetic-draft-test-secret-at-least-32-characters',
  AUTH_MODE: 'local', LDAP_ENABLED: 'false', MFA_POLICY: 'optional' });
const { DraftsController } = require('../dist/drafts/drafts.controller');
const { DraftsService } = require('../dist/drafts/drafts.service');
const { PrismaService } = require('../dist/prisma/prisma.service');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const { JwtAuthGuard } = require('../dist/auth/auth.guard');

const helper = process.env.TEMPLATE_DRAFT_HELPER_PATH || path.resolve(__dirname, '../../web/src/utils/preserveTemplateDraft.ts');
const exportsObject = {};
vm.runInNewContext(ts.transpileModule(fs.readFileSync(helper, 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText, { exports: exportsObject });
const { preserveTemplateDraft } = exportsObject;
const user = { id: 'synthetic-user', role: 'editor', isActive: true, authSource: 'local', mfaEnabled: false };
let app, base, token, rows, failWrite, deletes;
function find(where) {
  if (where.userId_templateId) return rows.find(r => r.userId === where.userId_templateId.userId && r.templateId === where.userId_templateId.templateId);
  if (where.userId_sourceFileId) return rows.find(r => r.userId === where.userId_sourceFileId.userId && r.sourceFileId === where.userId_sourceFileId.sourceFileId);
}
const prisma = {
  user: { findUnique: async ({ where }) => where.id === user.id ? user : null },
  userWebAuthnCredential: { count: async () => 0 },
  draft: {
    async upsert({ where, create, update }) {
      if (failWrite) throw new Error('synthetic database unavailable');
      const existing = find(where);
      const next = { ...(existing || { id: 'draft-' + rows.length, templateId: null, sourceFileId: null }), ...(existing ? update : create) };
      if (rows.some(r => r !== existing && r.userId === next.userId &&
        ((next.templateId && r.templateId === next.templateId) || (next.sourceFileId && r.sourceFileId === next.sourceFileId)))) {
        throw Object.assign(new Error('synthetic unique constraint'), { code: 'P2002' });
      }
      if (existing) Object.assign(existing, next); else rows.push(next);
      return next;
    },
    findUnique: async ({ where }) => find(where) || null,
    async delete({ where }) { deletes++; const row = find(where); rows = rows.filter(r => r !== row); return row; },
  },
};
class TestModule {}
Module({ imports: [PassportModule.register({ defaultStrategy: 'jwt' })], controllers: [DraftsController],
  providers: [DraftsService, JwtStrategy, { provide: PrismaService, useValue: prisma },
    { provide: APP_GUARD, useClass: JwtAuthGuard }],
})(TestModule);

before(async () => {
  app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
  await app.listen(0, '127.0.0.1'); base = await app.getUrl();
  token = new JwtService({ secret: process.env.JWT_SECRET }).sign({ sub: user.id, purpose: 'access' });
});
beforeEach(() => { rows = []; failWrite = false; deletes = 0; });
after(async () => { await app?.close(); process.chdir(originalCwd); fs.rmSync(temporary, { recursive: true, force: true }); });
const payload = { name: 'Synthetic filled copy', fields: [{ id: 'field-A', label: 'Synthetic', value: '<div>QA <strong>filled</strong></div>',
  x: 10, y: 20, w: 100, h: 30, type: 'text' }], rotation: 0, pageCount: 2 };
async function request(method, key, body, authenticated = true) {
  const response = await fetch(`${base}/api/drafts${method === 'PUT' ? '' : '?' + new URLSearchParams(key)}`, {
    method, headers: { ...(authenticated ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: response.status, body: await response.json() };
}
const put = key => request('PUT', key, { ...key, payload });
function transport(adopt = () => true) {
  return { sameSession: () => true, adopt,
    upsert: async (key, data) => {
      const result = await request('PUT', key, { ...key, payload: data });
      if (result.status !== 200) throw new Error('draft transfer refused');
    },
    clear: async key => { assert.equal((await request('DELETE', key)).status, 200); },
  };
}

test('HTTP reproduces the old combined-key rejection without deleting the source draft', async () => {
  assert.equal((await put({ sourceFileId: 'source-A' })).status, 200);
  assert.equal((await put({ templateId: 'new', sourceFileId: 'source-A' })).status, 500);
  assert.equal(rows.length, 1); assert.equal(deletes, 0);
});

test('HTTP corrected transfer preserves filled values under the new template and clears only its old source slot', async () => {
  await put({ sourceFileId: 'source-A' });
  const result = await preserveTemplateDraft('new', { key: { sourceFileId: 'source-A' }, revision: 1, payload }, transport());
  assert.equal(result.cleanupFailed, false);
  const saved = await request('GET', { templateId: 'new' });
  assert.equal(saved.status, 200); assert.equal(saved.body.draft.sourceFileId, null);
  assert.deepEqual(saved.body.draft.payload, payload);
  assert.equal((await request('GET', { sourceFileId: 'source-A' })).body.draft, null);
});

test('HTTP legacy template+source draft does not block a new independent template draft', async () => {
  await put({ templateId: 'old', sourceFileId: 'source-A' });
  await preserveTemplateDraft('new', { key: { templateId: 'old' }, revision: 2, payload }, transport());
  assert.equal((await request('GET', { templateId: 'old' })).body.draft, null);
  assert.equal((await request('GET', { templateId: 'new' })).body.draft.payload.fields[0].value, payload.fields[0].value);
});

test('HTTP write failure retains the previous working draft and never adopts the new context', async () => {
  await put({ sourceFileId: 'source-A' }); failWrite = true;
  await assert.rejects(preserveTemplateDraft('new', { key: { sourceFileId: 'source-A' }, revision: 3, payload },
    transport(() => assert.fail('must keep previous context'))), /transfer refused/);
  assert.equal(deletes, 0); assert.equal(rows.length, 1);
  assert.deepEqual((await request('GET', { sourceFileId: 'source-A' })).body.draft.payload, payload);
});

test('HTTP keeps both drafts when editing moved to a different document during preservation', async () => {
  await put({ sourceFileId: 'source-A' });
  const result = await preserveTemplateDraft('new', { key: { sourceFileId: 'source-A' }, revision: 4, payload }, transport(() => false));
  assert.equal(result.adopted, false); assert.equal(rows.length, 2); assert.equal(deletes, 0);
});

test('HTTP draft route still rejects an unauthenticated write', async () => {
  const result = await request('PUT', {}, { templateId: 'new', payload }, false);
  assert.equal(result.status, 401); assert.equal(rows.length, 0);
});
