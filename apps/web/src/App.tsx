const DEBUG_FUSED = false;
const ENABLE_FUSED_MODE = false;

import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { clearDraft, deleteTemplate, detectFields, getDraft, getDocumentUrl, getMyDocRole, getMyPermissions, listFolders, listTemplates, moveTemplateToFolder, renameTemplate, resolveExportDestination, runServerExport, saveTemplate, upsertDraft, uploadDocument, type DraftRecord, type RolePermissions } from './api';
import FieldOverlay from './components/FieldOverlay';
import PdfViewer from './components/PdfViewer';
import PropertiesPanel from './components/PropertiesPanel';
import { buildBreadcrumb } from './components/FolderTree';
import AutosaveIndicator from './components/AutosaveIndicator';
import DraftRestoreModal from './components/DraftRestoreModal';
import type { FolderModel } from './api';
import { defaultDocumentPreset, defaultFieldStyle } from './types';
import { exportFilledPdf, generateFilledPdfBlob } from './exportPdf';
import { displayDims, findNearestField } from './utils';
import type { Rotation } from './utils';
import type { DocumentPreset, FieldModel, FieldType, TemplateModel } from './types';
import { getStoredUser } from './auth';
import { useAutosave } from './hooks/useAutosave';
import { useTranslation } from './i18n';

const DEFAULT_WIDTH = 794;
const DEFAULT_HEIGHT = 1123;
const ZOOM_STEPS = [0.5, 0.6, 0.7, 0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.75, 2.0];
const ShareModal = lazy(() => import('./components/ShareModal'));

/** Strip field values to produce a clean template (structure only). */
function stripFieldValues(fields: FieldModel[]): FieldModel[] {
  return fields.map((f) => ({
    ...f,
    value: f.type === 'counter-tally' || f.type === 'counter-numeric' ? '0' : '',
  }));
}

type OverflowUiStateEntry = {
  anchorFieldId: string;
  usedFieldIds: string[];
  globalText: string;
  version: number;
};

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

type AppProps = {
  currentUser?: import('./auth').AuthUser | null;
  onLogout?: () => void;
  onShowAdminSettings?: () => void;
  onShowMfaSettings?: () => void;
};

export default function App({ currentUser: currentUserProp, onLogout, onShowAdminSettings, onShowMfaSettings }: AppProps = {}) {
  const { t } = useTranslation();
  const currentUser = currentUserProp ?? getStoredUser();
  const [fileMenuOpen, setFileMenuOpen] = useState(false);
  const docRoleLabel = (role: 'owner' | 'editor' | 'filler' | null) => {
    if (role === 'owner') return t('roles.owner');
    if (role === 'editor') return t('roles.editor');
    if (role === 'filler') return t('roles.filler');
    return t('roles.noAccess');
  };

  const normalizeField = (f: Partial<FieldModel> & Pick<FieldModel, 'id' | 'label' | 'x' | 'y' | 'w' | 'h' | 'type'>): FieldModel => ({
    ...f,
    value: f.value ?? '',
    style: f.style ?? { ...defaultFieldStyle },
    locked: f.locked ?? false,
    overlayVisible: f.overlayVisible ?? true,
    pageNumber: f.pageNumber ?? 1,
  });

  const getBlankFieldValue = (field: Pick<FieldModel, 'type'>): string => {
    if (field.type === 'checkbox') return 'false';
    if (field.type === 'counter-tally' || field.type === 'counter-numeric') return '0';
    return '';
  };

  const stripTemplateFieldValues = (items: FieldModel[]): FieldModel[] =>
    items.map((field) => ({ ...field, value: getBlankFieldValue(field) }));

  const [rolePermissions, setRolePermissions] = useState<RolePermissions>(fallbackPermissionsForRole(currentUser?.role));
  const [name, setName] = useState('template-a4');
  const [fields, setFields] = useState<FieldModel[]>([]);
  const [selectedFieldId, setSelectedFieldId] = useState<string | null>(null);
  const [multiSelectedIds, setMultiSelectedIds] = useState<Set<string>>(new Set());
  const [sourceFileId, setSourceFileId] = useState<string | undefined>();
  const [sourceUrl, setSourceUrl] = useState<string | undefined>();
  const [sourceMime, setSourceMime] = useState<string | undefined>();
  const [templates, setTemplates] = useState<TemplateModel[]>([]);
  const [status, setStatus] = useState('');
  const [dirty, setDirty] = useState(false); // Warn before destructive resets when there are unsaved edits.
  const [showShareModal, setShowShareModal] = useState(false);
  const [docRole, setDocRole] = useState<'owner' | 'editor' | 'filler' | null>(null);
  const canEditStructure = rolePermissions.editStructure && docRole !== 'filler';
  const canSaveTemplate = rolePermissions.createTemplate && (docRole === 'owner' || docRole === 'editor' || docRole === null);
  const canManageTemplate = rolePermissions.manageTemplate && (docRole === 'owner' || docRole === 'editor' || docRole === null);
  const canExport = rolePermissions.exportPdf && docRole !== 'filler';
  const canPrintDoc = rolePermissions.printDocument && docRole !== 'filler';
  const [selectedFolderId, setSelectedFolderId] = useState<string | null>(null);
  const [allFolders, setAllFolders] = useState<FolderModel[]>([]);
  const [pageCount, setPageCount] = useState(1);
  const [activePage, setActivePage] = useState(1);

  // Keep field geometry in natural page units; zoom/rotation are view-only transforms.
  const [pageW, setPageW] = useState(DEFAULT_WIDTH);
  const [pageH, setPageH] = useState(DEFAULT_HEIGHT);
  // Source dimensions are kept only for diagnostics.
  const [srcW, setSrcW] = useState(0);
  const [srcH, setSrcH] = useState(0);

  const [rotation, setRotation] = useState<Rotation>(0);

  const [zoomIndex, setZoomIndex] = useState(4);
  const zoom = ZOOM_STEPS[zoomIndex];

  const [preset, setPreset] = useState<DocumentPreset>({ ...defaultDocumentPreset });
  const [fillMode, setFillMode] = useState(true);
  const [showDebugOrder, setShowDebugOrder] = useState(false);
  const [fusedUiState, setFusedUiState] = useState<Record<string, OverflowUiStateEntry>>({});
  const [fitMode, setFitMode] = useState<'page' | 'width'>('page');

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
  const [detectSensitivity, setDetectSensitivity] = useState<'low' | 'normal' | 'high'>('normal');
  const [detectDottedAsLine, setDetectDottedAsLine] = useState(false);
  const [isDetecting, setIsDetecting] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const pendingFocusRef = useRef<string | null>(null);

  // ───── Marquee (rubber-band) selection ─────
  const [marqueeRect, setMarqueeRect] = useState<{ x: number; y: number; w: number; h: number } | null>(null);
  const [marqueePageNum, setMarqueePageNum] = useState(0);
  const marqueeJustEndedRef = useRef(false);
  const fieldsRef = useRef(fields);
  fieldsRef.current = fields;

  const selectedField = fields.find((f) => f.id === selectedFieldId) ?? null;

  // Wrapper dimensions follow rotation to keep the editor scroll area aligned.
  const [dispW, dispH] = displayDims(pageW, pageH, rotation);

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;

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

  useEffect(() => {
    listTemplates().then(setTemplates).catch(() => undefined);
    getMyPermissions().then(setRolePermissions).catch(() => undefined);
  }, []);

  // Fetch user's effective role on the current document
  useEffect(() => {
    if (!sourceFileId) { setDocRole(null); return; }
    getMyDocRole(sourceFileId).then((r) => setDocRole(r.docRole as any)).catch(() => setDocRole(null));
  }, [sourceFileId]);

  const applyFitZoom = useCallback((w: number, h: number) => {
    const el = editorRef.current;
    if (!el || w <= 0 || h <= 0) return;

    const availableW = Math.max(200, el.clientWidth - 32);
    const availableH = Math.max(200, el.clientHeight - 32);
    const fit = fitMode === 'width' ? (availableW / w) : Math.min(availableW / w, availableH / h);
    const clamped = Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], fit));

    let best = 0;
    let bestDiff = Number.POSITIVE_INFINITY;
    for (let i = 0; i < ZOOM_STEPS.length; i++) {
      const diff = Math.abs(ZOOM_STEPS[i] - clamped);
      if (diff < bestDiff) {
        bestDiff = diff;
        best = i;
      }
    }
    setZoomIndex(best);
  }, [fitMode]);

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
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedFieldId, multiSelectedIds, fields, fillMode, activePage, rotation, pageW, pageH]);

  // After Tab selection, move DOM focus to the field control for immediate typing.
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

  const onImageLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    setSrcW(img.naturalWidth);
    setSrcH(img.naturalHeight);
    setPageW(img.naturalWidth);
    setPageH(img.naturalHeight);
    applyFitZoom(img.naturalWidth, img.naturalHeight);
  }, [applyFitZoom]);

  // Ctrl/Cmd keeps additive selection behavior consistent between canvas and side panel.
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

  // ───── Marquee helpers ─────
  const rectsIntersect = (
    a: { x: number; y: number; w: number; h: number },
    b: { x: number; y: number; w: number; h: number },
  ) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

  /** Convert a screen point (clientX/Y) to field-space coords on the given page element. */
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

  const updateField = (id: string, partial: Partial<FieldModel>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...partial } : f)));
    setDirty(true);
  };

  const bulkUpdateFields = (ids: string[], partial: Partial<FieldModel>) => {
    const setIds = new Set(ids);
    setFields((prev) => prev.map((f) => (setIds.has(f.id) ? { ...f, ...partial } : f)));
    setDirty(true);
  };

  const bulkPatchFieldStyle = (ids: string[], stylePatch: Partial<FieldModel['style']>) => {
    const setIds = new Set(ids);
    setFields((prev) => prev.map((f) => {
      if (!setIds.has(f.id) || f.type !== 'text') return f;
      return { ...f, style: { ...f.style, ...stylePatch } };
    }));
    setDirty(true);
  };

  const estimateFieldCapacity = (field: FieldModel): number => {
    if (field.type !== 'text') return Number.MAX_SAFE_INTEGER;
    const fontSize = field.style.fontSize || 14;
    const innerW = Math.max(8, field.w - 6);
    const innerH = Math.max(8, field.h - 4);
    const charsPerLine = Math.max(1, Math.floor(innerW / (fontSize * 0.54)));
    const lines = Math.max(1, Math.floor(innerH / (fontSize * 1.2)));
    return charsPerLine * lines;
  };

  const takeFieldChunk = (text: string, field: FieldModel) => {
    const cap = estimateFieldCapacity(field);
    if (text.length <= cap) {
      return { chunk: text, consumed: text.length, cap };
    }

    // Prefer cutting at a word boundary to avoid brutal word splits between fields.
    let cut = cap;
    const candidate = text.slice(0, cap);
    const ws = Math.max(candidate.lastIndexOf(' '), candidate.lastIndexOf('\t'), candidate.lastIndexOf('\n'));
    if (ws >= Math.floor(cap * 0.9)) {
      cut = ws + 1; // include the separator in current field to preserve word spacing
    }

    const chunk = text.slice(0, cut);
    const consumed = cut;

    return { chunk, consumed, cap };
  };

  /** Strict capacity slice for fused mode: no word-boundary trimming, chunk === consumed always. */
  const takeFieldChunkStrict = (text: string, field: FieldModel) => {
    const cap = estimateFieldCapacity(field);
    const chunk = text.slice(0, cap);
    return { chunk, consumed: chunk.length, cap };
  };

  /**
   * Deterministic runtime order based on VISUAL coordinates (after rotation).
   * Left→right, then next line left→right.
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

    const items = group.map((f) => ({ f, r: toVisualRect(f) }));
    const avgH = items.length ? items.reduce((sum, it) => sum + it.r.h, 0) / items.length : 20;
    const tol = Math.max(6, avgH * 0.5);

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
    const activeChain = maxFields ? group.slice(0, maxFields) : group;
    const changedIdx = activeChain.findIndex((f) => f.id === id);

    if (changedIdx < 0) {
      updateField(id, { value: newValue });
      return;
    }

    // ── MODE SELECTION ───────────────────────────────────────────────────
    const interactionModeRaw = source.style.overflowInteractionMode || groupLead.style.overflowInteractionMode || 'distributed';
    const interactionMode = (!ENABLE_FUSED_MODE && interactionModeRaw === 'fused') ? 'distributed' : interactionModeRaw;

    {
      const hasOverflowHint = typeof meta?.overflowed === 'boolean';
      const overflowHint = Boolean(meta?.overflowed);
      const localCap = estimateFieldCapacity(source);

      const isFullLike = (field: FieldModel, value: string) => {
        const cap = estimateFieldCapacity(field);
        return value.length >= Math.max(1, cap - 1);
      };

      // ── CONTINUOUS MODE: physical extension (anchor + bounds) ─────────
      if (interactionMode === 'continuous') {
        const page = source.pageNumber ?? 1;
        const existingEntry = getContinuousStateForFieldId(page, groupId, id);
        const existingKey = existingEntry?.[0];
        const existingState = existingEntry?.[1];
        const localOnEnd = source.style.overflowOnEnd || groupLead.style.overflowOnEnd || 'truncate';

        // Check if this edit is on a field OUTSIDE the current extension zone
        const isInExtensionZone = !existingState || existingState.usedFieldIds.includes(id) || id === existingState.anchorFieldId;

        // Determine anchor:
        // - if editing inside existing extension: keep sticky anchor (can move upward)
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
        const chainIndices: number[] = [effectiveAnchorIdx];
        for (let i = effectiveAnchorIdx + 1; i < activeChain.length; i++) {
          const prev = activeChain[i - 1];
          const curr = activeChain[i];
          const prevVal = prev.value || '';
          const currVal = curr.value || '';
          const wasUsed = Boolean(existingState?.usedFieldIds.includes(curr.id));
          const allow = wasUsed || currVal.length === 0 || isFullLike(prev, prevVal);
          if (!allow) break;
          chainIndices.push(i);
        }
        const chainFields = chainIndices.map((idx) => activeChain[idx]);

        // ── Non-extension-zone edit: update locally without touching the extension ──
        if (!isInExtensionZone) {
          // Just update this field's value locally; don't destroy fused state
          const fits = (hasOverflowHint && !overflowHint) || (!hasOverflowHint && newValue.length <= localCap);
          if (fits) {
            setFields((prev) => prev.map((f) => (f.id === id ? { ...f, value: newValue } : f)));
            setDirty(true);
            return;
          }
          // If it overflows, start a new extension from this field
          // (fall through to the main continuous logic below with a fresh anchor)
        }

        // Local edit that fits and no existing extension → no physical extension needed
        if (!existingState && ((hasOverflowHint && !overflowHint) || (!hasOverflowHint && newValue.length <= localCap))) {
          setFields((prev) => prev.map((f) => (f.id === id ? { ...f, value: newValue } : f)));
          setDirty(true);
          return;
        }

        // Build the global text stream from the local chain onward
        const oldGlobalFromFields = chainFields.map((f) => f.value || '').join('');
        const oldGlobal = (existingState && existingState.anchorFieldId === effectiveAnchorId)
          ? (existingState.globalText || oldGlobalFromFields)
          : oldGlobalFromFields;
        const oldLocal = (id === effectiveAnchorId && existingState && existingState.anchorFieldId === effectiveAnchorId)
          ? oldGlobal
          : (source.value || '');

        // Prefix length: chars in chain fields between anchor and edited field
        let prefixLen = 0;
        for (const idx of chainIndices) {
          if (idx >= changedIdx) break;
          prefixLen += (activeChain[idx].value || '').length;
        }

        // Apply diff oldLocal → newValue into the global stream
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

        // Distribute across local continuous chain fields
        const valueById = new Map<string, string>();
        // Keep fields before anchor untouched
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

        // Normalize: pull text left to keep fields compact
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
        const usedFieldIds: string[] = [];
        const globalText = normalized.join('');
        for (let i = 0; i < chainFields.length; i++) {
          const val = normalized[i];
          if (i === 0 || val.length > 0) {
            usedFieldIds.push(chainFields[i].id);
          } else {
            break;
          }
        }

        // Update or clear fusedUiState for physical extension
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
          // Multiple fields used → show physical extension for this local chain.
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

      // Local edit when there is no visible overflow (distributed only).
      if (!needsDistributedReflow && ((hasOverflowHint && !overflowHint) || (!hasOverflowHint && newValue.length <= localCap))) {
        setFields((prev) => prev.map((f) => (f.id === id ? { ...f, value: newValue } : f)));
        setDirty(true);
        return;
      }

      const localOnEnd = groupLead.style.overflowOnEnd || 'truncate';

      // Build writable local chain for distributed mode.
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

    // Legacy global continuous branch disabled (kept only as fallback reference).
    // Current continuous behavior is handled by the localized flow above.
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
    if (interactionMode === 'fused') {
      if (DEBUG_FUSED) console.log('[FUSED] edit triggered', { id, groupId, changedIdx, newValue: newValue.slice(0, 40) });

      const fusedKey = `${source!.pageNumber ?? 1}:${groupId}`;
      const state = fusedUiState[fusedKey];
      const onEnd = groupLead.style.overflowOnEnd || 'truncate';

      // Sticky anchor: first editor becomes anchor and stays until reset.
      const anchorId = state?.anchorFieldId ?? id;
      const anchorIdx = activeChain.findIndex((f) => f.id === anchorId);
      const isAnchorEdit = id === anchorId;

      // ── Helper: distribute globalText from anchor onward & update state ──
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
        // from all suffix fields (with the edited field's new value) and redistribute.
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

        // Non-fused-zone non-anchor edit: local-only overflow
        const editedField = activeChain[changedIdx];
        const { chunk: fittedValue, consumed } = takeFieldChunkStrict(newValue, editedField);
        const overflow = newValue.slice(consumed);

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

      // Anchor edit: fused global stream from anchor onward.
      if (DEBUG_FUSED) console.log('[FUSED] anchor edit', { anchorId, newValueLen: newValue.length });
      distributeFusedGlobal(newValue);
      return;
    }
    // ── END FUSED MODE ───────────────────────────────────────────────────

    // Re-narrow source after block scope (TS loses narrowing across closures).
    const src = source!;

    const onEnd = groupLead.style.overflowOnEnd || 'truncate';
    const valueById = new Map<string, string>();

    // If the edited value still fits visually, keep the change local.
    // Prefer DOM overflow hint; fallback to heuristic capacity only when hint is absent.
    const localCap = estimateFieldCapacity(src);
    const hasOverflowHint = typeof meta?.overflowed === 'boolean';
    const overflowHint = Boolean(meta?.overflowed);
    if ((hasOverflowHint && !overflowHint) || (!hasOverflowHint && newValue.length <= localCap)) {
      setFields((prev) => prev.map((f) => (f.id === id ? { ...f, value: newValue } : f)));
      setDirty(true);
      return;
    }

    // Fields BEFORE edited one: keep intact (never reorder backward)
    for (let i = 0; i < changedIdx; i++) {
      valueById.set(activeChain[i].id, activeChain[i].value || '');
    }

    // Fields from edited index onward.
    const suffixFields = activeChain.slice(changedIdx);
    const oldCurrent = suffixFields[0].value || '';
    const oldSuffixTail = suffixFields.slice(1).map((f) => (f.value || '')).join('');
    const oldStream = oldCurrent + oldSuffixTail;
    const currentCap = estimateFieldCapacity(suffixFields[0]);

    let flowText = oldStream;

    // Common case when field 1 is visually full and user keeps typing:
    // browser still emits newValue = oldCurrent + typedChar(s), which should append
    // to the end of the global stream (not prepend in next field).
    if (
      (oldCurrent.length >= currentCap || overflowHint) &&
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

    // Normalization pass: keep text visually continuous when deleting/backspacing
    // at the end of a filled field (pull first chars from next fields to the left).
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

    setFields((prev) => prev.map((f) => (valueById.has(f.id) ? { ...f, value: valueById.get(f.id) as string } : f)));

    // ── DISTRIBUTED: auto-advance focus only on real overflow (not when just full) ──
    const currentValue = valueById.get(id) || '';
    const currentCap2 = estimateFieldCapacity(src);
    const nextValue = changedIdx < activeChain.length - 1 ? (valueById.get(activeChain[changedIdx + 1].id) || '') : '';
    const didOverflowCurrent = overflowHint || newValue.length > currentCap2;
    if (didOverflowCurrent && nextValue.length > 0 && changedIdx < activeChain.length - 1) {
      const nextField = activeChain[changedIdx + 1];
      setSelectedFieldId(nextField.id);
      pendingFocusRef.current = nextField.id;
    }
    setDirty(true);
    if (truncated) {
      setStatus(t('status.overflowFull'));
    }
  };

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

  const bulkUpdateType = (ids: string[], type: FieldType) => {
    const newValue = type === 'counter-tally' || type === 'counter-numeric' ? '0' : '';
    setFields((prev) => prev.map((f) => (ids.includes(f.id) ? { ...f, type, value: newValue } : f)));
    setDirty(true);
  };

  const deleteField = (id: string) => {
    setFields((prev) => prev.filter((f) => f.id !== id));
    if (selectedFieldId === id) setSelectedFieldId(null);
    setMultiSelectedIds((prev) => { const n = new Set(prev); n.delete(id); return n; });
    setDirty(true);
  };

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


  // Centralize reset logic so every new document/template load shares the same guardrails.
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

  const handleDeleteTemplate = async (id: string) => {
    try {
      await deleteTemplate(id);
      setTemplates((prev) => prev.filter((tmpl) => tmpl.id !== id));
      setStatus(t('status.templateDeleted'));
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t('status.errorFallback'));
    }
  };

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

  const [serverExportAvailable, setServerExportAvailable] = useState(false);
  const [serverExportBusy, setServerExportBusy] = useState(false);

  // Check if server-side export is available for current context
  useEffect(() => {
    if (!canExport || !sourceUrl) { setServerExportAvailable(false); return; }
    resolveExportDestination({ templateName: name, templateId: loadedTemplateId || undefined })
      .then((r) => setServerExportAvailable(r.enabled === true && r.matched === true && r.errors.length === 0))
      .catch(() => setServerExportAvailable(false));
  }, [canExport, sourceUrl, name, loadedTemplateId]);

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

  const handlePrint = () => {
    if (!canPrintDoc) {
      setStatus(t('status.insufficientRightsPrint'));
      return;
    }
    window.print();
  };

  const rotateBy = (deg: 90 | -90) => {
    setRotation((prev) => (((prev + deg) % 360 + 360) % 360) as Rotation);
  };

  const isPdf = sourceMime === 'application/pdf';

  // Compose transform once so all overlays/background stay in the same coordinate space.
  const pageTransform = (() => {
    const parts: string[] = [`scale(${zoom})`];
    if (rotation === 90) parts.push(`translate(${pageH}px, 0) rotate(90deg)`);
    else if (rotation === 180) parts.push(`translate(${pageW}px, ${pageH}px) rotate(180deg)`);
    else if (rotation === 270) parts.push(`translate(0, ${pageW}px) rotate(270deg)`);
    return parts.join(' ');
  })();


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

  const handleIgnoreDraft = useCallback(() => {
    if (!pendingDraft) return;
    // Optionally clear the draft so it won't prompt again
    const key = draftKey;
    if (key) clearDraft(key).catch(() => {});
    setPendingDraft(null);
  }, [pendingDraft, draftKey]);

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

  return (
    <main className="app">
      <header className="app-toolbar app-toolbar-single-row">
        {/* ── Left: Brand + File menu ── */}
        <div className="toolbar-group toolbar-group-brand">
          <div className="toolbar-brand">LMPdf</div>

          {/* File dropdown menu */}
          <div className="toolbar-file-menu-wrap">
            <button
              className="toolbar-file-menu-btn"
              onClick={() => setFileMenuOpen((v) => !v)}
              onBlur={() => setTimeout(() => setFileMenuOpen(false), 150)}
            >
              {t('toolbar.fileMenu')} ▾
            </button>
            {fileMenuOpen && (
              <div className="toolbar-file-dropdown">
                <button onClick={() => { onSave(); setFileMenuOpen(false); }} disabled={!canSaveTemplate}>{t('toolbar.saveTemplate')}</button>
                <button onClick={() => { onSaveDraft(); setFileMenuOpen(false); }} disabled={!draftKey}>{t('toolbar.saveDraft')}</button>
                <hr />
                <button onClick={() => { handleExportPdf(); setFileMenuOpen(false); }} disabled={!sourceUrl || !canExport}>{t('toolbar.export')}</button>
                {serverExportAvailable && (
                  <button onClick={() => { handleServerExport(); setFileMenuOpen(false); }} disabled={!sourceUrl || !canExport || serverExportBusy}>{serverExportBusy ? t('toolbar.serverExportBusy') : t('toolbar.serverExport')}</button>
                )}
                <button onClick={() => { handlePrint(); setFileMenuOpen(false); }} disabled={!sourceUrl || !canPrintDoc}>{t('toolbar.print')}</button>
                <button onClick={() => { setShowShareModal(true); setFileMenuOpen(false); }} disabled={!sourceFileId}>{t('toolbar.share')}</button>
              </div>
            )}
          </div>
        </div>

        {/* ── Center-left: Document name + quick save + compact meta ── */}
        <div className="toolbar-group toolbar-group-doc">
          <input
            className="toolbar-name-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('toolbar.templateNamePlaceholder')}
          />
          <button
            className="toolbar-save-icon"
            onClick={onSave}
            disabled={!canSaveTemplate}
            title={t('toolbar.saveTemplateTitle')}
            aria-label={t('toolbar.saveTemplateTitle')}
          >
            💾
          </button>
          <div className="toolbar-meta-stack">
            <span className={`toolbar-badge ${dirty ? 'dirty' : ''}`}>{dirty ? t('common.modified') : t('common.upToDate')}</span>
            {sourceFileId && (
              <span className={`doc-role-badge compact ${docRole ?? 'none'}`}>
                {docRoleLabel(docRole)}
              </span>
            )}
          </div>
        </div>

        {/* ── Center: View controls ── */}
        <div className="toolbar-group toolbar-group-controls">
          <label className="toolbar-inline-field">
            <span>{t('toolbar.page')}</span>
            <select value={activePage} onChange={(e) => setActivePage(Number(e.target.value))}>
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>{t('toolbar.page')} {n}</option>
              ))}
            </select>
          </label>

          <div className="zoom-controls compact">
            <button disabled={zoomIndex <= 0} onClick={() => setZoomIndex((i) => i - 1)}>−</button>
            <span>{Math.round(zoom * 100)}%</span>
            <button disabled={zoomIndex >= ZOOM_STEPS.length - 1} onClick={() => setZoomIndex((i) => i + 1)}>+</button>
          </div>

          <div className="fit-mode-controls compact">
            <button className={fitMode === 'page' ? 'active' : ''} onClick={() => setFitMode('page')}>{t('toolbar.page')}</button>
            <button className={fitMode === 'width' ? 'active' : ''} onClick={() => setFitMode('width')}>{t('toolbar.width')}</button>
          </div>

          <div className="rotation-controls compact">
            <button onClick={() => rotateBy(-90)} title={t('toolbar.rotateLeft')}>↺</button>
            <span>{rotation}°</span>
            <button onClick={() => rotateBy(90)} title={t('toolbar.rotateRight')}>↻</button>
          </div>
        </div>

        {/* ── Right: Status + User ── */}
        <div className="toolbar-group toolbar-group-right">
          <span className="toolbar-status-text">{status || t('status.ready')}</span>
          <AutosaveIndicator
            status={autosaveState.status}
            lastSavedAt={autosaveState.lastSavedAt}
            errorMessage={autosaveState.errorMessage}
          />
          {currentUser && (
            <div className="toolbar-user-area">
              <span className="toolbar-user-name">👤 {currentUser.displayName}</span>
              {onShowMfaSettings && <button className="toolbar-user-btn" onClick={onShowMfaSettings} title={t('mfa.title')}>🔐</button>}
              {onShowAdminSettings && <button className="toolbar-user-btn" onClick={onShowAdminSettings}>{t('auth.admin')}</button>}
              {onLogout && <button className="toolbar-user-btn" onClick={onLogout}>{t('auth.logout')}</button>}
            </div>
          )}
        </div>
      </header>

      {/* ═══════════════════════════════════════════════════════════
           LEFT PANEL: Édition / outils de travail
         ═══════════════════════════════════════════════════════════ */}
      <aside className="panel">
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
            <button onClick={addField} disabled={!canEditStructure}>{t('toolbar.addField')}</button>
            <button onClick={addPage} disabled={!canEditStructure}>{t('toolbar.addPage')}</button>
            <button onClick={duplicateActivePage} disabled={!sourceUrl || !canEditStructure}>{t('toolbar.duplicatePage')}</button>
            <button onClick={deleteActivePage} disabled={pageCount <= 1 || !canEditStructure}>{t('toolbar.deletePage')}</button>
          </div>

          <button
            className={`btn-fill-mode ${fillMode ? 'active' : ''}`}
            onClick={() => setFillMode((v) => !v)}
            title={t('panel.fillModeTitle')}
          >
            {fillMode ? t('panel.fillModeOn') : t('panel.fillModeOff')}
          </button>

          <button
            className={`btn-fill-mode ${showDebugOrder ? 'active' : ''}`}
            onClick={() => setShowDebugOrder((v) => !v)}
            title={t('panel.debugOrderOn')}
            style={{ fontSize: '0.85em' }}
          >
            {showDebugOrder ? t('panel.debugOrderOn') : t('panel.debugOrderOff')}
          </button>

          {fields.length > 0 && (
            <button
              className="btn-delete-all"
              disabled={fillMode}
              onClick={() => {
                if (window.confirm(t('panel.deleteAllFieldsConfirm', { count: fields.length }))) {
                  setFields([]);
                  setSelectedFieldId(null);
                  setMultiSelectedIds(new Set());
                  setDirty(true);
                  setStatus(t('status.fieldsDeleted', { count: fields.length }));
                }
              }}
            >
              {t('panel.deleteAllFields')}
            </button>
          )}
        </details>

        {sourceFileId && (
          <details open className="panel-section">
            <summary>{t('panel.detection')}</summary>
            <label>
              {t('panel.sensitivity')}
              <select
                value={detectSensitivity}
                onChange={(e) => setDetectSensitivity(e.target.value as 'low' | 'normal' | 'high')}
              >
                <option value="low">{t('panel.sensitivityLow')}</option>
                <option value="normal">{t('panel.sensitivityNormal')}</option>
                <option value="high">{t('panel.sensitivityHigh')}</option>
              </select>
            </label>
            <p className="detect-preset-desc">{
              detectSensitivity === 'low'
                ? t('panel.sensitivityLowDesc')
                : detectSensitivity === 'high'
                  ? t('panel.sensitivityHighDesc')
                  : t('panel.sensitivityNormalDesc')
            }</p>
            <label className="checkbox-toggle">
              <input
                type="checkbox"
                checked={detectDottedAsLine}
                onChange={(e) => setDetectDottedAsLine(e.target.checked)}
              />
              {t('panel.dottedAsLine')}
            </label>
            <p className="hint" style={{ fontSize: 11, marginTop: 2, marginBottom: 6 }}>{t('panel.dottedAsLineHint')}</p>
            <button
              className="btn-detect"
              disabled={!canEditStructure || isDetecting}
              onClick={async () => {
                if (!canEditStructure) {
                  setStatus(t('status.insufficientRightsStructure'));
                  return;
                }
                if (!sourceFileId || isDetecting) return;
                setIsDetecting(true);
                try {
                  setStatus(t('status.detecting'));
                  // Detection presets: sensitivity affects minimum cell size, line detection thresholds, and gap closing.
                  // - low: best for clean scans with large, clear cells (requires longer lines, bigger cells)
                  // - normal: balanced for most documents
                  // - high: best for degraded scans or small fields (detects shorter lines, smaller cells)
                  const detectPreset = {
                    low: { sensitivity: 'low', maxDetectWidth: 1200 },
                    normal: { sensitivity: 'normal', maxDetectWidth: 1800 },
                    high: { sensitivity: 'high', maxDetectWidth: 2400 },
                  } as const;

                  const result = await detectFields(sourceFileId, {
                    targetWidth: pageW,
                    targetHeight: pageH,
                    rotation,
                    ...detectPreset[detectSensitivity],
                    dottedAsLine: detectDottedAsLine,
                  });
                  if (result.error) {
                    setStatus(t('status.detectionError', { error: result.error }));
                    return;
                  }
                  if (!result.suggestedFields.length) {
                    setStatus(t('status.noFieldDetected'));
                    return;
                  }
                  const newFields: FieldModel[] = result.suggestedFields.map((sf) => ({
                    id: sf.id || crypto.randomUUID(),
                    label: sf.label || t('status.defaultFieldLabel'),
                    value: '',
                    x: sf.x,
                    y: sf.y,
                    w: Math.max(16, sf.w),
                    h: Math.max(10, sf.h),
                    type: (sf.type === 'checkbox' ? 'checkbox' : 'text') as FieldType,
                    style: {
                      fontFamily: preset.fontFamily,
                      fontSize: preset.fontSize,
                      fontWeight: preset.fontWeight,
                      textAlign: 'left' as const,
                      color: preset.color,
                    },
                    locked: false,
                    overlayVisible: true,
                    pageNumber: activePage,
                  }));
                  setFields((prev) => [...prev, ...newFields]);
                  setDirty(true);
                  setStatus(t('status.fieldsDetected', { count: newFields.length }));
                } catch (err) {
                  setStatus(err instanceof Error ? err.message : t('status.errorFallback'));
                } finally {
                  setIsDetecting(false);
                }
              }}
            >
              {isDetecting ? t('panel.detectingFields') : t('panel.detectFields')}
            </button>
          </details>
        )}

        <details className="panel-section">
          <summary>{t('panel.defaultStyleTitle')}</summary>
          <label>
            {t('panel.font')}
            <select value={preset.fontFamily} onChange={(e) => setPreset((p) => ({ ...p, fontFamily: e.target.value }))}>
              {['Arial, sans-serif', 'Helvetica, sans-serif', 'Times New Roman, serif', 'Courier New, monospace', 'Georgia, serif', 'Verdana, sans-serif'].map((f) => (
                <option key={f} value={f}>{f.split(',')[0]}</option>
              ))}
            </select>
          </label>
          <label>
            {t('panel.fontSize')}
            <select value={preset.fontSize} onChange={(e) => setPreset((p) => ({ ...p, fontSize: Number(e.target.value) }))}>
              {[8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32].map((s) => (
                <option key={s} value={s}>{s}px</option>
              ))}
            </select>
          </label>
          <label>
            {t('panel.fontWeight')}
            <select value={preset.fontWeight} onChange={(e) => setPreset((p) => ({ ...p, fontWeight: e.target.value as 'normal' | 'bold' }))}>
              <option value="normal">{t('panel.fontWeightNormal')}</option>
              <option value="bold">{t('panel.fontWeightBold')}</option>
            </select>
          </label>
          <label>
            {t('panel.color')}
            <input type="color" value={preset.color} onChange={(e) => setPreset((p) => ({ ...p, color: e.target.value }))} />
          </label>
          <button onClick={() => {
            setFields((prev) => prev.map((f) => ({ ...f, style: { ...f.style, fontFamily: preset.fontFamily, fontSize: preset.fontSize, fontWeight: preset.fontWeight, color: preset.color } })));
            setStatus(t('status.presetApplied'));
          }}>{t('panel.applyToAllFields')}</button>
        </details>

        <details className="panel-section">
          <summary>{t('panel.diagnosticTitle')}</summary>
          <div className="diagnostic-grid">
            <span>{t('panel.diagSource')}</span><span>{srcW} × {srcH} px</span>
            <span>{t('panel.diagDisplay')}</span><span>{pageW} × {pageH} px</span>
            <span>{t('panel.diagRotation')}</span><span>{rotation}°</span>
            <span>{t('panel.diagDisplayRot')}</span><span>{dispW} × {dispH} px</span>
            <span>{t('panel.diagZoom')}</span><span>{Math.round(zoom * 100)}%</span>
            <span>{t('panel.diagDpr')}</span><span>{dpr.toFixed(1)}</span>
            <span>{t('panel.diagCanvas')}</span><span>{Math.round(pageW * dpr)} × {Math.round(pageH * dpr)} px</span>
          </div>
        </details>
      </aside>

      <section ref={editorRef} className="editor" tabIndex={-1} onClick={() => { if (!marqueeJustEndedRef.current) handleSelectField(null); }}>
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
        <div className="multi-pages-stack" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {Array.from({ length: pageCount }, (_, idx) => idx + 1).map((pageNum) => (
            <div key={pageNum} className="page-zoom-wrapper" style={{ width: dispW * zoom, height: dispH * zoom }}>
              <div
                className="page"
                style={{
                  width: pageW,
                  height: pageH,
                  transform: pageTransform,
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
                <div style={{ position: 'absolute', top: -22, right: 0, fontSize: 12, color: '#666' }}>{t('panel.pageLabel', { n: pageNum })}</div>
                {sourceUrl ? (
                  isPdf ? (
                    <PdfViewer url={sourceUrl} onDimensionsDetected={onPdfDimensions} showPagination={false} />
                  ) : (
                    <img src={sourceUrl} className="scan-image" alt="Document" onLoad={onImageLoad} />
                  )
                ) : (
                  <div className="scan-bg"><p>{t('panel.importScanHint')}</p></div>
                )}

                {fields.filter((f) => (f.pageNumber ?? 1) === pageNum).map((f) => (
                  <FieldOverlay
                    key={f.id}
                    field={f}
                    selected={f.id === selectedFieldId || multiSelectedIds.has(f.id)}
                    zoom={zoom}
                    rotation={rotation}
                    docRole={docRole}
                    fillMode={fillMode}
                    onSelect={(ctrlKey) => {
                      setActivePage(pageNum);
                      handleSelectField(f.id, ctrlKey);
                    }}
                    onMove={(x, y) => updateField(f.id, { x, y })}
                    onResize={(w, h) => updateField(f.id, { w, h })}
                    onValueChange={(value, caret, meta) => updateFieldValueWithOverflow(f.id, value, caret, meta)}
                    onFieldKeyDown={handleFieldKeyDown}
                    onStructureLockedAttempt={() => setStatus(t('status.fieldLocked'))}
                    pageWidth={pageW}
                    pageHeight={pageH}
                    debugOrder={showDebugOrder ? (() => {
                      const gid = (f.style.overflowGroupId || '').trim();
                      if (!gid) return undefined;
                      const grp = sortOverflowGroup(fields.filter((g) => (g.pageNumber ?? 1) === (f.pageNumber ?? 1) && g.type === 'text' && (g.style.overflowGroupId || '').trim() === gid));
                      const idx = grp.findIndex((g) => g.id === f.id);
                      return idx >= 0 ? idx + 1 : undefined;
                    })() : undefined}
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
        </div>
      </section>

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
        onResetFused={(fusedKey: string) => {
          setFusedUiState((prev) => {
            const next = { ...prev };
            delete next[fusedKey];
            return next;
          });
        }}
        /* ── Library props (moved to right panel) ── */
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

      {showShareModal && sourceFileId && (
        <Suspense fallback={null}>
          <ShareModal docId={sourceFileId} onClose={() => setShowShareModal(false)} />
        </Suspense>
      )}

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

