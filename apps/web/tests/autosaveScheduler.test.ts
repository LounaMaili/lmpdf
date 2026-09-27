import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AutosaveScheduler,
  type AutosaveState,
  type AutosaveTimerApi,
} from '../src/hooks/autosaveScheduler.ts';

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

function createHarness(save: () => Promise<void>, debounceMs = 100, intervalMs = 1000) {
  const timers = new ManualTimers();
  const states: AutosaveState[] = [];
  const scheduler = new AutosaveScheduler({
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

test('first change triggers a save after the debounce', async () => {
  let saves = 0;
  const { scheduler, timers } = createHarness(async () => { saves += 1; });

  scheduler.notifyChange(1);
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

  scheduler.notifyChange(1);
  timers.advanceBy(100);
  await flushAsyncWork();
  scheduler.notifyChange(2);
  timers.advanceBy(100);
  await flushAsyncWork();

  assert.equal(saves, 2);
});

test('rapid changes are collapsed into one debounced save', async () => {
  let saves = 0;
  const { scheduler, timers } = createHarness(async () => { saves += 1; });

  scheduler.notifyChange(1);
  timers.advanceBy(50);
  scheduler.notifyChange(2);
  timers.advanceBy(50);
  scheduler.notifyChange(3);
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

  scheduler.notifyChange(1);
  timers.advanceBy(100);
  await flushAsyncWork();
  timers.advanceBy(5000);
  await flushAsyncWork();

  assert.equal(saves, 1);
});

test('the periodic interval saves pending changes', async () => {
  let saves = 0;
  const { scheduler, timers } = createHarness(async () => { saves += 1; }, 2000, 1000);

  scheduler.notifyChange(1);
  timers.advanceBy(1000);
  await flushAsyncWork();

  assert.equal(saves, 1);
});

test('saveNow flushes a pending change for visibility and pagehide handlers', async () => {
  let saves = 0;
  const { scheduler } = createHarness(async () => { saves += 1; });

  scheduler.notifyChange(1);
  await scheduler.saveNow();

  assert.equal(saves, 1);
});

test('an API error sets the error state', async () => {
  const { scheduler, states, timers } = createHarness(async () => {
    throw new Error('API unavailable');
  });

  scheduler.notifyChange(1);
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

  scheduler.notifyChange(1);
  timers.advanceBy(100);
  await flushAsyncWork();
  assert.equal(states.at(-1)?.status, 'error');

  scheduler.notifyChange(2);
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

  scheduler.notifyChange(1);
  timers.advanceBy(100);
  await flushAsyncWork();
  scheduler.notifyChange(2);
  timers.advanceBy(100);
  await flushAsyncWork();
  assert.equal(saves, 1);

  resolveFirstSave?.();
  await flushAsyncWork();
  timers.advanceBy(100);
  await flushAsyncWork();
  assert.equal(saves, 2);
});
