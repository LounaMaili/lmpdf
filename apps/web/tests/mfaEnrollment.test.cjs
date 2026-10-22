const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function component(file, states, modules) {
  let position = 0;
  const jsx = (type, props) => ({ type, props });
  const react = { useState: initial => [position < states.length ? states[position++] : initial, () => {}],
    useEffect: () => {}, lazy: loader => ({ lazy: loader.toString() }), Suspense: 'Suspense' };
  const source = ts.transpileModule(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2021 },
  }).outputText;
  const exports = {};
  vm.runInNewContext(source, { exports, require(name) {
    if (name === 'react') return react;
    if (name === 'react/jsx-runtime') return { jsx, jsxs: jsx, Fragment: 'Fragment' };
    if (name.endsWith('/i18n')) return { useTranslation: () => ({ t: key => key }) };
    if (name in modules) return modules[name];
    throw new Error(`Unmocked dependency: ${name}`);
  } });
  return exports.default;
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...[].concat(tree.props?.children ?? []).flatMap(nodes)];
}

test('mandatory enrollment renders no editor or administration', () => {
  const AppShell = component('AppShell.tsx', [{ id: 'pending-admin', role: 'admin', mfaSetupRequired: true }, false, false, false], {
    './App': { default: 'EDITOR' }, './components/LoginPage': { default: 'LOGIN' }, './auth': {},
  });
  const rendered = nodes(AppShell());
  assert.equal(rendered.some(node => node.type === 'EDITOR'), false);
  assert.equal(rendered.some(node => node.type?.lazy?.includes('MfaEnrollmentPage')), true);
});
test('ordinary authenticated session still renders the editor', () => {
  const AppShell = component('AppShell.tsx', [{ id: 'authenticated', role: 'editor' }, false, false, false], {
    './App': { default: 'EDITOR' }, './components/LoginPage': { default: 'LOGIN' }, './auth': {},
  });
  assert.equal(nodes(AppShell()).some(node => node.type === 'EDITOR'), true);
});
for (const mode of ['login', 'register']) {
  test(`${mode}: enrollment response stores the restricted token and pending user`, async () => {
    const result = { mfaSetupRequired: true, mfaEnrollmentToken: 'synthetic-enrollment',
      user: { id: 'pending', role: 'admin' } };
    let stored, connected;
    const LoginPage = component('components/LoginPage.tsx', [mode, 'test@synthetic.invalid', 'synthetic-password', 'Synthetic', '', false], {
      '../auth': { login: async () => result, register: async () => result, setAuth: (token, user) => { stored = { token, user }; } },
      '@simplewebauthn/browser': {},
    });
    const form = nodes(LoginPage({ onLogin: user => { connected = user; } })).find(node => node.type === 'form');
    await form.props.onSubmit({ preventDefault() {} });
    assert.equal(stored.token, 'synthetic-enrollment');
    assert.equal(stored.user.mfaSetupRequired, true); assert.equal(connected.mfaSetupRequired, true);
  });
}
