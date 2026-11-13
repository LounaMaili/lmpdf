// Debian-only HTTP integration against a disposable PostgreSQL/API/Vision stack.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { deflateSync } = require('node:zlib');
const { setTimeout: delay } = require('node:timers/promises');
const { PrismaClient } = require('@prisma/client');
const { hashSync } = require('bcryptjs');
const { generateSync } = require('otplib');
const { encryptSecret } = require('../dist/auth/crypto.util');

assert.equal(process.env.LMPDF_ISOLATED_UPLOAD_TESTS, '1');
const database = new URL(process.env.DATABASE_URL || 'http://invalid');
assert.match(database.hostname, /^lmpdf-upload-pg-\d+-\d+$/);
assert.equal(database.pathname, '/lmpdf_upload_validation');
const db = new PrismaClient();
const api = 'http://backend:3000/api';
const password = 'synthetic-upload-login-only';
const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function request(route, { token, body } = {}) {
  const response = await fetch(`${api}/${route}`, {
    method: body ? 'POST' : 'GET', signal: AbortSignal.timeout(30000),
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
async function login(name) {
  const first = await request('auth/login', { body: { email: `${name}@upload-test.invalid`, password } });
  assert.equal(first.status, 201); assert.equal(first.body.mfaRequired, true);
  assert.equal(first.body.token, undefined);
  const second = await request('auth/login/mfa-verify', {
    body: { mfaChallengeToken: first.body.mfaChallengeToken, code: generateSync({ secret }) },
  });
  assert.equal(second.status, 201); assert.equal(typeof second.body.token, 'string');
  return { token: second.body.token, id: second.body.user.id };
}
function multipart(bytes, name, mime) {
  const form = new FormData(); form.append('file', new Blob([bytes], { type: mime }), name); return form;
}
async function upload(actor, bytes, name, mime) {
  const response = await fetch(`${api}/uploads/document`, { method: 'POST', signal: AbortSignal.timeout(30000),
    headers: { Authorization: `Bearer ${actor.token}` }, body: multipart(bytes, name, mime) });
  return { status: response.status, body: await response.json() };
}

// Valid formats, generated without adding a PDF/image dependency.
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
  const rows = Buffer.alloc(200 * 601, 255);
  for (let y = 0; y < 200; y++) {
    rows[y * 601] = 0;
    for (let x = 20; x <= 180; x++) if ([40, 80, 120, 160].includes(y) || ((x === 20 || x === 180) && y >= 40 && y <= 160)) {
      rows.fill(0, y * 601 + 1 + x * 3, y * 601 + 4 + x * 3);
    }
  }
  return Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
function pdf() {
  const stream = '1 w\n20 40 160 120 re S\n20 80 m 180 80 l S\n20 120 m 180 120 l S\n';
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Resources << >> /Contents 4 0 R >>',
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}endstream`];
  let output = '%PDF-1.4\n'; const offsets = [0];
  objects.forEach((object, index) => { offsets.push(Buffer.byteLength(output)); output += `${index + 1} 0 obj\n${object}\nendobj\n`; });
  const xref = Buffer.byteLength(output);
  output += `xref\n0 ${offsets.length}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, '0')} 00000 n \n`;
  return Buffer.from(output + `trailer\n<< /Size ${offsets.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
}

if (process.argv[2] === 'seed') {
  (async () => {
    assert.equal(await db.user.count(), 0, 'only an empty disposable database may be seeded');
    for (const name of ['owner', 'outsider', 'viewer']) await db.user.create({ data: {
      email: `${name}@upload-test.invalid`, displayName: 'Synthetic upload integration',
      role: name === 'viewer' ? 'viewer' : 'editor', passwordHash: hashSync(password, 4),
      authSource: 'local', mfaEnabled: true, mfaSecret: encryptSecret(secret),
    } });
    console.log('Synthetic upload users initialized; TOTP enabled');
  })().catch(() => { console.error('Disposable upload seed failed'); process.exitCode = 1; }).finally(() => db.$disconnect());
} else {
  let owner, outsider, viewer;
  const documents = [];
  before(async () => {
    for (const endpoint of [`${api}/health`, 'http://vision:8001/health']) {
      let ready = false;
      for (let attempt = 0; attempt < 45; attempt++) {
        try { if ((await fetch(endpoint, { signal: AbortSignal.timeout(1000) })).status === 200) { ready = true; break; } } catch {}
        await delay(500);
      }
      assert.equal(ready, true, 'Disposable API/Vision unavailable');
    }
    owner = await login('owner'); outsider = await login('outsider'); viewer = await login('viewer');
  });
  after(async () => {
    fs.writeFileSync('/validation/results/manifest.json', JSON.stringify(documents));
    await db.$disconnect();
  });
  for (const [extension, mime, fixture] of [['png', 'image/png', png], ['pdf', 'application/pdf', pdf]]) {
    test(`integration: ${extension} upload -> PostgreSQL -> authenticated read -> Vision, file stays 0600`, { timeout: 60000 }, async () => {
      const bytes = fixture(), name = `synthetic-upload.${extension}`;
      const received = await upload(owner, bytes, name, mime);
      assert.equal(received.status, 201);
      const record = await db.document.findUniqueOrThrow({ where: { id: received.body.id } });
      assert.equal(record.ownerId, owner.id); assert.equal(record.mimeType, mime);
      assert.equal(record.originalName, name); assert.equal(record.size, bytes.length);
      assert.equal(record.path, `${record.id}.${extension}`);
      const filename = path.join('/validation/uploads', record.path), stat = fs.statSync(filename);
      assert.equal(stat.mode & 0o777, 0o600); assert.equal(stat.uid, Number(process.env.UPLOAD_OWNER_UID));
      assert.equal(stat.gid, Number(process.env.UPLOAD_OWNER_GID)); assert.equal(stat.nlink, 1);
      assert.equal(digest(fs.readFileSync(filename)), digest(bytes));
      const metadata = await request(`uploads/${record.id}`, { token: owner.token });
      assert.equal(metadata.status, 200); assert.equal(metadata.body.path, record.path);
      const read = await fetch(`http://backend:3000${received.body.url}`, { headers: { Authorization: `Bearer ${owner.token}` } });
      assert.equal(read.status, 200); assert.equal(digest(Buffer.from(await read.arrayBuffer())), digest(bytes));
      const detected = await request('detect', { token: owner.token, body: { documentId: record.id } });
      assert.equal(detected.status, 201); assert.equal(detected.body.error, undefined);
      assert.equal(detected.body.inputDocument.id, record.id);
      assert.equal(Array.isArray(detected.body.suggestedFields), true);
      documents.push({ path: record.path, sha256: digest(bytes) });
    });
  }
  test('integration: unshared documents reject another editor and an anonymous reader', async () => {
    assert.equal(documents.length, 2);
    for (const document of await db.document.findMany()) {
      for (const route of [`uploads/${document.id}`, `uploads/file/${document.id}`]) {
        const response = await fetch(`${api}/${route}`, { headers: { Authorization: `Bearer ${outsider.token}` } });
        assert.equal(response.status, 403);
      }
      assert.equal((await request('detect', { token: outsider.token, body: { documentId: document.id } })).status, 403);
      assert.equal((await fetch(`${api}/uploads/file/${document.id}`)).status, 401);
    }
  });
  test('integration: permission and signature refusals leave neither extra rows nor files', async () => {
    assert.equal((await upload(viewer, png(), 'synthetic-denied.png', 'image/png')).status, 403);
    assert.equal((await upload(owner, Buffer.from('synthetic invalid format'), 'synthetic-invalid.pdf', 'application/pdf')).status, 400);
    assert.equal(await db.document.count(), 2);
    assert.deepEqual(fs.readdirSync('/validation/uploads').sort(), documents.map(d => d.path).sort());
  });
}
