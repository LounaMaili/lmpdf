import { useEffect, useRef, useState } from 'react';
import { upsertDraft, type DraftPayload } from '../api';
import { AutosaveScheduler, type AutosaveState } from './autosaveScheduler';

export type { AutosaveStatus } from './autosaveScheduler';

interface AutosaveOptions {
  /** Debounce delay after last change (ms). Default 2000. */
  debounceMs?: number;
  /** Max interval between saves (ms). Default 25000. */
  intervalMs?: number;
  /** Whether autosave is enabled. Default true. */
  enabled?: boolean;
}

/**
 * Hook that autosaves field data to the backend draft endpoint.
 *
 * Triggers:
 * - Debounced after each change (2s default)
 * - Periodic interval (25s default)
 * - On visibilitychange (tab hidden) / pagehide
 *
 * Returns current autosave status for UI display.
 */
export function useAutosave(
  dirty: boolean,
  changeVersion: number,
  draftKey: { templateId?: string; sourceFileId?: string } | null,
  getData: () => DraftPayload,
  options: AutosaveOptions = {},
) {
  const {
    debounceMs = 2000,
    intervalMs = 25000,
    enabled = true,
  } = options;

  const [state, setState] = useState<AutosaveState>({
    status: 'idle',
    lastSavedAt: null,
    errorMessage: null,
  });

  const schedulerRef = useRef<AutosaveScheduler<DraftPayload> | null>(null);

  // Create one scheduler for the current timing configuration.
  useEffect(() => {
    if (!enabled) return;

    const initialRevision = dirty ? Math.max(0, changeVersion - 1) : changeVersion;
    const scheduler = new AutosaveScheduler<DraftPayload>({
      debounceMs,
      intervalMs,
      save: async (snapshot) => {
        await upsertDraft(snapshot.key, snapshot.data);
      },
      onStateChange: setState,
    }, initialRevision);

    schedulerRef.current = scheduler;
    scheduler.start();

    return () => {
      scheduler.stop();
      if (schedulerRef.current === scheduler) schedulerRef.current = null;
    };
  }, [enabled, debounceMs, intervalMs]);

  // The scheduler captures the key and payload with each new edit revision.
  useEffect(() => {
    const scheduler = schedulerRef.current;
    if (!enabled || !scheduler) return;
    scheduler.observe({ dirty, revision: changeVersion, key: draftKey, getData });
  }, [dirty, changeVersion, draftKey, getData, enabled]);

  // visibilitychange + pagehide: save when user switches tab or navigates away
  useEffect(() => {
    if (!enabled) return;

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        void schedulerRef.current?.saveNow();
      }
    };

    const handlePageHide = () => {
      // Use sendBeacon-style sync save for pagehide
      void schedulerRef.current?.saveNow();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [enabled]);

  // beforeunload warning when dirty
  useEffect(() => {
    if (!dirty) return;

    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      // Modern browsers show a generic message; returnValue is required for some.
      e.returnValue = '';
      return '';
    };

    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [dirty]);

  return state;
}
