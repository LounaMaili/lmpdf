import { useEffect, useRef, useState } from 'react';

type Props = {
  containerRef: HTMLElement | null;
  onFormat: (command: string, value?: string) => void;
};

const HIGHLIGHT_COLORS = ['#ffff00', '#ff9900', '#ff0000', '#00ff00', '#00ffff', '#9999ff', '#ff99cc', 'transparent'];
const TEXT_COLORS = ['#000000', '#e74c3c', '#3498db', '#2ecc71', '#f1c40f', '#e67e22', '#9b59b6', '#ffffff'];

export default function SelectionToolbar({ containerRef, onFormat }: Props) {
  const toolbarRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ top: 0, left: 0 });
  const [showHighlightPicker, setShowHighlightPicker] = useState(false);
  const [showColorPicker, setShowColorPicker] = useState(false);

  // Fallback: poll selection every 100ms since mouseup/selectionchange may not fire inside contentEditable
  useEffect(() => {
    const poll = setInterval(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      setVisible(true);
      setPosition({ top: rect.top - 46, left: rect.left + rect.width / 2 });
    }, 100);
    return () => clearInterval(poll);
  }, []);

  // Also try mouseup on window as a backup
  useEffect(() => {
    const onUp = () => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) return;
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      setVisible(true);
      setPosition({ top: rect.top - 46, left: rect.left + rect.width / 2 });
    };
    window.addEventListener('mouseup', onUp);
    return () => window.removeEventListener('mouseup', onUp);
  }, []);

  if (!visible) return null;

  const btn = (label: string, title: string, cmd: string, val?: string) => (
    <button
      key={cmd + (val ?? '')}
      title={title}
      className="selection-toolbar-btn"
      onMouseDown={(e) => { e.preventDefault(); onFormat(cmd, val); }}
    >{label}</button>
  );

  return (
    <div
      ref={toolbarRef}
      className="selection-toolbar"
      style={{
        position: 'fixed',
        top: position.top,
        left: position.left,
        transform: 'translateX(-50%)',
        zIndex: 9999,
      }}
    >
      {btn('B', 'Gras', 'bold')}
      {btn('I', 'Italique', 'italic')}
      {btn('U', 'Souligné', 'underline')}
      {btn('S', 'Barré', 'strikeThrough')}

      {/* Highlight */}
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <button
          title="Surlignage"
          className="selection-toolbar-btn"
          onMouseDown={(e) => { e.preventDefault(); setShowHighlightPicker(!showHighlightPicker); setShowColorPicker(false); }}
        >
          <span style={{ borderBottom: '3px solid #ffff00' }}>🖍</span>
        </button>
        {showHighlightPicker && (
          <div className="selection-color-picker">
            {HIGHLIGHT_COLORS.map(c => (
              <div
                key={c}
                className="color-swatch"
                style={{ backgroundColor: c, border: c === 'transparent' ? '1px dashed #999' : undefined }}
                onMouseDown={(e) => { e.preventDefault(); onFormat('hiliteColor', c); setShowHighlightPicker(false); }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Text color */}
      <div style={{ position: 'relative', display: 'inline-block' }}>
        <button
          title="Couleur du texte"
          className="selection-toolbar-btn"
          onMouseDown={(e) => { e.preventDefault(); setShowColorPicker(!showColorPicker); setShowHighlightPicker(false); }}
        >A🎨</button>
        {showColorPicker && (
          <div className="selection-color-picker">
            {TEXT_COLORS.map(c => (
              <div
                key={c}
                className="color-swatch"
                style={{ backgroundColor: c }}
                onMouseDown={(e) => { e.preventDefault(); onFormat('foreColor', c); setShowColorPicker(false); }}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}