/**
 * RichTextEditor
 *
 * Thin wrapper around a contentEditable div that bridges React state (the HTML string)
 * with the browser's native text editing capabilities.
 *
 * Key responsibilities:
 * - Renders a contentEditable div styled to match the field dimensions.
 * - Syncs outward changes (new `value` prop) into the DOM without destroying the
 *   current cursor position or text selection — critical for not losing the user's
 *   insertion point when the document auto-saves or the field overflows.
 * - Emits onChange with the current innerHTML on every user input event.
 * - Forwards keyboard shortcuts (Ctrl/Cmd+B/I/U) to document.execCommand so that
 *   the SelectionToolbar formatting buttons and keyboard shortcuts share the same path.
 * - Exposes its DOM element to the parent via `onContainerRef` so the SelectionToolbar
 *   can verify that a given text selection belongs to this editor instance.
 *
 * This component intentionally does NOT manage any React state for formatting —
 * all rich-text state lives in the browser's Selection API and the DOM itself.
 */

import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

interface Props {
  /** Current HTML content of the editor (set by parent on save / field update). */
  value: string;
  /** Called whenever the user types or formats; receives the new innerHTML string. */
  onChange: (html: string) => void;
  /** Base styles from the field geometry (left, top, width, height, font…). */
  style: CSSProperties;
  /** Placeholder text shown when the field is empty and not focused. */
  placeholder?: string;
  /** Keyboard event handler for non-formatting keys (e.g. Tab to exit field). */
  onKeyDown?: (e: React.KeyboardEvent) => void;
  /**
   * Called once after mount with the editor's DOM element (or null on unmount).
   * Used by FieldOverlay to pass a stable ref to SelectionToolbar so it can
   * verify that a text selection belongs to this specific editor instance.
   */
  onContainerRef?: (el: HTMLDivElement | null) => void;
  /**
   * Optional external ref. If not provided an internal ref is created.
   * Supports useImperativeHandle-style usage from the parent.
   */
  editorRef?: React.RefObject<HTMLDivElement>;
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RichTextEditor({
  value,
  onChange,
  style,
  placeholder,
  onKeyDown,
  onContainerRef,
  editorRef: externalRef,
}: Props) {
  // Internal ref used when no external ref is provided.
  const internalRef = useRef<HTMLDivElement>(null);
  // Use the external ref if provided, otherwise fall back to the internal one.
  const editorRef = externalRef ?? internalRef;

  // ── Expose DOM element to parent ───────────────────────────────────────────

  /**
   * Fires once after the component mounts and the div exists in the DOM.
   * FieldOverlay uses this to give SelectionToolbar a stable `containerRef`
   * so it can check whether a selection belongs to this editor.
   */
  useEffect(() => {
    onContainerRef?.(editorRef.current ?? null);
  }, []); // Intentionally empty — runs once on mount, element never changes.

  // ── Sync external value → DOM ───────────────────────────────────────────────

  /**
   * Updates the DOM when the value prop changes (e.g. after an autosave restore
   * or an overflow field merge).
   *
   * To avoid moving the cursor, we save the current selection range before
   * overwriting innerHTML and restore it afterward. This is especially important
   * when the save fires while the user is mid-keystroke.
   *
   * The guard `if (innerHTML === value) return` skips the expensive DOM write
   * when the content hasn't actually changed — important to avoid unnecessary
   * cursor disruption during renders where the value string is unchanged.
   */
  useEffect(() => {
    if (!editorRef.current) return;
    // Skip if the DOM already matches the new value — prevents cursor jumps.
    if (editorRef.current.innerHTML === value) return;

    // Save the current cursor position before overwriting the DOM.
    const sel = window.getSelection();
    let savedRange: Range | null = null;
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      // Only save if the cursor is actually inside this editor.
      if (editorRef.current.contains(r.startContainer) || editorRef.current === r.startContainer) {
        savedRange = r.cloneRange();
      }
    }

    // Overwrite with the new HTML.
    editorRef.current.innerHTML = value;

    // Restore the cursor position after the DOM update.
    if (savedRange) {
      try {
        const newSel = window.getSelection();
        newSel?.removeAllRanges();
        newSel?.addRange(savedRange);
      } catch {
        // ignore — restoration can fail if the saved range is no longer valid
      }
    }
  }, [value, editorRef]);

  // ── Input event ────────────────────────────────────────────────────────────

  /**
   * Fires on every keystroke, paste, or formatting change.
   * Emits the current innerHTML to the parent so it can persist the content.
   */
  const handleInput = () => {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  // ── Keyboard shortcuts ─────────────────────────────────────────────────────

  /**
   * Intercepts Ctrl/Cmd+B / I / U and forwards them to document.execCommand.
   * This is the same path the SelectionToolbar buttons take, ensuring
   * keyboard shortcuts and toolbar buttons produce identical results.
   *
   * e.preventDefault() is required — without it the browser navigates or
   * performs its own default action before execCommand fires.
   */
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      document.execCommand(e.key.toLowerCase() as 'bold' | 'italic' | 'underline', false);
      if (editorRef.current) onChange(editorRef.current.innerHTML);
      return;
    }
    // Pass non-formatting keys up to the parent (e.g. Tab to exit the field).
    onKeyDown?.(e);
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      onInput={handleInput}
      onKeyDown={handleKeyDown}
      // Placeholder support via CSS attribute selector `[data-placeholder]:empty::before`.
      data-placeholder={placeholder}
      style={{
        ...style,
        width: '100%',
        height: '100%',
        border: 'none',
        outline: 'none',
        overflow: 'hidden',
        wordWrap: 'break-word',
        whiteSpace: 'pre-wrap',
        cursor: 'text',
        // 4 px left padding prevents the first character being clipped at the field edge.
        padding: '2px 6px',
        boxSizing: 'border-box',
      }}
    />
  );
}
