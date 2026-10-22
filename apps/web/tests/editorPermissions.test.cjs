const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const ts = require('typescript');
const React = require('react');

// Compile the real TS/TSX components in memory. Only DOM-dependent dependencies
// and React hooks are simulated; the component event handlers themselves run.
const src = path.resolve(__dirname, '../src');
for (const extension of ['.ts', '.tsx']) {
  require.extensions[extension] = (module, filename) => {
    const result = ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: {
      module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true, target: ts.ScriptTarget.ES2021,
    }, fileName: filename });
    module._compile(result.outputText, filename);
  };
}
const load = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent?.filename.startsWith(src)) {
    if (request === 'react') return { ...React,
      useState: initial => [typeof initial === 'function' ? initial() : initial, () => {}],
      useRef: initial => ({ current: initial }), useEffect: () => {}, useLayoutEffect: () => {},
      useMemo: fn => fn(), useCallback: fn => fn,
    };
    if (request === '../i18n') return { useTranslation: () => ({ t: key => key }) };
    if (request === '../utils/sanitizeRichText') return { sanitizeRichTextHtml: value => value };
    if (request === '../api') return {};
  }
  return load.call(this, request, parent, isMain);
};
const { editorPermissions, canApplyFieldPatch, canApplyDetection } = require('../src/utils/editorPermissions.ts');
const FieldOverlay = require('../src/components/FieldOverlay.tsx').default;
const PropertiesPanel = require('../src/components/PropertiesPanel.tsx').default;
const all = { editStructure: true, createTemplate: true, manageTemplate: true, exportPdf: true, printDocument: true };
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
}
const hasClass = (node, name) => node.props?.className?.split(' ').includes(name);
const field = { id: 'test-field', label: 'Test', value: '', x: 10, y: 20, w: 40, h: 30, type: 'checkbox', locked: false, overlayVisible: true, style: {} };
function overlay(overrides = {}) {
  return FieldOverlay({ field, selected: true, dispRatio: 1, rotation: 0, docRole: 'filler', canEditStructure: false,
    fillMode: false, onSelect: () => {}, onMove: () => assert.fail('move interdit'), onResize: () => assert.fail('resize interdit'),
    onValueChange: () => {}, pageWidth: 500, pageHeight: 500, ...overrides });
}
for (const role of ['owner', 'editor', 'filler', null]) {
  test(`UI permissions combinées : ${role}`, () => {
    const permissions = editorPermissions(all, role, true);
    for (const allowed of Object.values(permissions)) assert.equal(allowed, role === 'owner' || role === 'editor');
    for (const allowed of Object.values(editorPermissions(Object.fromEntries(Object.keys(all).map(k => [k, false])), role, true))) assert.equal(allowed, false);
  });
}
test('pas de droit export sans document ; préparation vierge possible', () => {
  const permissions = editorPermissions(all, null, false);
  assert.equal(permissions.canEditStructure, true); assert.equal(permissions.canExport, false);
});
test('filler : seules les valeurs sont modifiables, patch mixte refusé', () => {
  assert.equal(canApplyFieldPatch(false, { value: 'filled' }), true);
  for (const patch of [{ x: 0 }, { w: 10 }, { type: 'date' }, { label: 'changed' }, { locked: false }, { style: {} }, { value: 'filled', type: 'text' }]) {
    assert.equal(canApplyFieldPatch(false, patch), false);
    assert.equal(canApplyFieldPatch(true, patch), true);
  }
});
test('filler déverrouillé : aucune poignée et aucune écoute de déplacement même en mode édition', () => {
  const tree = overlay({ canEditStructure: true }); // Defense even if a parent passes a wrong flag.
  assert.equal(nodes(tree).some(n => hasClass(n, 'resize-handle') || hasClass(n, 'field-move-handle')), false);
  tree.props.onMouseDown({ target: { classList: { contains: () => false }, tagName: 'DIV', closest: () => null }, stopPropagation() {} });
});
test('editor peut déplacer et redimensionner un champ', () => {
  const listeners = {};
  global.window = { addEventListener: (name, fn) => { listeners[name] = fn; }, removeEventListener: name => delete listeners[name] };
  const moves = [], sizes = [];
  const tree = overlay({ docRole: 'editor', canEditStructure: true, onMove: (...args) => moves.push(args), onResize: (...args) => sizes.push(args) });
  const event = { target: { classList: { contains: () => false }, tagName: 'DIV', closest: () => null }, stopPropagation() {}, preventDefault() {}, clientX: 0, clientY: 0 };
  tree.props.onMouseDown(event); listeners.mousemove({ clientX: 5, clientY: 6 }); listeners.mouseup();
  assert.deepEqual(moves, [[15, 26]]);
  nodes(tree).find(n => hasClass(n, 'resize-handle')).props.onMouseDown(event);
  listeners.mousemove({ clientX: 5, clientY: 6 }); listeners.mouseup();
  assert.deepEqual(sizes, [[45, 36]]); delete global.window;
});
for (const type of ['checkbox', 'counter-tally', 'counter-numeric']) {
  test(`filler conserve le remplissage ${type}`, () => {
    const values = [];
    const tree = overlay({ field: { ...field, type }, fillMode: true, onValueChange: value => values.push(value) });
    nodes(tree).find(n => hasClass(n, type === 'checkbox' ? 'checkbox-display' : 'counter-display')).props.onClick({ stopPropagation() {} });
    assert.deepEqual(values, [type === 'checkbox' ? 'true' : '1']);
  });
}
test('panneau filler : valeur modifiable ; type, géométrie et actions structurelles absents', () => {
  const changes = [];
  const tree = PropertiesPanel({ field, fields: [field], selectedFieldId: field.id, multiSelectedIds: new Set([field.id]), docRole: 'filler', canEditStructure: false, fillMode: false, onUpdate: (...args) => changes.push(args) });
  const form = nodes(tree).find(n => hasClass(n, 'properties-form-card'));
  assert.equal(nodes(form).some(n => n.type === 'select' || n.type === 'button' || n.props?.type === 'number'), false);
  nodes(form).find(n => n.type === 'input').props.onChange({ target: { checked: true } });
  assert.deepEqual(changes, [[field.id, { value: 'true' }]]);
  assert.equal(nodes(tree).some(n => hasClass(n, 'bulk-actions')), false);
});

test('détection tardive : ni autre document ni retrait du droit ne peuvent modifier la structure', () => {
  assert.equal(canApplyDetection({ sourceFileId: 'A', canEditStructure: true }, 'A'), true);
  assert.equal(canApplyDetection({ sourceFileId: 'B', canEditStructure: true }, 'A'), false);
  assert.equal(canApplyDetection({ sourceFileId: 'A', canEditStructure: false }, 'A'), false);
});
