import { useState } from 'react';
import type { FieldModel, FieldType, TemplateModel } from '../types';
import type { FolderModel } from '../api';
import FolderTree from './FolderTree';
import { useTranslation } from '../i18n';

type Props = {
  field: FieldModel | null;
  fields: FieldModel[];
  selectedFieldId: string | null;
  multiSelectedIds: Set<string>;
  onSelectField: (id: string | null, ctrlKey?: boolean) => void;
  onUpdate: (id: string, partial: Partial<FieldModel>) => void;
  onBulkUpdateFields: (ids: string[], partial: Partial<FieldModel>) => void;
  onBulkPatchFieldStyle: (ids: string[], stylePatch: Partial<FieldModel['style']>) => void;
  onBulkUpdateType: (ids: string[], type: FieldType) => void;
  onBulkAssignOverflowGroup: (ids: string[], groupId: string, mode?: "rows" | "right" | "down") => void;
  onReorder: (id: string, direction: 'up' | 'down') => void;
  onDelete: (id: string) => void;
  onDuplicate: (id: string) => void;
  onAutoOrderOverflowGroup: (groupId: string, mode?: "rows" | "right" | "down") => void;
  docRole?: 'owner' | 'editor' | 'filler' | null;
  fillMode?: boolean;
  onResetFused?: (fusedKey: string) => void;
  /* Library props */
  templates?: TemplateModel[];
  selectedFolderId?: string | null;
  onSelectFolder?: (id: string | null) => void;
  onFoldersLoaded?: (folders: FolderModel[]) => void;
  allFolders?: FolderModel[];
  onLoadTemplate?: (tpl: TemplateModel, mode?: 'template' | 'document') => void;
  onRenameTemplate?: (id: string) => void;
  onMoveTemplate?: (id: string) => void;
  onDeleteTemplate?: (id: string) => void;
  canManageTemplate?: boolean;
};

const FONT_FAMILIES = [
  'Arial, sans-serif',
  'Helvetica, sans-serif',
  'Times New Roman, serif',
  'Courier New, monospace',
  'Georgia, serif',
  'Verdana, sans-serif',
];

const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32];

export default function PropertiesPanel({
  field,
  fields,
  selectedFieldId,
  multiSelectedIds,
  onSelectField,
  onUpdate,
  onBulkUpdateFields,
  onBulkPatchFieldStyle,
  onBulkUpdateType,
  onBulkAssignOverflowGroup,
  onReorder,
  onDelete,
  onDuplicate,
  onAutoOrderOverflowGroup,
  docRole,
  fillMode,
  onResetFused,
  templates,
  selectedFolderId,
  onSelectFolder,
  onFoldersLoaded,
  allFolders,
  onLoadTemplate,
  onRenameTemplate,
  onMoveTemplate,
  onDeleteTemplate,
  canManageTemplate,
}: Props) {
  const { t } = useTranslation();
  const canEditStructure = (!docRole || docRole === 'owner' || docRole === 'editor') && !fillMode;
  const updateStyle = (key: string, value: string | number | boolean | undefined) => {
    if (!field) return;
    onUpdate(field.id, {
      style: { ...field.style, [key]: value },
    });
  };

  // Document defaults
  const [docDefaults, setDocDefaults] = useState<{ fontFamily: string; fontSize: number; fontWeight: 'normal' | 'bold'; color: string }>({
    fontFamily: 'Arial, sans-serif',
    fontSize: 14,
    fontWeight: 'normal',
    color: '#000000',
  });
  const applyDocDefaults = () => {
    const ids = fields.map(f => f.id);
    onBulkPatchFieldStyle(ids, {
      fontFamily: docDefaults.fontFamily,
      fontSize: docDefaults.fontSize,
      fontWeight: docDefaults.fontWeight,
      color: docDefaults.color,
    });
  };

  const hasMultiSelection = multiSelectedIds.size > 1;
  const isCounter = field?.type === 'counter-tally' || field?.type === 'counter-numeric';
  const [isFieldListOpen, setIsFieldListOpen] = useState(true);
  const [bulkGroupId, setBulkGroupId] = useState('');
  const [bulkInteractionMode, setBulkInteractionMode] = useState<'distributed' | 'continuous' | 'fused'>('distributed');
  const [bulkOverflowOnEnd, setBulkOverflowOnEnd] = useState<'truncate' | 'block'>('truncate');
  const selectionCount = hasMultiSelection ? multiSelectedIds.size : field ? 1 : 0;
  const selectionLabel = hasMultiSelection
    ? t('panel.multiSelected', { count: multiSelectedIds.size })
    : field
      ? field.label || t('panel.unlabeledField')
      : t('panel.noFieldSelected');
  const overflowGroupMembers = field?.style.overflowGroupId
    ? fields
        .filter((f) => (f.pageNumber ?? 1) === (field.pageNumber ?? 1) && f.type === 'text' && (f.style.overflowGroupId || '').trim() === field.style.overflowGroupId)
        .sort((a, b) => {
          const avgH = 20;
          const tol = Math.max(12, avgH * 1.2);
          const rowDiff = Math.abs(a.y - b.y) <= tol ? 0 : a.y - b.y;
          return rowDiff || (a.x - b.x);
        })
    : [];
  const availableOverflowGroups = Array.from(
    new Set(
      fields
        .filter((f) => f.type === 'text')
        .map((f) => (f.style.overflowGroupId || '').trim())
        .filter(Boolean),
    ),
  ).sort((a, b) => a.localeCompare(b));
  const bulkOverflowGroupListId = 'bulk-overflow-group-options';
  const fieldOverflowGroupListId = 'field-overflow-group-options';

  return (
    <div className="properties-panel">
      <div className="properties-panel-header">
        <h3>{t('panel.properties')}</h3>
        <div className="properties-selection-badge">{t('panel.selectionCount', { count: selectionCount })}</div>
      </div>
      <div className="properties-selection-summary">{selectionLabel}</div>

      {/* FIELD LIST */}
      <details open={isFieldListOpen} className="field-list-section panel-card" onToggle={(e) => setIsFieldListOpen((e.currentTarget as HTMLDetailsElement).open)}>
        <summary>
          <span>{t('panel.fieldListTitle')}</span>
          <span className="section-count">{fields.length}</span>
        </summary>
        <p className="hint field-list-hint">{t('panel.fieldListCtrlHint')}</p>
        {fields.length === 0 ? (
          <p className="hint">{t('panel.noFields')}</p>
        ) : (
          <ul className="field-list">
            {fields.map((f, i) => (
              <li
                key={f.id}
                className={`field-list-item ${f.id === selectedFieldId ? 'active' : ''} ${multiSelectedIds.has(f.id) ? 'multi-selected' : ''}`}
                onClick={(e) => onSelectField(f.id, e.ctrlKey || e.metaKey)}
              >
                <div className="field-list-reorder">
                  <button className="reorder-btn-small" disabled={i === 0} onClick={(e) => { e.stopPropagation(); onReorder(f.id, 'up'); }} title={t('fields.moveUp')}>⌃</button>
                  <button className="reorder-btn-small" disabled={i === fields.length - 1} onClick={(e) => { e.stopPropagation(); onReorder(f.id, 'down'); }} title={t('fields.moveDown')}>⌄</button>
                </div>
                <span className="field-list-type">
                  {f.type === 'checkbox' ? '☐' : f.type === 'counter-tally' ? '𝍸' : f.type === 'counter-numeric' ? '#' : f.type === 'date' ? '📅' : 'T'}
                </span>
                <span className="field-list-label">{f.label}</span>
                {!f.overlayVisible && <span title="Overlay masqué" style={{ opacity: 0.5 }}>👁️‍🗨️</span>}
                {f.value && <span className="field-list-value">{f.value}</span>}
              </li>
            ))}
          </ul>
        )}
      </details>

      {/* BULK TYPE CHANGE */}
      {hasMultiSelection && (
        <div className="bulk-actions panel-card">
          <h4>{t('bulk.actionsTitle', { count: multiSelectedIds.size })}</h4>
          <label>
            {t('bulk.changeType')}
            <select
              defaultValue=""
              onChange={(e) => {
                if (e.target.value) {
                  onBulkUpdateType(Array.from(multiSelectedIds), e.target.value as FieldType);
                  e.target.value = '';
                }
              }}
            >
              <option value="" disabled>{t('bulk.choose')}</option>
              <option value="text">{t('fields.typeText')}</option>
              <option value="date">{t('fields.typeDate')}</option>
              <option value="checkbox">{t('fields.typeCheckbox')}</option>
              <option value="counter-tally">{t('fields.typeCounterTally')}</option>
              <option value="counter-numeric">{t('fields.typeCounterNumeric')}</option>
            </select>
          </label>

          <h4 style={{ marginTop: 10 }}>{t('bulk.overflowTitle')}</h4>
          <label>
            {t('bulk.overflowGroupLabel')}
            <input
              type="text"
              list={bulkOverflowGroupListId}
              value={bulkGroupId}
              placeholder={t('bulk.overflowGroupPlaceholder')}
              onChange={(e) => setBulkGroupId(e.target.value)}
            />
            <datalist id={bulkOverflowGroupListId}>
              {availableOverflowGroups.map((groupId) => (
                <option key={groupId} value={groupId} />
              ))}
            </datalist>
          </label>

          <label>
            {t('bulk.interactionModeLabel')}
            <select
              value={bulkInteractionMode}
              onChange={(e) => setBulkInteractionMode(e.target.value as 'distributed' | 'continuous' | 'fused')}
            >
              <option value="distributed">{t('fields.overflowDistributed')}</option>
              <option value="continuous">{t('fields.overflowContinuous')}</option>
              <option value="fused" disabled>{t('fields.overflowFused')}</option>
            </select>
          </label>

          <label>
            {t('bulk.endCapacityLabel')}
            <select
              value={bulkOverflowOnEnd}
              onChange={(e) => setBulkOverflowOnEnd(e.target.value as 'truncate' | 'block')}
            >
              <option value="truncate">{t('fields.overflowTruncate')}</option>
              <option value="block">{t('fields.overflowBlock')}</option>
            </select>
          </label>

          <div className="buttons">
            <button
              type="button"
              onClick={() => {
                const gid = bulkGroupId.trim();
                if (!gid) return;
                const ids = Array.from(multiSelectedIds);
                onBulkAssignOverflowGroup(ids, gid, 'rows');
                onBulkPatchFieldStyle(ids, {
                  overflowInteractionMode: bulkInteractionMode,
                  overflowOnEnd: bulkOverflowOnEnd,
                });
              }}
            >
              {t('bulk.applyGroupAndOptions')}
            </button>
            <button
              type="button"
              onClick={() => {
                const ids = Array.from(multiSelectedIds);
                onBulkPatchFieldStyle(ids, {
                  overflowInteractionMode: bulkInteractionMode,
                  overflowOnEnd: bulkOverflowOnEnd,
                });
              }}
            >
              {t('bulk.applyOptionsToSelection')}
            </button>
          </div>
            <button
              type="button"
              style={{ backgroundColor: '#e74c3c', color: '#fff', marginTop: 4 }}
              onClick={() => {
                const ids = Array.from(multiSelectedIds);
                onBulkPatchFieldStyle(ids, {
                  overflowGroupId: undefined,
                  overflowOrder: undefined,
                  overflowMaxFields: undefined,
                  overflowInteractionMode: undefined,
                });
              }}
            >
              {t('bulk.removeGroupFromSelection')}
            </button>
        </div>
      )}

      <div className="properties-form-card panel-card">
        {!field ? (
          <p className="hint">{t('panel.selectFieldHint')}</p>
        ) : (
          <>
          <label>
            {t('fields.label')}
            <input
              type="text"
              value={field.label}
              onChange={(e) => onUpdate(field.id, { label: e.target.value })}
            />
          </label>

          <label>
            {t('fields.type')}
            <select
              value={field.type}
              onChange={(e) => {
                const newType = e.target.value as FieldType;
                const newValue = newType === 'counter-tally' || newType === 'counter-numeric' ? '0' : '';
                onUpdate(field.id, { type: newType, value: newValue });
              }}
            >
              <option value="text">{t('fields.typeText')}</option>
              <option value="date">{t('fields.typeDate')}</option>
              <option value="checkbox">{t('fields.typeCheckbox')}</option>
              <option value="counter-tally">{t('fields.typeCounterTally')}</option>
              <option value="counter-numeric">{t('fields.typeCounterNumeric')}</option>
            </select>
          </label>

          {field.type === 'text' && (
            <>
              <label>
                {t('fields.value')}
                <input
                  type="text"
                  value={field.value}
                  onChange={(e) => onUpdate(field.id, { value: e.target.value })}
                  placeholder={t('fields.valuePlaceholder')}
                />
              </label>

              <label>
                {t('fields.overflowGroup')}
                <input
                  type="text"
                  list={fieldOverflowGroupListId}
                  value={field.style.overflowGroupId ?? ''}
                  placeholder={t('fields.overflowGroupPlaceholder')}
                  onChange={(e) => onUpdate(field.id, { style: { ...field.style, overflowGroupId: e.target.value || undefined } })}
                />
                <datalist id={fieldOverflowGroupListId}>
                  {availableOverflowGroups.map((groupId) => (
                    <option key={groupId} value={groupId} />
                  ))}
                </datalist>
              </label>

              <label className="checkbox-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(field.style.carryToNextPage)}
                  onChange={(e) => onUpdate(field.id, { style: { ...field.style, carryToNextPage: e.target.checked } })}
                />
                {t('fields.carryToNextPage')}
              </label>

              {field.style.carryToNextPage && (
                <label>
                  {t('fields.carryValueMode')}
                  <select
                    value={field.style.carryValueMode || 'keep'}
                    onChange={(e) => onUpdate(field.id, { style: { ...field.style, carryValueMode: e.target.value as 'keep' | 'clear' } })}
                  >
                    <option value="keep">{t('fields.carryKeep')}</option>
                    <option value="clear">{t('fields.carryClear')}</option>
                  </select>
                </label>
              )}

              {field.style.overflowGroupId && (
                <>
                  <label>
                    {t('fields.overflowOrder')} <span style={{ fontSize: 10, color: '#999' }}>{t('fields.overflowOrderDebug')}</span>
                    <input
                      type="number"
                      min={1}
                      value={field.style.overflowOrder ?? ''}
                      placeholder="1"
                      onChange={(e) => onUpdate(field.id, { style: { ...field.style, overflowOrder: e.target.value ? Number(e.target.value) : undefined } })}
                    />
                  </label>

                  <label>
                    {t('fields.overflowMaxFields')}
                    <input
                      type="number"
                      min={1}
                      value={field.style.overflowMaxFields ?? ''}
                      placeholder={t('fields.overflowMaxFieldsPlaceholder')}
                      onChange={(e) => onUpdate(field.id, { style: { ...field.style, overflowMaxFields: e.target.value ? Number(e.target.value) : undefined } })}
                    />
                  </label>

                  <label>
                    {t('fields.overflowOnEnd')}
                    <select
                      value={field.style.overflowOnEnd || 'truncate'}
                      onChange={(e) => onUpdate(field.id, { style: { ...field.style, overflowOnEnd: e.target.value as 'truncate' | 'block' } })}
                    >
                      <option value="truncate">{t('fields.overflowTruncate')}</option>
                      <option value="block">{t('fields.overflowBlock')}</option>
                    </select>
                  </label>

                  <label>
                    {t('fields.overflowInteractionMode')}
                    <select
                      value={field.style.overflowInteractionMode || 'distributed'}
                      onChange={(e) => onUpdate(field.id, { style: { ...field.style, overflowInteractionMode: e.target.value as 'distributed' | 'continuous' | 'fused' } })}
                    >
                      <option value="distributed">{t('fields.overflowDistributed')}</option>
                      <option value="continuous">{t('fields.overflowContinuous')}</option>
                      <option value="fused" disabled>{t('fields.overflowFused')}</option>
                    </select>
                  </label>

                  <div className="buttons" style={{ marginTop: 6 }}>
                    <button type="button" onClick={() => onAutoOrderOverflowGroup(field.style.overflowGroupId!, "rows")}>{t('fields.autoOrderLR')}</button>
                    <button type="button" onClick={() => onAutoOrderOverflowGroup(field.style.overflowGroupId!, "right")}>{t('fields.autoOrderRight')}</button>
                    <button type="button" onClick={() => onAutoOrderOverflowGroup(field.style.overflowGroupId!, "down")}>{t('fields.autoOrderDown')}</button>
                  </div>

                  {field.style.overflowInteractionMode === 'fused' && onResetFused && (
                    <button
                      type="button"
                      style={{ marginTop: 6, fontSize: 11 }}
                      onClick={() => {
                        const fusedKey = `${field.pageNumber ?? 1}:${field.style.overflowGroupId}`;
                        onResetFused(fusedKey);
                      }}
                    >
                      {t('fields.resetFusion')}
                    </button>
                  )}

                  {overflowGroupMembers.length > 0 && (
                    <div className="hint" style={{ fontSize: 11, marginTop: 6 }}>
                      Parcours (coord): {overflowGroupMembers.map((m, i) => String(i + 1) + ':' + m.label).join(' → ')}
                    </div>
                  )}


                  <button
                    type="button"
                    style={{ backgroundColor: '#e74c3c', color: '#fff', marginTop: 6 }}
                    onClick={() => {
                      onUpdate(field.id, {
                        style: {
                          ...field.style,
                          overflowGroupId: undefined,
                          overflowOrder: undefined,
                          overflowMaxFields: undefined,
                          overflowInteractionMode: undefined,
                        },
                      });
                    }}
                  >
                    {t('fields.removeFromGroup')}
                  </button>
                  <p className="hint" style={{ fontSize: 11, marginTop: 4 }}>
                    {t('fields.overflowHint')}
                  </p>
                </>
              )}
            </>
          )}

          {field.type === 'date' && (
            <>
              <label>
                {t('fields.dateFormat')}
                <select
                  value={field.style.dateFormat || 'DD/MM/YYYY'}
                  onChange={(e) => onUpdate(field.id, { style: { ...field.style, dateFormat: e.target.value as any } })}
                >
                  <option value="DD/MM/YYYY">JJ/MM/AAAA</option>
                  <option value="MM/DD/YYYY">MM/JJ/AAAA</option>
                  <option value="YYYY-MM-DD">AAAA-MM-JJ</option>
                </select>
              </label>

              <label>
                {t('fields.datePlaceholder')}
                <input
                  type="text"
                  value={field.style.datePlaceholder ?? ''}
                  placeholder={field.style.dateFormat === 'MM/DD/YYYY' ? 'MM/JJ/AAAA' : field.style.dateFormat === 'YYYY-MM-DD' ? 'AAAA-MM-JJ' : 'JJ/MM/AAAA'}
                  onChange={(e) => onUpdate(field.id, { style: { ...field.style, datePlaceholder: e.target.value || undefined } })}
                />
              </label>

              <label className="checkbox-toggle">
                <input
                  type="checkbox"
                  checked={Boolean(field.style.dateDefaultToday)}
                  onChange={(e) => onUpdate(field.id, { style: { ...field.style, dateDefaultToday: e.target.checked } })}
                />
                {t('fields.dateDefaultToday')}
              </label>

              <label>
                {t('fields.value')}
                <input
                  type="text"
                  inputMode="numeric"
                  value={field.value}
                  onChange={(e) => {
                    const digits = e.target.value.replace(/\D/g, '').slice(0, 8);
                    const fmt = field.style.dateFormat || 'DD/MM/YYYY';
                    let formatted = '';
                    if (fmt === 'YYYY-MM-DD') {
                      const y = digits.slice(0, 4);
                      const m = digits.slice(4, 6);
                      const d = digits.slice(6, 8);
                      formatted = [y, m, d].filter(Boolean).join('-');
                    } else {
                      for (let i = 0; i < digits.length; i++) {
                        if (i === 2 || i === 4) formatted += '/';
                        formatted += digits[i];
                      }
                    }
                    onUpdate(field.id, { value: formatted });
                  }}
                  placeholder={field.style.datePlaceholder || (field.style.dateFormat === 'MM/DD/YYYY' ? 'MM/JJ/AAAA' : field.style.dateFormat === 'YYYY-MM-DD' ? 'AAAA-MM-JJ' : 'JJ/MM/AAAA')}
                  maxLength={10}
                />
              </label>

              <button
                type="button"
                onClick={() => {
                  const now = new Date();
                  const dd = String(now.getDate()).padStart(2, '0');
                  const mm = String(now.getMonth() + 1).padStart(2, '0');
                  const yyyy = String(now.getFullYear());
                  const fmt = field.style.dateFormat || 'DD/MM/YYYY';
                  const value = fmt === 'YYYY-MM-DD' ? `${yyyy}-${mm}-${dd}` : fmt === 'MM/DD/YYYY' ? `${mm}/${dd}/${yyyy}` : `${dd}/${mm}/${yyyy}`;
                  onUpdate(field.id, { value });
                }}
              >
                {t('fields.dateSetToday')}
              </button>
            </>
          )}

          {field.type === 'checkbox' && (
            <label className="checkbox-toggle">
              {t('fields.checked')}
              <input
                type="checkbox"
                checked={field.value === 'true'}
                onChange={(e) => onUpdate(field.id, { value: String(e.target.checked) })}
              />
            </label>
          )}

          {field.type === 'checkbox' && (
            <label>
              {t('fields.checkSize')}
              <input
                type="number"
                min={10}
                max={100}
                value={field.style.checkSize ?? ''}
                placeholder={t('fields.checkSizePlaceholder')}
                onChange={(e) => {
                  const val = e.target.value ? Number(e.target.value) : undefined;
                  updateStyle('checkSize', val as any);
                }}
              />
            </label>
          )}

          {isCounter && (
            <div className="counter-controls">
              <span className="counter-value">{field.value || '0'}</span>
              <div className="counter-buttons">
                <button onClick={() => onUpdate(field.id, { value: String(Math.max(0, Number(field.value || 0) - 1)) })}>−</button>
                <button onClick={() => onUpdate(field.id, { value: String(Number(field.value || 0) + 1) })}>+</button>
                <button onClick={() => onUpdate(field.id, { value: '0' })}>↺</button>
              </div>
            </div>
          )}

          <hr />

          <label>
            {t('panel.font')}
            <select value={field.style.fontFamily} onChange={(e) => updateStyle('fontFamily', e.target.value)}>
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f} style={{ fontFamily: f }}>{f.split(',')[0]}</option>
              ))}
            </select>
          </label>

          <label>
            {t('panel.fontSize')}
            <select value={field.style.fontSize} onChange={(e) => updateStyle('fontSize', Number(e.target.value))}>
              {FONT_SIZES.map((s) => (
                <option key={s} value={s}>{s}px</option>
              ))}
            </select>
          </label>

          <label>
            {t('panel.fontWeight')}
            <select value={field.style.fontWeight} onChange={(e) => updateStyle('fontWeight', e.target.value)}>
              <option value="normal">{t('panel.fontWeightNormal')}</option>
              <option value="bold">{t('panel.fontWeightBold')}</option>
            </select>
          </label>

          <div className="style-toggles">
            <button
              type="button"
              title={t('fields.italic')}
              className={`style-toggle-btn ${field.style.fontStyle === 'italic' ? 'active' : ''}`}
              onClick={() => updateStyle('fontStyle', field.style.fontStyle === 'italic' ? 'normal' : 'italic')}
            >I</button>
            <button
              type="button"
              title={t('fields.underline')}
              className={`style-toggle-btn ${field.style.textDecoration === 'underline' ? 'active' : ''}`}
              onClick={() => updateStyle('textDecoration', field.style.textDecoration === 'underline' ? 'none' : 'underline')}
            >U</button>
            <button
              type="button"
              title={t('fields.lineThrough')}
              className={`style-toggle-btn ${field.style.textDecoration === 'line-through' ? 'active' : ''}`}
              onClick={() => updateStyle('textDecoration', field.style.textDecoration === 'line-through' ? 'none' : 'line-through')}
            >S</button>
          </div>

          <label>
            {t('fields.alignment')}
            <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
              <button type="button" className={`style-toggle-btn ${field.style.textAlign === 'left' ? 'active' : ''}`} title={t('fields.alignLeft')} onClick={() => updateStyle('textAlign', 'left')}>◀</button>
              <button type="button" className={`style-toggle-btn ${field.style.textAlign === 'center' ? 'active' : ''}`} title={t('fields.alignCenter')} onClick={() => updateStyle('textAlign', 'center')}>◆</button>
              <button type="button" className={`style-toggle-btn ${field.style.textAlign === 'right' ? 'active' : ''}`} title={t('fields.alignRight')} onClick={() => updateStyle('textAlign', 'right')}>▶</button>
              <button type="button" className={`style-toggle-btn ${field.style.textAlign === 'justify' ? 'active' : ''}`} title={t('fields.alignJustify')} onClick={() => updateStyle('textAlign', 'justify')}>☰</button>
              <select value={field.style.textAlign} onChange={(e) => updateStyle('textAlign', e.target.value)} style={{ marginLeft: 4 }}>
                <option value="left">{t('fields.alignLeft')}</option>
                <option value="center">{t('fields.alignCenter')}</option>
                <option value="right">{t('fields.alignRight')}</option>
                <option value="justify">{t('fields.alignJustify')}</option>
              </select>
            </div>
          </label>

          <label>
            {t('panel.color')}
            <input type="color" value={field.style.color} onChange={(e) => updateStyle('color', e.target.value)} />
          </label>

          <div className="color-palette">
            {['#000000','#ffffff','#e74c3c','#3498db','#2ecc71','#f1c40f','#e67e22','#9b59b6','#ff69b4','#95a5a6'].map((c) => (
              <div
                key={c}
                className={`color-palette-swatch ${field.style.color === c ? 'selected' : ''}`}
                style={{ backgroundColor: c }}
                title={c}
                onClick={() => updateStyle('color', c)}
              />
            ))}
          </div>

          <label>
            {t('fields.highlightColor')}
            <input type="color" value={field.style.highlightColor || '#ffff00'} onChange={(e) => updateStyle('highlightColor', e.target.value)} />
          </label>

          <label className="checkbox-toggle">
            <input
              type="checkbox"
              checked={Boolean(field.style.maskBackground)}
              onChange={(e) => updateStyle('maskBackground', e.target.checked)}
            />
            {t('fields.maskBackground')}
          </label>

          {field.style.maskBackground && (
            <label>
              {t('fields.backgroundColor')}
              <input
                type="color"
                value={field.style.backgroundColor || '#ffffff'}
                onChange={(e) => updateStyle('backgroundColor', e.target.value)}
              />
            </label>
          )}

          <hr />

          <div className="prop-row">
            <label>
              X <input type="number" value={Math.round(field.x)} disabled={field.locked && !canEditStructure} onChange={(e) => onUpdate(field.id, { x: Number(e.target.value) })} />
            </label>
            <label>
              Y <input type="number" value={Math.round(field.y)} disabled={field.locked && !canEditStructure} onChange={(e) => onUpdate(field.id, { y: Number(e.target.value) })} />
            </label>
          </div>

          <div className="prop-row">
            <label>
              L <input type="number" value={Math.round(field.w)} disabled={field.locked && !canEditStructure} onChange={(e) => onUpdate(field.id, { w: Number(e.target.value) })} />
            </label>
            <label>
              H <input type="number" value={Math.round(field.h)} disabled={field.locked && !canEditStructure} onChange={(e) => onUpdate(field.id, { h: Number(e.target.value) })} />
            </label>
          </div>

          {canEditStructure && (
            <>
              <hr />
              <label className="checkbox-toggle">
                <input
                  type="checkbox"
                  checked={field.locked}
                  onChange={(e) => onUpdate(field.id, { locked: e.target.checked })}
                />
                {t('fields.lockStructure')}
              </label>

              <label className="checkbox-toggle">
                <input
                  type="checkbox"
                  checked={field.overlayVisible}
                  onChange={(e) => onUpdate(field.id, { overlayVisible: e.target.checked })}
                />
                {t('fields.showOverlay')}
              </label>

              <div className="buttons prop-buttons">
                <button onClick={() => onDuplicate(field.id)}>{t('fields.duplicateField')}</button>
                <button className="btn-delete" onClick={() => onDelete(field.id)}>{t('fields.deleteField')}</button>
              </div>
            </>
          )}
          </>
        )}
      </div>

      {/* ── Document Defaults ── */}
      {!fillMode && (
        <details className="panel-card" style={{ marginTop: 2 }}>
          <summary>{t('panel.defaultStyleTitle')}</summary>
          <label>
            {t('panel.font')}
            <select value={docDefaults.fontFamily} onChange={(e) => setDocDefaults(d => ({ ...d, fontFamily: e.target.value }))}>
              {FONT_FAMILIES.map((f) => (
                <option key={f} value={f}>{f.split(',')[0]}</option>
              ))}
            </select>
          </label>
          <label>
            {t('panel.fontSize')}
            <select value={docDefaults.fontSize} onChange={(e) => setDocDefaults(d => ({ ...d, fontSize: Number(e.target.value) }))}>
              {FONT_SIZES.map((s) => (
                <option key={s} value={s}>{s}px</option>
              ))}
            </select>
          </label>
          <label>
            {t('panel.fontWeight')}
            <select value={docDefaults.fontWeight} onChange={(e) => setDocDefaults(d => ({ ...d, fontWeight: e.target.value as 'normal' | 'bold' }))}>
              <option value="normal">{t('panel.fontWeightNormal')}</option>
              <option value="bold">{t('panel.fontWeightBold')}</option>
            </select>
          </label>
          <label>
            {t('panel.color')}
            <input type="color" value={docDefaults.color} onChange={(e) => setDocDefaults(d => ({ ...d, color: e.target.value }))} />
          </label>
          <button type="button" onClick={applyDocDefaults} style={{ marginTop: 6 }}>
            {t('panel.applyToAllFields')}
          </button>
        </details>
      )}

      {/* ── Library / Templates (moved from left panel) ── */}
      {templates && onSelectFolder && onFoldersLoaded && onLoadTemplate && (
        <details className="panel-section panel-card" style={{ marginTop: 2 }}>
          <summary>{t('panel.library')}</summary>
          <FolderTree selectedFolderId={selectedFolderId ?? null} onSelectFolder={onSelectFolder} onFoldersLoaded={onFoldersLoaded} />

          <h3 style={{ fontSize: 12, margin: '8px 0 4px' }}>{selectedFolderId ? t('panel.templatesInFolder') : t('panel.recentTemplates')}</h3>
          <ul className="templates-list">
            {templates
              .filter((tmpl) => selectedFolderId === null || selectedFolderId === undefined ? true : (tmpl.folderId ?? null) === selectedFolderId)
              .slice(0, 20)
              .map((tmpl) => (
              <li key={tmpl.id}>
                <strong>{tmpl.name}</strong>
                <span>{t('panel.nFields', { count: tmpl.fields.length })}</span>
                <div className="template-actions">
                  <button onClick={() => onLoadTemplate(tmpl, 'template')} title={t('template.loadBlank')} className="btn-icon-only">📄</button>
                  <button onClick={() => onLoadTemplate(tmpl, 'document')} title={t('template.loadWithDraft')}>📝</button>
                  {onRenameTemplate && <button onClick={() => onRenameTemplate(tmpl.id)} title={t('common.rename')} disabled={!canManageTemplate}>✏️</button>}
                  {onMoveTemplate && <button onClick={() => onMoveTemplate(tmpl.id)} title={t('common.move')} disabled={!canManageTemplate}>📁</button>}
                  {onDeleteTemplate && <button onClick={() => onDeleteTemplate(tmpl.id)} title={t('common.delete')} className="btn-delete-small" disabled={!canManageTemplate}>🗑</button>}
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
