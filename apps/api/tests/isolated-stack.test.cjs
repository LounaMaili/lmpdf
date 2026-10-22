require('reflect-metadata');
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const { deflateSync } = require('node:zlib');
const { setTimeout: delay } = require('node:timers/promises');
const { PrismaClient } = require('@prisma/client');
const { hashSync } = require('bcryptjs');
const { generateSync } = require('otplib');
const { encryptSecret } = require('../dist/auth/crypto.util');
const { writeAdminSettingsFile } = require('../dist/config/settings-file');
assert.equal(process.env.LMPDF_ISOLATED_STACK_TESTS, '1');
const url = new URL(process.env.DATABASE_URL || 'http://invalid');
assert.match(url.hostname, /^lmpdf-isolated-pg-\d+-\d+$/); assert.equal(url.pathname, '/lmpdf_validation');
const db = new PrismaClient();
const password = 'synthetic-stack-login-only';
const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const api = 'http://backend:3000/api';
async function request(route, { token, body, method } = {}) {
  const response = await fetch(`${api}/${route}`, { method: method ?? (body ? 'POST' : 'GET'),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}) });
  return { status: response.status, body: await response.json() };
}
async function login(name) {
  const first = await request('auth/login', { body: { email: `${name}@isolated.invalid`, password } });
  assert.equal(first.status, 201);
  if (first.body.mfaSetupRequired) return first.body;
  assert.equal(first.body.mfaRequired, true); assert.equal(first.body.token, undefined);
  const second = await request('auth/login/mfa-verify', { body: { mfaChallengeToken: first.body.mfaChallengeToken, code: generateSync({ secret }) } });
  assert.equal(second.status, 201); assert.equal(typeof second.body.token, 'string'); return second.body;
}
function png() {
  function chunk(name, data) {
    const type = Buffer.from(name), length = Buffer.alloc(4); length.writeUInt32BE(data.length);
    let checksum = 0xffffffff;
    for (const byte of Buffer.concat([type, data])) {
      checksum ^= byte;
      for (let bit = 0; bit < 8; bit++) checksum = (checksum >>> 1) ^ (checksum & 1 ? 0xedb88320 : 0);
    }
    const crc = Buffer.alloc(4); crc.writeUInt32BE((checksum ^ 0xffffffff) >>> 0);
    return Buffer.concat([length, type, data, crc]);
  }
  const header = Buffer.alloc(13); header.writeUInt32BE(200); header.writeUInt32BE(200, 4); header[8] = 8; header[9] = 2;
  const rows = Buffer.alloc(200 * 601, 255); for (let row = 0; row < 200; row++) rows[row * 601] = 0;
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

if (process.argv[2] === 'seed') {
  (async () => {
    for (const name of ['owner', 'editor', 'filler', 'pending-admin']) {
      await db.user.create({ data: { email: `${name}@isolated.invalid`, displayName: 'Synthetic stack user',
        passwordHash: hashSync(password, 4), role: name === 'pending-admin' ? 'admin' : 'editor',
        mfaEnabled: name !== 'pending-admin', mfaSecret: name === 'pending-admin' ? null : encryptSecret(secret) } });
    }
    await writeAdminSettingsFile({ auth: { mode: 'local' }, mfa: { policy: 'required' }, export: {
      enabled: true, allowedRoots: ['/exports'], destinations: [{ name: 'synthetic', enabled: true,
        rootPath: '/exports', pathTemplate: '', fileNameTemplate: '{templateName}', conflictStrategy: 'rename' }],
      rules: [{ label: 'canonical', enabled: true, destinationName: 'synthetic', templateNameContains: 'Trusted' }],
    } });
    console.log('Synthetic database and private admin config initialized');
  })().catch(() => { console.error('Synthetic seed failed'); process.exitCode = 1; }).finally(() => db.$disconnect());
} else {
  let owner, editor, filler, pending, documentId;
  before(async () => {
    for (const endpoint of [`${api}/health`, 'http://frontend/', 'http://vision:8001/health']) {
      let ready = false;
      for (let attempt = 0; attempt < 45; attempt++) {
        try { if ((await fetch(endpoint)).status === 200) { ready = true; break; } } catch {}
        await delay(500);
      }
      assert.equal(ready, true, `Isolated service unavailable: ${endpoint}`);
    }
    owner = (await login('owner')).token; editor = (await login('editor')).token; filler = (await login('filler')).token;
    pending = (await login('pending-admin')).mfaEnrollmentToken;
  });
  after(() => db.$disconnect());
  test('stack: frontend/nginx, API, PostgreSQL and Vision ready', async () => {
    assert.equal((await fetch('http://frontend/api/health')).status, 200);
    assert.equal((await request('auth/me', { token: owner })).status, 200);
    assert.equal((await db.user.count()), 4);
  });
  test('stack: config file required overrides optional env; pending admin denied', async () => {
    assert.equal(typeof pending, 'string');
    for (const route of ['admin/settings', 'templates', 'drafts']) assert.equal((await request(route, { token: pending })).status, 403);
    assert.equal((await request('auth/mfa/status', { token: pending })).body.policy, 'required');
  });
  test('stack: synthetic upload, authenticated read and owner/editor/filler roles', async () => {
    const form = new FormData(); form.append('file', new Blob([png()], { type: 'image/png' }), 'Trusted-synthetic.png');
    const upload = await fetch(`${api}/uploads/document`, { method: 'POST', headers: { Authorization: `Bearer ${owner}` }, body: form });
    assert.equal(upload.status, 201); documentId = (await upload.json()).id;
    const accounts = await db.user.findMany();
    for (const role of ['editor', 'filler']) await db.documentPermission.create({ data: {
      documentId, userId: accounts.find(u => u.email === `${role}@isolated.invalid`).id, docRole: role,
    } });
    assert.equal((await fetch(`${api}/uploads/file/${documentId}`, { headers: { Authorization: `Bearer ${filler}` } })).status, 200);
    for (const [token, expected] of [[owner, 201], [editor, 201], [filler, 403]]) {
      const result = await request('templates', { token, body: { name: 'Trusted synthetic template', sourceFileId: documentId, fields: [] } });
      assert.equal(result.status, expected);
    }
  });
  test('stack: canonical export rules, safe output name, real file and filler refusal', async () => {
    const context = { sourceFileId: documentId, outputFileName: 'UserChoice.png' };
    const resolved = await request('export/resolve', { token: owner, body: context });
    assert.equal(resolved.status, 201); assert.equal(resolved.body.ruleLabelMatched, 'canonical');
    assert.equal(resolved.body.resolvedFileName, 'UserChoice.pdf');
    const bytes = '%PDF-synthetic-stack';
    for (const [token, expected] of [[owner, 201], [filler, 403]]) {
      const form = new FormData(); form.append('sourceFileId', documentId); form.append('outputFileName', 'UserChoice.png');
      form.append('file', new Blob([bytes]), 'synthetic.pdf');
      const response = await fetch(`${api}/export/run`, { method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form });
      assert.equal(response.status, expected);
    }
    assert.deepEqual(fs.readdirSync('/exports'), ['UserChoice.pdf']); assert.equal(fs.readFileSync('/exports/UserChoice.pdf', 'utf8'), bytes);
  });
  test('stack: API to Vision reads the shared synthetic image', async () => {
    const result = await request('detect', { token: owner, body: { documentId } });
    assert.equal(result.status, 201); assert.equal(result.body.error, undefined);
    assert.equal(Array.isArray(result.body.suggestedFields), true);
  });
  test('stack: nginx refuses a 31 MiB envelope before accepting a body', async () => {
    const status = await new Promise((resolve, reject) => {
      const req = http.request('http://frontend/api/export/run', { method: 'POST', headers: {
        Authorization: `Bearer ${owner}`, 'Content-Type': 'multipart/form-data; boundary=synthetic', 'Content-Length': 31 * 1024 * 1024,
      } }, res => { res.resume(); res.on('end', () => { resolve(res.statusCode); req.destroy(); }); });
      req.on('error', reject); req.flushHeaders();
    });
    assert.equal(status, 413);
  });
  test('stack: actual enrollment, new MFA login and admin permission override', async () => {
    const enrolled = await request('auth/mfa/confirm', { token: pending, body: { secret, token: generateSync({ secret }) } });
    assert.equal(enrolled.status, 201); assert.equal(enrolled.body.token, undefined);
    assert.equal((await request('admin/settings', { token: pending })).status, 401);
    const admin = (await login('pending-admin')).token;
    assert.equal((await request('admin/settings', { token: admin })).status, 200);
    const changed = await request('admin/settings', { token: admin, method: 'PATCH', body: { permissions: { editor: { exportPdf: false } } } });
    assert.equal(changed.status, 200);
    assert.equal((await request('export/resolve', { token: owner, body: { sourceFileId: documentId } })).status, 403);
  });
}
