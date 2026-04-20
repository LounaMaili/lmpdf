/**
 * App.tsx — Main application component for LMPdf.
 *
 * This file contains the core editor logic: PDF/image document loading,
 * field management (create, move, resize, delete), text overflow across
 * multiple fields (distributed, continuous, and fused modes), autosave,
 * drag-and-drop file upload, keyboard navigation, and PDF export.
 *
 * The component is organized as follows:
 *   1. Module-level constants and helpers
 *   2. Main App component with state declarations
 *   3. Permission and role computations
 *   4. Zoom / rotation / marquee helpers
 *   5. Keyboard shortcut handling
 *   6. Overflow logic (estimateFieldCapacity, takeFieldChunk, sortOverflowGroup, updateFieldValueWithOverflow)
 *   7. Template and document CRUD operations
 *   8. Export and print handlers
 *   9. JSX render (toolbar, left panel, editor canvas, properties panel)
 */

/** Enable verbose console logging for the fused overflow mode (development only). */
const DEBUG_FUSED = false;

/** Global toggle for the experimental fused overflow interaction mode. */
const ENABLE_FUSED_MODE = false;

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearDraft, deleteTemplate, detectFields, getDraft, getDocumentUrl, getMyDocRole, getMyPermissions, listFolders, listTemplates, moveTemplateToFolder, renameTemplate, resolveExportDestination, runServerExport, saveTemplate, upsertDraft, uploadDocument, type DraftRecord, type RolePermissions } from './api';
import FieldOverlay from './components/FieldOverlay';
import PdfViewer from './components/PdfViewer';
import PropertiesPanel from './components/PropertiesPanel';
import { buildBreadcrumb } from './components/FolderTree';
import AutosaveIndicator from './components/AutosaveIndicator';
import DraftRestoreModal from './components/DraftRestoreModal';
import {
  MenuIcon, ChevronDownIcon, SaveIcon, DownloadIcon, PrintIcon, ShareIcon,
  LockIcon, UnlockIcon, TrashIcon, EditIcon, EyeIcon,
  RotateLeftIcon, RotateRightIcon, ZoomInIcon, ZoomOutIcon,
  UserIcon, ShieldIcon, UploadIcon, CloudUploadIcon, CloudDownloadIcon,
  PlusIcon, LayoutIcon, WandIcon, PanelLeftIcon, PanelRightIcon, SunIcon, MoonIcon,
} from './components/Icons';
import type { FolderModel } from './api';
import { defaultDocumentPreset, defaultFieldStyle } from './types';
import { exportFilledPdf, generateFilledPdfBlob } from './exportPdf';
import { displayDims, findNearestField } from './utils';
import type { Rotation } from './utils';
import type { DocumentPreset, FieldModel, FieldType, TemplateModel } from './types';
import { getStoredUser } from './auth';
import { useAutosave } from './hooks/useAutosave';
import { useTranslation } from './i18n';

/** Strip all HTML tags from a string, returning plain text. */
const stripHtml = (s: string): string => s.replace(/<[^>]*>/g, '');

/** Default page dimensions (A4 at 96 dpi, in pixels). */
const DEFAULT_WIDTH = 794;
const DEFAULT_HEIGHT = 1123;

/** Discrete zoom levels available to the user via +/- buttons. */
const ZOOM_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2.0];
/** Lazy-loaded sharing modal for document collaboration. */
const ShareModal = lazy(() => import('./components/ShareModal'));

/**
 * Strip field values to produce a clean template (structure only).
 * Resets counters to "0" and clears all other values.
 */
function stripFieldValues(fields: FieldModel[]): FieldModel[] {
  return fields.map((f) => ({
    ...f,
    value: f.type === 'counter-tally' || f.type === 'counter-numeric' ? '0' : '',
  }));
}

/**
 * Tracks the visual/overflow state for a group of fields sharing the same overflow group.
 * Used by both continuous and fused overflow modes.
 */
type OverflowUiStateEntry = {
  /** The field that anchors the overflow zone (typically the first field edited). */
  anchorFieldId: string;
  /** All field IDs currently participating in the overflow zone. */
  usedFieldIds: string[];
  /** The full concatenated text across all participating fields. */
  globalText: string;
  /** Monotonically increasing version counter for change detection. */
  version: number;
};

/**
 * Parse a continuous-mode state key into its components.
 * Keys follow the format "<page>:<groupId>:<anchorFieldId>".
 * Returns null if the key format is invalid.
 */
const parseContinuousKey = (key: string): { page: number; groupId: string; anchorId: string } | null => {
  const first = key.indexOf(':');
  const last = key.lastIndexOf(':');
  if (first <= 0 || last <= first) return null;
  const page = Number(key.slice(0, first));
  if (!Number.isFinite(page) || page <= 0) return null;
  const groupId = key.slice(first + 1, last);
  const anchorId = key.slice(last + 1);
  if (!groupId || !anchorId) return null;
  return { page, groupId, anchorId };
};

// docRoleLabel moved inside component to access t() — see useDocRoleLabel below

/**
 * Derive a permission set from a user role when the server doesn't provide explicit permissions.
 * Admin/editor get full access; everyone else gets read-only.
 */
function fallbackPermissionsForRole(role?: string): RolePermissions {
  if (role === 'admin' || role === 'editor') {
    return {
      uploadDocument: true,
      createTemplate: true,
      manageTemplate: true,
      editStructure: true,
      createPage: true,
      exportPdf: true,
      printDocument: true,
    };
  }
  return {
    uploadDocument: false,
    createTemplate: false,
    manageTemplate: false,
    editStructure: false,
    createPage: false,
    exportPdf: false,
    printDocument: false,
  };
}

/**
 * Props for the top-level App component.
 * All props are optional — the component can also derive the current user from localStorage.
 */
type AppProps = {
  /** Currently authenticated user, or null if logged out. */
  currentUser?: import('./auth').AuthUser | null;
  /** Callback to log the user out. */
  onLogout?: () => void;
  /** Callback to open the admin settings panel. */
  onShowAdminSettings?: () => void;
  /** Callback to open the MFA settings panel. */
  onShowMfaSettings?: () => void;
};

/**
 * Main application component — the PDF/image field editor.
 *
 * Manages the entire lifecycle: document loading, field creation/edition,
 * overflow text distribution, autosave, export, and user permissions.
 */
export default function App({ currentUser: currentUserProp, onLogout, onShowAdminSettings, onShowMfaSettings }: AppProps = {}) {
  const { t } = useTranslation();
  /** Prefer the prop-supplied user; fall back to whatever is stored in localStorage. */
  const currentUser = currentUserProp ?? getStoredUser();
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const docRoleLabel = (role: 'owner' | 'editor' | 'filler' | null) => {
    if (role === 'owner') return t('roles.owner');
    if (role === 'editor') return t('roles.editor');
    if (role === 'filler') return t('roles.filler');
    return t('roles.noAccess');
  };

  /** Fill in optional FieldModel properties with sensible defaults. */
  const normalizeField = (f: Partial<FieldModel> & Pick<FieldModel, 'id' | 'label' | 'x' | 'y' | 'w' | 'h' | 'type'>): FieldModel => ({
    ...f,
    value: f.value ?? '',
    style: f.style ?? { ...defaultFieldStyle },
    locked: f.locked ?? false,
    overlayVisible: f.overlayVisible ?? true,
    pageNumber: f.pageNumber ?? 1,
  });

  /** Return the appropriate "blank" value for a field based on its type. */
  const getBlankFieldValue = (field: Pick<FieldModel, 'type'>): string => {
    if (field.type === 'checkbox') return 'false';
    if (field.type === 'counter-tally' || field.type === 'counter-numeric') return '0';
    return '';
  };

  /** Reset all field values to their type-appropriate blank (used when loading a template in blank mode). */
  const stripTemplateFieldValues = (items: FieldModel[]): FieldModel[] =>
    items.map((field) => ({ ...field, value: getBlankFieldValue(field) }));

  // ───── Core state ─────

  /** Server-granted permission flags for the current user. */
  const [rolePermissions, setRolePermissions] = useState<RolePermissions>(fallbackPermissionsForRole(currentUser?.role));
  /** Editable template/document name. */
  const [name, setName] = useState('template-a4');
  /** All fields across all pages. */
  const [fields, setFields] = useState<FieldModel[]>([]);
  /** ID of the currently selected field (single selection leader). */
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  /** Set of field IDs included in the current multi-selection (marquee or Ctrl+click). */
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
  /** Server-side file ID of the uploaded PDF/image source. */
  const [sourceFileId, setSourceFileId] = useState<string | undefined>();
  /** Blob/object URL for rendering the source document. */
  const [sourceUrl, setSourceUrl] = useState<string | undefined>();
  /** MIME type of the source document (determines PDF vs image rendering). */
  const [sourceMime, setSourceMime] = useState<string | undefined>();
  /** All templates visible to the current user. */
  const [templates, setTemplates] = useState<TemplateModel[]>([]);
  /** Status bar message (ephemeral feedback). */
  const [status, setStatus] = useState('');
  /** Whether unsaved edits exist (warns before destructive resets). */
  const [dirty, setDirty] = useState(false);
  /** Whether the share-collaboration modal is open. */
  const [showShareModal, setShowShareModal] = useState(false);
  /** The current user's role on the active document (owner/editor/filler). */
  const [docRole, setDocRole] = useState<'owner' | 'editor' | 'filler' | null>(null);
  // ───── Derived permission booleans (combining global perms with doc-level role) ─────
  const canEditStructure = rolePermissions.editStructure && docRole !== 'filler';
  const canSaveTemplate = rolePermissions.createTemplate && (docRole === 'owner' || docRole === 'editor' || docRole === null);
  const canManageTemplate = rolePermissions.manageTemplate && (docRole === 'owner' || docRole === 'editor' || docRole === null);
  const canExport = rolePermissions.exportPdf && docRole !== 'filler';
  const canPrintDoc = rolePermissions.printDocument && docRole !== 'filler';
  /** Currently selected folder in the template library. */
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  /** All folders fetched from the server. */
  const [allFolders, setAllFolders] = useState<FolderModel[]>([]);
  /** Total number of pages in the current document. */
  const [pageCount, setPageCount] = useState(1);
  /** The page currently displayed and active for editing. */
  const [activePage, setActivePage] = useState(1);

  // Keep field geometry in natural page units; zoom/rotation are view-only transforms.
  /** Natural page width (before rotation). */
  const [pageW, setPageW] = useState(DEFAULT_WIDTH);
  /** Natural page height (before rotation). */
  const [pageH, setPageH] = useState(DEFAULT_HEIGHT);
  // Source document dimensions (before any scaling) — kept for diagnostics only.
  const [srcW, setSrcW] = useState(0);
  const [srcH, setSrcH] = useState(0);

  /** Current page rotation in degrees (0, 90, 180, or 270). */
  const [rotation, setRotation] = useState<Rotation>(0);

  /** Index into ZOOM_STEPS for the current zoom level. */
  const [zoomIndex, setZoomIndex] = useState(4);
  /** Whether a file is being dragged over the window (for the drop overlay). */
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  /** Computed zoom factor from the current zoom index. */
  const zoom = ZOOM_STEPS[zoomIndex];

  /** Default style preset applied to newly created fields. */
  const [preset, setPreset] = useState<DocumentPreset>({ ...defaultDocumentPreset });
  /** If true, the user is in "fill mode" (edit values only, not structure). */
  const [fillMode, setFillMode] = useState(true);
  /** Toggle to render overflow-order index numbers on each field (visual debug aid). */
  const [showDebugOrder, setShowDebugOrder] = useState(false);
  /** Tracks visual/overflow state per group key (continuous & fused modes). */
  const [fusedUiState, setFusedUiState] = useState<Record<string, OverflowUiStateEntry>>({});
  /** Viewport fit strategy: 'page' fits the entire page, 'width' fits only the width. */
  const [fitMode, setFitMode] = useState<'page' | 'width'>('width');

  // ───── Draft restore state ─────
  const [pendingDraft, setPendingDraft] = useState<DraftRecord | null>(null);
  const [loadedTemplateId, setLoadedTemplateId] = useState<string | null>(null);

  // ───── Autosave ─────
  // Compute the draft key: prefer loaded templateId, fallback to sourceFileId
  const draftKey = useMemo(() => {
    if (loadedTemplateId) return { templateId: loadedTemplateId };
    if (sourceFileId) return { sourceFileId };
    return null;
  }, [loadedTemplateId, sourceFileId]);

  const buildDraftPayload = useCallback(() => ({
    name,
    fields,
    rotation,
    pageCount,
    preset,
  }), [name, fields, rotation, pageCount, preset]);

  const autosaveState = useAutosave(
    dirty,
    draftKey,
    buildDraftPayload,
    { enabled: !!currentUser && !!draftKey },
  );

  /**
   * Reverse index: for each field ID, find the continuous-mode state entry that includes it.
   * Used to quickly look up whether a field participates in an active continuous overflow zone.
   */
  const continuousStateByFieldId = useMemo(() => {
    const byField = new Map<string, [string, OverflowUiStateEntry]>();
    for (const [key, state] of Object.entries(fusedUiState)) {
      const parsed = parseContinuousKey(key);
      if (!parsed) continue;
      if (!byField.has(state.anchorFieldId)) byField.set(state.anchorFieldId, [key, state]);
      for (const fid of state.usedFieldIds) {
        if (!byField.has(fid)) byField.set(fid, [key, state]);
      }
    }
    return byField;
  }, [fusedUiState]);

  /** Get the continuous-mode state entry for a specific field, validating page and group match. */
  const getContinuousStateForField = (field: FieldModel) => {
    const gid = (field.style.overflowGroupId || '').trim();
    if (!gid) return undefined as undefined | [string, OverflowUiStateEntry];
    const entry = continuousStateByFieldId.get(field.id);
    if (!entry) return undefined;
    const [key] = entry;
    const parsed = parseContinuousKey(key);
    if (!parsed) return undefined;
    if (parsed.page !== (field.pageNumber ?? 1)) return undefined;
    if (parsed.groupId !== gid) return undefined;
    return entry;
  };

  /** Get the continuous-mode state entry by explicit page, groupId, and fieldId. */
  const getContinuousStateForFieldId = (page: number, gid: string, fieldId: string) => {
    const entry = continuousStateByFieldId.get(fieldId);
    if (!entry) return undefined;
    const [key] = entry;
    const parsed = parseContinuousKey(key);
    if (!parsed) return undefined;
    if (parsed.page !== page) return undefined;
    if (parsed.groupId !== gid) return undefined;
    return entry;
  };

  // ───── Cleanup stale fused/continuous UI state ─────
  // Safety: keep legacy fused UI state from affecting normal overflow modes.
  // Continuous mode uses keys like "<page>:<groupId>:<anchorFieldId>".
  useEffect(() => {
    if (Object.keys(fusedUiState).length === 0) return;

    const activeContinuousGroups = new Set<string>();
    const activeFusedKeys = new Set<string>();

    for (const f of fields) {
      const gid = (f.style.overflowGroupId || '').trim();
      if (!gid) continue;
      const page = f.pageNumber ?? 1;
      const mode = f.style.overflowInteractionMode || 'distributed';
      if (mode === 'continuous') {
        activeContinuousGroups.add(`${page}:${gid}`);
      } else if (mode === 'fused' && ENABLE_FUSED_MODE) {
        activeFusedKeys.add(`${page}:${gid}`);
      }
    }

    const toRemove: string[] = [];
    for (const key of Object.keys(fusedUiState)) {
      const parsed = parseContinuousKey(key);
      if (parsed) {
        if (!activeContinuousGroups.has(`${parsed.page}:${parsed.groupId}`)) toRemove.push(key);
        continue;
      }
      if (!activeFusedKeys.has(key)) toRemove.push(key);
    }

    if (toRemove.length > 0) {
      setFusedUiState((prev) => {
        const next = { ...prev };
        for (const k of toRemove) delete next[k];
        return next;
      });
    }
  }, [fusedUiState, fields]);

  // ───── Drag & drop file upload (global listeners on document root) ─────
  useEffect(() => {
    const el = document.documentElement;
    const onDragEnter = (e: DragEvent) => { e.preventDefault(); if (e.dataTransfer?.types.includes('Files')) setIsDraggingOver(true); };
    const onDragOver = (e: DragEvent) => { e.preventDefault(); };
    const onDragLeave = (e: DragEvent) => {
      if (e.clientX === 0 && e.clientY === 0) setIsDraggingOver(false);
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      setIsDraggingOver(false);
      const file = e.dataTransfer?.files?.[0];
      if (!file) return;
      const allowedTypes = ['application/pdf', 'image/png', 'image/jpeg', 'image/gif', 'image/webp'];
      if (!allowedTypes.includes(file.type)) return;
      const input = document.querySelector<HTMLInputElement>('input[type=file]');
      const dt = new DataTransfer();
      dt.items.add(file);
      if (input) { input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true })); }
    };
    el.addEventListener('dragenter', onDragEnter);
    el.addEventListener('dragover', onDragOver);
    el.addEventListener('dragleave', onDragLeave);
    el.addEventListener('drop', onDrop);
    return () => {
      el.removeEventListener('dragenter', onDragEnter);
      el.removeEventListener('dragover', onDragOver);
      el.removeEventListener('dragleave', onDragLeave);
      el.removeEventListener('drop', onDrop);
    };
  }, []);

  /** Sensitivity preset for server-side field detection (low/normal/high). */
  const [detectSensitivity, setDetectSensitivity] = useState<'low' | 'normal' | 'high'>('normal');
  /** Whether to treat dotted lines as solid during field detection. */
  const [detectDottedAsLine, setDetectDottedAsLine] = useState(false);
  /** Whether a field detection request is currently in flight. */
  const [isDetecting, setIsDetecting] = useState(false);
  /** Ref to the editor scroll container (used for zoom fitting). */
  const editorRef = useRef<HTMLDivElement>(null);
  const iconBarRef = useRef<HTMLElement>(null);
  /** ID of a field that should receive DOM focus after the next render (Tab navigation). */
  const pendingFocusRef = useRef<string | null>(null);

  // ───── Marquee (rubber-band) selection state ─────
  /** Current marquee rectangle in field-space coordinates, or null if not dragging. */
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  /** Page number the marquee is active on. */
  const [marqueePageNum, setMarqueePageNum] = useState(0);
  /** Guard to prevent the click handler from deselecting right after a marquee drag ends. */
  const marqueeJustEndedRef = useRef(false);
  /** Live ref to the fields array so event listeners can read the latest value without re-registering. */
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  /** The currently selected field model, or null. */
  const selectedField = fields.find((f) => f.id === selectedFieldId) ?? null;

  // Wrapper dimensions follow rotation to keep the editor scroll area aligned.
  /** Display dimensions accounting for rotation (width/height may be swapped). */
  const [dispW, dispH] = displayDims(pageW, pageH, rotation);

  /** Device pixel ratio for high-DPI canvas rendering. */
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

  /**
   * Transform a field's natural coordinates to visual (screen) coordinates,
   * accounting for the current rotation. Used for arrow-key navigation and
   * overflow ordering.
   */
  const toVisualRect = (f: FieldModel) => {
    if (rotation === 90) {
      return { x: pageH - (f.y + f.h), y: f.x, w: f.h, h: f.w };
    }
    if (rotation === 180) {
      return { x: pageW - (f.x + f.w), y: pageH - (f.y + f.h), w: f.w, h: f.h };
    }
    if (rotation === 270) {
      return { x: f.y, y: pageW - (f.x + f.w), w: f.h, h: f.w };
    }
    return { x: f.x, y: f.y, w: f.w, h: f.h };
  };

  // ───── Initial data loading (runs once on mount) ─────
  useEffect(() => {
    listTemplates().then(setTemplates).catch(() => undefined);
    getMyPermissions().then(setRolePermissions).catch(() => undefined);
  }, []);

  /** Fetch the user's effective role on the current document whenever the source file changes. */
  useEffect(() => {
    if (!sourceFileId) { setDocRole(null); return; }
    getMyDocRole(sourceFileId).then((r) => setDocRole(r.docRole as any)).catch(() => setDocRole(null));
  }, [sourceFileId]);

  /**
   * Adjust the zoom level so the page fits within the editor viewport.
   * Snaps to the nearest discrete ZOOM_STEP.
   */
  const applyFitZoom = useCallback((w: number, h: number) => {
    const el = editorRef.current;
    if (!el || w <= 0 || h <= 0) return;

    // Use actual content area (clientWidth minus padding) for accurate fit calculation
    const cs = getComputedStyle(el);
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const padT = parseFloat(cs.paddingTop) || 0;
    const padB = parseFloat(cs.paddingBottom) || 0;
    const availableW = Math.max(200, el.clientWidth - padL - padR);
    const availableH = Math.max(200, el.clientHeight - padT - padB);
    const fit = fitMode === 'width' ? (availableW / w) : Math.min(availableW / w, availableH / h);

    let effectiveFit = fit;
    // In 'width' mode: allow zoom > 1 if document is small enough to fill width
    if (fitMode === 'width' && fit > 1.0 && (availableW - w) > 100) {
      effectiveFit = availableW / w;
    }
    // In 'page' mode: never exceed 100%
    if (fitMode === 'page') {
      effectiveFit = Math.min(effectiveFit, 1.0);
    }

    const clamped = Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], effectiveFit));

    // Snap to largest step <= clamped (document never exceeds available space)
    let best = 0;
    for (let i = 0; i < ZOOM_STEPS.length; i++) {
      if (ZOOM_STEPS[i] <= clamped) best = i;
    }
    setZoomIndex(best);
  }, [fitMode]);

  // ───── Global keyboard shortcuts ─────
  // Keep keyboard shortcuts global while scoping Tab cycling to the editor area.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Tab' && fields.length > 0) {
        const target = e.target as HTMLElement;
        if (target.closest('.editor') || target.closest('.field')) {
          e.preventDefault();
          e.stopPropagation();
          const currentIdx = selectedFieldId
            ? fields.findIndex((f) => f.id === selectedFieldId)
            : -1;
          let nextIdx: number;
          if (e.shiftKey) {
            nextIdx = currentIdx <= 0 ? fields.length - 1 : currentIdx - 1;
          } else {
            nextIdx = (currentIdx + 1) % fields.length;
          }
          const next = fields[nextIdx];
          setSelectedFieldId(next.id);
          setMultiSelectedIds(new Set([next.id]));
          pendingFocusRef.current = next.id;
          return;
        }
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        const target = e.target as HTMLElement;
        const isTextInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

        // Navigation between fields works with Ctrl+Arrow OR Alt+Arrow always.
        // In text inputs, plain arrows keep native caret behavior.
        const wantsFieldNavigation = e.ctrlKey || e.altKey;
        if (isTextInput && !wantsFieldNavigation) return;

        e.preventDefault();

        if (!selectedFieldId) {
          const pageFields = fields.filter((f) => (f.pageNumber ?? 1) === activePage);
          if (pageFields.length > 0) {
            const first = pageFields[0];
            setSelectedFieldId(first.id);
            setMultiSelectedIds(new Set([first.id]));
            pendingFocusRef.current = first.id;
          }
          return;
        }

        // Always filter by active page for consistent physical navigation
        const pageFields = fields.filter((f) => (f.pageNumber ?? 1) === activePage);
        const projected = pageFields.map((f) => {
          const r = toVisualRect(f);
          return { ...f, x: r.x, y: r.y, w: r.w, h: r.h };
        });
        const next = findNearestField(selectedFieldId, projected, e.key as any);
        if (next) {
          setSelectedFieldId(next.id);
          setMultiSelectedIds(new Set([next.id]));
          pendingFocusRef.current = next.id;
        }
        return;
      }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (fillMode) return;
        // Never intercept Delete/Backspace while the user is editing a form control.
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

        e.preventDefault();
        if (multiSelectedIds.size > 0) {
          setFields((prev) => prev.filter((f) => !multiSelectedIds.has(f.id)));
          setSelectedFieldId(null);
          setMultiSelectedIds(new Set());
          setDirty(true);
        } else if (selectedFieldId) {
          setFields((prev) => prev.filter((f) => f.id !== selectedFieldId));
          setSelectedFieldId(null);
          setDirty(true);
        }
      }

      // Ctrl+L: lock all selected fields; Ctrl+Shift+L: unlock all selected
      if (e.key === 'l' || e.key === 'L') {
        if ((e.ctrlKey || e.metaKey) && multiSelectedIds.size > 0 && canEditStructure && !fillMode) {
          e.preventDefault();
          bulkUpdateFields(Array.from(multiSelectedIds), { locked: !e.shiftKey });
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFieldId, multiSelectedIds, fields, fillMode, activePage, rotation, pageW, pageH]);

  /** After Tab/arrow selection, move DOM focus to the field's input control for immediate typing. */
  useEffect(() => {
    const targetId = pendingFocusRef.current;
    if (!targetId) return;
    pendingFocusRef.current = null;
    requestAnimationFrame(() => {
      const el = document.querySelector(`[data-field-id="${targetId}"]`);
      if (!el) return;
      const focusable = el.querySelector('textarea, input, .checkbox-display, .counter-display') as HTMLElement;
      if (focusable) focusable.focus();
    });
  }, [selectedFieldId]);

  /** Callback from PdfViewer when the PDF page dimensions are determined. */
  const onPdfDimensions = useCallback((w: number, h: number, origW: number, origH: number) => {
    setPageW(w);
    setPageH(h);
    setSrcW(origW);
    setSrcH(origH);
    applyFitZoom(w, h);
  }, [applyFitZoom]);

  useEffect(() => {
    applyFitZoom(pageW, pageH);
  }, [fitMode, pageW, pageH, applyFitZoom]);

  // Recalculate zoom when window is resized (editor.availableWidth changes)
  useEffect(() => {
    const handler = () => applyFitZoom(pageW, pageH);
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, [pageW, pageH, applyFitZoom]);

  // Force icon bar into bottom dock on narrow screens (bypass CSS issues)
  useEffect(() => {
    const apply = () => {
      const el = iconBarRef.current;
      if (!el) return;
      if (window.innerWidth <= 768) {
        el.style.position = 'fixed';
        el.style.bottom = '0';
        el.style.left = '0';
        el.style.right = '0';
        el.style.top = 'auto';
        el.style.width = '100%';
        el.style.height = '52px';
        el.style.display = 'flex';
        el.style.flexDirection = 'row';
        el.style.justifyContent = 'space-around';
        el.style.alignItems = 'center';
        el.style.zIndex = '99';
        el.style.borderRight = 'none';
        el.style.borderTop = '2px solid #3b82f6';
        el.style.background = '#fff';
        el.style.boxShadow = '0 -4px 16px rgba(59,130,246,0.25)';
        el.style.padding = '4px 8px';
        // Show debug banner on mobile
        const dbg = document.getElementById('mobile-debug');
        if (dbg) { dbg.style.display = 'block'; dbg.textContent = `Mobile detected: ${window.innerWidth}px, iconBar: ${!!el}`; }
      } else {
        el.style.position = '';
        el.style.bottom = '';
        el.style.left = '';
        el.style.right = '';
        el.style.top = '';
        el.style.width = '';
        el.style.height = '';
        el.style.display = '';
        el.style.flexDirection = '';
        el.style.justifyContent = '';
        el.style.alignItems = '';
        el.style.zIndex = '';
        el.style.borderRight = '';
        el.style.borderTop = '';
        el.style.background = '';
        el.style.boxShadow = '';
        el.style.padding = '';
      }
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
  }, []);

  /** Callback when the source image loads and its natural dimensions become available. */
  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setSrcW(img.naturalWidth);
    setSrcH(img.naturalHeight);
    setPageW(img.naturalWidth);
    setPageH(img.naturalHeight);
    applyFitZoom(img.naturalWidth, img.naturalHeight);
  }, [applyFitZoom]);

  /**
   * Select a field by ID, supporting additive (Ctrl/Cmd) multi-selection.
   * Ctrl/Cmd keeps additive selection behavior consistent between canvas and side panel.
   */
  const handleSelectField = (id: string | null, ctrlKey = false) => {
    if (id === null) {
      setSelectedFieldId(null);
      setMultiSelectedIds(new Set());
      return;
    }
    const targetField = fields.find((f) => f.id === id);
    if (targetField?.pageNumber) setActivePage(targetField.pageNumber);
    if (ctrlKey) {
      setMultiSelectedIds((prev) => {
        const next = new Set(prev);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      });
      setSelectedFieldId(id);
    } else {
      setSelectedFieldId(id);
      setMultiSelectedIds(new Set([id]));
    }
  };

  // ───── Marquee (rubber-band) selection helpers ─────

  /** Check whether two axis-aligned rectangles intersect. */
  const rectsIntersect = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  /** Convert a screen point (clientX/Y) to field-space coords on the given page element, undoing rotation. */
  const screenToFieldCoords = (clientX: number, clientY: number, pageEl: HTMLElement): { fx: number; fy: number } => {
    const rect = pageEl.getBoundingClientRect();
    // Visible coords relative to the page element (before accounting for zoom/rotation transform)
    const vx = (clientX - rect.left) / zoom;
    const vy = (clientY - rect.top) / zoom;
    // Undo rotation to get field-space coords
    if (rotation === 90) return { fx: vy, fy: pageH - vx };
    if (rotation === 180) return { fx: pageW - vx, fy: pageH - vy };
    if (rotation === 270) return { fx: pageW - vy, fy: vx };
    return { fx: vx, fy: vy };
  };

  /**
   * Begin a marquee (rubber-band) selection drag on the given page.
   * Alt+drag forces marquee even when starting over a field.
   * Ctrl/Cmd starts with the existing selection (additive).
   */
  const startMarquee = (e: React.MouseEvent, pageNum: number) => {
    // Only start on left button. Default mode = empty canvas only.
    // Alt+drag forces marquee even when starting over a field.
    if (e.button !== 0) return;
    if (fillMode) return; // Don't start marquee in fill mode
    const target = e.target as HTMLElement;
    const forceMarquee = e.altKey;
    // If the click lands on a field, skip unless Alt forces marquee mode.
    if (target.closest('.field') && !forceMarquee) return;

    const pageEl = e.currentTarget as HTMLElement;
    const { fx: startFx, fy: startFy } = screenToFieldCoords(e.clientX, e.clientY, pageEl);
    const additive = e.ctrlKey || e.metaKey;
    const baseSelection = additive ? new Set(multiSelectedIds) : new Set<string>();

    e.preventDefault();
    e.stopPropagation();

    setActivePage(pageNum);
    setMarqueePageNum(pageNum);
    setMarqueeRect({ x: startFx, y: startFy, w: 0, h: 0 });

    const onMouseMove = (ev: MouseEvent) => {
      const { fx: curFx, fy: curFy } = screenToFieldCoords(ev.clientX, ev.clientY, pageEl);
      const mx = Math.min(startFx, curFx);
      const my = Math.min(startFy, curFy);
      const mw = Math.abs(curFx - startFx);
      const mh = Math.abs(curFy - startFy);
      const mRect = { x: mx, y: my, w: mw, h: mh };
      setMarqueeRect(mRect);

      // Compute which fields are intersected
      const currentFields = fieldsRef.current;
      const pageFields = currentFields.filter((f) => (f.pageNumber ?? 1) === pageNum);
      const hitIds = new Set(baseSelection);
      for (const f of pageFields) {
        const fRect = { x: f.x, y: f.y, w: f.w, h: f.h };
        if (rectsIntersect(mRect, fRect)) {
          hitIds.add(f.id);
        }
      }
      setMultiSelectedIds(hitIds);
      if (hitIds.size > 0) {
        const first = [...hitIds][hitIds.size - 1];
        setSelectedFieldId(first);
      } else if (!additive) {
        setSelectedFieldId(null);
      }
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      setMarqueeRect(null);
      setMarqueePageNum(0);
      // Prevent the click handler from deselecting everything right after marquee
      marqueeJustEndedRef.current = true;
      requestAnimationFrame(() => { marqueeJustEndedRef.current = false; });
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  /** Add a new text field at a default position on the active page. */
  const addField = () => {
    if (!canEditStructure) {
      setStatus(t('status.insufficientRightsField'));
      return;
    }
    const newField: FieldModel = {
      id: crypto.randomUUID(),
      label: t('fields.fieldLabel', { n: fields.length + 1 }),
      value: '',
      x: 100,
      y: 100 + (fields.length % 20) * 36,
      w: 220,
      h: 30,
      type: 'text',
      style: {
        fontFamily: preset.fontFamily,
        fontSize: preset.fontSize,
        fontWeight: preset.fontWeight,
        textAlign: 'left',
        color: preset.color,
      },
      locked: false,
      overlayVisible: true,
      pageNumber: activePage,
    };
    setFields((prev) => [...prev, newField]);
    handleSelectField(newField.id);
    setDirty(true);
  };

  /**
   * Append a new blank page. Fields marked with `carryToNextPage` are cloned
   * onto the new page (with values cleared or preserved per `carryValueMode`).
   */
  const addPage = () => {
    if (!canEditStructure) {
      setStatus(t('status.insufficientRightsPage'));
      return;
    }
    const newPage = pageCount + 1;
    const carryFromPage = fields.filter((f) => (f.pageNumber ?? 1) === activePage && Boolean(f.style.carryToNextPage));
    const clones: FieldModel[] = carryFromPage.map((f) => ({
      ...f,
      id: crypto.randomUUID(),
      pageNumber: newPage,
      value: f.style.carryValueMode === 'clear' ? '' : f.value,
    }));
    if (clones.length > 0) {
      setFields((prev) => [...prev, ...clones]);
      setDirty(true);
    }
    setPageCount(newPage);
    setActivePage(newPage);
    setStatus(clones.length > 0
      ? t('status.newPageWithCarry', { page: newPage, count: clones.length })
      : t('status.newPageCreated', { page: newPage }));
  };

  /** Duplicate the active page (all its fields) as a new page at the end. */
  const duplicateActivePage = () => {
    if (!canEditStructure) {
      setStatus(t('status.insufficientRightsDuplicatePage'));
      return;
    }
    const newPage = pageCount + 1;
    const sourceFields = fields.filter((f) => (f.pageNumber ?? 1) === activePage);
    const clones: FieldModel[] = sourceFields.map((f) => ({ ...f, id: crypto.randomUUID(), pageNumber: newPage }));
    if (clones.length > 0) {
      setFields((prev) => [...prev, ...clones]);
      setDirty(true);
    }
    setPageCount(newPage);
    setActivePage(newPage);
    setStatus(t('status.pageDuplicated', { from: activePage, to: newPage }));
  };

  /** Delete the active page and renumber remaining pages. Cannot delete the last page. */
  const deleteActivePage = () => {
    if (!canEditStructure) {
      setStatus(t('status.insufficientRightsDeletePage'));
      return;
    }
    if (pageCount <= 1) {
      setStatus(t('status.cannotDeleteLastPage'));
      return;
    }
    if (!window.confirm(t('confirm.deletePageN', { page: activePage }))) return;

    setFields((prev) => prev
      .filter((f) => (f.pageNumber ?? 1) !== activePage)
      .map((f) => {
        const pn = f.pageNumber ?? 1;
        return pn > activePage ? { ...f, pageNumber: pn - 1 } : f;
      }));
    setPageCount((p) => p - 1);
    setActivePage((p) => Math.max(1, Math.min(p - 1, pageCount - 1)));
    setSelectedFieldId(null);
    setMultiSelectedIds(new Set());
    setDirty(true);
    setStatus(t('status.pageDeleted', { page: activePage }));
  };

  /** Duplicate a single field, offsetting it slightly below the original. */
  const duplicateField = (id: string) => {
    const source = fields.find((f) => f.id === id);
    if (!source) return;
    const dup: FieldModel = {
      ...source,
      id: crypto.randomUUID(),
      value: '',
      x: source.x + 10,
      y: source.y + source.h + 4,
      label: t('fields.copyLabel', { label: source.label }),
    };
    setFields((prev) => [...prev, dup]);
    handleSelectField(dup.id);
    setDirty(true);
  };

  /**
   * Update one or more properties on a single field by ID.
   * Merges the partial object into the existing field.
   */
  const updateField = (id: string, partial: Partial<FieldModel>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...partial } : f)));
    setDirty(true);
  };

  /** Update the same partial properties on multiple fields at once. */
  const bulkUpdateFields = (ids: string[], partial: Partial<FieldModel>) => {
    const setIds = new Set(ids);
    setFields((prev) => prev.map((f) => (setIds.has(f.id) ? { ...f, ...partial } : f)));
    setDirty(true);
  };

  /** Patch the style object on multiple text fields at once. */
  const bulkPatchFieldStyle = (ids: string[], stylePatch: Partial<FieldModel['style']>) => {
    const setIds = new Set(ids);
    setFields((prev) => prev.map((f) => {
      if (!setIds.has(f.id) || f.type !== 'text') return f;
      return { ...f, style: { ...f.style, ...stylePatch } };
    }));
    setDirty(true);
  };

  /**
   * Estimate how many characters a text field can visually hold based on its
   * dimensions and font size. Uses a heuristic: ~0.54 × fontSize chars per line,
   * ~fontSize × 1.2 px line height.
   */
  const estimateFieldCapacity = (field: FieldModel): number => {
    if (field.type !== 'text') return Number.MAX_SAFE_INTEGER;
    const fontSize = field.style.fontSize || 14;
    const innerW = Math.max(8, field.w - 6);  // Subtract horizontal padding (3px each side)
    const innerH = Math.max(8, field.h - 4);  // Subtract vertical padding (2px each side)
    const charsPerLine = Math.max(1, Math.floor(innerW / (fontSize * 0.54)));
    const lines = Math.max(1, Math.floor(innerH / (fontSize * 1.2)));
    return charsPerLine * lines;
  };

  /**
   * Extract the largest chunk of text that fits within a field's estimated capacity.
   * Prefers cutting at word boundaries (if within 90% of capacity) to avoid mid-word splits.
   * Works correctly with HTML content by mapping plain-text cut positions back to HTML offsets.
   */
  const takeFieldChunk = (text: string, field: FieldModel) => {
    const cap = estimateFieldCapacity(field);
    const plainLen = stripHtml(text).length;
    if (plainLen <= cap) {
      return { chunk: text, consumed: text.length, cap };
    }

    // Prefer cutting at a word boundary — work on plain text positions
    const plain = stripHtml(text);
    let cut = cap;
    const candidate = plain.slice(0, cap);
    const ws = Math.max(candidate.lastIndexOf(' '), candidate.lastIndexOf('\t'), candidate.lastIndexOf('\n'));
    if (ws >= Math.floor(cap * 0.9)) {
      cut = ws + 1;
    }

    // Map plain-text cut position back to HTML string position
    // by walking both strings in parallel, skipping HTML tags
    let htmlCut = 0;
    let plainCount = 0;
    let inTag = false;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '<') { inTag = true; htmlCut = i; continue; }
      if (text[i] === '>') { inTag = false; htmlCut = i + 1; continue; }
      if (!inTag) {
        plainCount++;
        if (plainCount > cut) { htmlCut = i; break; }
        htmlCut = i + 1;
      }
    }

    const chunk = text.slice(0, htmlCut);
    const consumed = htmlCut;

    return { chunk, consumed, cap };
  };

  /**
   * Strict capacity slice for fused mode: no word-boundary trimming.
   * `chunk.length === consumed` always (plain character count).
   */
  const takeFieldChunkStrict = (text: string, field: FieldModel) => {
    const cap = estimateFieldCapacity(field);
    const chunk = text.slice(0, cap);
    return { chunk, consumed: chunk.length, cap };
  };

  /**
   * Deterministic runtime order for overflow fields based on VISUAL coordinates
   * (after rotation). Fields are grouped into rows by Y proximity, then sorted
   * left→right within each row. If every field has an explicit `overflowOrder`,
   * that takes precedence.
   */
  const sortOverflowGroup = (group: FieldModel[]): FieldModel[] => {
    if (group.length <= 1) return [...group];

    // If every field has an explicit order, honor it first.
    const hasFullExplicitOrder = group.every((f) => Number.isFinite(f.style.overflowOrder));
    if (hasFullExplicitOrder) {
      return [...group].sort((a, b) => {
        const oa = Number(a.style.overflowOrder ?? 0);
        const ob = Number(b.style.overflowOrder ?? 0);
        if (oa !== ob) return oa - ob;
        if (a.y !== b.y) return a.y - b.y;
        return a.x - b.x;
      });
    }

    // Compute visual rects and derive an average height for row-grouping tolerance
    const items = group.map((f) => ({ f, r: toVisualRect(f) }));
    const avgH = items.length ? items.reduce((sum, it) => sum + it.r.h, 0) / items.length : 20;
    // Tolerance for grouping fields into the same visual row (half avg height, min 6px)
    const tol = Math.max(6, avgH * 0.5);

    // Group fields into rows by Y proximity, then flatten sorted top→bottom, left→right
    const rows: Array<typeof items> = [];
    for (const item of [...items].sort((a, b) => a.r.y - b.r.y)) {
      const row = rows.find((r) => Math.abs(r[0].r.y - item.r.y) <= tol);
      if (row) row.push(item);
      else rows.push([item]);
    }

    return rows
      .sort((a, b) => a[0].r.y - b[0].r.y)
      .flatMap((r) => r.sort((a, b) => a.r.x - b.r.x).map((x) => x.f));
  };

  /**
   * The core text-value update function with overflow distribution support.
   *
   * When a text field belongs to an overflow group, editing its value triggers
   * a redistribution of text across the group's fields according to the active
   * interaction mode:
   *
   *   - **distributed**: text flows forward field-by-field; edits reflow the local chain.
   *   - **continuous**: a local physical extension from an anchor field; the global
   *     text stream is diffed and redistributed across the extension zone.
   *   - **fused**: sticky-anchor mode where the first field edited becomes the anchor;
   *     non-anchor edits are non-destructive and reconstructed globally.
   *
   * For standalone fields (no overflow group), this simply calls `updateField`.
   *
   * @param id          - The ID of the field being edited.
   * @param newValue    - The new value of that field.
   * @param caretPosition - (Optional) caret position for fast-path optimizations.
   * @param meta        - (Optional) hints from the DOM about whether the field overflowed.
   */
  const updateFieldValueWithOverflow = (id: string, newValue: string, caretPosition?: number, meta?: { overflowed?: boolean }) => {
    const source = fields.find((f) => f.id === id);
    if (!source || source.type !== 'text') {
      updateField(id, { value: newValue });
      return;
    }

    const groupId = (source.style.overflowGroupId || '').trim();
    if (!groupId) {
      updateField(id, { value: newValue });
      return;
    }

    // Gather all text fields on the same page that share the same overflow group
    const group = sortOverflowGroup(
      fields.filter((f) => (f.pageNumber ?? 1) === (source.pageNumber ?? 1) && f.type === 'text' && (f.style.overflowGroupId || '').trim() === groupId)
    );

    if (group.length <= 1) {
      updateField(id, { value: newValue });
      return;
    }

    // Group behavior is defined by the first field in ordered chain (canonical settings).
    // This avoids inconsistent behavior when per-field styles drift.
    const groupLead = group[0] ?? source;
    const maxFields = groupLead.style.overflowMaxFields && groupLead.style.overflowMaxFields > 0
      ? groupLead.style.overflowMaxFields
      : undefined;
    // Cap the active chain to the configured max fields (or use the full group)
    const activeChain = maxFields ? group.slice(0, maxFields) : group;
    const changedIdx = activeChain.findIndex((f) => f.id === id);

    if (changedIdx < 0) {
      updateField(id, { value: newValue });
      return;
    }

    // ── MODE SELECTION ───────────────────────────────────────────────────
    // Determine which overflow interaction mode to use. Precedence:
    //   1) per-field override (source.style)
    //   2) group-level default (groupLead.style)
    //   3) hardcoded fallback 'distributed'
    // Fused mode is downgraded to distributed when the feature flag is off.
    const interactionModeRaw = source.style.overflowInteractionMode || groupLead.style.overflowInteractionMode || 'distributed';
    const interactionMode = (!ENABLE_FUSED_MODE && interactionModeRaw === 'fused') ? 'distributed' : interactionModeRaw;

    {
      const hasOverflowHint = typeof meta?.overflowed === 'boolean';
      const overflowHint = Boolean(meta?.overflowed);
      const localCap = estimateFieldCapacity(source);

      /** Heuristic: is a field visually "full" (within 1 char of capacity)? */
      const isFullLike = (field: FieldModel, value: string) => {
        const cap = estimateFieldCapacity(field);
        return stripHtml(value).length >= Math.max(1, cap - 1);
      };

      // ── CONTINUOUS MODE: physical extension (anchor + bounds) ─────────
      // In continuous mode, overflowing text "extends" a field into subsequent
      // empty fields in the group. The first field that started the overflow
      // becomes the "anchor". The UI visually stretches the anchor across all
      // used fields (via fusedUiState) while distributing the text internally.
      if (interactionMode === 'continuous') {
        const page = source.pageNumber ?? 1;
        const existingEntry = getContinuousStateForFieldId(page, groupId, id);
        const existingKey = existingEntry?.[0];
        const existingState = existingEntry?.[1];
        const localOnEnd = source.style.overflowOnEnd || groupLead.style.overflowOnEnd || 'truncate';

        // Check if this edit is on a field OUTSIDE the current extension zone.
        // Edits outside the zone either fit locally or start a new extension.
        const isInExtensionZone = !existingState || existingState.usedFieldIds.includes(id) || id === existingState.anchorFieldId;

        // Determine the anchor field for this continuous chain:
        // - if editing inside existing extension: keep the existing sticky anchor
        //   (anchor can move upward if an earlier field overflows)
        // - if editing outside extension and overflowing: start a new local extension from this field
        const previousAnchorId = existingState?.anchorFieldId ?? id;
        const previousAnchorIdx = activeChain.findIndex((f) => f.id === previousAnchorId);
        const baseAnchorIdx = (!existingState || isInExtensionZone)
          ? (previousAnchorIdx >= 0 ? previousAnchorIdx : changedIdx)
          : changedIdx;
        const effectiveAnchorIdx = Math.min(baseAnchorIdx, changedIdx);
        const effectiveAnchorId = activeChain[effectiveAnchorIdx].id;
        const targetContinuousKey = `${page}:${groupId}:${effectiveAnchorId}`;

        // Build a LOCAL continuous chain from anchor (or new start) without
        // rewriting unrelated fields that belong to separate local blocks.
        // A field is included if it was already part of the extension, is empty,
        // or follows a visually-full field.
        const chainIndices: number[] = [effectiveAnchorIdx];
        for (let i = effectiveAnchorIdx + 1; i < activeChain.length; i++) {
          const prev = activeChain[i - 1];
          const curr = activeChain[i];
          const prevVal = prev.value || '';
          const currVal = curr.value || '';
          const wasUsed = Boolean(existingState?.usedFieldIds.includes(curr.id));
          const allow = wasUsed || currVal.length === 0 || isFullLike(prev, prevVal);
          if (!allow) break; // stop at first field that breaks the chain
          chainIndices.push(i);
        }
        const chainFields = chainIndices.map((idx) => activeChain[idx]);

        // ── Non-extension-zone edit: update locally without touching the extension ──
        // If the user edits a field outside the current extension zone and it fits,
        // just update that field. Otherwise fall through to start a new extension.
        if (!isInExtensionZone) {
          // Just update this field's value locally; don't destroy fused state
          const fits = (hasOverflowHint && !overflowHint) || (!hasOverflowHint && stripHtml(newValue).length <= localCap);
          if (fits) {
            setFields((prev) => prev.map((f) => (f.id === id ? { ...f, value: newValue } : f)));
            setDirty(true);
            return;
          }
          // If it overflows, start a new extension from this field
          // (fall through to the main continuous logic below with a fresh anchor)
        }

        // Local edit that fits and no existing extension → no physical extension needed
        if (!existingState && ((hasOverflowHint && !overflowHint) || (!hasOverflowHint && stripHtml(newValue).length <= localCap))) {
          setFields((prev) => prev.map((f) => (f.id === id ? { ...f, value: newValue } : f)));
          setDirty(true);
          return;
        }

        // Build the global text stream from the local chain onward.
        // Prefer the stored globalText when the anchor hasn't changed, otherwise
        // recompute from field values.
        const oldGlobalFromFields = chainFields.map((f) => f.value || '').join('');
        const oldGlobal = (existingState && existingState.anchorFieldId === effectiveAnchorId)
          ? (existingState.globalText || oldGlobalFromFields) // reuse persisted stream
          : oldGlobalFromFields;
        // oldLocal is the portion of the global stream belonging to the edited field.
        const oldLocal = (id === effectiveAnchorId && existingState && existingState.anchorFieldId === effectiveAnchorId)
          ? oldGlobal // anchor edits replace the entire global stream
          : (source.value || '');

        // Compute prefix offset: cumulative chars in chain fields before the edited field.
        let prefixLen = 0;
        for (const idx of chainIndices) {
          if (idx >= changedIdx) break;
          prefixLen += (activeChain[idx].value || '').length;
        }

        // Apply a character-level diff (longest common prefix/suffix) from
        // oldLocal → newValue, then splice the result into the global stream.
        let left = 0;
        while (left < oldLocal.length && left < newValue.length && oldLocal[left] === newValue[left]) left++;
        let oldRight = oldLocal.length - 1;
        let newRight = newValue.length - 1;
        while (oldRight >= left && newRight >= left && oldLocal[oldRight] === newValue[newRight]) {
          oldRight--;
          newRight--;
        }
        const inserted = newValue.slice(left, newRight + 1);
        const removeEnd = oldRight + 1;
        const globalLeft = prefixLen + left;
        const globalRemoveEnd = prefixLen + removeEnd;
        const flowText = oldGlobal.slice(0, globalLeft) + inserted + oldGlobal.slice(globalRemoveEnd);

        // Distribute the merged flowText across local continuous chain fields,
        // respecting each field's estimated character capacity.
        const valueById = new Map<string, string>();
        // Keep fields before anchor untouched — they belong to a separate block.
        for (let i = 0; i < effectiveAnchorIdx; i++) {
          valueById.set(activeChain[i].id, activeChain[i].value || '');
        }

        let cursor = 0;
        const caps: number[] = [];
        for (const f of chainFields) {
          const rest = flowText.slice(cursor);
          const { chunk, consumed, cap } = takeFieldChunk(rest, f);
          valueById.set(f.id, chunk);
          cursor += consumed;
          caps.push(cap);
        }

        // Normalize: pull text left to fill each field to capacity before
        // spilling into the next one. This avoids visual gaps when the user
        // deletes text near a field boundary.
        const normalized = chainFields.map((f) => valueById.get(f.id) || '');
        for (let i = 0; i < normalized.length - 1; i++) {
          while (normalized[i].length < caps[i] && normalized[i + 1].length > 0) {
            normalized[i] += normalized[i + 1][0];
            normalized[i + 1] = normalized[i + 1].slice(1);
          }
        }
        chainFields.forEach((f, i) => valueById.set(f.id, normalized[i]));

        const truncated = cursor < flowText.length;
        if (truncated && localOnEnd === 'block') {
          setStatus(t('status.overflowBlocked'));
          return;
        }

        // ── Compute usedFieldIds for visual extension bounds ──
        // Walk the chain and collect field IDs that contain text.
        // The anchor (i===0) is always included. The list drives the
        // visual "stretch" effect in the rendering layer.
        const usedFieldIds: string[] = [];
        const globalText = normalized.join('');
        for (let i = 0; i < chainFields.length; i++) {
          const val = normalized[i];
          if (i === 0 || val.length > 0) {
            usedFieldIds.push(chainFields[i].id);
          } else {
            break; // stop at first empty trailing field
          }
        }

        // Update or clear fusedUiState for physical extension visualization.
        // If the text fits in one field, clear any existing extension state.
        if (globalText.length === 0 || usedFieldIds.length <= 1) {
          // No visible extension: clear current chain state.
          if (existingKey) {
            setFusedUiState((prev) => {
              const next = { ...prev };
              delete next[existingKey];
              return next;
            });
          }
        } else {
          // Multiple fields used → store extension state so the renderer can
          // visually stretch the anchor across all used fields.
          setFusedUiState((prev) => {
            const next = { ...prev };
            if (existingKey && existingKey !== targetContinuousKey) {
              delete next[existingKey];
            }
            next[targetContinuousKey] = {
              anchorFieldId: effectiveAnchorId,
              usedFieldIds,
              globalText,
              version: (prev[targetContinuousKey]?.version ?? 0) + 1,
            };
            return next;
          });
        }

        if (maxFields) {
          for (const f of group.slice(maxFields)) valueById.set(f.id, '');
        }

        setFields((prev) => prev.map((f) => (valueById.has(f.id) ? { ...f, value: valueById.get(f.id) as string } : f)));
        setDirty(true);

        if (truncated) {
          setStatus(t('status.overflowFull'));
        }
        return;
      }
      // ── END CONTINUOUS MODE ──────────────────────────────────────────

      // In distributed mode, detect if this field is part of an active overflow
      // chain that requires reflow even when the current edit doesn't overflow.
      // This handles edge cases like deleting from a field that is already full
      // while the next field has content that should be pulled back.
      const needsDistributedReflow = interactionMode === 'distributed' && (() => {
        if (changedIdx > 0) {
          const prev = activeChain[changedIdx - 1];
          if (isFullLike(prev, prev.value || '')) return true;
        }
        if (changedIdx < activeChain.length - 1) {
          const next = activeChain[changedIdx + 1];
          if ((next.value || '').length > 0) return true;
        }
        return false;
      })();

      // Fast path: local edit when there is no visible overflow (distributed only).
      // Skip the expensive chain recomputation if the value fits.
      if (!needsDistributedReflow && ((hasOverflowHint && !overflowHint) || (!hasOverflowHint && stripHtml(newValue).length <= localCap))) {
        setFields((prev) => prev.map((f) => (f.id === id ? { ...f, value: newValue } : f)));
        setDirty(true);
        return;
      }

      const localOnEnd = groupLead.style.overflowOnEnd || 'truncate';

      // Build the writable local chain for distributed overflow. Unlike continuous
      // mode, the chain always starts from the edited field and extends forward.
      let chainStart = changedIdx;
      const chainIndices: number[] = [chainStart];
      for (let i = chainStart + 1; i < activeChain.length; i++) {
        const prevIdx = i - 1;
        const prev = activeChain[prevIdx];
        const prevVal = activeChain[prevIdx].value || '';
        const currVal = activeChain[i].value || '';
        const allow = currVal.length === 0 || isFullLike(prev, prevVal);
        if (!allow) break;
        chainIndices.push(i);
      }

      const chainFields = chainIndices.map((idx) => activeChain[idx]);
      const oldChain = chainFields.map((f) => f.value || '').join('');
      const oldLocal = activeChain[changedIdx].value || '';

      let prefixLen = 0;
      for (let i = chainStart; i < changedIdx; i++) {
        prefixLen += (activeChain[i].value || '').length;
      }

      // Apply diff oldLocal -> newValue into the local chain stream.
      let left = 0;
      while (left < oldLocal.length && left < newValue.length && oldLocal[left] === newValue[left]) left++;
      let oldRight = oldLocal.length - 1;
      let newRight = newValue.length - 1;
      while (oldRight >= left && newRight >= left && oldLocal[oldRight] === newValue[newRight]) {
        oldRight--;
        newRight--;
      }
      const inserted = newValue.slice(left, newRight + 1);
      const removeEnd = oldRight + 1;
      const globalLeft = prefixLen + left;
      const globalRemoveEnd = prefixLen + removeEnd;
      const flowText = oldChain.slice(0, globalLeft) + inserted + oldChain.slice(globalRemoveEnd);

      const valueById = new Map<string, string>();
      let cursor = 0;
      const caps: number[] = [];
      for (const f of chainFields) {
        const rest = flowText.slice(cursor);
        const { chunk, consumed, cap } = takeFieldChunk(rest, f);
        valueById.set(f.id, chunk);
        cursor += consumed;
        caps.push(cap);
      }

      const truncated = cursor < flowText.length;
      if (truncated && localOnEnd === 'block') {
        setStatus(t('status.overflowBlocked'));
        return;
      }

      setFields((prev) => prev.map((f) => (valueById.has(f.id) ? { ...f, value: valueById.get(f.id) as string } : f)));
      setDirty(true);

      // Auto-advance focus on real overflow in distributed mode.
      // If the current field overflowed and text landed in the next field,
      // move focus there so the user can keep typing naturally.
      const currentPosInChain = chainIndices.findIndex((idx) => idx === changedIdx);
      if (currentPosInChain >= 0 && currentPosInChain < chainIndices.length - 1) {
        const currentNewValue = valueById.get(id) || '';
        const currentFieldCap = estimateFieldCapacity(source);
        const didOverflowCurrent = overflowHint || currentNewValue.length >= currentFieldCap;
        if (didOverflowCurrent) {
          const nextField = activeChain[chainIndices[currentPosInChain + 1]];
          const nextValue = valueById.get(nextField.id) || '';
          if (nextValue.length > 0) {
            setSelectedFieldId(nextField.id);
            pendingFocusRef.current = nextField.id;
          }
        }
      }

      if (truncated) {
        setStatus(t('status.overflowFull'));
      }
      return;
    }

    // ── LEGACY GLOBAL CONTINUOUS BRANCH (disabled) ────────────────────
    // This branch concatenates ALL group fields into one global string and
    // redistributes. It is disabled in favor of the localized continuous flow
    // above, but kept as a reference for debugging / future use.
    if (false && interactionMode === 'continuous') {
      // Concatenate ALL group field values as one global string
      const oldGlobal = activeChain.map((f) => f.value || '').join('');
      // Compute prefix length (chars in fields before this one)
      let prefixLen = 0;
      for (let i = 0; i < changedIdx; i++) prefixLen += (activeChain[i].value || '').length;
      const oldLocal = activeChain[changedIdx].value || '';
      const localCap = estimateFieldCapacity(activeChain[changedIdx]);
      const localCaret = caretPosition ?? newValue.length;
      const caretAtEnd = localCaret >= oldLocal.length;

      let newGlobal: string;

      // ── Fast-path: full field, caret at end, user appending characters ──
      if (
        oldLocal.length >= localCap &&
        caretAtEnd &&
        newValue.length > oldLocal.length &&
        newValue.startsWith(oldLocal)
      ) {
        // Append the new suffix to the END of the global stream (not at A/B junction)
        const suffix = newValue.slice(oldLocal.length);
        newGlobal = oldGlobal + suffix;

      // ── Fast-path: full field, caret at end, user deleting trailing chars ──
      } else if (
        oldLocal.length >= localCap &&
        caretAtEnd &&
        newValue.length < oldLocal.length &&
        oldLocal.startsWith(newValue)
      ) {
        // Delete from the END of the global stream
        const removed = oldLocal.length - newValue.length;
        newGlobal = oldGlobal.slice(0, oldGlobal.length - removed);

      // ── Generic diff path for all other edits ──
      } else {
        let left = 0;
        while (left < oldLocal.length && left < newValue.length && oldLocal[left] === newValue[left]) left++;
        let oldRight = oldLocal.length - 1;
        let newRight = newValue.length - 1;
        while (oldRight >= left && newRight >= left && oldLocal[oldRight] === newValue[newRight]) { oldRight--; newRight--; }
        const inserted = newValue.slice(left, newRight + 1);
        const removeEnd = oldRight + 1;
        const globalLeft = prefixLen + left;
        const globalRemoveEnd = prefixLen + removeEnd;
        newGlobal = oldGlobal.slice(0, globalLeft) + inserted + oldGlobal.slice(globalRemoveEnd);
      }
      // Redistribute across fields
      const onEnd = groupLead.style.overflowOnEnd || 'truncate';
      const cValueById = new Map<string, string>();
      let cursor = 0;
      let truncated = false;
      for (const f of activeChain) {
        const rest = newGlobal.slice(cursor);
        const { chunk, consumed } = takeFieldChunk(rest, f);
        cValueById.set(f.id, chunk);
        cursor += consumed;
      }
      truncated = cursor < newGlobal.length;
      if (truncated && onEnd === 'block') {
        setStatus(t('status.overflowBlocked'));
        return;
      }
      // Clear fields beyond maxFields
      if (maxFields) {
        for (const f of group.slice(maxFields)) cValueById.set(f.id, '');
      }
      setFields((prev) => prev.map((f) => (cValueById.has(f.id) ? { ...f, value: cValueById.get(f.id) as string } : f)));
      setDirty(true);
      if (truncated) setStatus(t('status.overflowFull'));
      return;
    }
    // ── END CONTINUOUS MODE ──────────────────────────────────────────────

    // ── FUSED MODE (sticky anchor, non-destructive non-anchor edits) ────
    // Fused mode treats all fields from the anchor onward as a single editable
    // canvas. The first field the user edits becomes the sticky "anchor" and
    // remains the anchor until the content is cleared. Non-anchor edits are
    // non-destructive: they modify only the local field's portion of the text.
    if (interactionMode === 'fused') {
      if (DEBUG_FUSED) console.log('[FUSED] edit triggered', { id, groupId, changedIdx, newValue: newValue.slice(0, 40) });

      const fusedKey = `${source!.pageNumber ?? 1}:${groupId}`;
      const state = fusedUiState[fusedKey];
      const onEnd = groupLead.style.overflowOnEnd || 'truncate';

      // Sticky anchor: the first field the user edits becomes the anchor and
      // retains that role until the fused state is cleared (content removed).
      const anchorId = state?.anchorFieldId ?? id;
      const anchorIdx = activeChain.findIndex((f) => f.id === anchorId);
      const isAnchorEdit = id === anchorId;

      /**
       * Distribute the fused global text across all fields from the anchor onward.
       * Uses strict capacity enforcement (takeFieldChunkStrict) to prevent any
       * overflow beyond what a field can hold. Returns false if blocked by
       * onEnd='block' policy, true otherwise.
       */
      const distributeFusedGlobal = (newGlobal: string) => {
        const suffixFields = activeChain.slice(anchorIdx);
        const fValueById = new Map<string, string>();
        for (let i = 0; i < anchorIdx; i++) {
          fValueById.set(activeChain[i].id, activeChain[i].value || '');
        }

        let cursor = 0;
        for (const f of suffixFields) {
          const rest = newGlobal.slice(cursor);
          const { chunk, consumed } = takeFieldChunkStrict(rest, f);
          fValueById.set(f.id, chunk);
          cursor += consumed;
        }
        const truncated = cursor < newGlobal.length;
        if (truncated && onEnd === 'block') {
          setStatus(t('status.overflowBlocked'));
          return false;
        }
        if (maxFields) {
          for (const f of group.slice(maxFields)) fValueById.set(f.id, '');
        }

        // Compute usedFieldIds: include every field that received text content,
        // always include anchor, and include the NEXT empty field to provide
        // visual room for the next extension.
        const usedFieldIds: string[] = [];
        for (let i = 0; i < suffixFields.length; i++) {
          const sf = suffixFields[i];
          const val = fValueById.get(sf.id) || '';
          if (i === 0 || val.length > 0) {
            usedFieldIds.push(sf.id);
          } else {
            // Include one extra empty field for visual room, then stop
            usedFieldIds.push(sf.id);
            break;
          }
        }
        if (DEBUG_FUSED) console.log('[FUSED] distribute result', { newGlobalLen: newGlobal.length, usedFieldIds, suffixFieldsCount: suffixFields.length, cursor, truncated });

        if (newGlobal.length === 0) {
          setFusedUiState((prev) => { const next = { ...prev }; delete next[fusedKey]; return next; });
        } else {
          setFusedUiState((prev) => ({
            ...prev,
            [fusedKey]: { anchorFieldId: anchorId, usedFieldIds, globalText: newGlobal, version: (prev[fusedKey]?.version ?? 0) + 1 },
          }));
        }

        setFields((prev) => prev.map((f) => (fValueById.has(f.id) ? { ...f, value: fValueById.get(f.id) as string } : f)));
        setDirty(true);
        if (truncated) setStatus(t('status.overflowFull'));
        return true;
      };

      if (!isAnchorEdit) {
        // Non-anchor edit on a field within the fused zone: reconstruct globalText
        // from all suffix fields (with the edited field's new value substituted in)
        // and redistribute. This is the "non-destructive" path — the user edits
        // their portion of the fused text without affecting other parts.
        const isInFusedZone = state?.usedFieldIds?.includes(id);
        if (isInFusedZone && state) {
          if (DEBUG_FUSED) console.log('[FUSED] non-anchor edit in fused zone', { id, changedIdx, anchorIdx });
          // Reconstruct global text: take values from anchor onward, replacing the edited field's value
          const suffixFields = activeChain.slice(anchorIdx);
          const parts: string[] = [];
          for (const sf of suffixFields) {
            if (sf.id === id) {
              parts.push(newValue);
            } else if (state.usedFieldIds.includes(sf.id)) {
              parts.push(sf.value || '');
            }
            // Stop at last used field (unless it's the edited one which may overflow)
          }
          const reconstructedGlobal = parts.join('');
          if (DEBUG_FUSED) console.log('[FUSED] reconstructed global from non-anchor edit', { reconstructedGlobal: reconstructedGlobal.slice(0, 60), len: reconstructedGlobal.length });
          distributeFusedGlobal(reconstructedGlobal);
          return;
        }

        // Non-fused-zone non-anchor edit: the user edited a field that isn't part
        // of the current fused extension. Handle overflow locally by fitting what
        // we can and spilling into subsequent empty fields.
        const editedField = activeChain[changedIdx];
        const { chunk: fittedValue, consumed } = takeFieldChunkStrict(newValue, editedField);
        const overflow = newValue.slice(consumed); // text that didn't fit

        const fValueById = new Map<string, string>();
        fValueById.set(editedField.id, fittedValue);

        let overflowWarning = false;
        if (overflow.length > 0) {
          let remaining = overflow;
          for (let i = changedIdx + 1; i < activeChain.length && remaining.length > 0; i++) {
            const nextField = activeChain[i];
            const existingValue = (nextField.value || '').trim();
            if (existingValue.length > 0) {
              overflowWarning = true;
              break;
            }
            const { chunk, consumed: c } = takeFieldChunkStrict(remaining, nextField);
            fValueById.set(nextField.id, chunk);
            remaining = remaining.slice(c);
          }
          if (remaining.length > 0) {
            if (onEnd === 'block') {
              setStatus(t('status.overflowBlocked'));
              return;
            }
            overflowWarning = true;
          }
        }

        setFields((prev) => prev.map((f) => (fValueById.has(f.id) ? { ...f, value: fValueById.get(f.id) as string } : f)));
        setDirty(true);
        if (overflowWarning) setStatus(t('status.overflowNextFieldNotEmpty'));
        return;
      }

      // Anchor edit: the entire new value becomes the fused global stream.
      // All fields from anchor onward are redistributed from scratch.
      if (DEBUG_FUSED) console.log('[FUSED] anchor edit', { anchorId, newValueLen: newValue.length });
      distributeFusedGlobal(newValue);
      return;
    }
    // ── END FUSED MODE ───────────────────────────────────────────────────

    // ── DEFAULT / FALLBACK OVERFLOW PATH ────────────────────────────────
    // This path runs when none of the interaction-mode branches above matched
    // or returned. It implements a generic suffix-based overflow strategy:
    // fields before the edited one stay intact; text from the edited field
    // onward is merged into a single stream and redistributed.

    // Re-narrow source after block scope (TS loses narrowing across closures).
    const src = source!;

    const onEnd = groupLead.style.overflowOnEnd || 'truncate';
    const valueById = new Map<string, string>();

    // If the edited value still fits visually, keep the change local.
    // Prefer DOM overflow hint; fallback to heuristic capacity only when hint is absent.
    const localCap = estimateFieldCapacity(src);
    const hasOverflowHint = typeof meta?.overflowed === 'boolean';
    const overflowHint = Boolean(meta?.overflowed);
    if ((hasOverflowHint && !overflowHint) || (!hasOverflowHint && stripHtml(newValue).length <= localCap)) {
      setFields((prev) => prev.map((f) => (f.id === id ? { ...f, value: newValue } : f)));
      setDirty(true);
      return;
    }

    // Fields BEFORE edited one: keep intact — overflow never reorders backward.
    for (let i = 0; i < changedIdx; i++) {
      valueById.set(activeChain[i].id, activeChain[i].value || '');
    }

    // Build the suffix stream: concatenate the current field's old value with
    // all subsequent field values. This is the text we need to redistribute.
    const suffixFields = activeChain.slice(changedIdx);
    const oldCurrent = suffixFields[0].value || '';
    const oldSuffixTail = suffixFields.slice(1).map((f) => (f.value || '')).join('');
    const oldStream = oldCurrent + oldSuffixTail;
    const currentCap = estimateFieldCapacity(suffixFields[0]);

    let flowText = oldStream;

    // Fast path for the common append-typing case: when the field is visually
    // full and the user keeps typing, the browser emits newValue = oldCurrent +
    // typedChar(s). We append the new suffix to the end of the global stream
    // rather than splicing it at the field boundary.
    if (
      (stripHtml(oldCurrent).length >= currentCap || overflowHint) &&
      newValue.length > oldCurrent.length &&
      newValue.startsWith(oldCurrent)
    ) {
      flowText = oldStream + newValue.slice(oldCurrent.length);
    } else {
      // Generic edit diff oldCurrent -> newValue (LCP/LCS) and apply to oldStream.
      let left = 0;
      while (left < oldCurrent.length && left < newValue.length && oldCurrent[left] === newValue[left]) {
        left++;
      }

      let oldRight = oldCurrent.length - 1;
      let newRight = newValue.length - 1;
      while (oldRight >= left && newRight >= left && oldCurrent[oldRight] === newValue[newRight]) {
        oldRight--;
        newRight--;
      }

      const inserted = newValue.slice(left, newRight + 1);
      const removeEnd = oldRight + 1; // exclusive in oldCurrent
      flowText = oldStream.slice(0, left) + inserted + oldStream.slice(removeEnd);
    }

    let cursor = 0;
    const caps: number[] = [];
    for (const field of suffixFields) {
      const rest = flowText.slice(cursor);
      const { chunk, consumed, cap } = takeFieldChunk(rest, field);
      valueById.set(field.id, chunk);
      caps.push(cap);
      cursor += consumed;
    }

    // Normalization pass: after distribution, pull text leftward to keep fields
    // compact. Without this, deleting at a field boundary could leave the current
    // field partially empty while the next field still has content.
    const normalized = suffixFields.map((f) => valueById.get(f.id) || '');
    for (let i = 0; i < normalized.length - 1; i++) {
      while (normalized[i].length < caps[i] && normalized[i + 1].length > 0) {
        normalized[i] += normalized[i + 1][0];
        normalized[i + 1] = normalized[i + 1].slice(1);
      }
    }
    suffixFields.forEach((f, i) => valueById.set(f.id, normalized[i]));

    if (maxFields) {
      for (const f of group.slice(maxFields)) {
        valueById.set(f.id, '');
      }
    }

    const truncated = cursor < flowText.length;

    if (truncated && onEnd === 'block') {
      setStatus(t('status.overflowBlocked'));
      return;
    }

    // Apply the distributed values to all fields in the chain
    setFields((prev) => prev.map((f) => (valueById.has(f.id) ? { ...f, value: valueById.get(f.id) as string } : f)));

    // ── DISTRIBUTED: auto-advance focus only on real overflow (not when just full) ──
    // After redistribution, check whether the edit caused text to spill into the
    // next field. If so, move keyboard focus there for a seamless typing experience.
    const currentValue = valueById.get(id) || '';
    const currentCap2 = estimateFieldCapacity(src);
    const nextValue = changedIdx < activeChain.length - 1 ? (valueById.get(activeChain[changedIdx + 1].id) || '') : '';
    const didOverflowCurrent = overflowHint || stripHtml(newValue).length > currentCap2;
    if (didOverflowCurrent && nextValue.length > 0 && changedIdx < activeChain.length - 1) {
      const nextField = activeChain[changedIdx + 1];
      setSelectedFieldId(nextField.id);
      pendingFocusRef.current = nextField.id;
    }
    setDirty(true);
    // If content was truncated (couldn't fit even across all fields), notify the user
    if (truncated) {
      setStatus(t('status.overflowFull'));
    }
  };

  /**
   * Automatically assign explicit overflow order values to all fields in a group,
   * using the deterministic sortOverflowGroup algorithm.
   */
  const autoOrderOverflowGroup = (groupId: string, _mode: 'rows' | 'right' | 'down' = 'rows') => {
    const gid = groupId.trim();
    if (!gid) return;

    const groupFields = fields.filter((f) => (f.pageNumber ?? 1) === activePage && f.type === 'text' && (f.style.overflowGroupId || '').trim() === gid);
    const ordered = sortOverflowGroup(groupFields);

    if (ordered.length === 0) return;

    const orderById = new Map(ordered.map((f, idx) => [f.id, idx + 1] as const));
    setFields((prev) => prev.map((f) => (
      orderById.has(f.id)
        ? { ...f, style: { ...f.style, overflowOrder: orderById.get(f.id) } }
        : f
    )));
    setDirty(true);
    setStatus(t('status.overflowAutoOrder'));
  };

  /**
   * Assign the given overflow group ID (and auto-computed order) to multiple
   * selected text fields at once.
   */
  const bulkAssignOverflowGroup = (ids: string[], groupId: string, _mode: 'rows' | 'right' | 'down' = 'rows') => {
    const gid = groupId.trim();
    if (!gid) return;
    const selectedSet = new Set(ids);
    const selectedTextFields = fields.filter((f) => selectedSet.has(f.id) && f.type === 'text');
    if (selectedTextFields.length === 0) {
      setStatus(t('bulk.noTextFieldSelected'));
      return;
    }

    // Sort using the same deterministic algorithm
    const ordered = sortOverflowGroup(selectedTextFields);
    const orderById = new Map(ordered.map((f, idx) => [f.id, idx + 1] as const));

    // Atomic: set group AND order in a single setFields call
    setFields((prev) => prev.map((f) => {
      if (!selectedSet.has(f.id) || f.type !== 'text') return f;
      return {
        ...f,
        style: {
          ...f.style,
          overflowGroupId: gid,
          overflowOrder: orderById.get(f.id),
          overflowMaxFields: undefined,
        },
      };
    }));
    setDirty(true);
    setStatus(t('status.overflowGroupApplied', { count: ordered.length }));
  };

  /** Change the type of multiple fields, resetting values to type-appropriate defaults. */
  const bulkUpdateType = (ids: string[], type: FieldType) => {
    const newValue = type === 'counter-tally' || type === 'counter-numeric' ? '0' : '';
    setFields((prev) => prev.map((f) => (ids.includes(f.id) ? { ...f, type, value: newValue } : f)));
    setDirty(true);
  };

  /** Delete a single field by ID, cleaning up selection state. */
  const deleteField = (id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
    if (selectedFieldId === id) setSelectedFieldId(null);
    setMultiSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setDirty(true);
  };

  /**
   * Swap a field's position with its neighbor (up or down) in the flat fields array.
   * Used for manual reordering in the properties panel field list.
   */
  const reorderField = (id: string, direction: 'up' | 'down') => {
    setFields((prev) => {
      const idx = prev.findIndex((f) => f.id === id);
      if (idx < 0) return prev;
      const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (swapIdx < 0 || swapIdx >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[swapIdx]] = [next[swapIdx], next[idx]];
      return next;
    });
    setDirty(true);
  };


  /**
   * Reset all editor state for a new document. Prompts the user if there are
   * unsaved changes. Returns false if the user cancels.
   */
  const resetFieldsForNewDoc = (): boolean => {
    if (fields.length > 0 && dirty) {
      const ok = window.confirm(
        t('confirm.unsavedFields', { count: fields.length }),
      );
      if (!ok) return false;
    }
    setFields([]);
    setSelectedFieldId(null);
    setMultiSelectedIds(new Set());
    setFusedUiState({});
    setDirty(false);
    setRotation(0);
    setPageCount(1);
    setActivePage(1);
    setLoadedTemplateId(null);
    setPendingDraft(null);
    return true;
  };

  /** Handle file input change: upload the selected PDF/image to the server and load it. */
  /**
   * Handle file input change: upload the selected PDF/image to the server and load it.
   * Checks upload permissions and prompts if there are unsaved changes.
   */
  const onUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!rolePermissions.uploadDocument) {
      setStatus(t('status.insufficientRightsUpload'));
      return;
    }
    const file = e.target.files?.[0];
    if (!file) return;

    if (!resetFieldsForNewDoc()) {
      e.target.value = '';
      return;
    }

    try {
      setStatus(t('status.uploadInProgress'));
      const uploaded = await uploadDocument(file);
      setSourceFileId(uploaded.id);
      const docInfo = await getDocumentUrl(uploaded.id);
      if (!docInfo) throw new Error(t('status.noDocumentLoaded'));
      setSourceUrl(docInfo.url);
      setSourceMime(docInfo.mimeType || uploaded.mimeType || file.type);
      setPageW(DEFAULT_WIDTH);
      setPageH(DEFAULT_HEIGHT);
      setStatus(t('status.uploadOk', { name: uploaded.originalName }));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t('status.errorFallback'));
    }
  };

  /**
   * Load a template into the editor.
   *
   * @param mode - 'template' loads with blank values (creating a new document);
   *               'document' loads with the saved values (continuing editing).
   */
  const loadTemplate = async (tpl: TemplateModel, mode: 'template' | 'document' = 'template') => {
    const isBlank = mode === 'template';
    const normalized = tpl.fields.map((f) => normalizeField(f as FieldModel));
    setName(isBlank ? tpl.name : `${tpl.name} — ${t('template.filledCopy')}`);
    setRotation((tpl.rotation ?? 0) as Rotation);
    setFields(isBlank ? stripTemplateFieldValues(normalized) : normalized);
    setSourceFileId(tpl.sourceFileId);
    // In "template" (blank) mode we don't set the loadedTemplateId so saving
    // creates a NEW template instead of overwriting the base template.
    setLoadedTemplateId(isBlank ? null : tpl.id);
    const maxPage = Math.max(1, ...tpl.fields.map((f: any) => (f.pageNumber ?? 1)));
    setPageCount(maxPage);
    setActivePage(1);
    handleSelectField(null);
    setFusedUiState({});
    setDirty(isBlank ? false : true);

    if (tpl.sourceFileId) {
      setStatus(t('status.loadingDocument'));
      const docInfo = await getDocumentUrl(tpl.sourceFileId);
      if (docInfo) {
        setSourceUrl(docInfo.url);
        setSourceMime(docInfo.mimeType);
        setStatus(isBlank
          ? t('status.templateLoadedBlank', { name: tpl.name })
          : t('status.templateLoaded', { name: tpl.name }));
      } else {
        setSourceUrl(undefined);
        setSourceMime(undefined);
        setStatus(t('status.templateLoadedNoDoc'));
      }
    } else {
      setSourceUrl(undefined);
      setSourceMime(undefined);
      setStatus(isBlank
        ? t('status.templateLoadedBlank', { name: tpl.name })
        : t('status.templateLoaded', { name: tpl.name }));
    }

    // Check for existing draft (only when loading with values)
    if (!isBlank && currentUser) {
      try {
        const key = tpl.id ? { templateId: tpl.id } : tpl.sourceFileId ? { sourceFileId: tpl.sourceFileId } : null;
        if (key) {
          const draft = await getDraft(key);
          if (draft && new Date(draft.updatedAt) > new Date(tpl.updatedAt)) {
            setPendingDraft(draft);
          }
        }
      } catch {
        // Silently ignore draft fetch errors
      }
    }
  };

  /** Delete a template from the server and update local state. */
  const handleDeleteTemplate = async (id: string) => {
    try {
      await deleteTemplate(id);
      setTemplates((prev) => prev.filter((tmpl) => tmpl.id !== id));
      setStatus(t('status.templateDeleted'));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t('status.errorFallback'));
    }
  };

  /** Prompt for a new name and rename a template on the server. */
  const handleRenameTemplate = async (id: string) => {
    const newName = prompt(t('confirm.renameTemplate'));
    if (!newName) return;
    try {
      const updated = await renameTemplate(id, newName);
      setTemplates((prev) => prev.map((tmpl) => (tmpl.id === id ? updated : tmpl)));
      setStatus(t('status.templateRenamed'));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t('status.errorFallback'));
    }
  };

  /** Prompt the user to pick a folder and move the template there. */
  const handleMoveTemplate = async (templateId: string) => {
    if (!canManageTemplate) { setStatus(t('status.insufficientRightsGeneric')); return; }
    // Build a simple prompt with available folders
    try {
      const folders = await listFolders();
      if (folders.length === 0) {
        setStatus(t('status.noFoldersAvailable'));
        return;
      }
      const options = folders.map((f, i) => `${i + 1}. ${f.name}`).join('\n');
      const choice = prompt(t('confirm.moveToFolder', { options }));
      if (!choice) return;
      const idx = parseInt(choice, 10) - 1;
      if (idx < 0 || idx >= folders.length) { setStatus(t('status.invalidChoice')); return; }
      await moveTemplateToFolder(folders[idx].id, templateId);
      // Update local state
      setTemplates((prev) => prev.map((tmpl) => tmpl.id === templateId ? { ...tmpl, folderId: folders[idx].id } : tmpl));
      setStatus(t('status.templateMovedTo', { folder: folders[idx].name }));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t('status.errorFallback'));
    }
  };

  /**
   * Save the current template structure (with blank field values) to the server.
   * Also upserts a draft with the current filled values.
   */
  const onSave = async () => {
    if (!canSaveTemplate) {
      setStatus(t('status.insufficientRightsSave'));
      return;
    }
    try {
      setStatus(t('status.savingTemplate'));
      const filledDraftPayload = buildDraftPayload();
      const templateFields = stripTemplateFieldValues(fields);
      const created = await saveTemplate({ name, sourceFileId, rotation, fields: templateFields });
      setTemplates((prev) => [created, ...prev]);
      setLoadedTemplateId(created.id);
      setDirty(false);

      if (currentUser && created.id) {
        try {
          await upsertDraft({ templateId: created.id, sourceFileId }, filledDraftPayload);
          if (draftKey && draftKey.templateId !== created.id) {
            await clearDraft(draftKey);
          }
        } catch {
          // Silent – preserving the working draft is best-effort
        }
      }

      setStatus(t('status.templateSavedStructure'));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t('status.errorFallback'));
    }
  };

  /** Explicitly save current state (with filled values) as a draft. */
  const onSaveDraft = async () => {
    const key = draftKey;
    if (!key || (!key.templateId && !key.sourceFileId)) {
      setStatus(t('status.noDocumentLoaded'));
      return;
    }
    try {
      await upsertDraft(key, buildDraftPayload());
      setStatus(t('status.draftSavedExplicit'));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t('status.errorFallback'));
    }
  };

  /** Export the filled PDF to the user's browser (download). */
  const handleExportPdf = async () => {
    if (!sourceUrl) {
      setStatus(t('status.noDocumentLoaded'));
      return;
    }
    if (!canExport) {
      setStatus(t('status.insufficientRightsExport'));
      return;
    }
    try {
      setStatus(t('status.exportInProgress'));
      await exportFilledPdf(sourceUrl, fields, rotation, name, pageCount, pageW, pageH, fusedUiState);
      setStatus(t('status.exportDone'));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t('status.errorFallback'));
    }
  };

  // ── Server-side export state ──
  /** Whether server-side export is available for the current template (checked on mount/change). */
  const [serverExportAvailable, setServerExportAvailable] = useState(false);
  /** Whether a server export request is currently in flight. */
  const [serverExportBusy, setServerExportBusy] = useState(false);

  const [panelExpanded, setPanelExpanded] = useState(false);
  const [rightPanelExpanded, setRightPanelExpanded] = useState(false);
  const [darkMode, setDarkMode] = useState(() => localStorage.getItem('lmpdf-dark') === 'true');
  useEffect(() => { document.documentElement.dataset.theme = darkMode ? 'dark' : 'light'; localStorage.setItem('lmpdf-dark', String(darkMode)); }, [darkMode]);

  /**
   * Check if server-side export is available for the current template/document context.
   * Resolves the export destination configuration from the server.
   */
  useEffect(() => {
    if (!canExport || !sourceUrl) { setServerExportAvailable(false); return; }
    resolveExportDestination({ templateName: name, templateId: loadedTemplateId || undefined })
      .then((r) => setServerExportAvailable(r.enabled === true && r.matched === true && r.errors.length === 0))
      .catch(() => setServerExportAvailable(false));
  }, [canExport, sourceUrl, name, loadedTemplateId]);

  /**
   * Generate the filled PDF in the browser and upload it to the server
   * for filesystem write (server-side export).
   */
  const handleServerExport = async () => {
    if (!sourceUrl) { setStatus(t('status.noDocumentLoaded')); return; }
    if (!canExport) { setStatus(t('status.insufficientRightsExport')); return; }

    try {
      setServerExportBusy(true);
      setStatus(t('status.serverExportInProgress'));

      // 1. Generate the PDF blob in the browser (same logic as manual export)
      const pdfBlob = await generateFilledPdfBlob(sourceUrl, fields, rotation, pageCount, pageW, pageH, fusedUiState);

      // 2. Send to backend for filesystem write
      const result = await runServerExport(pdfBlob, {
        templateName: name,
        templateId: loadedTemplateId || undefined,
      });

      if (result.skipped) {
        setStatus(t('status.serverExportSkipped'));
      } else if (result.renamed) {
        setStatus(t('status.serverExportRenamed', { path: result.finalPath }));
      } else {
        setStatus(t('status.serverExportDone', { path: result.finalPath }));
      }
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t('status.errorFallback'));
    } finally {
      setServerExportBusy(false);
    }
  };

  /**
   * Trigger the browser's print dialog for the current document.
   * Checks print permissions before invoking.
   */
  const handlePrint = () => {
    if (!canPrintDoc) {
      setStatus(t('status.insufficientRightsPrint'));
      return;
    }
    window.print();
  };

  /**
   * Rotate the page by the given number of degrees (90 or -90).
   * Wraps around to stay within 0–359°.
   */
  const rotateBy = (deg: 90 | -90) => {
    setRotation((prev) => (((prev + deg) % 360 + 360) % 360) as Rotation);
  };

  /** Whether the current source document is a PDF (as opposed to an image). */
  const isPdf = sourceMime === 'application/pdf';

  // ── Wrapper has no transform — sized at visual dimensions ──
  // Wrapper is sized at dispW*zoom × dispH*zoom (visual = layout, no divergence).
  // The page inside uses scale(zoom) + rotation transform.
  // NOTE: scale() causes layout box (pageW × pageH) to differ from visual size.
  // This divergence is the root cause of the "document too far right" bug.

  // ── Page rotation transform (applied to .page inside wrapper) ──
  // Only rotation — zoom is applied via transform: scale() (NOT CSS zoom property)
  const pageRotation = (() => {
    if (rotation === 90) return `translate(${pageH}px, 0) rotate(90deg)`;
    if (rotation === 180) return `translate(${pageW}px, ${pageH}px) rotate(180deg)`;
    if (rotation === 270) return `translate(0, ${pageW}px) rotate(270deg)`;
    return '';
  })();


  // ── Draft restore / ignore handlers ──

  /** Restore editor state from a pending draft record. */
  const handleRestoreDraft = useCallback(() => {
    if (!pendingDraft) return;
    const payload = pendingDraft.payload as any;
    if (payload.name) setName(payload.name);
    if (payload.rotation != null) setRotation(payload.rotation as Rotation);
    if (Array.isArray(payload.fields)) {
      setFields(payload.fields.map((f: any) => normalizeField(f)));
    }
    if (payload.pageCount) setPageCount(payload.pageCount);
    if (payload.preset) setPreset(payload.preset);
    setDirty(true);
    setPendingDraft(null);
    setStatus(t('status.draftRestored'));
  }, [pendingDraft]);

  /** Dismiss the pending draft and optionally clear it from the server. */
  const handleIgnoreDraft = useCallback(() => {
    if (!pendingDraft) return;
    // Optionally clear the draft so it won't prompt again
    const key = draftKey;
    if (key) clearDraft(key).catch(() => {});
    setPendingDraft(null);
  }, [pendingDraft, draftKey]);

  /**
   * Handle Backspace in an empty overflow field: jump focus back to the previous
   * field in the overflow chain (distributed or continuous mode only).
   */
  const handleFieldKeyDown = useCallback((fieldId: string, e: React.KeyboardEvent) => {
    if (e.key !== 'Backspace') return;
    const f = fields.find((ff) => ff.id === fieldId);
    if (!f || f.type !== 'text') return;
    const groupId = (f.style.overflowGroupId || ''). trim();
    if (!groupId) return;
    const mode = f.style.overflowInteractionMode ?? 'distributed';
    if (mode !== 'distributed' && mode !== 'continuous') return;
    // Only trigger when field is empty
    if ((f.value || ''). length > 0) return;
    const group = sortOverflowGroup(
      fields.filter((g) => (g.pageNumber ?? 1) === (f.pageNumber ?? 1) && g.type === 'text' && (g.style.overflowGroupId || ''). trim() === groupId)
    );
    const idx = group.findIndex((g) => g.id === fieldId);
    if (idx <= 0) return;
    const prevField = group[idx - 1];
    setSelectedFieldId(prevField.id);
    pendingFocusRef.current = prevField.id;
    e.preventDefault();
  }, [fields]);

  // ═══════════════════════════════════════════════════════════════════
  // JSX RENDER — Main layout: toolbar | sidebar | editor | properties
  // ═══════════════════════════════════════════════════════════════════
  return (
    // Root element: applies drag-over highlight when a file is being dragged onto the app
    <main className={`app${isDraggingOver ? ' app-drag-over' : ''} app-right-collapsed`}>
      {/* Drag overlay shown when a file is dragged over the app window */}
      {isDraggingOver && <div className="drag-overlay"><UploadIcon size={18} /> <span>Déposez le fichier ici</span></div>}
      {/* DEBUG: Mobile dock test */}
      <div id="mobile-debug" style={{ display: 'none', position: 'fixed', top: 0, left: 0, right: 0, background: 'red', color: 'white', padding: '8px', textAlign: 'center', zIndex: 9999, fontSize: '14px', fontWeight: 'bold' }}>LMPdf Debug Banner</div>
      {/* ── Top toolbar: brand, file menu, document name, view controls, user area ── */}
      <header className="app-toolbar app-toolbar-single-row">
        {/* ── Left: Brand + File menu ── */}
        <div className="toolbar-group toolbar-group-brand">
          <div className="toolbar-brand">LMPdf</div>

          {/* File dropdown menu */}
          {/* File dropdown menu (save, export, print, share) */}
          <div className="toolbar-file-menu-wrap">
            <button
              className="toolbar-file-menu-btn"
              onClick={() => setFileMenuOpen((v) => !v)}
              onBlur={() => setTimeout(() => setFileMenuOpen(false), 150)}
            >
              {t('toolbar.fileMenu')} <ChevronDownIcon size={12} />
            </button>
            {fileMenuOpen && (
              <div className="toolbar-file-dropdown compact">
                <button onClick={() => { onSave(); setFileMenuOpen(false); }} disabled={!canSaveTemplate} title={t('toolbar.saveTemplate')}>
                  <SaveIcon size={14} /> {t('toolbar.saveTemplate')}
                </button>
                <button onClick={() => { handleExportPdf(); setFileMenuOpen(false); }} disabled={!sourceUrl || !canExport} title={t('toolbar.export')}>
                  <DownloadIcon size={14} /> {t('toolbar.export')}
                </button>
                {serverExportAvailable && (
                  <button onClick={() => { handleServerExport(); setFileMenuOpen(false); }} disabled={!sourceUrl || !canExport || serverExportBusy} title={serverExportBusy ? t('toolbar.serverExportBusy') : t('toolbar.serverExport')}>
                    <CloudDownloadIcon size={14} /> {serverExportBusy ? t('toolbar.serverExportBusy') : t('toolbar.serverExport')}
                  </button>
                )}
                <button onClick={() => { handlePrint(); setFileMenuOpen(false); }} disabled={!sourceUrl || !canPrintDoc} title={t('toolbar.print')}>
                  <PrintIcon size={14} /> {t('toolbar.print')}
                </button>
                <button onClick={() => { setShowShareModal(true); setFileMenuOpen(false); }} disabled={!sourceFileId} title={t('toolbar.share')}>
                  <ShareIcon size={14} /> {t('toolbar.share')}
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Center-left: Document name + quick save + compact meta ── */}
          {/* Document name input + quick save + status badges */}
          <div className="toolbar-group toolbar-group-doc">
          {/* Template name editable input */}
          <input
            className="toolbar-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('toolbar.templateNamePlaceholder')}
          />
          {/* Save draft icon button */}
          <button
            className="toolbar-action-btn"
            onClick={() => { onSaveDraft(); }}
            disabled={!draftKey}
            title={t('toolbar.saveDraft')}
            aria-label={t('toolbar.saveDraft')}
          >
            <CloudUploadIcon size={16} />
          </button>
          {/* Meta badges: dirty state, document role, fill mode, multi-select actions */}
          <div className="toolbar-meta-stack">
            {/* Dirty indicator: shows if template has unsaved changes */}
            <span className={`toolbar-badge ${dirty ? 'dirty' : ''}`}>{dirty ? t('common.modified') : t('common.upToDate')}</span>
            {/* Current user's role on this document (owner/editor/viewer) */}
            {sourceFileId && (
              <span className={`doc-role-badge compact ${docRole ?? 'none'}`}>
                {docRoleLabel(docRole)}
              </span>
            )}
{/* Multi-select bulk actions: lock, unlock, delete */}
            {multiSelectedIds.size > 0 && !fillMode && canEditStructure && (
              <>
                <button
                  className="toolbar-action-btn"
                  title="Lock all selected (Ctrl+L)"
                  onClick={() => bulkUpdateFields(Array.from(multiSelectedIds), { locked: true })}
                ><LockIcon size={14} /></button>
                <button
                  className="toolbar-action-btn"
                  title="Unlock all selected (Ctrl+Shift+L)"
                  onClick={() => bulkUpdateFields(Array.from(multiSelectedIds), { locked: false })}
                ><UnlockIcon size={14} /></button>
                <button
                  className="toolbar-action-btn"
                  title="Delete all selected"
                  onClick={() => { setFields((prev) => prev.filter((f) => !multiSelectedIds.has(f.id))); setSelectedFieldId(null); setMultiSelectedIds(new Set()); setDirty(true); }}
                ><TrashIcon size={14} /></button>
              </>
            )}
          </div>
        </div>

        {/* ── Center: View controls (page, zoom, fit mode, rotation) ── */}
        <div className="toolbar-group toolbar-group-controls">
          {/* Page selector dropdown */}
          <label className="toolbar-inline-field">
            <span>{t('toolbar.page')}</span>
            <select value={activePage} onChange={(e) => setActivePage(Number(e.target.value))}>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{t('toolbar.page')} {n}</option>
              ))}
            </select>
          </label>

          {/* Zoom controls: step through predefined zoom levels */}
          <div className="zoom-controls compact">
            <button disabled={zoomIndex <= 0} onClick={() => setZoomIndex((i) => i - 1)}><ZoomOutIcon size={14} /></button>
            <span>{Math.round(zoom * 100)}%</span>
            <button disabled={zoomIndex >= ZOOM_STEPS.length - 1} onClick={() => setZoomIndex((i) => i + 1)}><ZoomInIcon size={14} /></button>
          </div>

          {/* Fit mode: fit entire page or fit width only */}
          <div className="fit-mode-controls compact">
            <button className={fitMode === 'page' ? 'active' : ''} onClick={() => setFitMode('page')}>{t('toolbar.page')}</button>
            <button className={fitMode === 'width' ? 'active' : ''} onClick={() => setFitMode('width')}>{t('toolbar.width')}</button>
          </div>

          {/* Rotation controls: rotate 90° left/right */}
          <div className="rotation-controls compact">
            <button onClick={() => rotateBy(-90)} title={t('toolbar.rotateLeft')}> <RotateLeftIcon size={16} /></button>
            <span>{rotation}°</span>
            <button onClick={() => rotateBy(90)} title={t('toolbar.rotateRight')}> <RotateRightIcon size={16} /></button>
          </div>
        </div>

        {/* ── Right: User menu ── */}
        <div className="toolbar-group toolbar-group-right">
          {/* Dark mode toggle */}
          <button className="toolbar-user-btn theme-toggle" onClick={() => setDarkMode((v) => !v)} title={darkMode ? t('theme.light') : t('theme.dark')}>
            {darkMode ? <SunIcon size={16} /> : <MoonIcon size={16} />}
          </button>
          {/* User info area: name, MFA, admin, logout */}
          {currentUser && (
            <div className="toolbar-user-area">
              <span className="toolbar-user-name"><UserIcon size={16} /> {currentUser.displayName}</span>
              {onShowMfaSettings && <button className="toolbar-user-btn" onClick={onShowMfaSettings} title={t('mfa.title')}><ShieldIcon size={16} /></button>}
              {onShowAdminSettings && <button className="toolbar-user-btn" onClick={onShowAdminSettings}>{t('auth.admin')}</button>}
              {onLogout && <button className="toolbar-user-btn" onClick={onLogout}>{t('auth.logout')}</button>}
            </div>
          )}
        </div>
      </header>

      {/* Right panel toggle — fixed to right edge of viewport */}
      <button
        className={`right-panel-toggle ${rightPanelExpanded ? 'active' : ''}`}
        title={rightPanelExpanded ? 'Hide panel' : 'Show panel'}
        onClick={() => setRightPanelExpanded((v) => !v)}
      >
        {rightPanelExpanded ? <PanelRightIcon size={18} /> : <PanelLeftIcon size={18} />}
      </button>

      {/* ═══════════════════════════════════════════════════════════
           LEFT PANEL: Édition / outils de travail
         ═══════════════════════════════════════════════════════════ */}
            {/* ── Compact icon bar (always visible) ── */}
      <aside ref={iconBarRef} className={`panel-icon-bar ${panelExpanded ? 'expanded' : ''}`}>
        {/* Toggle panel — always first */}
        <button className={`panel-icon-btn ${panelExpanded ? 'active' : ''}`} title={panelExpanded ? 'Hide tools' : 'Show tools'} onClick={() => setPanelExpanded((v) => !v)}>
          {panelExpanded ? <PanelRightIcon size={18} /> : <PanelLeftIcon size={18} />}
        </button>

        {/* Divider */}
        <div className="panel-icon-divider" />

        {/* Upload */}
        <label className="panel-upload-btn" title={t('panel.importPdfImage')}>
          <UploadIcon size={18} />
          <input type="file" accept="application/pdf,image/*" onChange={onUpload} disabled={!rolePermissions.uploadDocument} style={{ display: 'none' }} />
        </label>

        {/* Add field */}
        <button className="panel-icon-btn" title={t('toolbar.addField')} disabled={!canEditStructure} onClick={() => { addField(); }}>
          <PlusIcon size={18} />
        </button>

        {/* Add page */}
        <button className="panel-icon-btn" title={t('toolbar.addPage')} disabled={!canEditStructure} onClick={() => { addPage(); }}>
          <LayoutIcon size={18} />
        </button>

        {/* Fill mode toggle */}
        <button className={`panel-icon-btn fill-edit-mode ${fillMode ? 'fill-active' : 'edit-active'}`} title={fillMode ? 'Switch to edit mode' : 'Switch to fill mode'} onClick={() => setFillMode((v) => !v)}>
          {fillMode ? <EditIcon size={18} /> : <EyeIcon size={18} />}
        </button>

        {/* Detect fields */}
        {sourceFileId && (
          <button className="panel-icon-btn" title={t('panel.detect')} disabled={isDetecting} onClick={() => { if (!canEditStructure || !sourceFileId || isDetecting) return; setIsDetecting(true); setStatus(t('status.detecting')); const detectPreset = { low: { sensitivity: 'low', maxDetectWidth: 1200 }, normal: { sensitivity: 'normal', maxDetectWidth: 1800 }, high: { sensitivity: 'high', maxDetectWidth: 2400 } } as const; detectFields(sourceFileId, { targetWidth: pageW, targetHeight: pageH, rotation, ...detectPreset[detectSensitivity], dottedAsLine: detectDottedAsLine }).then(result => { if (result.error) { setStatus(t('status.detectionError', { error: result.error })); return; } if (!result.suggestedFields.length) { setStatus(t('status.noFieldDetected')); return; } const newFields = result.suggestedFields.map(sf => ({ id: sf.id || crypto.randomUUID(), label: sf.label || t('status.defaultFieldLabel'), value: '', x: sf.x, y: sf.y, w: Math.max(16, sf.w), h: Math.max(10, sf.h), type: (sf.type === 'checkbox' ? 'checkbox' : 'text') as FieldType, style: { fontFamily: preset.fontFamily, fontSize: preset.fontSize, fontWeight: preset.fontWeight, textAlign: 'left' as const, color: preset.color }, locked: false, overlayVisible: true, pageNumber: activePage })); setFields(prev => [...prev, ...newFields]); setDirty(true); setStatus(t('status.fieldsDetected', { count: newFields.length })); }).catch(err => { setStatus(err instanceof Error ? err.message : t('status.errorFallback')); }).finally(() => { setIsDetecting(false); }); }}>
            <WandIcon size={18} />
          </button>
        )}

        {/* Divider before right panel toggle */}
        <div className="panel-icon-divider" />

        {/* Right panel toggle — shown in bottom dock on mobile */}
        <button
          className={`panel-icon-btn right-toggle ${rightPanelExpanded ? 'active' : ''}`}
          title={rightPanelExpanded ? 'Hide panel' : 'Show panel'}
          onClick={() => setRightPanelExpanded((v) => !v)}
        >
          {rightPanelExpanded ? <PanelRightIcon size={18} /> : <PanelLeftIcon size={18} />}
        </button>
      </aside>

      {/* ── Expanded panel (slides in, non-blocking) ── */}
      <aside className={`panel panel-expanded ${panelExpanded ? 'visible' : ''}`}>
        <div className="panel-header">
          <span>{t('panel.tools')}</span>
          <span className="panel-hint">{'←'} close</span>
        </div>

            <div className="panel-shortcuts">
              <span>{t('panel.shortcutCtrlClick')}</span>
              <span>{t('panel.shortcutAltDrag')}</span>
            </div>

            <details open className="panel-section">
              <summary>{t('panel.document')}</summary>
              <label className="upload-label">
                {t('panel.importPdfImage')}
                <input type="file" accept="application/pdf,image/*" onChange={onUpload} disabled={!rolePermissions.uploadDocument} />
              </label>
              <div className="panel-meta-grid">
                <div><strong>{t('panel.activePage')}</strong><span>{activePage} / {pageCount}</span></div>
                <div><strong>{t('panel.source')}</strong><span>{sourceMime ? (isPdf ? t('panel.sourcePdf') : t('panel.sourceImage')) : t('panel.sourceNone')}</span></div>
              </div>
            </details>

            <details open className="panel-section">
              <summary>{t('panel.edition')}</summary>
              <div className="panel-btn-grid">
                <button onClick={() => { addField(); setPanelExpanded(false); }} disabled={!canEditStructure}>{t('toolbar.addField')}</button>
                <button onClick={() => { addPage(); setPanelExpanded(false); }} disabled={!canEditStructure}>{t('toolbar.addPage')}</button>
                <button onClick={duplicateActivePage} disabled={!sourceUrl || !canEditStructure}>{t('toolbar.duplicatePage')}</button>
                <button onClick={deleteActivePage} disabled={pageCount <= 1 || !canEditStructure}>{t('toolbar.deletePage')}</button>
              </div>
              <button className={`panel-action-btn ${fillMode ? 'active' : ''}`} onClick={() => setFillMode(v => !v)}>
                {fillMode ? t('panel.fillModeOn') : t('panel.fillModeOff')}
              </button>
              <button className={`panel-action-btn ${showDebugOrder ? 'active' : ''}`} onClick={() => setShowDebugOrder(v => !v)}>
                {showDebugOrder ? t('panel.debugOrderOn') : t('panel.debugOrderOff')}
              </button>
              {fields.length > 0 && (
                <button className="panel-action-btn danger" disabled={fillMode} onClick={() => {
                  if (window.confirm(t('panel.deleteAllFieldsConfirm', { count: fields.length }))) {
                    setFields([]); setSelectedFieldId(null); setMultiSelectedIds(new Set()); setDirty(true);
                    setStatus(t('status.fieldsDeleted', { count: fields.length }));
                  }
                }}>
                  {t('panel.deleteAllFields')}
                </button>
              )}
            </details>

            {sourceFileId && (
              <details open className="panel-section">
                <summary>{t('panel.detection')}</summary>
                <label>
                  {t('panel.sensitivity')}&nbsp;
                  <select value={detectSensitivity}
                    onChange={(e) => setDetectSensitivity(e.target.value as 'low' | 'normal' | 'high')}>
                    <option value="low">{t('panel.sensitivityLow')}</option>
                    <option value="normal">{t('panel.sensitivityNormal')}</option>
                    <option value="high">{t('panel.sensitivityHigh')}</option>
                  </select>
                </label>
                <label style={{ fontSize: '11px', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={detectDottedAsLine}
                    onChange={(e) => setDetectDottedAsLine(e.target.checked)} />
                  {t('panel.dottedAsLine')}
                </label>
                <button className="panel-action-btn" disabled={!canEditStructure || isDetecting}
                  onClick={async () => {
                    if (!canEditStructure) { setStatus(t('status.insufficientRightsStructure')); return; }
                    if (!sourceFileId || isDetecting) return;
                    setIsDetecting(true);
                    try {
                      setStatus(t('status.detecting'));
                      const detectPreset = {
                        low: { sensitivity: 'low', maxDetectWidth: 1200 },
                        normal: { sensitivity: 'normal', maxDetectWidth: 1800 },
                        high: { sensitivity: 'high', maxDetectWidth: 2400 },
                      } as const;
                      const result = await detectFields(sourceFileId, {
                        targetWidth: pageW, targetHeight: pageH, rotation,
                        ...detectPreset[detectSensitivity], dottedAsLine: detectDottedAsLine,
                      });
                      if (result.error) { setStatus(t('status.detectionError', { error: result.error })); return; }
                      if (!result.suggestedFields.length) { setStatus(t('status.noFieldDetected')); return; }
                      const newFields: FieldModel[] = result.suggestedFields.map((sf) => ({
                        id: sf.id || crypto.randomUUID(),
                        label: sf.label || t('status.defaultFieldLabel'),
                        value: '', x: sf.x, y: sf.y,
                        w: Math.max(16, sf.w), h: Math.max(10, sf.h),
                        type: (sf.type === 'checkbox' ? 'checkbox' : 'text') as FieldType,
                        style: { fontFamily: preset.fontFamily, fontSize: preset.fontSize, fontWeight: preset.fontWeight, textAlign: 'left' as const, color: preset.color },
                        locked: false, overlayVisible: true, pageNumber: activePage,
                      }));
                      setFields((prev) => [...prev, ...newFields]); setDirty(true);
                      setStatus(t('status.fieldsDetected', { count: newFields.length }));
                    } catch (err) {
                      setStatus(err instanceof Error ? err.message : t('status.errorFallback'));
                    } finally {
                      setIsDetecting(false);
                    }
                  }}>
                  {isDetecting ? t('panel.detectingFields') : t('panel.detectFields')}
                </button>
              </details>
            )}

            {/* ── Default style section: font family, size, weight, color ── */}
            <details className="panel-section">
              <summary>{t('panel.defaultStyle')}</summary>
              <label>
                {t('panel.font')}
                <select value={preset.fontFamily}
                  onChange={(e) => setPreset((p) => ({ ...p, fontFamily: e.target.value }))}>
                  {['Arial, sans-serif', 'Helvetica, sans-serif', 'Times New Roman, serif', 'Courier New, monospace', 'Georgia, serif', 'Verdana, sans-serif'].map((f) => (
                    <option key={f} value={f}>{f.split(',')[0]}</option>
                  ))}
                </select>
              </label>
              <label>
                {t('panel.fontSize')}
                <select value={preset.fontSize}
                  onChange={(e) => setPreset((p) => ({ ...p, fontSize: Number(e.target.value) }))}>
                  {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32].map((s) => (
                    <option key={s} value={s}>{s}px</option>
                  ))}
                </select>
              </label>
              <label>
                {t('panel.fontWeight')}
                <select value={preset.fontWeight}
                  onChange={(e) => setPreset((p) => ({ ...p, fontWeight: e.target.value as 'normal' | 'bold' }))}>
                  <option value="normal">{t('panel.fontWeightNormal')}</option>
                  <option value="bold">{t('panel.fontWeightBold')}</option>
                </select>
              </label>
              <label>
                {t('panel.color')}
                <input type="color" value={preset.color}
                  onChange={(e) => setPreset((p) => ({ ...p, color: e.target.value }))} />
              </label>
              <button className="panel-action-btn" onClick={() => {
                setFields((prev) => prev.map((f) => ({
                  ...f, style: { ...f.style, fontFamily: preset.fontFamily, fontSize: preset.fontSize, fontWeight: preset.fontWeight, color: preset.color }
                })));
                setStatus(t('status.presetApplied'));
              }}>{t('panel.applyToAllFields')}</button>
            </details>

          </aside>

      {/* ═══════════════════════════════════════════════════════════════════
           EDITOR SECTION — Main canvas area with multi-page rendering
           Each page renders the source document (PDF/image) and overlays fields.
         ═══════════════════════════════════════════════════════════════════ */}
      <section ref={editorRef} className="editor" style={{}} tabIndex={-1} onClick={() => { if (!marqueeJustEndedRef.current) handleSelectField(null); }}>
        {/* Breadcrumb navigation when a folder is selected */}
        {selectedFolderId && (
          <div className="breadcrumb">
            <span className="breadcrumb-item" onClick={() => setSelectedFolderId(null)}>{t('panel.allFolders')}</span>
            {buildBreadcrumb(allFolders, selectedFolderId).map((f) => (
              <span key={f.id}>
                <span className="breadcrumb-sep"> › </span>
                <span
                  className={`breadcrumb-item ${f.id === selectedFolderId ? 'active' : ''}`}
                  onClick={() => setSelectedFolderId(f.id)}
                >
                  📁 {f.name}
                </span>
              </span>
            ))}
          </div>
        )}
        {/* Multi-page stack: renders all pages vertically */}
        <div className="multi-pages-stack">
          {/* Render each page with its zoom wrapper and field overlays */}
          {Array.from({ length: pageCount }, (_, idx) => idx + 1).map((pageNum) => (
            <div key={pageNum} className="page-zoom-wrapper" style={{ width: dispW * zoom, height: dispH * zoom }}>
              {/* Page container: scale for zoom + rotation */}
              <div
                className="page"
                style={{
                  width: pageW,
                  height: pageH,
                  transform: `scale(${zoom})${pageRotation ? ' ' + pageRotation : ''}`,
                  transformOrigin: 'top left',
                  outline: pageNum === activePage ? '2px solid #0077ff' : '1px solid #d0d0d0',
                }}
                aria-label={`Page document ${pageNum}`}
                onMouseDown={(e) => startMarquee(e, pageNum)}
                onClick={(e) => {
                  if (marqueeJustEndedRef.current) return;
                  if (e.target === e.currentTarget) {
                    setActivePage(pageNum);
                    handleSelectField(null);
                  }
                }}
              >
                {/* Page label shown above each page */}
                <div style={{ position: 'absolute', top: -22, right: 0, fontSize: 12, color: '#666' }}>{t('panel.pageLabel', { n: pageNum })}</div>
                {/* Source document renderer: PDF uses PdfViewer, image uses <img> */}
                {sourceUrl ? (
                  isPdf ? (
                    <PdfViewer url={sourceUrl} onDimensionsDetected={onPdfDimensions} showPagination={false} />
                  ) : (
                    <img src={sourceUrl} className="scan-image" alt="Document" onLoad={onImageLoad} />
                  )
                ) : (
                  <div className="scan-bg"><p>{t('panel.importScanHint')}</p></div>
                )}

                {/* Field overlays: render interactive FieldOverlay for each field on this page */}
                {fields.filter((f) => (f.pageNumber ?? 1) === pageNum).map((f) => (
                  <FieldOverlay
                    key={f.id}
                    field={f}
                    selected={f.id === selectedFieldId || multiSelectedIds.has(f.id)}
                    zoom={zoom}
                    rotation={rotation}
                    docRole={docRole}
                    fillMode={fillMode}
                    // Selection handler: activates page and selects/deselects field
                    onSelect={(ctrlKey) => {
                      setActivePage(pageNum);
                      handleSelectField(f.id, ctrlKey);
                    }}
                    // Position and size update callbacks
                    onMove={(x, y) => updateField(f.id, { x, y })}
                    onResize={(w, h) => updateField(f.id, { w, h })}
                    // Value change with overflow distribution logic
                    onValueChange={(value, caret, meta) => updateFieldValueWithOverflow(f.id, value, caret, meta)}
                    // Keyboard handler for backspace-to-previous-field in overflow chains
                    onFieldKeyDown={handleFieldKeyDown}
                    onStructureLockedAttempt={() => setStatus(t('status.fieldLocked'))}
                    pageWidth={pageW}
                    pageHeight={pageH}
                    // Debug overlay: shows overflow order number when debug mode is active
                    debugOrder={showDebugOrder ? (() => {
                      const gid = (f.style.overflowGroupId || '').trim();
                      if (!gid) return undefined;
                      const grp = sortOverflowGroup(fields.filter((g) => (g.pageNumber ?? 1) === (f.pageNumber ?? 1) && g.type === 'text' && (g.style.overflowGroupId || '').trim() === gid));
                      const idx = grp.findIndex((g) => g.id === f.id);
                      return idx >= 0 ? idx + 1 : undefined;
                    })() : undefined}
                    // valueOverride: for fused/continuous overflow modes, the anchor field
                    // displays the combined global text instead of its individual field value
                    valueOverride={(() => {
                      const gid = (f.style.overflowGroupId || '').trim();
                      if (!gid) return undefined;

                      const mode = f.style.overflowInteractionMode ?? 'distributed';
                      const isFusedActive = mode === 'fused' && ENABLE_FUSED_MODE;
                      const continuousEntry = mode === 'continuous' ? getContinuousStateForField(f) : undefined;
                      const continuousState = continuousEntry?.[1];
                      const fusedState = isFusedActive ? fusedUiState[`${f.pageNumber ?? 1}:${gid}`] : undefined;
                      const state = continuousState ?? fusedState;

                      if (!state) return undefined;
                      if (state.anchorFieldId !== f.id) return undefined;
                      return state.globalText;
                    })()}
                    // fusedMeta: controls visual behavior for fused/continuous mode fields
                    // - anchor fields get expanded bounds covering all used fields
                    // - non-anchor used fields are hidden (anchor covers their area)
                    fusedMeta={(() => {
                      const gid = (f.style.overflowGroupId || '').trim();
                      if (!gid) return undefined;

                      const mode = f.style.overflowInteractionMode ?? 'distributed';
                      const isFusedActive = mode === 'fused' && ENABLE_FUSED_MODE;
                      const continuousEntry = mode === 'continuous' ? getContinuousStateForField(f) : undefined;
                      const continuousState = continuousEntry?.[1];
                      const fusedState = isFusedActive ? fusedUiState[`${f.pageNumber ?? 1}:${gid}`] : undefined;
                      const state = continuousState ?? fusedState;

                      if (!state) return undefined;
                      const isAnchor = state.anchorFieldId === f.id;
                      const isUsed = state.usedFieldIds.includes(f.id);
                      if (!isUsed && !isAnchor) return undefined;
                      if (isAnchor) {
                        const usedFields = state.usedFieldIds.map((uid) => fields.find((ff) => ff.id === uid)).filter(Boolean) as FieldModel[];
                        if (usedFields.length <= 1) return { hidden: false, anchor: true };
                        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                        for (const uf of usedFields) {
                          minX = Math.min(minX, uf.x);
                          minY = Math.min(minY, uf.y);
                          maxX = Math.max(maxX, uf.x + uf.w);
                          maxY = Math.max(maxY, uf.y + uf.h);
                        }
                        return { hidden: false, anchor: true, bounds: { x: minX, y: minY, w: maxX - minX, h: maxY - minY } };
                      }
                      // Non-anchor used field: hide it visually (anchor covers it)
                      return { hidden: true, anchor: false };
                    })()}
                    // onReAnchorFused: callback to change which field is the anchor in a fused/continuous group
                    onReAnchorFused={(() => {
                      const gid = (f.style.overflowGroupId || '').trim();
                      if (!gid) return undefined;

                      const mode = f.style.overflowInteractionMode ?? 'distributed';
                      const isFusedActive = mode === 'fused' && ENABLE_FUSED_MODE;
                      const continuousEntry = mode === 'continuous' ? getContinuousStateForField(f) : undefined;
                      const stateKey = continuousEntry?.[0] ?? (isFusedActive ? `${f.pageNumber ?? 1}:${gid}` : undefined);
                      const state = continuousEntry?.[1] ?? (isFusedActive ? fusedUiState[`${f.pageNumber ?? 1}:${gid}`] : undefined);
                      if (!state) return undefined;

                      return () => {
                        const targetKey = mode === 'continuous'
                          ? `${f.pageNumber ?? 1}:${gid}:${f.id}`
                          : `${f.pageNumber ?? 1}:${gid}`;
                        const group = sortOverflowGroup(
                          fields.filter((g) => (g.pageNumber ?? 1) === (f.pageNumber ?? 1) && g.type === 'text' && (g.style.overflowGroupId || '').trim() === gid)
                        );
                        const anchorIdx = group.findIndex((g) => g.id === f.id);
                        if (anchorIdx < 0) return;
                        const usedFieldIds: string[] = [];
                        const globalParts: string[] = [];
                        for (let i = anchorIdx; i < group.length; i++) {
                          const val = group[i].value || '';
                          if (i === anchorIdx || val.length > 0) usedFieldIds.push(group[i].id);
                          globalParts.push(val);
                          if (val.length === 0 && i > anchorIdx) break;
                        }
                        const globalText = globalParts.join('');
                        setFusedUiState((prev) => {
                          const next = { ...prev };
                          if (stateKey && stateKey !== targetKey) delete next[stateKey];
                          next[targetKey] = {
                            anchorFieldId: f.id,
                            usedFieldIds,
                            globalText,
                            version: (prev[targetKey]?.version ?? 0) + 1,
                          };
                          return next;
                        });
                        setStatus(t('status.anchorRepositioned'));
                      };
                    })()}
                  />
                ))}

                {/* Marquee selection rectangle */}
                {/* Marquee selection rectangle: shown during rubber-band selection drag */}
                {marqueeRect && marqueePageNum === pageNum && marqueeRect.w + marqueeRect.h > 2 && (
                  <div
                    className="marquee-rect"
                    style={{
                      left: marqueeRect.x,
                      top: marqueeRect.y,
                      width: marqueeRect.w,
                      height: marqueeRect.h,
                    }}
                  />
                )}
              </div>
            </div>
          ))}

          {/* ── Status bar: autosave + status, below all pages ── */}
          <div className="editor-status-bar">
            <span className="toolbar-status-text">{status || t('status.ready')}</span>
            <AutosaveIndicator
              status={autosaveState.status}
              lastSavedAt={autosaveState.lastSavedAt}
              errorMessage={autosaveState.errorMessage}
            />
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════
           RIGHT PANEL: PropertiesPanel — field properties, overflow config,
           and template library browser
         ═══════════════════════════════════════════════════════════════════ */}
      <aside className={`right-panel-wrapper ${rightPanelExpanded ? 'visible' : ''}`}>
      <PropertiesPanel
        field={selectedField}
        fields={fields}
        selectedFieldId={selectedFieldId}
        multiSelectedIds={multiSelectedIds}
        onSelectField={(id, ctrlKey) => handleSelectField(id, ctrlKey)}
        onUpdate={updateField}
        onBulkUpdateFields={bulkUpdateFields}
        onBulkPatchFieldStyle={bulkPatchFieldStyle}
        onBulkUpdateType={bulkUpdateType}
        onBulkAssignOverflowGroup={bulkAssignOverflowGroup}
        onReorder={reorderField}
        onDelete={deleteField}
        onDuplicate={duplicateField}
        onAutoOrderOverflowGroup={autoOrderOverflowGroup}
        docRole={docRole}
        fillMode={fillMode}
        // Callback to reset fused UI state for a given key (used when changing overflow settings)
        onResetFused={(fusedKey: string) => {
          setFusedUiState((prev) => {
            const next = { ...prev };
            delete next[fusedKey];
            return next;
          });
        }}
        /* ── Template library props (folder browsing, CRUD operations) ── */
        templates={templates}
        selectedFolderId={selectedFolderId}
        onSelectFolder={setSelectedFolderId}
        onFoldersLoaded={setAllFolders}
        allFolders={allFolders}
        onLoadTemplate={loadTemplate}
        onRenameTemplate={handleRenameTemplate}
        onMoveTemplate={handleMoveTemplate}
        onDeleteTemplate={handleDeleteTemplate}
        canManageTemplate={canManageTemplate}
      />
      </aside>

      {/* Share modal: lazy-loaded, allows sharing the document with other users */}
      {showShareModal && sourceFileId && (
        <Suspense fallback={null}>
          <ShareModal docId={sourceFileId} onClose={() => setShowShareModal(false)} />
        </Suspense>
      )}

      {/* Draft restore modal: prompts user to restore or discard a pending auto-saved draft */}
      {pendingDraft && (
        <DraftRestoreModal
          draft={pendingDraft}
          onRestore={handleRestoreDraft}
          onIgnore={handleIgnoreDraft}
        />
      )}
    </main>
  );
}

