import { useRef, useCallback, useEffect, useState } from 'react';
import SelectionToolbar from './SelectionToolbar';

type Props = {
  value: string;
  onChange: (html: string) => void;
  style: React.CSSProperties;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
};

export default function RichTextEditor({ value, onChange, style, placeholder, onKeyDown }: Props) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [focused, setFocused] = useState(false);

  // Sync HTML only when value changed externally (not during local edits that keep selection)
  useEffect(() => {
    if (!editorRef.current || editorRef.current.innerHTML === value) return;
    // Save and restore selection to avoid collapsing on re-render
    const sel = window.getSelection();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0).cloneRange() : null;
    editorRef.current.innerHTML = value;
    if (range) {
      try {
        const newSel = window.getSelection();
        newSel?.removeAllRanges();
        newSel?.addRange(range);
      } catch {}
      }
  }, [value]);

  const handleInput = useCallback(() => {
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  const handleFormat = useCallback((command: string, value?: string) => {
    document.execCommand(command, false, value);
    if (editorRef.current) {
      onChange(editorRef.current.innerHTML);
    }
  }, [onChange]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    // Allow bold/italic/underline shortcuts to work natively in contentEditable
    if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
      // Let the browser handle it
      setTimeout(() => {
        if (editorRef.current) onChange(editorRef.current.innerHTML);
      }, 0);
      return;
    }
    onKeyDown?.(e);
  }, [onKeyDown, onChange]);

  const [containerEl, setContainerEl] = useState<HTMLDivElement | null>(null);

  const setEditorRef = useCallback((node: HTMLDivElement | null) => {
    editorRef.current = node;
    setContainerEl(node);
  }, []);

  return (
    <>
      <div
        ref={setEditorRef}
        className="rich-text-editor"
        contentEditable
        suppressContentEditableWarning
        onInput={handleInput}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={handleKeyDown}
        data-placeholder={placeholder}
        style={{
          ...style,
          width: '100%',
          height: '100%',
          border: 'none',
          outline: 'none',
          resize: 'none',
          overflow: 'hidden',
          wordWrap: 'break-word',
          whiteSpace: 'pre-wrap',
          cursor: 'text',
        }}
      />
      <SelectionToolbar containerRef={containerEl} onFormat={handleFormat} />
    </>
  );
}
