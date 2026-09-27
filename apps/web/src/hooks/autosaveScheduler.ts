export type AutosaveStatus = 'idle' | 'saving' | 'saved' | 'error';

export interface AutosaveState {
  status: AutosaveStatus;
  lastSavedAt: Date | null;
  errorMessage: string | null;
}

export interface DraftKey {
  templateId?: string;
  sourceFileId?: string;
}

export interface AutosaveSnapshot<T> {
  revision: number;
  key: DraftKey;
  data: T;
}

export interface EditableDocument<T> {
  dirty: boolean;
  revision: number;
  key: DraftKey | null;
  getData: () => T;
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface AutosaveTimerApi {
  setTimeout(callback: () => void, delayMs: number): TimerHandle;
  clearTimeout(handle: TimerHandle): void;
  setInterval(callback: () => void, delayMs: number): TimerHandle;
  clearInterval(handle: TimerHandle): void;
}

interface AutosaveSchedulerOptions<T> {
  debounceMs: number;
  intervalMs: number;
  save: (snapshot: AutosaveSnapshot<T>) => Promise<void>;
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

function sameKey(a: DraftKey | null, b: DraftKey | null): boolean {
  if (!a || !b) return a === b;
  return a.templateId === b.templateId && a.sourceFileId === b.sourceFileId;
}

/** Coordinates autosave timing independently from React rendering. */
export class AutosaveScheduler<T> {
  #debounceMs: number;
  #intervalMs: number;
  #save: (snapshot: AutosaveSnapshot<T>) => Promise<void>;
  #onStateChange: (state: AutosaveState) => void;
  #now: () => Date;
  #timers: AutosaveTimerApi;
  #observedRevision: number;
  #latestChangeRevision: number;
  #activeKey: DraftKey | null = null;
  #pending: AutosaveSnapshot<T> | null = null;
  #previousDocuments: AutosaveSnapshot<T>[] = [];
  #lastSavedAt: Date | null = null;
  #debounceTimer: TimerHandle | null = null;
  #intervalTimer: TimerHandle | null = null;
  #isSaving = false;
  #stopped = false;

  constructor(options: AutosaveSchedulerOptions<T>, initialRevision = 0) {
    this.#debounceMs = options.debounceMs;
    this.#intervalMs = options.intervalMs;
    this.#save = options.save;
    this.#onStateChange = options.onStateChange;
    this.#now = options.now ?? (() => new Date());
    this.#timers = options.timers ?? defaultTimers;
    this.#observedRevision = initialRevision;
    this.#latestChangeRevision = initialRevision;
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

  /** Apply the editor's committed state without treating a document load as an edit. */
  observe(document: EditableDocument<T>): void {
    this.switchKey(document.key);
    if (!document.dirty) this.resetPending();

    if (document.revision <= this.#observedRevision) return;
    this.#observedRevision = document.revision;
    if (document.dirty && document.key) {
      this.notifyChange({
        revision: document.revision,
        key: document.key,
        data: document.getData(),
      });
    }
  }

  /** Keep the previous document's pending snapshot under its own key. */
  switchKey(key: DraftKey | null): void {
    if (sameKey(this.#activeKey, key)) return;
    this.#clearDebounce();
    if (this.#pending) {
      this.#previousDocuments.push(this.#pending);
      this.#pending = null;
    }
    this.#activeKey = key ? { ...key } : null;
    this.#lastSavedAt = null;
    this.#emit('idle', null);
    if (this.#previousDocuments.length > 0) void this.saveNow();
  }

  /** Discard only the active document after an explicit clean/reset action. */
  resetPending(): void {
    this.#clearDebounce();
    this.#pending = null;
  }

  notifyChange(snapshot: AutosaveSnapshot<T>): void {
    if (snapshot.revision <= this.#latestChangeRevision) return;
    if (!sameKey(this.#activeKey, snapshot.key)) this.switchKey(snapshot.key);
    this.#latestChangeRevision = snapshot.revision;
    this.#pending = {
      revision: snapshot.revision,
      key: { ...snapshot.key },
      data: structuredClone(snapshot.data),
    };
    this.#scheduleDebounce();
  }

  hasPendingChanges(): boolean {
    return this.#previousDocuments.length > 0 || this.#pending !== null;
  }

  async saveNow(): Promise<boolean> {
    if (this.#stopped || this.#isSaving || !this.hasPendingChanges()) return false;

    const fromPreviousDocument = this.#previousDocuments.length > 0;
    const snapshot = fromPreviousDocument ? this.#previousDocuments.shift()! : this.#pending!;
    if (!fromPreviousDocument) {
      this.#pending = null;
      this.#clearDebounce();
    }
    this.#isSaving = true;
    if (sameKey(snapshot.key, this.#activeKey)) this.#emit('saving', null);

    let succeeded = false;
    try {
      await this.#save(snapshot);
      succeeded = true;
      if (sameKey(snapshot.key, this.#activeKey)) {
        this.#lastSavedAt = this.#now();
        this.#emit('saved', null);
      }
    } catch (error) {
      if (sameKey(snapshot.key, this.#activeKey)) {
        if (!this.#pending || this.#pending.revision < snapshot.revision) this.#pending = snapshot;
      } else {
        this.#previousDocuments.unshift(snapshot);
      }
      const message = error instanceof Error ? error.message : 'Erreur autosave';
      this.#emit('error', sameKey(snapshot.key, this.#activeKey)
        ? message
        : `Document précédent : ${message}`);
    } finally {
      this.#isSaving = false;
      if (succeeded && this.#previousDocuments.length > 0) void this.saveNow();
      else if (this.#pending && !this.#debounceTimer
        && (succeeded || this.#pending.revision > snapshot.revision)) this.#scheduleDebounce();
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
