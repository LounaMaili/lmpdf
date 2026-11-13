const { test, before, beforeEach, after, mock } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { Writable } = require('node:stream');
const { setTimeout: delay } = require('node:timers/promises');
require('reflect-metadata');
const originalCwd = process.cwd();
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lmpdf-upload-lifecycle-'));
process.chdir(root);
fs.mkdirSync('config'); fs.mkdirSync('uploads');
const { Module, Logger } = require('@nestjs/common');
const { NestFactory, APP_GUARD } = require('@nestjs/core');
const { PassportModule } = require('@nestjs/passport');
const { JwtService } = require('@nestjs/jwt');
const { finalize } = require('rxjs');
const { UploadController } = require('../dist/upload/upload.controller');
const { JwtAuthGuard } = require('../dist/auth/auth.guard');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const { PrismaService } = require('../dist/prisma/prisma.service');

// Never mount the application uploads volume or real config when running this suite.
// PDF/PNG bytes exercise the existing signature contract, not full format decoding.
const maxBytes = 25 * 1024 * 1024;
const pdf = Buffer.from('%PDF-1.7\nsynthetic upload only\n');
const existing = path.resolve('uploads/existing-synthetic.pdf');
const sentinel = Buffer.from('Synthetic existing document: must survive every failure');
const actors = {
  admin: { id: 'synthetic-admin', role: 'admin', isActive: true, authSource: 'local' },
  editor: { id: 'synthetic-editor', role: 'editor', isActive: true, authSource: 'local' },
  viewer: { id: 'synthetic-viewer', role: 'viewer', isActive: true, authSource: 'local' },
};
let app, base, signer, records, creates, create;
const completions = new Map();
const prisma = {
  user: { findUnique: async ({ where }) => Object.values(actors).find(u => u.id === where.id) ?? null },
  userWebAuthnCredential: { count: async () => 0 },
  document: {
    create: async args => { creates++; return create(args); },
    findUnique: async ({ where }) => records.find(r => r.id === where.id) ?? null,
  },
};
class UploadTestModule {}
Module({ imports: [PassportModule.register({ defaultStrategy: 'jwt' })], controllers: [UploadController],
  providers: [JwtStrategy, { provide: PrismaService, useValue: prisma }, { provide: APP_GUARD, useClass: JwtAuthGuard }],
})(UploadTestModule);
function settings(permissions = {}) {
  fs.writeFileSync('config/admin-settings.json', JSON.stringify({ auth: { mode: 'local' }, mfa: { policy: 'optional' }, permissions }));
}
function persist({ data }) {
  const record = { id: `synthetic-document-${records.length}`, ...data };
  records.push(record); return record;
}
function rejectedInsert() { return Object.assign(new Error('synthetic rejected insert'), { code: 'P2003' }); }
function token(role = 'editor', claims = {}) {
  return signer.sign({ sub: actors[role].id, purpose: 'access', ...claims });
}
function body(bytes = pdf, options = {}) {
  const form = new FormData();
  form.append(options.field ?? 'file', new Blob([bytes], { type: options.mime ?? 'application/pdf' }), options.name ?? 'synthetic.pdf');
  if (options.secondFile) form.append('file', new Blob([pdf]), 'synthetic-second.pdf');
  return form;
}
async function upload({ form = body(), role = 'editor', jwt = token(role), headers = {} } = {}) {
  const response = await fetch(`${base}/api/uploads/document`, { method: 'POST', headers: { ...(jwt ? { Authorization: `Bearer ${jwt}` } : {}), ...headers }, body: form });
  return { status: response.status, body: await response.json() };
}
const files = () => fs.readdirSync('uploads').filter(f => f !== path.basename(existing)).sort();
function untouched() { assert.deepEqual(fs.readFileSync(existing), sentinel); }
function empty() { untouched(); assert.deepEqual(files(), []); assert.equal(records.length, 0); }
function deferred() {
  let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve };
}
async function eventually(predicate, message) {
  const deadline = Date.now() + 1500;
  while (!predicate() && Date.now() < deadline) await delay(10);
  assert.ok(predicate(), message);
}
function rawRequest(marker = 'synthetic') {
  completions.set(marker, deferred());
  const request = http.request(`${base}/api/uploads/document`, { method: 'POST', headers: {
    Authorization: `Bearer ${token()}`, 'Content-Type': 'multipart/form-data; boundary=synthetic', 'x-synthetic-request': marker,
  } });
  request.on('error', () => {}); return request;
}
const rawBody = Buffer.concat([Buffer.from('--synthetic\r\nContent-Disposition: form-data; name="file"; filename="synthetic.pdf"\r\nContent-Type: application/pdf\r\n\r\n'), pdf, Buffer.from('\r\n--synthetic--\r\n')]);
function observeDisconnect(marker) {
  const closed = deferred();
  const observe = (req, res) => { if (req.headers['x-synthetic-request'] === marker) res.once('close', closed.resolve); };
  app.getHttpServer().on('request', observe);
  return { promise: closed.promise, stop: () => app.getHttpServer().removeListener('request', observe) };
}
before(async () => {
  process.env.JWT_SECRET = 'synthetic-upload-only-secret-at-least-32-characters';
  signer = new JwtService({ secret: process.env.JWT_SECRET });
  app = await NestFactory.create(UploadTestModule, { logger: false });
  app.useGlobalInterceptors({ intercept(context, next) {
    const marker = context.switchToHttp().getRequest().headers['x-synthetic-request'];
    return next.handle().pipe(finalize(() => completions.get(marker)?.resolve()));
  } });
  app.setGlobalPrefix('api'); await app.listen(0, '127.0.0.1'); base = await app.getUrl();
});
beforeEach(() => {
  mock.restoreAll(); completions.clear(); records = []; creates = 0; create = persist;
  settings(); fs.rmSync('uploads', { recursive: true, force: true }); fs.mkdirSync('uploads'); fs.writeFileSync(existing, sentinel);
});
after(async () => {
  mock.restoreAll(); await app?.close(); process.chdir(originalCwd); fs.rmSync(root, { recursive: true, force: true });
});

test('HTTP: anonymous request rejected before any disk write', async () => {
  const write = mock.method(fs, 'createWriteStream');
  assert.equal((await upload({ jwt: null })).status, 401); assert.equal(write.mock.callCount(), 0); empty();
});
test('HTTP: viewer denied before disk storage, repeated denials do not accumulate files', async () => {
  const write = mock.method(fs, 'createWriteStream'); const statuses = [];
  for (let i = 0; i < 4; i++) statuses.push((await upload({ role: 'viewer', form: body(Buffer.alloc(64 * 1024, 65)) })).status);
  assert.deepEqual(statuses, [403, 403, 403, 403]); assert.equal(creates, 0);
  assert.equal(write.mock.callCount(), 0, 'a denied request must not open a file'); empty();
});
for (const role of ['admin', 'editor']) test(`HTTP: global upload override denies ${role} before writing`, async () => {
  settings({ [role]: { uploadDocument: false } });
  const write = mock.method(fs, 'createWriteStream');
  assert.equal((await upload({ role })).status, 403); assert.equal(write.mock.callCount(), 0); empty();
});
for (const role of ['admin', 'editor']) test(`HTTP: ${role} upload commits one file and its metadata`, async () => {
  const result = await upload({ role }); assert.equal(result.status, 201); assert.equal(creates, 1);
  assert.equal(records.length, 1); assert.equal(records[0].ownerId, actors[role].id); assert.equal(result.body.id, records[0].id);
  assert.equal(records[0].mimeType, 'application/pdf'); assert.deepEqual(files(), [records[0].path]);
  assert.deepEqual(fs.readFileSync(path.join('uploads', records[0].path)), pdf);
  assert.equal(fs.statSync(path.join('uploads', records[0].path)).mode & 0o777, 0o600); untouched();
});
test('HTTP: an explicit viewer override is respected, no hard-coded role list', async () => {
  settings({ viewer: { uploadDocument: true } }); assert.equal((await upload({ role: 'viewer' })).status, 201); assert.equal(records.length, 1); untouched();
});
test('HTTP: a challenge JWT cannot upload and never opens disk storage', async () => {
  const write = mock.method(fs, 'createWriteStream');
  assert.equal((await upload({ jwt: token('admin', { purpose: 'mfa-challenge', mfaChallenge: true }) })).status, 401);
  assert.equal(write.mock.callCount(), 0); empty();
});
for (const [name, bytes, mime] of [['bad signature', Buffer.from('synthetic-not-a-pdf'), 'application/pdf'], ['SVG', pdf, 'image/svg+xml']]) {
  test(`HTTP: ${name} rejected and received file removed`, async () => { assert.equal((await upload({ form: body(bytes, { mime }) })).status, 400); assert.equal(creates, 0); empty(); });
}
test('HTTP: detected MIME determines extension, client filename cannot choose a path', async () => {
  const png = Buffer.from('89504e470d0a1a0a', 'hex');
  const result = await upload({ form: body(png, { name: '../../outside.pdf', mime: 'application/pdf' }) });
  assert.equal(result.status, 201); assert.equal(records[0].mimeType, 'image/png');
  assert.match(records[0].path, /^[a-f0-9-]+\.png$/); assert.deepEqual(fs.readFileSync(path.join('uploads', records[0].path)), png); untouched();
});
test('HTTP: missing file rejected without touching existing documents', async () => {
  assert.equal((await upload({ form: new FormData() })).status, 400); assert.equal(creates, 0); empty();
});
test('HTTP: second file rejected and first uncommitted file removed', async () => {
  assert.equal((await upload({ form: body(pdf, { secondFile: true }) })).status, 400); assert.equal(creates, 0); empty();
});
test('HTTP: declared size exceeded (25 MiB + 1) cleans storage and creates no row', async () => {
  const bytes = Buffer.alloc(maxBytes + 1, 65); bytes.write('%PDF-');
  assert.equal((await upload({ form: body(bytes) })).status, 413); assert.equal(creates, 0); empty();
});
test('HTTP: database rejection after receipt removes the promoted file', async () => {
  create = async () => { throw rejectedInsert(); };
  assert.equal((await upload()).status, 500); assert.equal(creates, 1); empty();
});
test('HTTP: definite P2003 rejection cleans its file even when reconciliation reads would fail', async () => {
  create = async () => { throw rejectedInsert(); };
  const lookup = mock.method(prisma.document, 'findUnique', async () => { throw new Error('synthetic read unavailable'); });
  const logged = mock.method(Logger.prototype, 'error', () => {});
  assert.equal((await upload()).status, 500); assert.equal(creates, 1); empty();
  assert.equal(lookup.mock.callCount(), 0, 'a definite rejection needs no reconciliation read');
  assert.equal(logged.mock.callCount(), 0, 'no indeterminate-outcome signal for a definite rejection');
});
test('HTTP: read failure after receipt cleans only the current file', async () => {
  for (const method of ['readFile', 'open']) {
    const original = fs.promises[method].bind(fs.promises);
    mock.method(fs.promises, method, async (name, ...args) => {
      if (String(name).endsWith('.bin')) throw Object.assign(new Error('synthetic read failure'), { code: 'EIO' });
      return original(name, ...args);
    });
  }
  assert.equal((await upload()).status, 500); assert.equal(creates, 0); empty();
});
test('HTTP: promotion failure cleans the temporary file without deleting a preexisting target', async () => {
  for (const method of ['rename', 'link']) mock.method(fs.promises, method, async () => { throw Object.assign(new Error('synthetic promotion failure'), { code: 'EACCES' }); });
  assert.equal((await upload()).status, 500); assert.equal(creates, 0); empty();
});
test('HTTP: ENOSPC during streaming removes a partially written file', async () => {
  const original = fs.createWriteStream.bind(fs);
  mock.method(fs, 'createWriteStream', (name, options) => {
    const output = original(name, options); const sink = new Writable({
      write(chunk, encoding, callback) { output.write(chunk.subarray(0, 8), encoding, () => callback(Object.assign(new Error('synthetic disk full'), { code: 'ENOSPC' }))); },
      destroy(error, callback) { output.destroy(); output.once('close', () => callback(error)); },
    });
    output.once('open', fd => sink.emit('open', fd)); output.on('error', () => {});
    return sink;
  });
  assert.equal((await upload()).status, 500); assert.equal(creates, 0); empty();
});
test('HTTP: abort during reception leaves no partial file and no database row', { timeout: 6000 }, async () => {
  const opened = deferred(), original = fs.createWriteStream.bind(fs);
  mock.method(fs, 'createWriteStream', (...args) => { const stream = original(...args); stream.once('open', opened.resolve); return stream; });
  const observed = observeDisconnect('stream-abort'), client = rawRequest('stream-abort');
  try {
    client.write(rawBody.subarray(0, rawBody.length - 19)); await opened.promise;
    client.destroy(); await observed.promise; await completions.get('stream-abort').promise;
    await eventually(() => files().length === 0, 'partial upload must be removed after disconnect'); assert.equal(creates, 0); empty();
  } finally { client.destroy(); observed.stop(); }
});
test('HTTP: complete body then disconnect during validation must not create metadata', { timeout: 6000 }, async () => {
  const reached = deferred(), release = deferred();
  for (const method of ['readFile', 'open']) {
    const original = fs.promises[method].bind(fs.promises);
    mock.method(fs.promises, method, async (name, ...args) => {
      if (String(name).endsWith('.bin')) { reached.resolve(); await release.promise; }
      return original(name, ...args);
    });
  }
  const observed = observeDisconnect('validation-abort'), client = rawRequest('validation-abort');
  try {
    client.end(rawBody); await reached.promise; client.destroy(); await observed.promise; release.resolve(); await completions.get('validation-abort').promise;
    await eventually(() => files().length === 0, 'uncommitted file must be removed after late disconnect'); assert.equal(creates, 0); empty();
  } finally { release.resolve(); client.destroy(); observed.stop(); }
});
for (const succeeds of [false, true]) test(`HTTP: disconnect during pending database write (${succeeds ? 'commit' : 'rejection'})`, { timeout: 6000 }, async () => {
  const reached = deferred(), release = deferred(), settled = deferred();
  create = async args => {
    reached.resolve(); await release.promise;
    try { if (!succeeds) throw rejectedInsert(); return persist(args); }
    finally { settled.resolve(); }
  };
  const observed = observeDisconnect('database-abort'), client = rawRequest('database-abort');
  try {
    client.end(rawBody); await reached.promise; client.destroy(); await observed.promise; release.resolve(); await settled.promise; await completions.get('database-abort').promise;
    if (succeeds) {
      assert.equal(records.length, 1); assert.deepEqual(files(), [records[0].path]); assert.deepEqual(fs.readFileSync(path.join('uploads', records[0].path)), pdf); untouched();
    } else { await eventually(() => files().length === 0, 'database rejection must remove its file after disconnect'); empty(); }
  } finally { release.resolve(); client.destroy(); observed.stop(); }
});
test('HTTP: one failed concurrent upload cannot delete a successful upload or existing file', async () => {
  create = args => args.data.originalName === 'rejected.pdf' ? Promise.reject(rejectedInsert()) : persist(args);
  const results = await Promise.all([upload({ form: body(pdf, { name: 'accepted.pdf' }) }), upload({ form: body(pdf, { name: 'rejected.pdf' }) })]);
  assert.deepEqual(results.map(r => r.status), [201, 500]); assert.equal(records.length, 1); assert.deepEqual(files(), [records[0].path]); untouched();
});

test('HTTP: invalid JWT signature cannot open disk storage', async () => {
  const jwt = new JwtService({ secret: 'synthetic-incorrect-signature-only' }).sign({ sub: actors.admin.id, purpose: 'access' });
  const write = mock.method(fs, 'createWriteStream');
  assert.equal((await upload({ jwt })).status, 401); assert.equal(write.mock.callCount(), 0); empty();
});
test('HTTP: disabled account cannot open disk storage', async () => {
  actors.editor.isActive = false;
  try {
    const write = mock.method(fs, 'createWriteStream');
    assert.equal((await upload()).status, 401); assert.equal(write.mock.callCount(), 0); empty();
  } finally { actors.editor.isActive = true; }
});
test('HTTP: mandatory MFA enrollment cannot upload, including an admin', async () => {
  fs.writeFileSync('config/admin-settings.json', JSON.stringify({ auth: { mode: 'local' }, mfa: { policy: 'required' } }));
  const write = mock.method(fs, 'createWriteStream');
  assert.equal((await upload({ jwt: token('admin', { purpose: 'mfa-enrollment', mfaEnrollment: true }) })).status, 403);
  assert.equal(write.mock.callCount(), 0); empty();
});
test('HTTP: upload permission revoked while receiving the body is rechecked', { timeout: 6000 }, async () => {
  const opened = deferred(), original = fs.createWriteStream.bind(fs);
  mock.method(fs, 'createWriteStream', (...args) => { const stream = original(...args); stream.once('open', opened.resolve); return stream; });
  const client = rawRequest('revoked');
  const response = new Promise((resolve, reject) => { client.once('response', res => { res.resume(); res.once('end', () => resolve(res.statusCode)); }); client.once('error', reject); });
  try {
    const end = rawBody.length - 19;
    client.write(rawBody.subarray(0, end)); await opened.promise; settings({ editor: { uploadDocument: false } });
    client.end(rawBody.subarray(end)); assert.equal(await response, 403); assert.equal(creates, 0); empty();
  } finally { client.destroy(); }
});
test('HTTP: exactly 25 MiB accepted and committed without a leftover temporary link', async () => {
  const bytes = Buffer.alloc(maxBytes, 65); bytes.write('%PDF-');
  assert.equal((await upload({ form: body(bytes) })).status, 201); assert.equal(records[0].size, maxBytes);
  assert.deepEqual(files(), [records[0].path]); assert.equal(fs.statSync(path.join('uploads', records[0].path)).nlink, 1); untouched();
});
test('HTTP: an unexpected file field is rejected without disk output', async () => {
  const write = mock.method(fs, 'createWriteStream');
  assert.equal((await upload({ form: body(pdf, { field: 'unexpected' }) })).status, 400);
  assert.equal(write.mock.callCount(), 0); empty();
});
test('HTTP: missing multipart boundary is a controlled 400 with no output', async () => {
  const response = await fetch(`${base}/api/uploads/document`, { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'multipart/form-data' }, body: pdf });
  assert.equal(response.status, 400); assert.equal(creates, 0); empty();
});
test('HTTP: truncated multipart body is a controlled 400 and leaves no partial file', { timeout: 6000 }, async () => {
  const response = await fetch(`${base}/api/uploads/document`, { method: 'POST', headers: { Authorization: `Bearer ${token()}`, 'Content-Type': 'multipart/form-data; boundary=synthetic' }, body: rawBody.subarray(0, rawBody.length - 17) });
  assert.equal(response.status, 400); assert.equal(creates, 0); empty();
});
test('HTTP: multipart field bytes and count are bounded, cleanup includes the first file', async () => {
  for (const many of [false, true]) {
    const form = body();
    if (many) for (let i = 0; i < 9; i++) form.append(`synthetic-${i}`, 'x');
    else form.append('synthetic', 'x'.repeat(1025));
    assert.equal((await upload({ form })).status, 400); assert.equal(creates, 0); empty();
  }
});
for (const extension of ['bin', 'pdf']) test(`HTTP: existing UUID.${extension} never overwritten on collision`, async () => {
  const id = '44444444-4444-4444-8444-444444444444', name = `${id}.${extension}`;
  fs.writeFileSync(path.join('uploads', name), sentinel);
  mock.method(require('node:crypto'), 'randomUUID', () => id);
  assert.equal((await upload()).status, 500); assert.equal(creates, 0); assert.equal(records.length, 0);
  assert.deepEqual(files(), [name]); assert.deepEqual(fs.readFileSync(path.join('uploads', name)), sentinel); untouched();
});
test('HTTP: a failure delivering committed metadata does not delete the committed file', async () => {
  create = args => { const record = persist(args); return { ...record, get originalName() { throw new Error('synthetic response failure'); } }; };
  assert.equal((await upload()).status, 500); assert.equal(records.length, 1);
  assert.deepEqual(files(), [records[0].path]); assert.deepEqual(fs.readFileSync(path.join('uploads', records[0].path)), pdf); untouched();
});
test('HTTP: persistent unlink failure is reported, never silently treated as cleanup success', async () => {
  create = async () => { throw rejectedInsert(); };
  const unlink = fs.promises.unlink.bind(fs.promises), logged = mock.method(Logger.prototype, 'error', () => {});
  mock.method(fs.promises, 'unlink', async name => {
    if (String(name).endsWith('.pdf')) throw Object.assign(new Error('synthetic cleanup denial'), { code: 'EACCES' });
    return unlink(name);
  });
  assert.equal((await upload()).status, 500); assert.equal(records.length, 0);
  assert.equal(files().length, 1); assert.ok(logged.mock.callCount() > 0); untouched();
});
test('HTTP: authorized upload initializes a missing uploads directory', async () => {
  fs.rmSync('uploads', { recursive: true });
  assert.equal((await upload()).status, 201); assert.equal(records.length, 1);
  assert.deepEqual(fs.readdirSync('uploads'), [records[0].path]);
});
test('HTTP: lost insert acknowledgement is reconciled by server ID, file and owner', async () => {
  create = args => { persist(args); throw Object.assign(new Error('synthetic lost acknowledgement'), { code: 'P1017' }); };
  const result = await upload();
  assert.equal(result.status, 201); assert.equal(creates, 1); assert.equal(records.length, 1);
  assert.equal(result.body.id, records[0].id); assert.deepEqual(files(), [records[0].path]);
  assert.deepEqual(fs.readFileSync(path.join('uploads', records[0].path)), pdf); untouched();
});
test('HTTP: unresolved database outcome is retained and reported, never blindly unlinked', async () => {
  create = () => { throw Object.assign(new Error('synthetic connection lost'), { code: 'P1001' }); };
  mock.method(prisma.document, 'findUnique', async () => { throw new Error('synthetic database still unavailable'); });
  const logged = mock.method(Logger.prototype, 'error', () => {});
  assert.equal((await upload()).status, 500); assert.equal(creates, 1); assert.equal(records.length, 0);
  assert.equal(files().length, 1); assert.match(files()[0], /\.pdf$/); assert.ok(logged.mock.callCount() > 0); untouched();
});
for (const mismatch of ['owner', 'path']) test(`HTTP: another record's ${mismatch} cannot confirm this upload`, async () => {
  create = async () => { throw rejectedInsert(); };
  mock.method(prisma.document, 'findUnique', async ({ where }) => ({ id: where.id,
    ownerId: mismatch === 'owner' ? 'another-synthetic-user' : actors.editor.id,
    path: mismatch === 'path' ? 'another-synthetic-file.pdf' : `${where.id}.pdf`,
  }));
  assert.equal((await upload()).status, 500); assert.equal(creates, 1); empty();
});
test('HTTP: a temporarily absent row after connection loss cannot justify deleting a late commit', async () => {
  let pending;
  create = args => { pending = args; throw Object.assign(new Error('synthetic connection lost while committing'), { code: 'P1017' }); };
  const logged = mock.method(Logger.prototype, 'error', () => {});
  assert.equal((await upload()).status, 500); assert.equal(records.length, 0);
  assert.deepEqual(files(), [pending.data.path]); assert.ok(logged.mock.callCount() > 0);
  persist(pending);
  assert.deepEqual(files(), [records[0].path]);
  assert.deepEqual(fs.readFileSync(path.join('uploads', records[0].path)), pdf); untouched();
});
