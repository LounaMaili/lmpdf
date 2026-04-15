import { useCallback, useEffect, useRef, useState } from 'react';
import { upsertDraft, type DraftPayload } from '../api';
import type { FieldModel } from '../types';

export type AutosaveStatus =
  | 'idle'
  | 'saving'
  | 'saved'
  | 'error';

interface AutosaveState {
  status: AutosaveStatus;
  lastSavedAt: Date | null;
  errorMessage: string | null;
}

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

  // Track whether there are unsaved changes since last autosave
  const hasPendingChanges = useRef(false);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const intervalTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  const isSaving = useRef(false);
  const getDataRef = useRef(getData);
  const draftKeyRef = useRef(draftKey);

  // Keep refs in sync
  getDataRef.current = getData;
  draftKeyRef.current = draftKey;

  // Mark pending when dirty changes
  useEffect(() => {
    if (dirty) {
      hasPendingChanges.current = true;
    }
  }, [dirty]);

  const performSave = useCallback(async () => {
    const key = draftKeyRef.current;
    if (!key || (!key.templateId && !key.sourceFileId)) return;
    if (!hasPendingChanges.current) return;
    if (isSaving.current) return;

    isSaving.current = true;
    setState((s) => ({ ...s, status: 'saving', errorMessage: null }));

    try {
      const data = getDataRef.current();
      await upsertDraft(key, data);
      hasPendingChanges.current = false;
      const now = new Date();
      setState({ status: 'saved', lastSavedAt: now, errorMessage: null });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur autosave';
      setState((s) => ({ ...s, status: 'error', errorMessage: msg }));
    } finally {
      isSaving.current = false;
    }
  }, []);

  // Debounce: reset timer on each dirty change
  useEffect(() => {
    if (!enabled || !dirty) return;

    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      performSave();
    }, debounceMs);

    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [dirty, enabled, debounceMs, performSave]);

  // Periodic interval
  useEffect(() => {
    if (!enabled) return;

    intervalTimer.current = setInterval(() => {
      performSave();
    }, intervalMs);

    return () => {
      if (intervalTimer.current) clearInterval(intervalTimer.current);
    };
  }, [enabled, intervalMs, performSave]);

  // visibilitychange + pagehide: save when user switches tab or navigates away
  useEffect(() => {
    if (!enabled) return;

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') {
        performSave();
      }
    };

    const handlePageHide = () => {
      // Use sendBeacon-style sync save for pagehide
      performSave();
    };

    document.addEventListener('visibilitychange', handleVisibility);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [enabled, performSave]);

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

  // Force save when fields change to a new key (template/doc change)
  const prevKeyRef = useRef(draftKey);
  useEffect(() => {
    const prev = prevKeyRef.current;
    prevKeyRef.current = draftKey;
    if (prev && (prev.templateId !== draftKey?.templateId || prev.sourceFileId !== draftKey?.sourceFileId)) {
      // Key changed: save previous if pending
      if (hasPendingChanges.current) {
        performSave();
      }
      setState({ status: 'idle', lastSavedAt: null, errorMessage: null });
    }
  }, [draftKey, performSave]);

  return state;
}
