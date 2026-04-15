import { useEffect, useRef } from 'react';
import type { CSSProperties } from 'react';

interface Props {
  value: string;
  onChange: (html: string) => void;
  style: CSSProperties;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
  onContainerRef?: (el: HTMLDivElement | null) => void;
  editorRef?: React.RefObject<HTMLDivElement>;
}

export default function RichTextEditor({
  value,
  onChange,
  style,
  placeholder,
  onKeyDown,
  onContainerRef,
  editorRef: externalRef,
}: Props) {
  const internalRef = useRef<HTMLDivElement>(null);
  const editorRef = externalRef ?? internalRef;

  // Expose the editor element to parent after DOM mounts
  useEffect(() => {
    onContainerRef?.(editorRef.current ?? null);
  }, []);

  useEffect(() => {
    if (!editorRef.current) return;
    if (editorRef.current.innerHTML === value) return;
    const sel = window.getSelection();
    let savedRange: Range | null = null;
    if (sel && sel.rangeCount > 0) {
      const r = sel.getRangeAt(0);
      if (editorRef.current.contains(r.startContainer) || editorRef.current === r.startContainer) {
        savedRange = r.cloneRange();
      }
    }
    editorRef.current.innerHTML = value;
    if (savedRange) {
      try {
        const newSel = window.getSelection();
        newSel?.removeAllRanges();
        newSel?.addRange(savedRange);
      } catch { /* ignore */ }
    }
  }, [value, editorRef]);

  const handleInput = () => {
    if (editorRef.current) onChange(editorRef.current.innerHTML);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && ['b', 'i', 'u'].includes(e.key.toLowerCase())) {
      e.preventDefault();
      document.execCommand(e.key.toLowerCase() as 'bold' | 'italic' | 'underline', false);
      if (editorRef.current) onChange(editorRef.current.innerHTML);
      return;
    }
    onKeyDown?.(e);
  };

  return (
    <div
      ref={editorRef}
      contentEditable
      suppressContentEditableWarning
      onInput={handleInput}
      onKeyDown={handleKeyDown}
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
        paddingLeft: '2px',
        boxSizing: 'border-box',
      }}
    />
  );
}