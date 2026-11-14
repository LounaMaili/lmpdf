import type { DraftPayload } from '../api';
import type { DraftKey } from '../hooks/autosaveScheduler';

export interface DraftSaveContext {
  key: DraftKey | null;
  revision: number;
  /** Clean loads can replace data without incrementing the edit revision. */
  payloadVersion?: () => DraftPayload;
}

export interface TemplateDraftSnapshot extends DraftSaveContext {
  payload: DraftPayload;
}

export function captureTemplateDraft(context: DraftSaveContext, payload: DraftPayload): TemplateDraftSnapshot {
  return { ...context, key: context.key ? { ...context.key } : null, payload: structuredClone(payload) };
}

export function sameDraftKey(a: DraftKey | null, b: DraftKey | null): boolean {
  if (!a || !b) return a === b;
  if (a.templateId || b.templateId) return a.templateId === b.templateId;
  return a.sourceFileId === b.sourceFileId;
}

export function isDraftSaveContextCurrent(saved: DraftSaveContext, current: DraftSaveContext): boolean {
  return saved.revision === current.revision && sameDraftKey(saved.key, current.key)
    && saved.payloadVersion === current.payloadVersion;
}

interface DraftTransport {
  upsert(key: DraftKey, payload: DraftPayload): Promise<unknown>;
  clear(key: DraftKey, preservedPayload?: DraftPayload): Promise<unknown>;
  /** A late response must not write with another signed-in account. */
  sameSession(): boolean;
  /** Adopt only if the captured document/revision is still being edited. */
  adopt(): boolean;
  /** Fence confirmed old revisions; false keeps an unsettled old slot intact. */
  prepareCleanup?(key: DraftKey, revision: number): boolean;
}

/** Preserve filled values separately from the newly saved, blank structure. */
export async function preserveTemplateDraft(
  templateId: string,
  snapshot: TemplateDraftSnapshot,
  transport: DraftTransport,
): Promise<{ adopted: boolean; cleanupFailed: boolean }> {
  if (!templateId || !transport.sameSession()) throw new Error('Draft session changed');
  const key = { templateId };
  // A source-file slot may already exist. Combining both keys collides with
  // Draft(userId, sourceFileId) even though this template slot is new.
  await transport.upsert(key, snapshot.payload);

  // Preserve the saved copy, but keep a newer/different editor context intact.
  if (!transport.sameSession() || !transport.adopt()) return { adopted: false, cleanupFailed: false };
  if (snapshot.key && !sameDraftKey(snapshot.key, key)) {
    try {
      // The editor has adopted the new key before old-slot cleanup begins.
      if (!transport.sameSession()) return { adopted: true, cleanupFailed: true };
      if (transport.prepareCleanup && !transport.prepareCleanup(snapshot.key, snapshot.revision)) {
        return { adopted: true, cleanupFailed: true };
      }
      await transport.clear(snapshot.key, snapshot.payload);
    } catch {
      return { adopted: true, cleanupFailed: true };
    }
  }
  return { adopted: true, cleanupFailed: false };
}
