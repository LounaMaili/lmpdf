import { test } from 'node:test';
import assert from 'node:assert/strict';
import { captureTemplateDraft, isDraftSaveContextCurrent, preserveTemplateDraft, sameDraftKey } from '../src/utils/preserveTemplateDraft.ts';

const payload = { name: 'Synthetic filled draft', fields: [], rotation: 0, pageCount: 2 };
const snapshot = { key: { sourceFileId: 'source-A' }, revision: 7, payload };
const noop = async () => {};
const session = () => true;

test('capture keeps key, revision and nested data independent from later edits', () => {
  const context = { key: { sourceFileId: 'A' }, revision: 4 };
  const data = { ...payload, preset: { color: '#000000' } };
  const captured = captureTemplateDraft(context, data);
  context.key.sourceFileId = 'B'; context.revision = 5; data.preset.color = '#ffffff';
  assert.equal(captured.key?.sourceFileId, 'A'); assert.equal(captured.revision, 4);
  assert.equal(captured.payload.preset.color, '#000000');
});

test('source-file draft is transferred to a separate template slot, with filled data', async () => {
  const slots = new Map([['source-A', { value: 'old draft' }]]);
  const events: string[] = [];
  const result = await preserveTemplateDraft('template-new', snapshot, {
    sameSession: session,
    upsert: async (key, data) => {
      // Model the existing API uniqueness contract: a combined source key
      // would collide with the already occupied source-file slot.
      if (key.sourceFileId && slots.has(key.sourceFileId)) throw new Error('P2002');
      assert.deepEqual(key, { templateId: 'template-new' });
      assert.equal(data, payload);
      slots.set(key.templateId!, { value: data.name });
      events.push('write');
    },
    adopt: () => { events.push('adopt'); return true; },
    clear: async key => {
      assert.equal(slots.get('template-new')?.value, payload.name);
      events.push('clear'); slots.delete(key.sourceFileId!);
    },
  });
  assert.deepEqual(events, ['write', 'adopt', 'clear']);
  assert.deepEqual(result, { adopted: true, cleanupFailed: false });
  assert.equal(slots.has('source-A'), false);
});

test('a failed or indeterminate upsert never adopts or clears the previous draft', async () => {
  await assert.rejects(preserveTemplateDraft('new', snapshot, {
    sameSession: session, upsert: async () => { throw new Error('request failed'); },
    adopt: () => assert.fail('must keep current context'), clear: async () => assert.fail('old draft must survive'),
  }), /request failed/);
});

test('cleanup cannot begin while draft preservation is pending', async () => {
  let finish!: () => void;
  const pending = new Promise<void>(resolve => { finish = resolve; });
  let adopted = false, cleared = false;
  const save = preserveTemplateDraft('new', snapshot, {
    sameSession: session, upsert: () => pending,
    adopt: () => { adopted = true; return true; }, clear: async () => { cleared = true; },
  });
  await Promise.resolve();
  assert.equal(adopted, false); assert.equal(cleared, false);
  finish(); await save;
  assert.equal(adopted, true); assert.equal(cleared, true);
});

test('a changed document or revision preserves both slots without adopting or clearing', async () => {
  for (const current of [{ key: { sourceFileId: 'source-B' }, revision: 7 }, { key: snapshot.key, revision: 8 }]) {
    let writes = 0;
    const result = await preserveTemplateDraft('new', snapshot, {
      sameSession: session, upsert: async () => { writes++; },
      adopt: () => isDraftSaveContextCurrent(snapshot, current),
      clear: async () => assert.fail('keep the newer working draft'),
    });
    assert.equal(writes, 1); assert.equal(result.adopted, false);
  }
});

test('cleanup failure is reported separately after a successful preservation', async () => {
  const result = await preserveTemplateDraft('new', snapshot, {
    sameSession: session, upsert: noop, adopt: session, clear: async () => { throw new Error('offline'); },
  });
  assert.deepEqual(result, { adopted: true, cleanupFailed: true });
});

test('a clean load with the same source key is still a different editable context', async () => {
  const saved = { ...snapshot, payloadVersion: () => payload };
  const loaded = { ...snapshot, payloadVersion: () => ({ ...payload, name: 'Another blank template' }) };
  const result = await preserveTemplateDraft('new', saved, {
    sameSession: session, upsert: noop, adopt: () => isDraftSaveContextCurrent(saved, loaded),
    clear: async () => assert.fail('the freshly loaded source slot must survive'),
  });
  assert.equal(result.adopted, false);
});

test('the current target is never cleared; template key takes precedence over a legacy source key', async () => {
  assert.equal(sameDraftKey({ templateId: 'new', sourceFileId: 'source-A' }, { templateId: 'new' }), true);
  await preserveTemplateDraft('new', { ...snapshot, key: { templateId: 'new', sourceFileId: 'source-A' } }, {
    sameSession: session, upsert: noop, adopt: session, clear: async () => assert.fail('same target'),
  });
});

test('a previous template slot is cleared by its own key only after preservation', async () => {
  const oldKey = { templateId: 'old' };
  const cleared: unknown[] = [];
  await preserveTemplateDraft('new', { ...snapshot, key: oldKey }, {
    sameSession: session, upsert: async key => assert.deepEqual(key, { templateId: 'new' }),
    adopt: session, clear: async key => { cleared.push(key); },
  });
  assert.deepEqual(cleared, [oldKey]);
});

test('logout or account switch before a late response prevents writing with the new session', async () => {
  await assert.rejects(preserveTemplateDraft('new', snapshot, {
    sameSession: () => false, upsert: async () => assert.fail('no cross-account write'),
    adopt: () => assert.fail('no late adoption'), clear: async () => assert.fail('no cross-account deletion'),
  }), /session changed/);
});

test('a session changed during the upsert prevents adoption and cleanup', async () => {
  let active = true;
  const result = await preserveTemplateDraft('new', snapshot, {
    sameSession: () => active, upsert: async () => { active = false; },
    adopt: () => assert.fail('no late adoption'), clear: async () => assert.fail('no deletion'),
  });
  assert.equal(result.adopted, false);
});
