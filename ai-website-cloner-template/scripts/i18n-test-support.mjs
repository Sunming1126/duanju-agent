import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
const require = createRequire(import.meta.url), ts = require('typescript');
const cache = new Map();
export function loadI18n(name) {
  if (cache.has(name)) return cache.get(name);
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(`../src/lib/i18n/${name}.ts`, import.meta.url),'utf8'), {compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
  vm.runInThisContext(`(function(exports,require){${code}\n})`)(exports, specifier => specifier === './messages.json' ? require('../src/lib/i18n/messages.json') : loadI18n(specifier.replace('./','')));
  cache.set(name,exports);return exports;
}
// Existing interaction harnesses intentionally call components without a React
// dispatcher. Their original Chinese behavior remains isolated from locale tests.
export function legacyI18nDependency(name) {
  if(name === '@/lib/i18n/provider') return {useUI:()=>value=>value,usePreferences:()=>({locale:'zh-CN',market:'china'})};
  if(name.startsWith('@/lib/i18n/')) return loadI18n(name.slice('@/lib/i18n/'.length));
  if(name === '@/components/studio/language-settings') return {LanguageSettings:()=>null,LanguageSwitcher:()=>null};
}
