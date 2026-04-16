/**
 * SelectionToolbar
 *
 * Floating formatting toolbar that appears near a text selection inside a RichTextEditor.
 * Rendered via a React Portal into document.body to avoid being clipped by ancestor
 * elements with overflow:hidden or transform:scale (e.g. the PDF canvas wrapper).
 *
 * Only one toolbar instance exists at a time — FieldOverlay mounts it only when the
 * field is the active/selected field (selected === true).
 *
 * Visibility is driven by:
 *  - A `showToolbar` callback that checks the selection is non-empty and inside the
 *    editor container, and that the bounding rect is valid.
 *  - Two document-level event listeners (mouseup + selectionchange) that call
 *    showToolbar on every selection change.
 *  - CSS opacity + pointer-events for smooth show/hide without remounting.
 */

import { useEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

// ── Types ────────────────────────────────────────────────────────────────────

type Props = {
  /** Reference to the RichTextEditor div. Toolbar only shows when selection is inside this element. */
  containerRef: HTMLElement | null;
  /** Called when a formatting button is clicked, forwards a document.execCommand command. */
  onFormat: (command: string, value?: string) => void;
};

// ── Constants ─────────────────────────────────────────────────────────────────

/** Background colors available in the highlight/surcharge color picker. */
const HIGHLIGHT_COLORS = ['#ffff00', '#ff9900', '#ff0000', '#00ff00', '#00ffff', '#9999ff', '#ff99cc', 'transparent'];
/** Text foreground colors available in the text color picker. */
const TEXT_COLORS = ['#000000', '#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#e67e22', '#9b59b6', '#ffffff'];

// ── Component ─────────────────────────────────────────────────────────────────

export default function SelectionToolbar({ containerRef, onFormat }: Props) {
  const toolbarRef = useRef<HTMLDivElement>(null);

  /** Plain text of the current selection — used to show/hide the toolbar. */
  const [selText, setSelText] = useState('');
  /** Position of the toolbar (top/left in page coordinates). */
  const [position, setPosition] = useState({ top: 0, left: 0 });
  /** Whether the highlight color picker dropdown is open. */
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  /** Whether the text color picker dropdown is open. */
  const [showColorPicker, setShowColorPicker] = useState(false);

  // ── Position calculation ────────────────────────────────────────────────────

  /**
   * Determines whether the toolbar should be visible and, if so, where.
   *
   * Guards:
   * 1. Selection must exist, be non-collapsed, and have at least one range.
   * 2. containerRef must be non-null AND must contain the selection anchor node.
   *    If containerRef is null we skip rather than falsely passing the check.
   * 3. The actual selected text string must be non-empty (guards against
   *    whitespace-only or programmatically collapsed selections).
   * 4. The bounding rect must have non-zero dimensions.
   * 5. Position (0,0) is treated as invalid — this fires when the range
   *    hasn't been laid out yet or the selection is outside the viewport.
   * 6. The toolbar sits 46 px above the selection — if that would place it
   *    above the top of the viewport, it is hidden.
   */
  const showToolbar = useCallback(() => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.rangeCount) return;

    // Guard: no editor reference → never show
    if (!containerRef) return;
    // Guard: selection must be inside the editor, not in sidebar/toolbar/elsewhere
    if (!containerRef.contains(sel.anchorNode)) return;

    const selTextNow = sel.toString();
    if (!selTextNow || selTextNow.length === 0) return;

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    // Guard: zero-area rect means the range hasn't been painted yet
    if (rect.width === 0 && rect.height === 0) return;
    // Guard: (0,0) is a known invalid position from unfinished layout
    if (rect.top === 0 && rect.left === 0) return;

    // 46 px offset puts the toolbar above the selection
    const top = rect.top - 46;
    if (top <= 0 || rect.width === 0) return;

    setPosition({ top, left: rect.left + rect.width / 2 });
  }, [containerRef]);

  // ── Sync selected text into state ───────────────────────────────────────────

  /**
   * Keeps selText in sync with the current document selection.
   * Fires immediately on mount and on every selectionchange event so the
   * toolbar's opacity reflects whether there is an active selection.
   */
  useEffect(() => {
    const sync = () => {
      const sel = window.getSelection();
      setSelText(sel && sel.rangeCount > 0 ? sel.toString() : '');
    };
    sync();
    document.addEventListener('selectionchange', sync);
    return () => document.removeEventListener('selectionchange', sync);
  }, []);

  // ── Event listeners ─────────────────────────────────────────────────────────

  /**
   * Attaches document-level listeners to reposition or show/hide the toolbar
   * when the user makes or adjusts a text selection.
   *
   * - mouseup: fires after a mouse drag finishes; we defer showToolbar by 50 ms
   *   to allow the selection range to settle and getBoundingClientRect to update.
   * - selectionchange: fires whenever the selection changes (including keyboard
   *   movement); shows the toolbar immediately if the selection is inside the editor.
   */
  useEffect(() => {
    const onUp = () => { setTimeout(showToolbar, 50); };
    const onSel = () => { showToolbar(); };
    document.addEventListener('mouseup', onUp);
    document.addEventListener('selectionchange', onSel);
    return () => {
      document.removeEventListener('mouseup', onUp);
      document.removeEventListener('selectionchange', onSel);
    };
  }, [showToolbar]);

  // ── Button factory ───────────────────────────────────────────────────────────

  /**
   * Creates a formatting button.
   *
   * onMouseDown uses e.preventDefault() to stop the default browser behavior,
   * which would otherwise blur the contentEditable and collapse the selection
   * before execCommand runs — leaving the formatting with no target.
   *
   * @param label  Button text label
   * @param title  Tooltip text
   * @param cmd    document.execCommand command string
   * @param val    Optional value passed to execCommand
   */
  const btn = (label: string, title: string, cmd: string, val?: string) => (
    <button
      key={cmd + (val ?? '')}
      title={title}
      className="selection-toolbar-btn"
      onMouseDown={(e) => { e.preventDefault(); onFormat(cmd, val); }}
    >{label}</button>
  );

  // ── Render ──────────────────────────────────────────────────────────────────

  /**
   * Rendered via createPortal into document.body so it is not affected by
   * ancestor transforms or overflow clipping (e.g. the PDF canvas scale wrapper).
   *
   * Position is set with position:fixed in page coordinates.
   * When selText is empty the toolbar is moved offscreen and hidden via opacity
   * and pointer-events rather than unmounting, avoiding layout thrashing.
   */
  return createPortal(
    <div
      ref={toolbarRef}
      className="selection-toolbar"
      style={{
        position: 'fixed',
        // Move offscreen when hidden so it doesn't interfere with clicks
        top: selText.length > 0 ? position.top : -9999,
        left: selText.length > 0 ? position.left : -9999,
        transform: 'translateX(-50%)',
        zIndex: 99999,
        opacity: selText.length > 0 ? 1 : 0,
        pointerEvents: selText.length > 0 ? 'auto' : 'none',
        transition: 'opacity 0.15s',
      }}
    >
      {/* ── Core formatting ─────────────────────────────────────────────── */}
      {btn('B', 'Bold', 'bold')}
      {btn('I', 'Italic', 'italic')}
      {btn('U', 'Underline', 'underline')}
      {btn('S', 'Strikethrough', 'strikeThrough')}

      {/* ── Highlight / surcharge color ────────────────────────────────── */}
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <button
          title="Highlight color"
          className="selection-toolbar-btn"
          onMouseDown={(e) => {
            e.preventDefault();
            setShowHighlightPicker(!showHighlightPicker);
            setShowColorPicker(false);
          }}
        >
          <span style={{ borderBottom: '3px solid #ffff00' }}>🖍</span>
        </button>
        {showHighlightPicker && (
          <div className="selection-color-picker">
            {HIGHLIGHT_COLORS.map(c => (
              <div
                key={c}
                className="color-swatch"
                // Transparent is shown as a dashed border swatch
                style={{ backgroundColor: c, border: c === 'transparent' ? '1px dashed #999' : undefined }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onFormat('hiliteColor', c);
                  setShowHighlightPicker(false);
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* ── Text foreground color ──────────────────────────────────────── */}
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <button
          title="Text color"
          className="selection-toolbar-btn"
          onMouseDown={(e) => {
            e.preventDefault();
            setShowColorPicker(!showColorPicker);
            setShowHighlightPicker(false);
          }}
        >A🎨</button>
        {showColorPicker && (
          <div className="selection-color-picker">
            {TEXT_COLORS.map(c => (
              <div
                key={c}
                className="color-swatch"
                style={{ backgroundColor: c }}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onFormat('foreColor', c);
                  setShowColorPicker(false);
                }}
              />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}
