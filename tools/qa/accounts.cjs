/* Run only on Debian, against the approved QA target. JSON input/output is private.
 * Creates four new QA users; never updates or deletes an existing user.
 */
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const crypto = require('node:crypto');
const fs = require('node:fs');

const prisma = new PrismaClient({ log: [] });
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const roles = { owner: 'editor', editor: 'editor', filler: 'editor', outsider: 'viewer' };

async function inventory(tx) {
  const tables = await tx.$queryRawUnsafe(
    "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
  );
  const fingerprints = {};
  for (const { tablename } of tables) {
    const identifier = '"' + tablename.replaceAll('"', '""') + '"';
    const rows = await tx.$queryRawUnsafe(`SELECT row_to_json(t)::text AS data FROM public.${identifier} t`);
    fingerprints[tablename] = Object.fromEntries(rows.map(({ data }) => {
      const { id } = JSON.parse(data);
      if (typeof id !== 'string') throw new Error('Table without a stable string ID');
      return [id, hash(data)];
    }).sort(([a], [b]) => a.localeCompare(b)));
  }
  const users = await tx.user.findMany({
    select: { id: true, email: true, displayName: true, role: true, authSource: true,
      isActive: true, mfaEnabled: true, createdAt: true, updatedAt: true },
    orderBy: { id: 'asc' },
  });
  return { at: new Date().toISOString(), fingerprints, users,
    counts: Object.fromEntries(Object.entries(fingerprints).map(([table, rows]) => [table, Object.keys(rows).length])) };
}

function assertHistoricalRows(baseline, current) {
  for (const [table, rows] of Object.entries(baseline.fingerprints)) {
    for (const [id, digest] of Object.entries(rows)) {
      if (current.fingerprints[table]?.[id] !== digest) {
        throw new Error('Historical row changed: ' + table + '/' + id);
      }
    }
  }
}

async function main() {
  const mode = process.argv[1];
  if (!['inventory', 'verify', 'provision'].includes(mode)) throw new Error('Explicit mode required');
  const url = new URL(process.env.DATABASE_URL);
  if (url.hostname !== 'postgres' || url.pathname !== '/lmpdf') throw new Error('Unexpected database target');
  if (mode === 'inventory') {
    return prisma.$transaction(tx => inventory(tx), { isolationLevel: 'RepeatableRead' });
  }
  const input = JSON.parse(fs.readFileSync(0, 'utf8'));
  if (mode === 'verify') {
    const current = await prisma.$transaction(tx => inventory(tx), { isolationLevel: 'RepeatableRead' });
    assertHistoricalRows(input.baseline, current);
    return { historicalRowsUnchanged: true, counts: current.counts };
  }
  if (input.authorization !== 'create-four-persistent-qa-users' || input.campaign !== 'RECETTE-20261114') {
    throw new Error('Missing scoped QA authorization');
  }
  if (input.accounts?.length !== 4 || new Set(input.accounts.map(a => a.alias)).size !== 4) {
    throw new Error('Exactly four QA actors required');
  }
  for (const a of input.accounts) {
    if (!Object.hasOwn(roles, a.alias) || a.role !== roles[a.alias]
      || a.email !== `qa-${a.alias}-20261114@lmpdf.test`
      || a.displayName !== `QA ${a.alias.toUpperCase()} 20261114`
      || !/^[a-f0-9-]{36}$/.test(a.id) || !/^[A-Za-z0-9_-]{43,}$/.test(a.password)) {
      throw new Error('Invalid QA account descriptor');
    }
  }
  const outcomes = await prisma.$transaction(async tx => {
    assertHistoricalRows(input.baseline, await inventory(tx));
    const result = [];
    for (const a of input.accounts) {
      const existing = await tx.user.findUnique({ where: { email: a.email } });
      if (existing) {
        if (existing.id !== a.id || existing.role !== a.role || existing.authSource !== 'local'
          || !existing.isActive || existing.displayName !== a.displayName
          || !(await bcrypt.compare(a.password, existing.passwordHash))) {
          throw new Error('QA identity collision: refusing to modify any existing user');
        }
      } else {
        await tx.user.create({ data: { id: a.id, email: a.email, displayName: a.displayName,
          role: a.role, authSource: 'local', isActive: true, mfaEnabled: false,
          passwordHash: await bcrypt.hash(a.password, 12) } });
      }
      result.push({ alias: a.alias, id: a.id, email: a.email, role: a.role, created: !existing });
    }
    return result;
  }, { timeout: 30000, isolationLevel: 'Serializable' });
  const publicKey = crypto.createPublicKey({ key: input.transportPublicKey, format: 'jwk' });
  return { campaign: input.campaign, accounts: outcomes.map(a => ({ ...a,
    encryptedPassword: crypto.publicEncrypt({ key: publicKey, oaepHash: 'sha256',
      padding: crypto.constants.RSA_PKCS1_OAEP_PADDING },
    Buffer.from(input.accounts.find(original => original.alias === a.alias).password)).toString('base64'),
  })) };
}

main().then(result => console.log(JSON.stringify(result)))
  .catch(error => {
    // Prisma diagnostics may include credentials or submitted values: never print them.
    console.error(JSON.stringify({ error: 'QA operation failed', code: error.code || 'QA_GUARD' }));
    process.exitCode = 1;
  }).finally(() => prisma.$disconnect());
