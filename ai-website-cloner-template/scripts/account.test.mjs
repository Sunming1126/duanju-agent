import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { posix } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

const require = createRequire(import.meta.url), ts = require('typescript'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const user = { id: 'author', name: '作者', email: 'author@example.com', avatar_url: null };
const space = { space_id: 'private-space', isolated: true, user };

function loader({ hooks = React, api = {} } = {}) {
  const cache = new Map();
  function load(path) {
    if (cache.has(path)) return cache.get(path);
    const exports = {}; cache.set(path, exports);
    const code = ts.transpileModule(readFileSync(new URL(`../src/${path}`, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
    vm.runInThisContext(`(function(exports,require){${code}\n})`)(exports, name => {
      if (name === 'react') return hooks;
      if (['react/jsx-runtime', 'lucide-react'].includes(name)) return require(name);
      if (name.endsWith('.css')) return { __esModule: true, default: new Proxy({}, { get: (_, key) => String(key) }) };
      if (name === 'next/script') return { __esModule: true, default: () => null };
      if (name === 'next/link') return { __esModule: true, default: ({ children, ...props }) => { delete props.prefetch; return React.createElement('a', props, children); }, useLinkStatus: () => ({ pending: false }) };
      if (name === '@/components/sites/storyplay/shared') return { Header: () => null, Modal: ({ children }) => React.createElement('dialog', null, children) };
      if (name === '@/lib/studio/api') return { jsonBody: JSON.stringify, ...api };
      const base = name.startsWith('@/') ? name.slice(2) : posix.normalize(posix.join(posix.dirname(path), name));
      const target = [`${base}.ts`, `${base}.tsx`].find(value => existsSync(new URL(`../src/${value}`, import.meta.url)));
      if (target) return load(target);
      throw new Error(name);
    });
    return exports;
  }
  return load;
}

function harness(api = {}) {
  const slots = []; let cursor = 0;
  const hooks = { ...React, useEffect() {}, useState(initial) {
    const key = cursor++;
    if (!(key in slots)) slots[key] = typeof initial === 'function' ? initial() : initial;
    return [slots[key], next => { slots[key] = typeof next === 'function' ? next(slots[key]) : next; }];
  }, useRef(initial) { const key = cursor++; return slots[key] ||= { current: initial }; } };
  const load = loader({ hooks, api });
  return { load, render(component, props) { cursor = 0; return component(props); } };
}
function nodes(tree) {
  if (!tree || typeof tree !== 'object') return [];
  return [tree, ...React.Children.toArray(tree.props?.children).flatMap(nodes)];
}
function text(tree) {
  if (typeof tree === 'string' || typeof tree === 'number') return String(tree);
  return React.Children.toArray(tree?.props?.children).map(text).join('');
}
const button = (tree, label) => nodes(tree).find(node => node.type === 'button' && text(node).includes(label));

test('account settings is a full page with authenticated profile controls, real data links and unavailable membership', () => {
  const { AccountSettings } = loader()('components/studio/account-page.tsx');
  const html = renderToStaticMarkup(React.createElement(AccountSettings, { space, onUserChanged() {} }));
  assert.doesNotMatch(html, /<dialog|role="dialog"/);
  for (const label of ['个人资料', '账号资料', '账号与空间', '数据与备份', '会员与积分', '积分余额', '即将开放', '创作服务', '退出登录', '更换头像', '编辑昵称']) assert.ok(html.includes(label), label);
  assert.match(html, /href="\/workspace"/); assert.match(html, /href="\/worlds"/);
  assert.match(html, /disabled="">会员权益/); assert.match(html, /disabled="">积分明细/);
  assert.doesNotMatch(html, /充值|购买|积分余额<\/dt><dd>0/);
  assert.ok(html.includes('正在读取服务信息')); assert.doesNotMatch(html, /3 个请求|5 个请求/);
});

test('guest sees inline email and Google login without profile editing or logout', () => {
  const { AccountSettings } = loader()('components/studio/account-page.tsx');
  const html = renderToStaticMarkup(React.createElement(AccountSettings, { space: { ...space, user: null }, onUserChanged() {} }));
  assert.match(html, /id="login-email"/); assert.match(html, /id="login-code"/); assert.match(html, /Google 登录/);
  assert.doesNotMatch(html, /<dialog|退出登录|更换头像|编辑昵称/);
  assert.ok(html.includes('访客作品不会自动合并'));
});

test('sidebar uses a selected account link and header hides login for authenticated or pending identity', () => {
  const load = loader();
  const { StudioNav } = load('components/studio/navigation.tsx');
  const html = renderToStaticMarkup(React.createElement(StudioNav, { selected: '我的空间' }));
  assert.match(html, /href="\/account"[^>]*aria-current="page"/);
  assert.doesNotMatch(html, /<button[^>]*class="sidebar-link/);
  for (const value of [undefined, space]) {
    let key = 0;
    const hooks = { ...React, useEffect() {}, useState() { return [[value, false, false][key++], () => {}]; } };
    const { AccountMenu } = loader({ hooks })('components/studio/account-menu.tsx');
    assert.equal(AccountMenu(), null);
  }
  // The first hook value is provided by a resolved guest session.
  let count = 0;
  const hooks = { ...React, useEffect() {}, useState() { return [[{ ...space, user: null }, false, false][count++], () => {}]; } };
  const menu = loader({ hooks })('components/studio/account-menu.tsx').AccountMenu();
  assert.equal(button(menu, '登录').props['aria-label'], '登录');
});

test('nickname save sends one request, updates identity and locks duplicates; errors keep the draft', async () => {
  let resolve; const gate = new Promise(done => { resolve = done; });
  const calls = [], updates = [];
  let fail = false;
  const h = harness({ backendRequest: async (path, init) => {
    calls.push({ path, init }); if (fail) throw new Error('保存未确认'); await gate;
    return { user: { ...user, name: '新笔名' } };
  } });
  const { AccountSettings } = h.load('components/studio/account-page.tsx');
  const props = { space, onUserChanged: async value => updates.push(value) };
  let tree = h.render(AccountSettings, props);
  nodes(tree).find(node => node.type === 'button' && text(node).includes('编辑昵称')).props.onClick();
  tree = h.render(AccountSettings, props);
  nodes(tree).find(node => node.props?.id === 'profile-name').props.onChange({ target: { value: '新笔名' } });
  tree = h.render(AccountSettings, props);
  const form = nodes(tree).find(node => node.type === 'form' && nodes(node).some(child => child.props?.id === 'profile-name'));
  const first = form.props.onSubmit({ preventDefault() {} });
  const duplicate = form.props.onSubmit({ preventDefault() {} });
  assert.equal(calls.length, 1); resolve(); await Promise.all([first, duplicate]);
  assert.equal(calls[0].path, '/studio/auth/profile');
  assert.deepEqual(JSON.parse(calls[0].init.body), { name: '新笔名' }); assert.equal(updates.length, 1);
  tree = h.render(AccountSettings, props); assert.ok(!nodes(tree).some(node => node.props?.id === 'profile-name'));
  button(tree, '编辑昵称').props.onClick(); tree = h.render(AccountSettings, props);
  nodes(tree).find(node => node.props?.id === 'profile-name').props.onChange({ target: { value: '失败时保留' } });
  fail = true; tree = h.render(AccountSettings, props);
  await nodes(tree).find(node => node.type === 'form' && nodes(node).some(child => child.props?.id === 'profile-name')).props.onSubmit({ preventDefault() {} });
  tree = h.render(AccountSettings, props);
  assert.equal(nodes(tree).find(node => node.props?.id === 'profile-name').props.value, '失败时保留');
  assert.ok(nodes(tree).some(node => text(node).includes('保存未确认'))); assert.equal(calls.length, 2);
});

test('avatar selection requires confirmation, sends binary once, and removal updates user', async () => {
  const calls = [], updates = [];
  const h = harness({ backendRequest: async (path, init) => { calls.push({ path, init }); return { user: { ...user, avatar_url: init.method === 'DELETE' ? null : '/private-avatar' } }; } });
  const { AccountSettings } = h.load('components/studio/account-page.tsx');
  const props = { space: { ...space, user: { ...user, avatar_url: '/old-avatar' } }, onUserChanged: async value => updates.push(value) };
  let tree = h.render(AccountSettings, props);
  const image = new File(['test-image'], 'avatar.png', { type: 'image/png' });
  nodes(tree).find(node => node.props?.type === 'file').props.onChange({ target: { files: [image] } });
  assert.equal(calls.length, 0);
  tree = h.render(AccountSettings, props); await button(tree, '保存头像').props.onClick();
  assert.equal(calls[0].path, '/studio/auth/profile/avatar'); assert.equal(calls[0].init.body, image); assert.equal(calls[0].init.method, 'PUT');
  tree = h.render(AccountSettings, props); await button(tree, '恢复默认头像').props.onClick();
  assert.equal(calls[1].init.method, 'DELETE'); assert.equal(updates[1].avatar_url, null);
});

test('logout uses the existing endpoint and reloads only after success', async () => {
  const original = globalThis.window;
  const calls = []; let reloads = 0, fail = true;
  globalThis.window = { location: { reload() { reloads++; } } };
  try {
    const h = harness({ backendRequest: async path => { calls.push(path); if (fail) throw new Error('暂时无法退出'); } });
    const { AccountSettings } = h.load('components/studio/account-page.tsx');
    const props = { space, onUserChanged: async () => {} };
    await button(h.render(AccountSettings, props), '退出登录').props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reloads, 0); assert.ok(nodes(h.render(AccountSettings, props)).some(node => text(node).includes('暂时无法退出')));
    fail = false;
    await button(h.render(AccountSettings, props), '退出登录').props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(reloads, 1); assert.deepEqual(calls, ['/studio/auth/logout', '/studio/auth/logout']);
  } finally { globalThis.window = original; }
});

test('legacy recovery retains failed input and clears it after a successful explicit retry', async () => {
  const calls = []; let fail = true;
  const h = harness({ backendRequest: async (path, init) => { calls.push({ path, init }); if (fail) throw new Error('恢复码无效'); } });
  const { AccountSettings } = h.load('components/studio/account-page.tsx');
  const props = { space, onUserChanged: async () => {} };
  let tree = h.render(AccountSettings, props);
  nodes(tree).find(node => node.props?.id === 'legacy-recovery-code').props.onChange({ target: { value: 'x'.repeat(30) } });
  const form = value => nodes(value).find(node => node.type === 'form' && nodes(node).some(child => child.props?.id === 'legacy-recovery-code'));
  await form(h.render(AccountSettings, props)).props.onSubmit({ preventDefault() {} });
  tree = h.render(AccountSettings, props);
  assert.equal(nodes(tree).find(node => node.props?.id === 'legacy-recovery-code').props.value, 'x'.repeat(30)); assert.equal(calls.length, 1);
  fail = false; await form(tree).props.onSubmit({ preventDefault() {} });
  assert.equal(nodes(h.render(AccountSettings, props)).find(node => node.props?.id === 'legacy-recovery-code').props.value, '');
  assert.equal(calls[0].path, '/studio/session/claim-legacy'); assert.deepEqual(JSON.parse(calls[0].init.body), { code: 'x'.repeat(30) });
});
