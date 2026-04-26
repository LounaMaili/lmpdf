/**
 * FieldOverlay
 *
 * Renders a single form field as an absolutely-positioned overlay on top of the
 * PDF page canvas. Handles all field types (text, checkbox, counter, date) and
 * manages selection, dragging, resizing, and value changes.
 *
 * Key concepts:
 * - Fields are positioned in page coordinates (pageW × pageH). Le document PDF
 *   est rendu à une largeur disponible (fit-to-width). dispRatio (renderW / pageW)
 *   est le facteur de conversion screen ↔ page via `screenToFieldDelta`.
 * - Rich text (bold, italic, underline, colors) is only available in fillMode or
 *   when the field is selected. When neither is true the field renders as a plain
 *   div with dangerouslySetInnerHTML for performance.
 * - Structural edits (move, resize) are blocked in fillMode or when the current
 *   user role is "filler" and the field is locked.
 * - Fused fields (continuous overflow extension across multiple physical fields)
 *   use `fusedMeta` to report their logical bounds; the anchor field carries
 *   the full combined bounds and hidden ghost fields are display:none.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { FieldModel } from '../types';
import { screenToFieldDelta } from '../utils';
import type { Rotation } from '../utils';
import { useTranslation } from '../i18n';
import RichTextEditor from './RichTextEditor';
import SelectionToolbar from './SelectionToolbar';

// ── Types ────────────────────────────────────────────────────────────────────

type Props = {
  field: FieldModel;
  selected: boolean;
  /** Ratio de la largeur rendue sur la largeur naturelle de la page (dispRatio = renderW / pageW). */
  dispRatio: number;
  rotation: Rotation;
  /** Role of the current user in this document. */
  docRole?: 'owner' | 'editor' | 'filler' | null;
  /** True when the user is in fill mode (editing field values). */
  fillMode?: boolean;
  onSelect: (ctrlKey: boolean) => void;
  onMove: (x: number, y: number) => void;
  onResize: (w: number, h: number) => void;
  onValueChange: (value: string, caretPosition?: number, meta?: { overflowed?: boolean }) => void;
  /** Override the displayed value (used e.g. during autosave to show pending content). */
  valueOverride?: string;
  onStructureLockedAttempt?: () => void;
  pageWidth: number;
  pageHeight: number;
  onFieldKeyDown?: (fieldId: string, e: React.KeyboardEvent) => void;
  /** Debug: show field index order tag. */
  debugOrder?: number;
  /**
   * Set when this field participates in a fused/continuous overflow group.
   * - `hidden`: this is a ghost field carrying overflow text from a previous field.
   * - `anchor`: this is the primary field whose bounds cover the full fused area.
   * - `bounds`: the logical bounding box for the fused field (may exceed the
   *   physical field's x,y,w,h from the PDF).
   */
  fusedMeta?: {
    hidden: boolean;
    anchor: boolean;
    bounds?: { x: number; y: number; w: number; h: number };
  };
  onReAnchorFused?: () => void;
};

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Clamps a value between min and max. */
function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

/**
 * Renders a count as tally marks — five 𝍸 symbols per group, then | for remainder.
 * Keeps large counts legible in narrow field viewboxes.
 * e.g. 7 → "𝍸𝍸|"
 */
function tallyMarks(count: number): string {
  if (count <= 0) return '0';
  const groups = Math.floor(count / 5);
  const rest = count % 5;
  const parts: string[] = [];
  for (let i = 0; i < groups; i++) parts.push('𝍸');
  for (let i = 0; i < rest; i++) parts.push('|');
  return parts.join(' ');
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function FieldOverlay({
  field,
  selected,
  dispRatio,
  rotation,
  docRole,
  fillMode,
  onSelect,
  onMove,
  onResize,
  onValueChange,
  valueOverride,
  onStructureLockedAttempt,
  pageWidth,
  pageHeight,
  onFieldKeyDown,
  debugOrder,
  fusedMeta,
  onReAnchorFused,
}: Props) {
  const { t } = useTranslation();

  // Structural edits (move/resize) are blocked when the field is locked and the
  // user is a filler, or when in fill mode (fill mode is for data entry only).
  const structureLocked = (field.locked && docRole === 'filler') || Boolean(fillMode);

  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);

  // Plain textarea ref (used for non-rich text fields in edit mode).
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Date input ref — used to restore cursor position after controlled value updates.
  const dateInputRef = useRef<HTMLInputElement>(null);
  const dateCursorRef = useRef<number>(-1);
  // Text caret position to restore after an overflow update.
  const textCursorRef = useRef<number>(-1);
  // Ref passed to RichTextEditor so we can focus it before formatting commands.
  const textEditorRef = useRef<HTMLDivElement>(null);
  // The actual DOM element of the RichTextEditor, used as containerRef for SelectionToolbar.
  const [richTextEl, setRichTextEl] = useState<HTMLDivElement | null>(null);

  // ── Drag-to-move ────────────────────────────────────────────────────────────

  /**
   * mousedown handler on the field wrapper.
   *
   * Guards:
   * - Alt+drag → reserved for marquee selection on the canvas, don't intercept.
   * - Click on a resize handle → handled separately, don't start drag.
   * - Click inside an already-focused INPUT/TEXTAREA → preserve native editing.
   * - Click inside contentEditable while the field is already selected →
   *   preserve native text editing (don't deselect).
   * - Click on checkbox/counter → those have their own onClick, stop propagation.
   * - fillMode → no structural edits at all.
   *
   * When allowed, captures mouse movement globally (adds listeners to window)
   * and clamps the new position within the page boundaries.
   */
  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.altKey) return;
    if ((e.target as HTMLElement).classList.contains('resize-handle')) return;

    // Empêcher le marquee de se déclencher quand on clique sur un champ
    e.stopPropagation();

    const tag = (e.target as HTMLElement).tagName;
    // Preserve native text editing when the field is already selected.
    if ((tag === 'INPUT' || tag === 'TEXTAREA') && selected) return;
    if ((e.target as HTMLElement).closest('.checkbox-display, .counter-display')) return;
    // Preserve contentEditable editing in an already-selected rich text field.
    if ((e.target as HTMLElement).closest('[contentEditable]') && selected) return;

    if (fillMode) return;

    setDragging(true);
    const startX = e.clientX;
    const startY = e.clientY;
    const initialX = field.x;
    const initialY = field.y;

    const onMouseMove = (ev: MouseEvent) => {
      const rawDx = ev.clientX - startX;
      const rawDy = ev.clientY - startY;
      // Convert screen pixels → page coordinates, accounting for zoom and rotation.
      // Convertir les pixels écran → coordonnées page en divisant par dispRatio
      const [dx, dy] = screenToFieldDelta(rawDx, rawDy, dispRatio, rotation);
      onMove(
        clamp(initialX + dx, 0, pageWidth - field.w),
        clamp(initialY + dy, 0, pageHeight - field.h),
      );
    };

    const onMouseUp = () => {
      setDragging(false);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // ── Resize handle ──────────────────────────────────────────────────────────

  /**
   * mousedown handler on the resize handle (bottom-right corner grip).
   * Stops propagation so the drag handler doesn't also fire.
   * Structural edits are gated by structureLocked.
   */
  const handleResizeDown = (e: React.MouseEvent) => {
    if (structureLocked) {
      onStructureLockedAttempt?.();
      return;
    }
    e.stopPropagation();
    e.preventDefault();

    const startX = e.clientX;
    const startY = e.clientY;
    const initialW = field.w;
    const initialH = field.h;

    const onMouseMove = (ev: MouseEvent) => {
      const rawDx = ev.clientX - startX;
      const rawDy = ev.clientY - startY;
      // Convertir les pixels écran → coordonnées page en divisant par dispRatio
      const [dw, dh] = screenToFieldDelta(rawDx, rawDy, dispRatio, rotation);
      onResize(
        clamp(initialW + dw, 20, pageWidth - field.x),
        clamp(initialH + dh, 12, pageHeight - field.y),
      );
    };

    const onMouseUp = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
  };

  // ── Field-type shortcuts ────────────────────────────────────────────────────

  const isCheckbox = field.type === 'checkbox';
  const isCounterTally = field.type === 'counter-tally';
  const isCounterNumeric = field.type === 'counter-numeric';
  const isCounter = isCounterTally || isCounterNumeric;
  const isChecked = field.value === 'true';
  const counterVal = Number(field.value || 0);
  const isDate = field.type === 'date';
  const dateFormat = field.style.dateFormat || 'DD/MM/YYYY';

  // ── Auto-set date to today ─────────────────────────────────────────────────

  /**
   * Effect: if this is a date field with `dateDefaultToday` set and no value yet,
   * initialize it to today's date in the field's configured format.
   * Runs once on mount when conditions are first met.
   */
  useEffect(() => {
    if (!isDate || !field.style.dateDefaultToday || field.value) return;
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = String(now.getFullYear());
    const v =
      dateFormat === 'YYYY-MM-DD' ? `${yyyy}-${mm}-${dd}`
      : dateFormat === 'MM/DD/YYYY' ? `${mm}/${dd}/${yyyy}`
      : `${dd}/${mm}/${yyyy}`;
    onValueChange(v);
  }, [isDate, field.style.dateDefaultToday, field.value, dateFormat, onValueChange]);

  // ── Date formatting ────────────────────────────────────────────────────────

  /**
   * Formats a raw digit string into a localised date by inserting separators
   * at positions 2 and 4 (DD/MM/YYYY convention).
   */
  const formatDateValue = (raw: string): string => {
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    if (dateFormat === 'YYYY-MM-DD') {
      return [digits.slice(0, 4), digits.slice(4, 6), digits.slice(6, 8)]
        .filter(Boolean).join('-');
    }
    let result = '';
    for (let i = 0; i < digits.length; i++) {
      if (i === 2 || i === 4) result += '/';
      result += digits[i];
    }
    return result;
  };

  /**
   * Handles date input changes:
   * 1. Extracts numeric digits from the current input value.
   * 2. Formats them back with separators (DD/MM/YYYY).
   * 3. Maps the new cursor position to account for inserted slashes so the
   *    cursor stays on the same digit after reformatting.
   * 4. Stores the new cursor in dateCursorRef; a useLayoutEffect below
   *    restores it after the controlled value update re-renders the input.
   */
  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const selStart = input.selectionStart ?? 0;
    const raw = input.value;
    // Count digits before the cursor so we can map to the formatted string.
    let digitsBefore = 0;
    for (let i = 0; i < selStart; i++) {
      if (/\d/.test(raw[i])) digitsBefore++;
    }
    const formatted = formatDateValue(raw);
    let newPos = 0;
    let counted = 0;
    for (let i = 0; i < formatted.length; i++) {
      if (counted >= digitsBefore) break;
      if (/\d/.test(formatted[i])) counted++;
      newPos = i + 1;
    }
    while (newPos < formatted.length && formatted[newPos] === '/') newPos++;
    dateCursorRef.current = newPos;
    onValueChange(formatted);
  };

  // ── Cursor position restoration ───────────────────────────────────────────

  /**
   * useLayoutEffect (runs synchronously after DOM mutation, before paint) to
   * restore cursor positions after controlled updates that change the value.
   *
   * - dateInputRef: restored after handleDateChange reformats the date string.
   * - inputRef (plain textarea): restored after overflow field changes push text
   *   into or out of this field, shifting the caret.
   *
   * We use refs rather than state to pass the caret position because the
   * cursor restore must happen in the same render cycle as the value change,
   * before React finishes committing — setState would be too late.
   */
  useLayoutEffect(() => {
    if (dateCursorRef.current >= 0 && dateInputRef.current) {
      const pos = Math.min(dateCursorRef.current, dateInputRef.current.value.length);
      dateCursorRef.current = -1;
      dateInputRef.current.setSelectionRange(pos, pos);
    }

    if (textCursorRef.current >= 0 && inputRef.current) {
      const pos = Math.min(textCursorRef.current, inputRef.current.value.length);
      textCursorRef.current = -1;
      if (document.activeElement !== inputRef.current) {
        inputRef.current.focus();
      }
      inputRef.current.setSelectionRange(pos, pos);
    }
  });

  // ── Fused / overflow geometry ───────────────────────────────────────────────

  /**
   * When this field is the anchor of a fused group, the anchor's bounds
   * (fusedMeta.bounds) define the full logical extent — larger than the
   * single physical field. Use those for positioning; fall back to the
   * original field dimensions otherwise.
   */
  const effectiveW = (fusedMeta?.anchor && fusedMeta.bounds) ? fusedMeta.bounds.w : field.w;
  const effectiveH = (fusedMeta?.anchor && fusedMeta.bounds) ? fusedMeta.bounds.h : field.h;
  const isHiddenGhost = Boolean(fusedMeta?.hidden);

  // ── Rotation style ─────────────────────────────────────────────────────────

  /**
   * Counter-rotates the inner content so text remains readable when the
   * underlying PDF field is rotated (90° or 270°). 90/270 also need a
   * centering offset because the rotation pivot is the center of the
   * physical field box, not the logical bounds.
   */
  const contentStyle = useMemo<CSSProperties | undefined>(() => {
    if (rotation === 0) return undefined;

    if (rotation === 90 || rotation === 270) {
      return {
        position: 'absolute',
        width: effectiveH,
        height: effectiveW,
        left: (effectiveW - effectiveH) / 2,
        top: (effectiveH - effectiveW) / 2,
        transform: `rotate(${-rotation}deg)`,
        transformOrigin: 'center center',
      };
    }

    return {
      transform: `rotate(${-rotation}deg)`,
      transformOrigin: 'center center',
    };
  }, [rotation, effectiveW, effectiveH]);

  // ── Content renderer ────────────────────────────────────────────────────────

  /**
   * Renders the appropriate input for each field type.
   *
   * In fillMode or when selected → RichTextEditor (contentEditable) for inline
   * formatting support. The SelectionToolbar is only mounted here so it only
   * exists for the active field.
   *
   * When not selected (read-only display) → plain div with dangerouslySetInnerHTML
   * for performance; no contentEditable overhead.
   */
  const renderContent = () => {
    if (isCheckbox) {
      return (
        <div
          className={`checkbox-display ${isChecked ? 'checked' : ''}`}
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onValueChange(isChecked ? 'false' : 'true');
          }}
          style={{ fontSize: field.style.checkSize ?? Math.max(12, Math.min(field.w, field.h) * 0.75), color: field.style.color, lineHeight: 1 }}
        >
          {isChecked ? '✓' : ''}
        </div>
      );
    }

    if (isCounter) {
      return (
        <div
          className="counter-display"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation();
            onValueChange(String(counterVal + 1));
          }}
          // Right-click → decrement
          onContextMenu={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onValueChange(String(Math.max(0, counterVal - 1)));
          }}
          title={t('fieldOverlay.counterTooltip')}
          style={{
            direction: 'ltr',
            unicodeBidi: 'plaintext',
            fontFamily: field.style.fontFamily,
            fontSize: field.style.fontSize,
            fontWeight: field.style.fontWeight,
            fontStyle: field.style.fontStyle,
            textDecoration: field.style.textDecoration,
            textAlign: field.style.textAlign,
            color: field.style.color,
            backgroundColor: field.style.highlightColor ? 'transparent' : undefined,
          }}
        >
          {isCounterTally ? tallyMarks(counterVal) : String(counterVal)}
        </div>
      );
    }

    if (isDate) {
      return (
        <input
          ref={dateInputRef}
          type="text"
          inputMode="numeric"
          className="field-input field-date-input"
          tabIndex={-1}
          value={valueOverride ?? field.value}
          onChange={handleDateChange}
          placeholder={
            field.style.datePlaceholder
              || (dateFormat === 'MM/DD/YYYY' ? 'MM/JJ/AAAA'
              : dateFormat === 'YYYY-MM-DD' ? 'AAAA-MM-JJ'
              : 'JJ/MM/AAAA')
          }
          maxLength={10}
          style={{
            fontFamily: field.style.fontFamily,
            fontSize: field.style.fontSize,
            fontWeight: field.style.fontWeight,
            fontStyle: field.style.fontStyle,
            textDecoration: field.style.textDecoration,
            textAlign: field.style.textAlign,
            color: field.style.color,
          }}
        />
      );
    }

    const textEditStyle = {
      fontFamily: field.style.fontFamily,
      fontSize: field.style.fontSize,
      fontWeight: field.style.fontWeight,
      fontStyle: field.style.fontStyle,
      textDecoration: field.style.textDecoration,
      textAlign: field.style.textAlign,
      color: field.style.color,
    };

    // ── Rich text mode (fillMode or selected) ──────────────────────────────

    if (selected || fillMode) {
      return (
        <div onClick={() => onSelect(false)} style={{ width: '100%', height: '100%', userSelect: 'text' }}>
          <RichTextEditor
            // Key forces a remount when fillMode toggles so the editor re-initialises cleanly.
            key={`${field.id}-${fillMode}`}
            value={valueOverride ?? field.value}
            onChange={(html) => onValueChange(html)}
            style={textEditStyle}
            placeholder={field.label}
            onKeyDown={(e) => onFieldKeyDown?.(field.id, e)}
            editorRef={textEditorRef}
            onContainerRef={(el) => { textEditorRef.current = el; setRichTextEl(el); }}
          />
          {/* SelectionToolbar is only mounted when the field is selected —
              preventing multiple toolbars from appearing across the document. */}
          {selected && (
            <SelectionToolbar
              containerRef={richTextEl}
              onFormat={(cmd, val) => {
                const editor = textEditorRef.current;
                if (!editor) return;
                // Save the current selection range, refocus the editor (which
                // can collapse the selection), restore the range, then apply
                // the formatting command so it applies to the right text.
                const sel = window.getSelection();
                let savedRange: Range | null = null;
                if (sel && sel.rangeCount > 0) savedRange = sel.getRangeAt(0).cloneRange();
                editor.focus();
                if (savedRange) {
                  sel?.removeAllRanges();
                  sel?.addRange(savedRange);
                }
                document.execCommand(cmd, false, val);
                onValueChange(editor.innerHTML);
              }}
            />
          )}
        </div>
      );
    }

    // ── Read-only display ──────────────────────────────────────────────────

    return (
      <div
        className="field-input field-textarea"
        style={{ ...textEditStyle, overflow: 'hidden', wordWrap: 'break-word', whiteSpace: 'pre-wrap' }}
        onClick={() => onSelect(false)}
        dangerouslySetInnerHTML={{ __html: valueOverride ?? field.value }}
      />
    );
  };

  // ── Computed styles ─────────────────────────────────────────────────────────

  // Font size for the checkbox glyph — scales with the smaller of width/height.
  const checkboxFontSize = field.style.checkSize ?? Math.max(12, Math.min(field.w, field.h) * 0.75);

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className={[
        'field',
        selected && 'field-selected',
        dragging && 'field-dragging',
        structureLocked && 'field-locked',
        !field.overlayVisible && !selected && 'field-overlay-hidden',
        // In fillMode, dim non-selected, non-hovered fields so active fields stand out.
        fillMode && !selected && !hovered && 'field-fill-hidden',
        fillMode && hovered && !selected && 'field-fill-hover',
      ].filter(Boolean).join(' ')}
      style={{
        // Coordonnées natives + CSS zoom pour l'échelle visuelle.
        // zoom affecte layout ET hit-testing uniformément.
        left: fusedMeta?.anchor && fusedMeta.bounds ? fusedMeta.bounds.x : field.x,
        top: fusedMeta?.anchor && fusedMeta.bounds ? fusedMeta.bounds.y : field.y,
        width: effectiveW,
        height: effectiveH,
        zoom: dispRatio,
        cursor: structureLocked ? 'default' : undefined,
        // Ghost fields (overflow overflow overflow recipients) are hidden.
        ...(isHiddenGhost ? { display: 'none' } : {}),
      }}
      data-field-id={field.id}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      // Stop click from bubbling to the canvas (which would deselect the field).
      onClick={(e) => e.stopPropagation()}
    >
      {/* Inner content area — carries the background highlight/mask style. */}
      <div
        className="field-content"
        style={{
          ...(contentStyle ?? {}),
          background: field.style.maskBackground
            ? (field.style.backgroundColor || '#ffffff')
            : (field.style.highlightColor ? field.style.highlightColor : undefined),
        }}
      >
        {renderContent()}
      </div>

      {/* Field label tag — hidden in fillMode. */}
      {!fillMode && (
        <div className="field-label-tag">
          {field.locked ? '🔒 ' : ''}{field.label}
        </div>
      )}

      {/* Debug field index marker. */}
      {debugOrder != null && (
        <div style={{
          position: 'absolute', top: -2, right: -2, background: '#ff6600', color: '#fff',
          borderRadius: '50%', width: 18, height: 18, fontSize: 10, fontWeight: 'bold',
          display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10,
          pointerEvents: 'none', lineHeight: 1,
        }}>
          {debugOrder}
        </div>
      )}

      {/* Re-anchor button — shown on non-anchor fields in a fused group. */}
      {fusedMeta && !fusedMeta.anchor && !fusedMeta.hidden && onReAnchorFused && (
        <button
          style={{
            position: 'absolute', top: -24, right: 0, fontSize: 10, padding: '1px 5px',
            background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 3,
            cursor: 'pointer', whiteSpace: 'nowrap', zIndex: 20, lineHeight: '16px',
          }}
          onClick={(e) => { e.stopPropagation(); onReAnchorFused(); }}
          title={t('fieldOverlay.reAnchorTitle')}
        >
          {t('fieldOverlay.reAnchor')}
        </button>
      )}

      {/* Anchor indicator — shown on the anchor field of a fused group. */}
      {fusedMeta?.anchor && onReAnchorFused && (
        <button
          style={{
            position: 'absolute', top: -24, left: 0, fontSize: 10, padding: '1px 5px',
            background: '#34a853', color: '#fff', border: 'none', borderRadius: 3,
            cursor: 'pointer', whiteSpace: 'nowrap', zIndex: 20, lineHeight: '16px',
          }}
          onClick={(e) => { e.stopPropagation(); }}
          title={t('fieldOverlay.anchorActiveTitle')}
        >
          {t('fieldOverlay.anchorLabel')}
        </button>
      )}

      {/* Resize handle — bottom-right corner grip; hidden when structureLocked. */}
      {!structureLocked && (
        <div className="resize-handle" onMouseDown={handleResizeDown} />
      )}
    </div>
  );
}
