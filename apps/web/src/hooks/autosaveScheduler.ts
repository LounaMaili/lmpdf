export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface AutosaveState {
  status: AutosaveStatus;
  lastSavedAt: Date | null;
  errorMessage: string | null;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface AutosaveTimerApi {
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(callback: () => void, delayMs: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
}

interface AutosaveSchedulerOptions {
  debounceMs: number;
  intervalMs: number;
  save: () => Promise<void>;
  onStateChange: (state: AutosaveState) => void;
  now?: () => Date;
  timers?: AutosaveTimerApi;
}

const defaultTimers: AutosaveTimerApi = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle),
  setInterval: (callback, delayMs) => globalThis.setInterval(callback, delayMs),
  clearInterval: (handle) => globalThis.clearInterval(handle),
};

/** Coordinates autosave timing independently from React rendering. */
export class AutosaveScheduler {
  #debounceMs: number;
  #intervalMs: number;
  #save: () => Promise<void>;
  #onStateChange: (state: AutosaveState) => void;
  #now: () => Date;
  #timers: AutosaveTimerApi;
  #latestRevision: number;
  #savedRevision: number;
  #lastSavedAt: Date | null = null;
  #debounceTimer: TimerHandle | null = null;
  #intervalTimer: TimerHandle | null = null;
  #isSaving = false;
  #stopped = false;

  constructor(options: AutosaveSchedulerOptions, initialRevision = 0) {
    this.#debounceMs = options.debounceMs;
    this.#intervalMs = options.intervalMs;
    this.#save = options.save;
    this.#onStateChange = options.onStateChange;
    this.#now = options.now ?? (() => new Date());
    this.#timers = options.timers ?? defaultTimers;
    this.#latestRevision = initialRevision;
    this.#savedRevision = initialRevision;
  }

  start(): void {
    this.#stopped = false;
    if (this.#intervalTimer) return;
    this.#intervalTimer = this.#timers.setInterval(() => {
      void this.saveNow();
    }, this.#intervalMs);
  }

  stop(): void {
    this.#stopped = true;
    this.#clearDebounce();
    if (this.#intervalTimer) {
      this.#timers.clearInterval(this.#intervalTimer);
      this.#intervalTimer = null;
    }
  }

  resetPending(revision: number): void {
    this.#clearDebounce();
    this.#latestRevision = revision;
    this.#savedRevision = revision;
  }

  notifyChange(revision: number): void {
    if (revision <= this.#latestRevision) return;
    this.#latestRevision = revision;
    this.#scheduleDebounce();
  }

  hasPendingChanges(): boolean {
    return this.#latestRevision > this.#savedRevision;
  }

  async saveNow(): Promise<boolean> {
    if (this.#stopped || this.#isSaving || !this.hasPendingChanges()) return false;

    const revisionAtStart = this.#latestRevision;
    this.#isSaving = true;
    this.#emit('saving', null);

    try {
      await this.#save();
      this.#savedRevision = Math.max(this.#savedRevision, revisionAtStart);
      this.#lastSavedAt = this.#now();
      this.#emit('saved', null);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Erreur autosave';
      this.#emit('error', message);
    } finally {
      this.#isSaving = false;
      if (this.#latestRevision > revisionAtStart) {
        this.#scheduleDebounce();
      }
    }

    return true;
  }

  #scheduleDebounce(): void {
    if (this.#stopped) return;
    this.#clearDebounce();
    this.#debounceTimer = this.#timers.setTimeout(() => {
      this.#debounceTimer = null;
      void this.saveNow();
    }, this.#debounceMs);
  }

  #clearDebounce(): void {
    if (!this.#debounceTimer) return;
    this.#timers.clearTimeout(this.#debounceTimer);
    this.#debounceTimer = null;
  }

  #emit(status: AutosaveStatus, errorMessage: string | null): void {
    if (this.#stopped) return;
    this.#onStateChange({ status, lastSavedAt: this.#lastSavedAt, errorMessage });
  }
}
