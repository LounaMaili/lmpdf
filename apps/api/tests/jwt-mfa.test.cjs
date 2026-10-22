// Run against the compiled API in an isolated container. No database or real account.
require('reflect-metadata');
const { test, before, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash, generateKeyPairSync, sign, randomBytes } = require('node:crypto');
const { hashSync } = require('bcryptjs');
const { generateSync } = require('otplib');
const { Module, ValidationPipe } = require('@nestjs/common');
const { NestFactory, APP_GUARD } = require('@nestjs/core');
const { JwtModule, JwtService } = require('@nestjs/jwt');
const { PassportModule } = require('@nestjs/passport');

// runtime-settings on main captures cwd at import time: never read real settings.
const originalCwd = process.cwd();
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'lmpdf-jwt-mfa-'));
process.chdir(directory);
Object.assign(process.env, {
  JWT_SECRET: 'synthetic-only-jwt-secret-at-least-32-characters',
  MFA_ENCRYPTION_KEY: 'ab'.repeat(32), AUTH_MODE: 'local', LDAP_ENABLED: 'false',
  MFA_POLICY: 'optional', ALLOW_SELF_REGISTER: 'false',
  WEBAUTHN_RP_ID: 'localhost', WEBAUTHN_RP_ORIGIN: 'http://localhost:4173',
});
const { PrismaService } = require('../dist/prisma/prisma.service');
const { AuthController } = require('../dist/auth/auth.controller');
const { UsersController } = require('../dist/users/users.controller');
const { JwtStrategy } = require('../dist/auth/jwt.strategy');
const { JwtAuthGuard } = require('../dist/auth/auth.guard');
const { RolesGuard } = require('../dist/auth/roles.guard');
const { LdapService } = require('../dist/auth/ldap.service');
const { MfaService } = require('../dist/auth/mfa.service');
const { WebAuthnService } = require('../dist/auth/webauthn.service');
const { encryptSecret } = require('../dist/auth/crypto.util');
const { isAccessTokenPayload, isMfaChallengePayload } = require('../dist/auth/jwt-purpose');

const password = 'synthetic-password-only';
const passwordHash = hashSync(password, 4);
const totpSecret = 'JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP';
let users, credential, backupCodes, privateKey, lookupCount, app, jwt, base;
const ldap = { enabled: false };
const prisma = {
  user: {
    async findUnique({ where }) {
      lookupCount++;
      return users.find(u => where.id ? u.id === where.id : u.email === where.email) ?? null;
    },
    async findMany() { return users.map(u => ({ ...u, _count: { backupCodes: 0, webauthnCredentials: 0 } })); },
  },
  userBackupCode: {
    async findMany({ where }) { return backupCodes.filter(c => c.userId === where.userId && !c.usedAt); },
    async update({ where, data }) {
      const code = backupCodes.find(c => c.id === where.id);
      Object.assign(code, data); return code;
    },
  },
  userWebAuthnCredential: {
    async count({ where }) { return Number(where.userId === 'passkey'); },
    async findMany({ where }) { return where.userId === 'passkey' ? [credential] : []; },
    async findFirst({ where }) {
      return where.userId === 'passkey' && where.credentialId === credential.credentialId ? credential : null;
    },
    async update({ data }) { Object.assign(credential, data); return credential; },
  },
};

class IsolatedAuthModule {}
Module({
  imports: [PassportModule.register({ defaultStrategy: 'jwt' }), JwtModule.register({
    secret: process.env.JWT_SECRET, signOptions: { expiresIn: '7d' },
  })],
  controllers: [AuthController, UsersController],
  providers: [
    { provide: PrismaService, useValue: prisma }, { provide: LdapService, useValue: ldap },
    MfaService, WebAuthnService, JwtStrategy, RolesGuard,
    { provide: APP_GUARD, useClass: JwtAuthGuard }, { provide: APP_GUARD, useClass: RolesGuard },
  ],
})(IsolatedAuthModule);

before(async () => {
  app = await NestFactory.create(IsolatedAuthModule, { logger: false });
  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(0, '127.0.0.1');
  base = await app.getUrl();
  jwt = app.get(JwtService);
});
beforeEach(() => {
  lookupCount = 0;
  backupCodes = [];
  process.env.AUTH_MODE = 'local';
  users = ['ordinary', 'totp', 'admin', 'disabled', 'passkey'].map(id => ({
    id, email: `${id}@synthetic.invalid`, displayName: 'Synthetic user',
    role: id === 'admin' ? 'admin' : 'editor', isActive: id !== 'disabled',
    mfaEnabled: id === 'totp' || id === 'admin',
    mfaSecret: id === 'totp' || id === 'admin' ? encryptSecret(totpSecret) : null,
    passwordHash, authSource: 'local', externalId: null,
  }));
  const keys = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
  privateKey = keys.privateKey;
  const jwk = keys.publicKey.export({ format: 'jwk' });
  // COSE EC2 / ES256 key (kty, alg, curve, x, y), consumed by the real verifier.
  const publicKey = Buffer.concat([
    Buffer.from('a5010203262001215820', 'hex'), Buffer.from(jwk.x, 'base64url'),
    Buffer.from('225820', 'hex'), Buffer.from(jwk.y, 'base64url'),
  ]);
  credential = { id: 'synthetic-credential', userId: 'passkey',
    credentialId: randomBytes(32).toString('base64url'), publicKey, counter: 0n, transports: ['internal'] };
});
after(async () => {
  try { if (app) await app.close(); }
  finally { process.chdir(originalCwd); fs.rmSync(directory, { recursive: true, force: true }); }
});

function token(id = 'ordinary', extra = {}, options = {}) {
  return jwt.sign({ sub: id, email: `${id}@synthetic.invalid`, role: id === 'admin' ? 'admin' : 'editor', ...extra }, options);
}
function challenge(id = 'totp', extra = {}, options = {}) {
  return token(id, { purpose: 'mfa-challenge', mfaChallenge: true, ...extra }, { expiresIn: '2m', ...options });
}
async function request(route, { bearer, body } = {}) {
  const response = await fetch(`${base}/api/${route}`, {
    method: body ? 'POST' : 'GET', headers: {
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    }, ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
const me = bearer => request('auth/me', { bearer });
async function expectAccess(result, id) {
  assert.equal(result.status, 201);
  assert.equal(typeof result.body.token, 'string');
  const payload = jwt.verify(result.body.token);
  assert.equal(payload.purpose, 'access');
  assert.equal(Object.hasOwn(payload, 'mfaChallenge'), false);
  assert.equal(payload.exp - payload.iat, 7 * 24 * 60 * 60);
  const access = await me(result.body.token);
  assert.equal(access.status, 200);
  assert.equal(access.body.id, id);
  return result.body.token;
}
async function login(id) {
  return request('auth/login', { body: { email: `${id}@synthetic.invalid`, password } });
}
function assertion(challengeValue, { validSignature = true, verifiedUser = true } = {}) {
  const clientDataJSON = Buffer.from(JSON.stringify({
    type: 'webauthn.get', challenge: challengeValue, origin: process.env.WEBAUTHN_RP_ORIGIN,
  }));
  const authenticatorData = Buffer.concat([
    createHash('sha256').update(process.env.WEBAUTHN_RP_ID).digest(),
    Buffer.from([verifiedUser ? 5 : 1, 0, 0, 0, 1]), // UP, UV, signature counter 1
  ]);
  const signed = Buffer.concat([authenticatorData, createHash('sha256').update(clientDataJSON).digest()]);
  const signature = sign('sha256', signed, privateKey);
  if (!validSignature) signature[signature.length - 1] ^= 1;
  return { id: credential.credentialId, rawId: credential.credentialId, type: 'public-key',
    response: { authenticatorData: authenticatorData.toString('base64url'),
      clientDataJSON: clientDataJSON.toString('base64url'), signature: signature.toString('base64url') },
    clientExtensionResults: {}, authenticatorAttachment: 'platform' };
}

test('unit: access and challenge are mutually exclusive, including legacy claims', () => {
  for (const payload of [{ sub: 'u' }, { sub: 'u', purpose: 'access', type: 'access' }]) {
    assert.equal(isAccessTokenPayload(payload), true);
    assert.equal(isMfaChallengePayload(payload), false);
  }
  for (const payload of [{ sub: 'u', mfaChallenge: true }, { sub: 'u', purpose: 'mfa-challenge', mfaChallenge: true }]) {
    assert.equal(isAccessTokenPayload(payload), false);
    assert.equal(isMfaChallengePayload(payload), true);
  }
  for (const payload of [null, [], {}, { sub: '' }, { sub: 7 }, { sub: '  ' },
    { sub: 'u', purpose: null }, { sub: 'u', type: 'refresh' },
    { sub: 'u', purpose: 'access', mfaChallenge: true }, { sub: 'u', mfaChallenge: 'true' }]) {
    assert.equal(isAccessTokenPayload(payload), false);
    assert.equal(isMfaChallengePayload(payload), false);
  }
});
test('unit: strategy rejects a challenge before any Prisma lookup', async () => {
  await assert.rejects(() => app.get(JwtStrategy).validate({ sub: 'admin', mfaChallenge: true }), e => e.getStatus() === 401);
  assert.equal(lookupCount, 0);
});
test('HTTP: authenticated access token is accepted', async () => {
  assert.equal((await me(token('ordinary', { purpose: 'access' }))).status, 200);
});
test('HTTP: legacy ordinary session without purpose remains accepted', async () => {
  assert.equal((await me(token())).status, 200);
});
test('HTTP: new MFA challenge is rejected on protected routes', async () => {
  assert.equal((await me(challenge())).status, 401);
});
test('HTTP: legacy MFA challenge is rejected on protected routes', async () => {
  assert.equal((await me(token('totp', { mfaChallenge: true }))).status, 401);
});
test('HTTP: admin challenge cannot access the real admin users route', async () => {
  assert.equal((await request('users', { bearer: challenge('admin') })).status, 401);
  assert.equal((await request('users', { bearer: token('admin', { mfaChallenge: true }) })).status, 401);
  assert.equal((await request('users', { bearer: token('admin', { purpose: 'access' }) })).status, 200);
});
for (const [name, claims] of [
  ['unknown purpose', { purpose: 'refresh' }], ['unknown type', { type: 'refresh' }],
  ['challenge purpose alone', { purpose: 'mfa-challenge' }], ['conflicting type', { purpose: 'access', type: 'mfa-challenge' }],
  ['null purpose', { purpose: null }], ['false marker', { mfaChallenge: false }],
  ['string marker', { mfaChallenge: 'true' }], ['numeric marker', { mfaChallenge: 1 }],
]) {
  test(`HTTP: reject ${name}`, async () => { assert.equal((await me(token('ordinary', claims))).status, 401); });
}
test('HTTP: expired challenge rejected both by guard and MFA endpoints', async () => {
  const expired = challenge('totp', {}, { expiresIn: -1 });
  assert.equal((await me(expired)).status, 401);
  for (const route of ['mfa', 'webauthn']) {
    const result = await request(`auth/login/${route}-verify`, { body: { mfaChallengeToken: expired, code: generateSync({ secret: totpSecret }), response: {} } });
    assert.equal(result.status, 401); assert.equal(result.body.token, undefined);
  }
});
test('HTTP: expired ordinary access is still rejected', async () => {
  assert.equal((await me(token('ordinary', {}, { expiresIn: -1 }))).status, 401);
});
test('HTTP: malformed or incorrectly signed JWT is rejected', async () => {
  for (const invalid of ['not-a-jwt', token('ordinary', {}, { secret: 'synthetic-wrong-secret' })]) {
    assert.equal((await me(invalid)).status, 401);
    assert.equal((await request('auth/login/mfa-verify', { body: { mfaChallengeToken: invalid, code: 'invalid' } })).status, 401);
  }
});
test('HTTP: disabled or missing user rejected despite a valid access signature', async () => {
  assert.equal((await me(token('disabled', { purpose: 'access' }))).status, 401);
  assert.equal((await me(token('missing'))).status, 401);
});
test('HTTP: token role cannot elevate a database editor to admin', async () => {
  assert.equal((await request('users', { bearer: token('ordinary', { purpose: 'access', role: 'admin' }) })).status, 403);
});
test('HTTP: local login issues an explicit access token for an ordinary user', async () => {
  await expectAccess(await login('ordinary'), 'ordinary');
});
test('HTTP: local MFA login only issues a two-minute challenge', async () => {
  const result = await login('totp');
  assert.equal(result.status, 201); assert.equal(result.body.token, undefined);
  assert.equal(result.body.mfaRequired, true);
  const payload = jwt.verify(result.body.mfaChallengeToken);
  assert.equal(payload.purpose, 'mfa-challenge'); assert.equal(payload.mfaChallenge, true);
  assert.equal(payload.exp - payload.iat, 120);
  assert.equal((await me(result.body.mfaChallengeToken)).status, 401);
});
for (const legacy of [false, true]) {
  test(`HTTP: ${legacy ? 'legacy' : 'new'} challenge plus real TOTP issues access`, async () => {
    const mfaChallengeToken = legacy ? token('totp', { mfaChallenge: true }) : challenge();
    await expectAccess(await request('auth/login/mfa-verify', { body: { mfaChallengeToken, code: generateSync({ secret: totpSecret }) } }), 'totp');
  });
}
test('HTTP: invalid TOTP/backup factor cannot issue access', async () => {
  const result = await request('auth/login/mfa-verify', { body: { mfaChallengeToken: challenge(), code: 'invalid-factor' } });
  assert.equal(result.status, 401); assert.equal(result.body.token, undefined);
});
test('HTTP: valid backup code still issues access and is consumed', async () => {
  backupCodes = [{ id: 'backup', userId: 'totp', codeHash: hashSync('synthetic-backup', 4), usedAt: null }];
  const body = { mfaChallengeToken: challenge(), code: 'synthetic-backup' };
  await expectAccess(await request('auth/login/mfa-verify', { body }), 'totp');
  assert.ok(backupCodes[0].usedAt instanceof Date);
  const replay = await request('auth/login/mfa-verify', { body });
  assert.equal(replay.status, 401); assert.equal(replay.body.token, undefined);
});
test('HTTP: admin only gets admin access after valid TOTP', async () => {
  const pending = challenge('admin');
  assert.equal((await request('users', { bearer: pending })).status, 401);
  const access = await expectAccess(await request('auth/login/mfa-verify', { body: {
    mfaChallengeToken: pending, code: generateSync({ secret: totpSecret }),
  } }), 'admin');
  assert.equal((await request('users', { bearer: access })).status, 200);
});
test('HTTP: disabling an account after challenge prevents TOTP completion', async () => {
  const pending = challenge(); users.find(u => u.id === 'totp').isActive = false;
  const result = await request('auth/login/mfa-verify', { body: { mfaChallengeToken: pending, code: generateSync({ secret: totpSecret }) } });
  assert.equal(result.status, 401); assert.equal(result.body.token, undefined);
});
for (const route of ['mfa', 'webauthn']) {
  test(`HTTP: ${route} endpoint rejects access tokens, invalid markers and conflicting purposes`, async () => {
    for (const candidate of [token('totp', { purpose: 'access' }), challenge('totp', { purpose: 'access' }),
      challenge('totp', { type: 'refresh' }), challenge('totp', { mfaChallenge: 'true' })]) {
      const result = await request(`auth/login/${route}-verify`, { body: { mfaChallengeToken: candidate, code: generateSync({ secret: totpSecret }), response: {} } });
      assert.equal(result.status, 401); assert.equal(result.body.token, undefined);
    }
  });
}
for (const legacy of [false, true]) {
  test(`HTTP: ${legacy ? 'legacy' : 'new'} JWT challenge plus real WebAuthn signature issues access`, async () => {
    const result = await login('passkey');
    assert.equal(result.status, 201); assert.equal(result.body.token, undefined);
    const pending = legacy ? token('passkey', { mfaChallenge: true }) : result.body.mfaChallengeToken;
    await expectAccess(await request('auth/login/webauthn-verify', { body: {
      mfaChallengeToken: pending, response: assertion(result.body.webauthnOptions.challenge),
    } }), 'passkey');
    assert.equal(credential.counter, 1n);
  });
}
test('HTTP: invalid WebAuthn signature cannot issue access', async () => {
  const result = await login('passkey');
  const verified = await request('auth/login/webauthn-verify', { body: {
    mfaChallengeToken: result.body.mfaChallengeToken,
    response: assertion(result.body.webauthnOptions.challenge, { validSignature: false }),
  } });
  assert.equal(verified.status, 401); assert.equal(verified.body.token, undefined);
  assert.equal(credential.counter, 0n);
});
test('HTTP: WebAuthn assertion cannot be replayed after successful verification', async () => {
  const result = await login('passkey');
  const body = { mfaChallengeToken: result.body.mfaChallengeToken, response: assertion(result.body.webauthnOptions.challenge) };
  await expectAccess(await request('auth/login/webauthn-verify', { body }), 'passkey');
  const replay = await request('auth/login/webauthn-verify', { body });
  assert.equal(replay.status, 401); assert.equal(replay.body.token, undefined);
});
test('HTTP: passwordless with a real signed assertion still issues explicit access', async () => {
  const begin = await request('auth/login/passwordless-begin', { body: { email: 'passkey@synthetic.invalid' } });
  assert.equal(begin.status, 201);
  await expectAccess(await request('auth/login/passwordless-finish', { body: {
    email: 'passkey@synthetic.invalid', response: assertion(begin.body.options.challenge),
  } }), 'passkey');
});
