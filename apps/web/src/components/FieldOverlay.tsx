import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import type { FieldModel } from '../types';
import { screenToFieldDelta } from '../utils';
import type { Rotation } from '../utils';
import { useTranslation } from '../i18n';
import RichTextEditor from './RichTextEditor';

type Props = {
  field: FieldModel;
  selected: boolean;
  zoom: number;
  rotation: Rotation;
  docRole?: 'owner' | 'editor' | 'filler' | null;
  fillMode?: boolean;
  onSelect: (ctrlKey: boolean) => void;
  onMove: (x: number, y: number) => void;
  onResize: (w: number, h: number) => void;
  onValueChange: (value: string, caretPosition?: number, meta?: { overflowed?: boolean }) => void;
  valueOverride?: string;
  onStructureLockedAttempt?: () => void;
  pageWidth: number;
  pageHeight: number;
  onFieldKeyDown?: (fieldId: string, e: React.KeyboardEvent) => void;
  debugOrder?: number;
  fusedMeta?: { hidden: boolean; anchor: boolean; bounds?: { x: number; y: number; w: number; h: number } };
  onReAnchorFused?: () => void;
};

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

// Render tally counters in groups of five so larger counts stay readable in narrow fields.
function tallyMarks(count: number): string {
  if (count <= 0) return '0';
  const groups = Math.floor(count / 5);
  const rest = count % 5;
  const parts: string[] = [];
  for (let i = 0; i < groups; i++) parts.push('𝍸');
  for (let i = 0; i < rest; i++) parts.push('|');
  return parts.join(' ');
}

export default function FieldOverlay({
  field,
  selected,
  zoom,
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
  // A filler cannot move/resize locked fields; fill mode also prevents structural edits.
  const structureLocked = (field.locked && docRole === 'filler') || Boolean(fillMode);
  const [dragging, setDragging] = useState(false);
  const [hovered, setHovered] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dateInputRef = useRef<HTMLInputElement>(null);
  const dateCursorRef = useRef<number>(-1);
  const textCursorRef = useRef<number>(-1);

  const handleMouseDown = (e: React.MouseEvent) => {
    // Alt+drag is reserved for marquee selection from anywhere, including on top of a field.
    // Do not intercept the event so it can bubble to the page canvas handler.
    if (e.altKey) return;
    if ((e.target as HTMLElement).classList.contains('resize-handle')) return;
    // Preserve native text editing when the click is inside an already-selected input.
    const tag = (e.target as HTMLElement).tagName;
    if ((tag === 'INPUT' || tag === 'TEXTAREA') && selected) return;
    if ((e.target as HTMLElement).closest('.checkbox-display')) return;
    if ((e.target as HTMLElement).closest('.counter-display, .checkbox-display')) return;

    e.preventDefault();
    e.stopPropagation();
    onSelect(e.ctrlKey || e.metaKey);
    if (structureLocked) {
      if (!fillMode) onStructureLockedAttempt?.();
      return; // No drag/resize in fill mode; filler also cannot drag locked fields.
    }
    setDragging(true);

    const startX = e.clientX;
    const startY = e.clientY;
    const initialX = field.x;
    const initialY = field.y;

    const onMouseMove = (ev: MouseEvent) => {
      const rawDx = ev.clientX - startX;
      const rawDy = ev.clientY - startY;
      const [dx, dy] = screenToFieldDelta(rawDx, rawDy, zoom, rotation);
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
      const [dw, dh] = screenToFieldDelta(rawDx, rawDy, zoom, rotation);
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

  const isCheckbox = field.type === 'checkbox';
  const isCounterTally = field.type === 'counter-tally';
  const isCounterNumeric = field.type === 'counter-numeric';
  const isCounter = isCounterTally || isCounterNumeric;
  const isChecked = field.value === 'true';
  const counterVal = Number(field.value || 0);
  const checkboxFontSize = field.style.checkSize ?? Math.max(12, Math.min(field.w, field.h) * 0.75);
  const isDate = field.type === 'date';
  const dateFormat = field.style.dateFormat || 'DD/MM/YYYY';

  useEffect(() => {
    if (!isDate || !field.style.dateDefaultToday || field.value) return;
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = String(now.getFullYear());
    const v = dateFormat === 'YYYY-MM-DD' ? `${yyyy}-${mm}-${dd}` : dateFormat === 'MM/DD/YYYY' ? `${mm}/${dd}/${yyyy}` : `${dd}/${mm}/${yyyy}`;
    onValueChange(v);
  }, [isDate, field.style.dateDefaultToday, field.value, dateFormat, onValueChange]);

  const formatDateValue = (raw: string): string => {
    const digits = raw.replace(/\D/g, '').slice(0, 8);
    if (dateFormat === 'YYYY-MM-DD') {
      const y = digits.slice(0, 4);
      const m = digits.slice(4, 6);
      const d = digits.slice(6, 8);
      return [y, m, d].filter(Boolean).join('-');
    }

    let result = '';
    for (let i = 0; i < digits.length; i++) {
      if (i === 2 || i === 4) result += '/';
      result += digits[i];
    }
    return result;
  };

  const handleDateChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const selStart = input.selectionStart ?? 0;
    const raw = input.value;
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

    // Keep caret position stable after controlled updates (date + overflow text).
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

  // Effective dimensions: use fused bounds when this field is the anchor, otherwise original field dims.
  const effectiveW = (fusedMeta?.anchor && fusedMeta.bounds) ? fusedMeta.bounds.w : field.w;
  const effectiveH = (fusedMeta?.anchor && fusedMeta.bounds) ? fusedMeta.bounds.h : field.h;
  const isHiddenGhost = Boolean(fusedMeta?.hidden);

  // Counter-rotate inner content so text stays readable; 90/270 need recentering to avoid drift.
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
          style={{ fontSize: checkboxFontSize, color: field.style.color, lineHeight: 1 }}
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
          placeholder={field.style.datePlaceholder || (dateFormat === 'MM/DD/YYYY' ? 'MM/JJ/AAAA' : dateFormat === 'YYYY-MM-DD' ? 'AAAA-MM-JJ' : 'JJ/MM/AAAA')}
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

    // In fill mode or when selected, use rich text editor for inline formatting support
    if (selected || fillMode) {
      return (
        <RichTextEditor
          value={valueOverride ?? field.value}
          onChange={(html) => onValueChange(html)}
          style={textEditStyle}
          placeholder={field.label}
          onKeyDown={(e) => onFieldKeyDown?.(field.id, e)}
        />
      );
    }

    // When not selected, render HTML content directly
    return (
      <div
        className="field-input field-textarea"
        style={{ ...textEditStyle, pointerEvents: 'none', overflow: 'hidden', wordWrap: 'break-word', whiteSpace: 'pre-wrap' }}
        dangerouslySetInnerHTML={{ __html: valueOverride ?? field.value }}
      />
    );
  };

  return (
    <div
      className={[
        'field',
        selected && 'field-selected',
        dragging && 'field-dragging',
        structureLocked && 'field-locked',
        !field.overlayVisible && !selected && 'field-overlay-hidden',
        fillMode && !selected && !hovered && 'field-fill-hidden',
        fillMode && hovered && !selected && 'field-fill-hover',
      ].filter(Boolean).join(' ')}
      style={{
        left: fusedMeta?.anchor && fusedMeta.bounds ? fusedMeta.bounds.x : field.x,
        top: fusedMeta?.anchor && fusedMeta.bounds ? fusedMeta.bounds.y : field.y,
        width: fusedMeta?.anchor && fusedMeta.bounds ? fusedMeta.bounds.w : field.w,
        height: fusedMeta?.anchor && fusedMeta.bounds ? fusedMeta.bounds.h : field.h,
        cursor: structureLocked ? 'default' : undefined,
        ...(isHiddenGhost ? {
          display: 'none',
        } : {}),
      }}
      data-field-id={field.id}
      onMouseDown={handleMouseDown}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={(e) => e.stopPropagation()}
    >
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
      {!fillMode && <div className="field-label-tag">{field.locked ? '🔒 ' : ''}{field.label}</div>}
      {debugOrder != null && <div className="field-debug-order" style={{
        position: 'absolute', top: -2, right: -2, background: '#ff6600', color: '#fff',
        borderRadius: '50%', width: 18, height: 18, fontSize: 10, fontWeight: 'bold',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 10,
        pointerEvents: 'none', lineHeight: 1,
      }}>{debugOrder}</div>}
      {fusedMeta && !fusedMeta.anchor && !fusedMeta.hidden && onReAnchorFused && (
        <button
          style={{
            position: 'absolute', top: -24, right: 0, fontSize: 10, padding: '1px 5px',
            background: '#1a73e8', color: '#fff', border: 'none', borderRadius: 3,
            cursor: 'pointer', whiteSpace: 'nowrap', zIndex: 20, lineHeight: '16px',
          }}
          onClick={(e) => { e.stopPropagation(); onReAnchorFused(); }}
          title={t('fieldOverlay.reAnchorTitle')}
        >{t('fieldOverlay.reAnchor')}</button>
      )}
      {fusedMeta?.anchor && onReAnchorFused && (
        <button
          style={{
            position: 'absolute', top: -24, left: 0, fontSize: 10, padding: '1px 5px',
            background: '#34a853', color: '#fff', border: 'none', borderRadius: 3,
            cursor: 'pointer', whiteSpace: 'nowrap', zIndex: 20, lineHeight: '16px',
          }}
          onClick={(e) => { e.stopPropagation(); }}
          title={t('fieldOverlay.anchorActiveTitle')}
        >{t('fieldOverlay.anchorLabel')}</button>
      )}
      {!structureLocked && <div className="resize-handle" onMouseDown={handleResizeDown} />}
    </div>
  );
}
