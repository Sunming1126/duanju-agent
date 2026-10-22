/** Non-browser UI checks. Run: node tools/check_frontend.mjs. No server or API calls. */
import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
// Read the real HTML with the standard library, rather than maintaining a second UI fixture.
const parsed = spawnSync('python3', ['-c', `
from html.parser import HTMLParser
import json,sys
class Tree(HTMLParser):
 def __init__(self):
  super().__init__(); self.root={'tag':'document','attrs':{},'children':[]}; self.stack=[self.root]
 def handle_starttag(self,tag,attrs):
  n={'tag':tag,'attrs':dict(attrs),'children':[]}; self.stack[-1]['children'].append(n)
  if tag not in {'area','base','br','col','embed','hr','img','input','link','meta','param','source','track','wbr'}: self.stack.append(n)
 def handle_startendtag(self,tag,attrs): self.handle_starttag(tag,attrs); self.handle_endtag(tag)
 def handle_endtag(self,tag):
  for i in range(len(self.stack)-1,0,-1):
   if self.stack[i]['tag']==tag: self.stack=self.stack[:i]; break
 def handle_data(self,text): self.stack[-1].setdefault('text',''); self.stack[-1]['text']+=text
p=Tree(); p.feed(sys.stdin.read()); print(json.dumps(p.root))
`], { input: read('static/index.html'), encoding: 'utf8' });
assert.equal(parsed.status, 0, parsed.stderr);
const tree = JSON.parse(parsed.stdout);
class Element {
  constructor(node, document, parent = null) {
    this.tagName = node.tag.toUpperCase(); this.attrs = { ...node.attrs }; this.ownerDocument = document; this.parentElement = parent;
    this.children = (node.children || []).map((child) => new Element(child, document, this));
    this.value = this.attrs.value || ''; this._text = node.text || ''; this.events = {}; this.open = false; this.style = {};
    this.dataset = new Proxy({}, { get: (_, key) => this.attrs['data-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())], set: (_, key, value) => { this.attrs['data-' + key.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())] = String(value); return true; } });
    const classes = () => new Set((this.attrs.class || '').split(/\s+/).filter(Boolean));
    this.classList = { contains: (c) => classes().has(c), toggle: (c, value) => { const set = classes(), on = value ?? !set.has(c); on ? set.add(c) : set.delete(c); this.attrs.class = [...set].join(' '); return on; }, add: (...names) => { const set = classes(); names.forEach((n) => set.add(n)); this.attrs.class = [...set].join(' '); }, remove: (...names) => { const set = classes(); names.forEach((n) => set.delete(n)); this.attrs.class = [...set].join(' '); } };
  }
  get id() { return this.attrs.id; }
  get isConnected() { return true; }
  get hidden() { return 'hidden' in this.attrs; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.children = []; }
  setAttribute(key, value) { this.attrs[key] = String(value); }
  getAttribute(key) { return this.attrs[key] ?? null; }
  removeAttribute(key) { delete this.attrs[key]; }
  matches(selector) {
    const parts = selector.trim().split(/\s+/);
    if (parts.length > 1) {
      if (!this.matches(parts.pop())) return false;
      let parent = this.parentElement;
      while (parts.length) {
        const expected = parts.pop();
        while (parent && !parent.matches(expected)) parent = parent.parentElement;
        if (!parent) return false;
        parent = parent.parentElement;
      }
      return true;
    }
    if (selector.includes(':not(:disabled)') && 'disabled' in this.attrs) return false;
    selector = selector.replace(':not(:disabled)', '');
    const attrs = [...selector.matchAll(/\[([^=\]]+)(?:=["']?([^"'\]]*)["']?)?\]/g)];
    if (!attrs.every(([, key, val]) => key in this.attrs && (val === undefined || this.attrs[key] === val))) return false;
    selector = selector.replace(/\[[^\]]+\]/g, '');
    const tag = selector.match(/^[a-z]+/i)?.[0];
    if (tag && tag.toUpperCase() !== this.tagName) return false;
    const id = selector.match(/#([\w-]+)/)?.[1];
    if (id && this.id !== id) return false;
    return [...selector.matchAll(/\.([\w-]+)/g)].every(([, name]) => this.classList.contains(name));
  }
  closest(selector) { for (let el = this; el; el = el.parentElement) if (el.matches(selector)) return el; return null; }
  querySelectorAll(selector) { const result = []; const walk = (el) => { for (const child of el.children) { if (selector.split(',').some((s) => child.matches(s.trim()))) result.push(child); walk(child); } }; walk(this); return result; }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  addEventListener(type, callback) { (this.events[type] ||= []).push(callback); }
  dispatchEvent(event) { event.target ||= this; for (const callback of this.events[event.type] || []) callback(event); return true; }
  click() { this.dispatchEvent({ type: 'click', target: this }); }
  focus() { this.ownerDocument.activeElement = this; this.ownerDocument.dispatchEvent({ type: 'focusin', target: this }); }
  getClientRects() { return this.closest('.hidden') ? [] : [{}]; }
}
function boot({ market = 'japan', entries = {}, blocked = false } = {}) {
  const document = new Element(tree, null); document.ownerDocument = document;
  const assignDocument = (el) => { el.ownerDocument = document; el.children.forEach(assignDocument); }; assignDocument(document);
  document.getElementById = (id) => document.querySelector('#' + id);
  document.body = document.querySelector('body'); document.documentElement = document.querySelector('html'); document.activeElement = document.body;
  const storage = new Map(Object.entries(entries)); const events = {}; const calls = {};
  const context = { document, location: { hostname: market === 'china' ? 'jubencn.onesay.top' : 'juben.onesay.top', pathname: '/' }, localStorage: { getItem(key) { if (blocked) throw Error('Storage blocked'); return storage.get(key) ?? null; }, setItem(key, value) { if (blocked) throw Error('Storage blocked'); storage.set(key, String(value)); } }, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } }, console };
  context.window = context;
  context.addEventListener = (type, cb) => (events[type] ||= []).push(cb);
  context.emit = (type, event) => (events[type] || []).forEach((cb) => cb(event));
  vm.createContext(context);
  const i18n = read('static/i18n.js').replace('  function cur() {', '  window.__dictionary = Object.fromEntries(Object.entries(dict).map(([lang, values]) => [lang, { ...values, ...(window.SITE_MARKET === \"japan\" ? japanMarketCopy[lang] : {}) }]));\n  function cur() {');
  vm.runInContext(i18n, context);
  context.$ = (s) => document.querySelector(s); context.$$ = (s) => document.querySelectorAll(s); context.initInspire = () => {};
  for (const module of ['Hub', 'Graph', 'Hooks', 'Cats', 'Writer']) context[module + 'View'] = { activate() { calls[module] = (calls[module] || 0) + 1; }, onShown() { calls.GraphShown = (calls.GraphShown || 0) + 1; } };
  const app = read('static/app.js');
  vm.runInContext(app.slice(app.indexOf('const inited ='), app.indexOf('/* ---------- 节点渲染')), context);
  vm.runInContext(read('static/shell.js'), context);
  return { context, document, storage, calls, el: (id) => document.getElementById(id) };
}
const app = boot(); const { context: w, document: d, el } = app;
const visibleView = () => ['studio','writer','hub','graph','inspire','hooks','cats'].filter((v) => !el('view-' + v).classList.contains('hidden'));
assert.deepEqual(visibleView(), ['studio']);
const dictionary = w.__dictionary;
const labels = new Set(d.querySelectorAll('[data-i18n],[data-i18n-placeholder],[data-i18n-title],[data-i18n-aria-label]').flatMap((node) => ['data-i18n','data-i18n-placeholder','data-i18n-title','data-i18n-aria-label'].map((key) => node.getAttribute(key)).filter(Boolean)));
for (const locale of ['zh','en','ja']) for (const key of labels) assert.equal(typeof dictionary[locale][key], 'string', `${locale}: ${key}`);
const ids = d.querySelectorAll('[id]').map((node) => node.id); assert.equal(new Set(ids).size, ids.length, 'Duplicate IDs');
// Switching and leaving creation must retain both input trees and initialize a flow once.
const quick = el('idea'), staged = el('wIdea'); quick.value = 'My quick draft'; staged.value = 'My staged draft';
d.querySelector('[data-mode="writer"]').click(); assert.deepEqual(visibleView(), ['writer']);
w.switchView('hub'); assert.deepEqual(visibleView(), ['hub']);
d.querySelector('#mainnav').querySelector('[data-view="studio"]').click(); assert.deepEqual(visibleView(), ['writer']);
d.querySelector('[data-mode="studio"]').click(); d.querySelector('[data-mode="writer"]').click();
assert.equal(app.calls.Writer, 1); assert.equal(el('idea'), quick); assert.equal(el('wIdea'), staged); assert.equal(quick.value, 'My quick draft'); assert.equal(staged.value, 'My staged draft');
for (const view of ['hub','inspire','graph','hooks','cats','studio']) { w.switchView(view); assert.deepEqual(visibleView(), [view]); }
w.switchView('graph'); assert.equal(app.calls.Graph, 1); assert.equal(app.calls.GraphShown, 1); assert(el('btnContext').classList.contains('hidden'));
// Sheets open only for the active view, support Escape, and restore focus.
w.switchView('studio'); el('btnContext').click(); assert(!el('studioReference').classList.contains('hidden')); assert.equal(el('btnContext').getAttribute('aria-expanded'), 'true');
d.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} }); assert(el('studioReference').classList.contains('hidden')); assert.equal(d.activeElement, el('btnContext'));
w.WorkspaceUI.openDrawer('resourceImport'); assert(el('resourceImport').classList.contains('hidden'));
// Native pointer order: dismiss the sheet before click, while preserving the target action.
const pointerClick = (target) => {
  let cancelled = false;
  d.dispatchEvent({type:'pointerdown', target, preventDefault(){cancelled=true;}});
  assert.equal(cancelled, false, 'Outside controls must keep their native click');
  target.click();
  d.dispatchEvent({type:'click', target});
};
w.switchView('studio');
pointerClick(el('btnContext')); assert(!el('studioReference').classList.contains('hidden'));
pointerClick(el('btnContext')); assert(el('studioReference').classList.contains('hidden'), 'Context button toggles closed in one click');
pointerClick(el('btnContext'));
pointerClick(el('mainnav').querySelector('[data-view="hub"]'));
assert.deepEqual(visibleView(), ['hub'], 'One click navigates directly out of an open sheet');
assert(el('studioReference').classList.contains('hidden'));
w.switchView('studio'); pointerClick(el('btnContext'));
let actions = 0;
el('btnRandom').addEventListener('click', () => actions++);
pointerClick(el('btnRandom'));
assert.equal(actions, 1, 'Outside action executes exactly once');
assert(el('studioReference').classList.contains('hidden'));
pointerClick(el('btnContext'));
d.dispatchEvent({type:'pointerdown', target:el('studioReference')});
assert(!el('studioReference').classList.contains('hidden'), 'Clicks inside a sheet keep it open');
pointerClick(el('btnBackground'));
assert(el('studioReference').classList.contains('hidden'));
assert(!el('backgroundPopover').classList.contains('hidden'), 'Background opens on the first click from a sheet');
pointerClick(d.querySelector('[data-background="dune"].background-option'));
assert.equal(d.body.dataset.background, 'dune');
w.WorkspaceUI.closeDrawer(); pointerClick(el('closeBackground'));
w.switchView('hub');
pointerClick(el('btnContext')); assert(!el('resourceImport').classList.contains('hidden'));
pointerClick(el('btnContext')); assert(el('resourceImport').classList.contains('hidden'), 'Library import panel toggles on a single click');
w.switchView('studio');
// All presets apply everywhere, persist per site and restore after a simulated reload.
for (const value of ['cloud','dune','plain','water']) { d.querySelector(`[data-background="${value}"].background-option`).click(); assert.equal(d.body.dataset.background, value); assert.equal(app.storage.get('duanju.background.japan'), value); }
const saved = boot({ entries: { 'duanju.background.japan': 'cloud' } }); assert.equal(saved.document.body.dataset.background, 'cloud');
assert.equal(boot({ entries: { 'duanju.background.japan': 'invalid' } }).document.body.dataset.background, 'water');
assert.equal(boot({ market: 'china', entries: { 'duanju.background.japan': 'dune' } }).document.body.dataset.background, 'water');
const unavailable = boot({ blocked: true }); unavailable.document.querySelector('[data-background="dune"].background-option').click(); assert.equal(unavailable.document.body.dataset.background, 'dune');
w.emit('storage', { key: 'duanju.background.japan', newValue: 'cloud' }); assert.equal(d.body.dataset.background, 'cloud');
for (const locale of ['en','zh-CN','ja-JP']) { w.setDuanjuLocale(locale); assert.equal(d.documentElement.lang, locale); assert.notEqual(el('pageTitle').textContent, 'navCreate'); assert.equal(d.body.dataset.background, 'cloud'); assert.equal(quick.value, 'My quick draft'); }
console.log(`PASS: ${labels.size} interface keys in 3 languages; unique controls; navigation and draft retention; one-time initialization; sheets and Escape; one-click sheet toggles, outside navigation/actions and background selection; 4 background presets; reload, site isolation, storage failures and locale switching.`);
export { boot, read };
