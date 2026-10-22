require('reflect-metadata');
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, generateKeyPairSync, createHash } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { PrismaClient } = require('@prisma/client');
const { generateSync } = require('otplib');
const { Logger } = require('@nestjs/common');
const { completeFirstEnrollment } = require('../dist/auth/mfa-enrollment');
const { MfaService } = require('../dist/auth/mfa.service');
const { WebAuthnService } = require('../dist/auth/webauthn.service');
const { decryptSecret } = require('../dist/auth/crypto.util');

// Fail closed rather than accidentally exercising a supplied real DATABASE_URL.
const url = new URL(process.env.DATABASE_URL || 'http://invalid');
assert.equal(process.env.LMPDF_ISOLATED_POSTGRES_TESTS, '1');
assert.match(url.hostname, /^lmpdf-isolated-pg-\d+-\d+$/);
assert.equal(url.pathname, '/lmpdf_validation');
assert.equal(url.username, 'lmpdf_validation');
assert.equal(url.port, '5432');
assert.equal(url.protocol, 'postgresql:');
Logger.overrideLogger(false);
Object.assign(process.env, { MFA_ENCRYPTION_KEY: 'ab'.repeat(32),
  WEBAUTHN_RP_ID: 'localhost', WEBAUTHN_RP_ORIGIN: 'http://localhost:4173' });
function client(name) {
  const connection = new URL(url); connection.searchParams.set('connection_limit', '1');
  connection.searchParams.set('application_name', name);
  return new PrismaClient({ datasources: { db: { url: connection.toString() } } });
}
const primary = client('lmpdf-enrollment-primary'), peer = client('lmpdf-enrollment-peer'), observer = client('lmpdf-enrollment-observer');
const secret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
let user;
before(async () => {
  await Promise.all([primary.$connect(), peer.$connect(), observer.$connect()]);
  assert.equal((await observer.$queryRaw`SELECT current_database() AS name`)[0].name, 'lmpdf_validation');
});
beforeEach(async () => {
  await primary.user.deleteMany({ where: { email: { endsWith: '@isolated.invalid' } } });
  user = await primary.user.create({ data: { email: `${randomUUID()}@isolated.invalid`,
    displayName: 'Synthetic PostgreSQL test', passwordHash: 'not-used-for-login' } });
});
after(async () => { await Promise.all([primary.$disconnect(), peer.$disconnect(), observer.$disconnect()]); });
const unauthorized = result => result.status === 'rejected' && result.reason.getStatus?.() === 401;
const totp = db => new MfaService(db).confirmEnrollment(user.id, secret, generateSync({ secret }), true);
async function snapshot() {
  const stored = await observer.user.findUnique({ where: { id: user.id } });
  return { enabled: stored.mfaEnabled, secret: stored.mfaSecret,
    backup: await observer.userBackupCode.count({ where: { userId: user.id } }),
    keys: await observer.userWebAuthnCredential.count({ where: { userId: user.id } }), active: stored.isActive };
}
async function waitForPostgresLock() {
  const deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    const rows = await observer.$queryRaw`SELECT wait_event_type FROM pg_stat_activity
      WHERE application_name = 'lmpdf-enrollment-peer' AND wait_event_type = 'Lock'`;
    if (rows.length > 0) return;
    await delay(10);
  }
  assert.fail('Aucun verrou PostgreSQL observé pour le client concurrent');
}
function gate() { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; }
function cbor(value) {
  function head(major, length) {
    if (length < 24) return Buffer.from([(major << 5) | length]);
    if (length < 256) return Buffer.from([(major << 5) | 24, length]);
    const out = Buffer.alloc(3); out[0] = (major << 5) | 25; out.writeUInt16BE(length, 1); return out;
  }
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === 'string') { const bytes = Buffer.from(value); return Buffer.concat([head(3, bytes.length), bytes]); }
  const entries = Object.entries(value);
  return Buffer.concat([head(5, entries.length), ...entries.flatMap(([key, item]) => [cbor(key), cbor(item)])]);
}
async function registration(db) {
  const service = new WebAuthnService(db);
  const options = await service.beginRegistration(user.id, user.email);
  const { publicKey } = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  const jwk = publicKey.export({ format: 'jwk' });
  const cose = Buffer.concat([Buffer.from('a5010203262001215820', 'hex'), Buffer.from(jwk.x, 'base64url'),
    Buffer.from('225820', 'hex'), Buffer.from(jwk.y, 'base64url')]);
  const id = randomBytes(32);
  const authData = Buffer.concat([createHash('sha256').update('localhost').digest(), Buffer.from([0x45]),
    Buffer.alloc(4), Buffer.alloc(16), Buffer.from([0, id.length]), id, cose]);
  const response = { id: id.toString('base64url'), rawId: id.toString('base64url'), type: 'public-key', clientExtensionResults: {},
    response: { clientDataJSON: Buffer.from(JSON.stringify({ type: 'webauthn.create', challenge: options.challenge,
      origin: 'http://localhost:4173' })).toString('base64url'),
      attestationObject: cbor({ fmt: 'none', attStmt: {}, authData }).toString('base64url'), transports: ['internal'] } };
  return () => service.finishRegistration(user.id, response, 'Synthetic key', true);
}

test('PostgreSQL : activation initiale TOTP complète et seconde activation refusée', async () => {
  const result = await totp(primary); assert.equal(result.success, true);
  const state = await snapshot(); assert.equal(state.enabled, true); assert.equal(decryptSecret(state.secret), secret);
  assert.equal(state.backup, 8); assert.equal(state.keys, 0);
  await assert.rejects(() => totp(peer), error => error.getStatus?.() === 401);
  assert.deepEqual(await snapshot(), state);
});
test('PostgreSQL : activation WebAuthn réelle et seconde activation refusée', async () => {
  assert.equal((await (await registration(primary))()).success, true);
  const state = await snapshot(); assert.equal(state.keys, 1); assert.equal(state.enabled, false); assert.equal(state.backup, 0);
  await assert.rejects(await registration(peer), error => error.getStatus?.() === 401);
  assert.deepEqual(await snapshot(), state);
});
test('PostgreSQL : deux activations TOTP concurrentes, un seul succès', async () => {
  const results = await Promise.allSettled([totp(primary), totp(peer)]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(unauthorized).length, 1);
  assert.equal((await snapshot()).backup, 8); assert.equal((await snapshot()).enabled, true);
});
test('PostgreSQL : concurrence TOTP/WebAuthn, un seul facteur atomique', async () => {
  const webauthn = await registration(peer);
  const results = await Promise.allSettled([totp(primary), webauthn()]);
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  assert.equal(results.filter(unauthorized).length, 1);
  const state = await snapshot();
  assert.equal(Number(state.enabled) + state.keys, 1);
  assert.equal(state.backup, state.enabled ? 8 : 0);
});
test('PostgreSQL : FOR UPDATE sérialise deux clients indépendants', async () => {
  const entered = gate(), release = gate(); let secondActivated = false;
  const first = completeFirstEnrollment(primary, user.id, async tx => {
    entered.resolve(); await release.promise;
    return tx.user.update({ where: { id: user.id }, data: { mfaEnabled: true, mfaSecret: 'synthetic-lock-test' } });
  });
  await entered.promise;
  const second = completeFirstEnrollment(peer, user.id, async () => { secondActivated = true; });
  const settled = Promise.allSettled([first, second]);
  try { await waitForPostgresLock(); assert.equal(secondActivated, false); }
  finally { release.resolve(); }
  const results = await settled; assert.equal(results[0].status, 'fulfilled'); assert.equal(unauthorized(results[1]), true);
});
test('PostgreSQL : erreur après écritures partielles, rollback total', async () => {
  await assert.rejects(() => completeFirstEnrollment(primary, user.id, async tx => {
    await tx.user.update({ where: { id: user.id }, data: { mfaEnabled: true, mfaSecret: 'synthetic-rollback' } });
    await tx.userBackupCode.create({ data: { userId: user.id, codeHash: 'synthetic-code-hash' } });
    await tx.userWebAuthnCredential.create({ data: { userId: user.id, credentialId: randomUUID(), publicKey: Buffer.from('synthetic'), transports: [] } });
    throw new Error('synthetic rollback');
  }), /synthetic rollback/);
  assert.deepEqual(await snapshot(), { enabled: false, secret: null, backup: 0, keys: 0, active: true });
});
test('PostgreSQL : désactivation pendant la procédure, aucune activation', async () => {
  const entered = gate(), release = gate();
  const disabling = primary.$transaction(async tx => {
    await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${user.id} FOR UPDATE`;
    entered.resolve(); await release.promise;
    await tx.user.update({ where: { id: user.id }, data: { isActive: false } });
  });
  await entered.promise;
  const activation = totp(peer);
  const settled = Promise.allSettled([disabling, activation]);
  try { await waitForPostgresLock(); } finally { release.resolve(); }
  const results = await settled; assert.equal(unauthorized(results[1]), true);
  assert.deepEqual(await snapshot(), { enabled: false, secret: null, backup: 0, keys: 0, active: false });
});
