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

  // Initialize innerHTML on mount and when value changes while unfocused
  useEffect(() => {
    if (editorRef.current && !focused) {
      if (editorRef.current.innerHTML !== value) {
        editorRef.current.innerHTML = value;
      }
    }
  }, [value, focused]);

  // Also set on mount
  useEffect(() => {
    if (editorRef.current && value) {
      editorRef.current.innerHTML = value;
    }
  }, []);

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

  return (
    <>
      <div
        ref={editorRef}
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
      <SelectionToolbar containerRef={editorRef.current} onFormat={handleFormat} />
    </>
  );
}
