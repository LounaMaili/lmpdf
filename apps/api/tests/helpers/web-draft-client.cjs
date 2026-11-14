const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

function sourceFile(environment, relative) {
  return process.env[environment] || path.resolve(__dirname, '../../../web/src', relative);
}
function compile(source, context = {}) {
  const exports = {};
  vm.runInNewContext(ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText, { exports, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval, ...context });
  return exports;
}

exports.loadWebDraftClient = function(base, getToken) {
  const url = new URL(base);
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !url.port) throw new Error('Isolated loopback API required');
  const source = fs.readFileSync(sourceFile('DRAFT_WEB_API_PATH', 'api.ts'), 'utf8');
  if (!source.includes('import.meta.env.VITE_API_URL')) throw new Error('Vite API configuration changed');
  // Substitute only the build-time Vite constant. The real web API functions,
  // serialization, HTTP handling and JWT headers execute against the test app.
  return compile(source.replaceAll('import.meta.env.VITE_API_URL', JSON.stringify(base + '/api')), {
    fetch, URLSearchParams, URL, FormData, Blob,
    require(name) {
      if (name === './auth') return { getToken };
      throw new Error('Unexpected web API runtime import');
    },
  });
};
exports.loadTemplateDraftHelper = () => compile(fs.readFileSync(
  sourceFile('TEMPLATE_DRAFT_HELPER_PATH', 'utils/preserveTemplateDraft.ts'), 'utf8'));
exports.loadAutosaveScheduler = () => compile(fs.readFileSync(
  sourceFile('AUTOSAVE_SCHEDULER_PATH', 'hooks/autosaveScheduler.ts'), 'utf8'));
