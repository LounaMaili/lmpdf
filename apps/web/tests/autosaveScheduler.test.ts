import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AutosaveScheduler,
  type AutosaveSnapshot,
  type AutosaveState,
  type AutosaveTimerApi,
  type DraftKey,
} from '../src/hooks/autosaveScheduler.ts';

type TestPayload = { name: string };
const keyA: DraftKey = { templateId: 'template-a' };
const keyB: DraftKey = { sourceFileId: 'file-b' };

type TimerTask = {
  callback: () => void;
  dueAt: number;
  intervalMs: number | null;
};

class ManualTimers implements AutosaveTimerApi {
  now = 0;
  #nextId = 1;
  #tasks = new Map<number, TimerTask>();

  setTimeout(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    return this.#add(callback, delayMs, null) as ReturnType<typeof setTimeout>;
  }

  clearTimeout(handle: ReturnType<typeof setTimeout>): void {
    this.#tasks.delete(handle as number);
  }

  setInterval(callback: () => void, delayMs: number): ReturnType<typeof setTimeout> {
    return this.#add(callback, delayMs, delayMs) as ReturnType<typeof setTimeout>;
  }

  clearInterval(handle: ReturnType<typeof setTimeout>): void {
    this.#tasks.delete(handle as number);
  }

  advanceBy(durationMs: number): void {
    const target = this.now + durationMs;

    while (true) {
      const next = [...this.#tasks.entries()]
        .filter(([, task]) => task.dueAt <= target)
        .sort((a, b) => a[1].dueAt - b[1].dueAt || a[0] - b[0])[0];
      if (!next) break;

      const [id, task] = next;
      this.now = task.dueAt;
      if (task.intervalMs === null) this.#tasks.delete(id);
      else task.dueAt += task.intervalMs;
      task.callback();
    }

    this.now = target;
  }

  #add(callback: () => void, delayMs: number, intervalMs: number | null): number {
    const id = this.#nextId++;
    this.#tasks.set(id, { callback, dueAt: this.now + delayMs, intervalMs });
    return id;
  }
}

async function flushAsyncWork(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

function createHarness(
  save: (snapshot: AutosaveSnapshot<TestPayload>) => Promise<void>,
  debounceMs = 100,
  intervalMs = 1000,
) {
  const timers = new ManualTimers();
  const states: AutosaveState[] = [];
  const scheduler = new AutosaveScheduler<TestPayload>({
    debounceMs,
    intervalMs,
    save,
    onStateChange: (state) => states.push(state),
    now: () => new Date(timers.now),
    timers,
  });
  scheduler.start();
  return { scheduler, states, timers };
}

function observeEdit(scheduler: AutosaveScheduler<TestPayload>, revision: number,
  key: DraftKey = keyA, name = `revision-${revision}`): void {
  scheduler.observe({ dirty: true, revision, key, getData: () => ({ name }) });
}

function observeCleanLoad(scheduler: AutosaveScheduler<TestPayload>, revision: number,
  key: DraftKey): void {
  scheduler.observe({ dirty: false, revision, key, getData: () => ({ name: 'loaded' }) });
}

test('first change triggers a save after the debounce', async () => {
  let saves = 0;
  const { scheduler, timers } = createHarness(async () => { saves += 1; });

  observeEdit(scheduler, 1);
  timers.advanceBy(99);
  await flushAsyncWork();
  assert.equal(saves, 0);

  timers.advanceBy(1);
  await flushAsyncWork();
  assert.equal(saves, 1);
});

test('a second change after a successful autosave triggers another save', async () => {
  let saves = 0;
  const { scheduler, timers } = createHarness(async () => { saves += 1; });

  observeEdit(scheduler, 1);
  timers.advanceBy(100);
  await flushAsyncWork();
  observeEdit(scheduler, 2);
  timers.advanceBy(100);
  await flushAsyncWork();

  assert.equal(saves, 2);
});

test('rapid changes are collapsed into one debounced save', async () => {
  let saves = 0;
  const { scheduler, timers } = createHarness(async () => { saves += 1; });

  observeEdit(scheduler, 1);
  timers.advanceBy(50);
  observeEdit(scheduler, 2);
  timers.advanceBy(50);
  observeEdit(scheduler, 3);
  timers.advanceBy(99);
  await flushAsyncWork();
  assert.equal(saves, 0);

  timers.advanceBy(1);
  await flushAsyncWork();
  assert.equal(saves, 1);
});

test('periodic checks do not save again without new changes', async () => {
  let saves = 0;
  const { scheduler, timers } = createHarness(async () => { saves += 1; });

  observeEdit(scheduler, 1);
  timers.advanceBy(100);
  await flushAsyncWork();
  timers.advanceBy(5000);
  await flushAsyncWork();

  assert.equal(saves, 1);
});

test('the periodic interval saves pending changes', async () => {
  let saves = 0;
  const { scheduler, timers } = createHarness(async () => { saves += 1; }, 2000, 1000);

  observeEdit(scheduler, 1);
  timers.advanceBy(1000);
  await flushAsyncWork();

  assert.equal(saves, 1);
});

test('saveNow flushes a pending change for visibility and pagehide handlers', async () => {
  let saves = 0;
  const { scheduler } = createHarness(async () => { saves += 1; });

  observeEdit(scheduler, 1);
  await scheduler.saveNow();

  assert.equal(saves, 1);
});

test('an API error sets the error state', async () => {
  const { scheduler, states, timers } = createHarness(async () => {
    throw new Error('API unavailable');
  });

  observeEdit(scheduler, 1);
  timers.advanceBy(100);
  await flushAsyncWork();

  assert.equal(states.at(-1)?.status, 'error');
  assert.equal(states.at(-1)?.errorMessage, 'API unavailable');
});

test('a successful save after an error returns to the saved state', async () => {
  let attempts = 0;
  const { scheduler, states, timers } = createHarness(async () => {
    attempts += 1;
    if (attempts === 1) throw new Error('temporary failure');
  });

  observeEdit(scheduler, 1);
  timers.advanceBy(100);
  await flushAsyncWork();
  assert.equal(states.at(-1)?.status, 'error');

  observeEdit(scheduler, 2);
  timers.advanceBy(100);
  await flushAsyncWork();

  assert.equal(attempts, 2);
  assert.equal(states.at(-1)?.status, 'saved');
  assert.ok(states.at(-1)?.lastSavedAt instanceof Date);
});

test('a change during an in-flight save is queued without concurrent saves', async () => {
  let saves = 0;
  let resolveFirstSave: (() => void) | undefined;
  const { scheduler, timers } = createHarness(() => {
    saves += 1;
    if (saves === 1) {
      return new Promise<void>((resolve) => { resolveFirstSave = resolve; });
    }
    return Promise.resolve();
  });

  observeEdit(scheduler, 1);
  timers.advanceBy(100);
  await flushAsyncWork();
  observeEdit(scheduler, 2);
  timers.advanceBy(100);
  await flushAsyncWork();
  assert.equal(saves, 1);

  resolveFirstSave?.();
  await flushAsyncWork();
  timers.advanceBy(100);
  await flushAsyncWork();
  assert.equal(saves, 2);
});

test('pending changes for A are flushed with the captured A payload on a clean B load', async () => {
  const writes: AutosaveSnapshot<TestPayload>[] = [];
  const { scheduler, timers } = createHarness(async (snapshot) => { writes.push(snapshot); });

  observeEdit(scheduler, 1, keyA, 'edited A');
  timers.advanceBy(50);
  observeCleanLoad(scheduler, 1, keyB);
  await flushAsyncWork();

  assert.deepEqual(writes.map(({ key, data }) => ({ key, name: data.name })), [
    { key: keyA, name: 'edited A' },
  ]);
  timers.advanceBy(5000);
  await flushAsyncWork();
  assert.equal(writes.length, 1, 'opening B without editing it must not autosave B');

  observeEdit(scheduler, 2, keyB, 'edited B');
  timers.advanceBy(100);
  await flushAsyncWork();
  assert.deepEqual(writes.map(({ key, data }) => ({ key, name: data.name })), [
    { key: keyA, name: 'edited A' },
    { key: keyB, name: 'edited B' },
  ]);
});

test('a new B edit in the same update never writes A data under B', async () => {
  const writes: AutosaveSnapshot<TestPayload>[] = [];
  const { scheduler, timers } = createHarness(async (snapshot) => { writes.push(snapshot); });

  observeEdit(scheduler, 1, keyA, 'A payload');
  observeEdit(scheduler, 2, keyB, 'B payload');
  await flushAsyncWork();
  timers.advanceBy(100);
  await flushAsyncWork();

  assert.deepEqual(writes.map(({ key, data }) => ({ key, name: data.name })), [
    { key: keyA, name: 'A payload' },
    { key: keyB, name: 'B payload' },
  ]);
});

test('an unchanged dirty flag on a key switch does not create a B revision', async () => {
  const writes: AutosaveSnapshot<TestPayload>[] = [];
  const { scheduler, timers } = createHarness(async (snapshot) => { writes.push(snapshot); });

  observeEdit(scheduler, 1, keyA, 'A payload');
  scheduler.observe({ dirty: true, revision: 1, key: keyB,
    getData: () => ({ name: 'B was only opened' }) });
  await flushAsyncWork();
  timers.advanceBy(5000);
  await flushAsyncWork();

  assert.deepEqual(writes.map(({ key, data }) => ({ key, name: data.name })), [
    { key: keyA, name: 'A payload' },
  ]);
});

test('a clean document load alone does not start autosave', async () => {
  const writes: AutosaveSnapshot<TestPayload>[] = [];
  const { scheduler, timers } = createHarness(async (snapshot) => { writes.push(snapshot); });

  observeCleanLoad(scheduler, 0, keyB);
  timers.advanceBy(5000);
  await flushAsyncWork();

  assert.equal(writes.length, 0);
});

test('switching to an editor without a draft key still flushes A under A', async () => {
  const writes: AutosaveSnapshot<TestPayload>[] = [];
  const { scheduler } = createHarness(async (snapshot) => { writes.push(snapshot); });

  observeEdit(scheduler, 1, keyA, 'edited A');
  scheduler.observe({ dirty: false, revision: 1, key: null,
    getData: () => ({ name: 'empty editor' }) });
  await flushAsyncWork();

  assert.deepEqual(writes.map(({ key, data }) => ({ key, name: data.name })), [
    { key: keyA, name: 'edited A' },
  ]);
});

test('a queued snapshot remains immutable after the editor state changes', async () => {
  const writes: AutosaveSnapshot<TestPayload>[] = [];
  const { scheduler } = createHarness(async (snapshot) => { writes.push(snapshot); });
  const data = { name: 'original A' };

  scheduler.observe({ dirty: true, revision: 1, key: keyA, getData: () => data });
  data.name = 'new editor state';
  observeCleanLoad(scheduler, 1, keyB);
  await flushAsyncWork();

  assert.equal(writes[0]?.data.name, 'original A');
  assert.deepEqual(writes[0]?.key, keyA);
});

test('a key switch during an in-flight save serializes the A and B writes', async () => {
  const writes: AutosaveSnapshot<TestPayload>[] = [];
  let finishA: (() => void) | undefined;
  const { scheduler, timers } = createHarness((snapshot) => {
    writes.push(snapshot);
    if (writes.length === 1) return new Promise<void>((resolve) => { finishA = resolve; });
    return Promise.resolve();
  });

  observeEdit(scheduler, 1, keyA, 'A first');
  timers.advanceBy(100);
  await flushAsyncWork();
  observeEdit(scheduler, 2, keyA, 'A second');
  observeEdit(scheduler, 3, keyB, 'B first');
  timers.advanceBy(100);
  await flushAsyncWork();
  assert.equal(writes.length, 1);

  finishA?.();
  await flushAsyncWork();
  assert.deepEqual(writes.slice(0, 2).map(({ key, data }) => ({ key, name: data.name })), [
    { key: keyA, name: 'A first' },
    { key: keyA, name: 'A second' },
  ]);
  timers.advanceBy(100);
  await flushAsyncWork();
  assert.deepEqual(writes.map(({ key, data }) => ({ key, name: data.name })), [
    { key: keyA, name: 'A first' },
    { key: keyA, name: 'A second' },
    { key: keyB, name: 'B first' },
  ]);
});

test('a failed A flush does not block B and remains visible until A retries', async () => {
  const writes: AutosaveSnapshot<TestPayload>[] = [];
  let failA = true;
  const { scheduler, states, timers } = createHarness(async (snapshot) => {
    writes.push(snapshot);
    if (snapshot.key.templateId === keyA.templateId && failA) throw new Error('A unavailable');
  });

  observeEdit(scheduler, 1, keyA, 'A payload');
  observeEdit(scheduler, 2, keyB, 'B payload');
  await flushAsyncWork();
  assert.equal(states.at(-1)?.status, 'error');

  timers.advanceBy(100);
  await flushAsyncWork();
  assert.deepEqual(writes.map(({ key }) => key), [keyA, keyB]);
  assert.equal(states.at(-1)?.status, 'error', 'A failure must remain visible after B saves');

  failA = false;
  timers.advanceBy(900);
  await flushAsyncWork();
  assert.deepEqual(writes.map(({ key }) => key), [keyA, keyB, keyA]);
  assert.equal(states.at(-1)?.status, 'saved');
});
