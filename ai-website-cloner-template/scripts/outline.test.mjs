import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { posix } from "node:path";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const cache = new Map();
function load(path) {
  if (cache.has(path)) return cache.get(path);
  const source = readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {}; cache.set(path, exports);
  vm.runInThisContext(`(function(exports,require){${compiled}\n})`)(exports, name => {
    if (["react", "react/jsx-runtime", "lucide-react"].includes(name)) return require(name);
    if (name.endsWith(".css")) return { __esModule: true, default: {} };
    const base = name.startsWith("@/") ? name.slice(2) : posix.normalize(posix.join(posix.dirname(path), name));
    const target = [`${base}.ts`, `${base}.tsx`].find(candidate => existsSync(new URL(`../src/${candidate}`, import.meta.url)));
    if (target) return load(target);
    throw new Error(`Unexpected dependency ${name}`);
  });
  return exports;
}
const { parseOutline, serializeOutline, nextOutlineNumber } = load("lib/studio/outline.ts");
const { OutlineEditor } = load("components/studio/outline-editor.tsx");
const { ManuscriptEditor, createManuscriptUnit, patchManuscriptUnit } = load("components/studio/manuscript-editor.tsx");

test("manual outline framing preserves multiline values, whitespace and literal structure markers exactly", () => {
  const rough = " \t开头\r\n【Plotloom 大纲 v1】\n粗纲：\n【单元 1 阶段 0】\n【大纲结束】\n    缩进原文\n\n";
  const entries = [{ number: 1, phase: 0, text: "" }, { number: 2, phase: 3, text: "\n\n【单元 7 阶段 1】\n尾部 \t\n" }, { number: 15, phase: 1, text: "孤立回车\r和 emoji 👩🏽‍🚀" }];
  const text = serializeOutline({ rough, entries });
  const result = parseOutline(text);
  assert.deepEqual(result, { rough, entries, structured: true });
  assert.equal(serializeOutline(result), text);
  assert.equal(parseOutline(serializeOutline({ rough: "", entries: [] })).rough, "");
});

test("AI and old outlines are never split heuristically or trimmed; malformed framing has a raw fallback", () => {
  const samples = [" \n", "第一集：她回家。\n第二集：父亲失踪。\n起承转合及未编号附言不能丢。\n", "# 第一章\n故事设定：下雨。\r\n", "【Plotloom 大纲 v1】\n粗纲：\n    原文\n未知字段\n【大纲结束】"];
  for (const value of samples) assert.deepEqual(parseOutline(value), { rough: value, entries: [], structured: false });
  const duplicate = serializeOutline({ rough: "原稿", entries: [{ number: 1, phase: 0, text: "A" }, { number: 1, phase: 3, text: "B" }] });
  assert.equal(parseOutline(duplicate).rough, duplicate);
  const old = samples[1];
  const wrapped = parseOutline(serializeOutline({ rough: old, entries: [{ number: 1, phase: 2, text: "手写新增" }] }));
  assert.equal(wrapped.rough, old);
});

test("exact backend unit lines become cards with no invented plot phases and no source character loss", () => {
  for (const unit of ["集", "章"]) {
    const value = `\t \r\n第1${unit}： 她找到钥匙。\r\n\r\n \t\n第3${unit}：他说：‘第2${unit}：只是对白。’  \n第19${unit}：【大纲结束】\n`;
    const result = parseOutline(value);
    assert.equal(result.structured, true);
    assert.equal(result.source, value);
    assert.deepEqual(result.entries.map(entry => entry.number), [1, 3, 19]);
    assert.ok(result.entries.every(entry => entry.phase === 0));
    assert.equal(result.rough + result.entries.map(entry => entry.text).join(""), value);
    // A first manual edit canonicalizes framing, preserving untouched labels, spacing and separators.
    const changed = { ...result, entries: result.entries.map(entry => entry.number === 3 ? { ...entry, text: entry.text + "手动补充\n" } : entry) };
    const reread = parseOutline(serializeOutline(changed));
    assert.equal(reread.rough, result.rough);
    assert.deepEqual(reread.entries, changed.entries);
    assert.equal(reread.entries[0].text, result.entries[0].text);
    assert.equal(reread.entries[2].text, result.entries[2].text);
  }
});

test("duplicate, unsafe, mixed-mode and ambiguous headings remain wholly raw", () => {
  for (const value of [
    "第1集：甲\n第1集：重复编号",
    "第9007199254740992集：超安全整数",
    "第1集：甲\n第2章：类型不一致",
    "# 第1集：Markdown标题",
    " 第1集：前缀存在缩进",
    "第0集：零编号",
    "第01章：含前导零",
    "第1集: 非约定冒号",
    "第1集：甲\n第02集：不安全的编号",
  ]) assert.deepEqual(parseOutline(value), { rough: value, entries: [], structured: false });
});

test("multiline generated units fill real outline cards without dropping headings, paragraphs or notes", () => {
  for (const unit of ["集", "章"]) {
    const value = `第1${unit}：夹层里的信\r\n\r\n**开场钩子**：父女发现信封。\r\n\r\n第二段继续争执。\r\n\r\n第2${unit}：收件人\n\n**转折**：父亲承认错误。\n附注：此句也要保留。\n`;
    const result = parseOutline(value);
    assert.deepEqual(result.entries.map(entry => entry.number), [1, 2]);
    assert.equal(result.source, value);assert.equal(result.rough + result.entries.map(entry => entry.text).join(""), value);
    assert.ok(result.entries.every(entry => entry.phase === 0));
    assert.deepEqual(parseOutline(serializeOutline(result)).entries, result.entries);
    const html = renderToStaticMarkup(React.createElement(OutlineEditor, { value, type: unit === "集" ? "short_drama" : "novel", units: 2, onChange() { assert.fail("opening must not rewrite"); } }));
    assert.ok(html.includes(`aria-label="第1${unit}${unit}纲"`) && html.includes(`aria-label="第2${unit}${unit}纲"`));
    assert.ok(html.includes("父亲承认错误"));
  }
});

test("opening recognized AI outline is read-only until editing and exposes real unit cards", () => {
  const value = "第1集：她回来。\n第2集：父亲失踪。\n";
  let writes = 0;
  const html = renderToStaticMarkup(React.createElement(OutlineEditor, { value, type: "short_drama", units: 2, onChange() { writes++; } }));
  assert.equal(writes, 0);
  assert.match(html, /aria-label="第1集集纲"/);
  assert.match(html, /aria-label="第2集集纲"/);
  assert.ok(html.includes("她回来。")); assert.ok(html.includes("父亲失踪。"));
});

test("unit creation respects 1..plan and preserves existing/out-of-plan chapters with titles and text", () => {
  const old = [{ number: 1, title: "保留自定标题", content: "旧稿\n" }, { number: 19, title: "旧计划外", content: "完整保留" }];
  const snapshot = JSON.stringify(old);
  assert.equal(nextOutlineNumber(old, 3), 2);
  assert.equal(nextOutlineNumber(old, 0), null);
  assert.equal(nextOutlineNumber(old, 2.1), null);
  assert.equal(nextOutlineNumber(old, 201), null);
  const created = createManuscriptUnit(old, 3, 300, "novel");
  assert.equal(created.number, 2);
  assert.deepEqual(created.chapters.slice(0, 2), old);
  assert.deepEqual(created.chapters[2], { number: 2, title: "第2章", content: "" });
  assert.equal(JSON.stringify(old), snapshot);
  assert.equal(createManuscriptUnit(old, 1, 1, "short_drama"), null);
  assert.equal(createManuscriptUnit([], 0, 1, "novel"), null);
  const direct = createManuscriptUnit(old, 3, 3, "short_drama");
  assert.equal(direct.number, 3);
  assert.equal(direct.chapters[2].title, "第3集");
});

test("editing manuscript content retains selected custom title and every other chapter", () => {
  const chapters = [{ number: 2, title: "夜路", content: "旧稿" }, { number: 12, title: "计划外结局", content: "保留结局" }];
  const edited = patchManuscriptUnit(chapters, 2, { content: "新稿\n\n" });
  assert.equal(edited[0].title, "夜路");
  assert.equal(edited[0].content, "新稿\n\n");
  assert.equal(edited[1], chapters[1]);
  assert.equal(chapters[0].content, "旧稿");
  assert.deepEqual(patchManuscriptUnit(chapters, 1, { title: "不存在" }), chapters);
});

test("outline and manuscript views show both writing modes and keep read navigation enabled while locked", () => {
  const noop = () => {};
  for (const type of ["short_drama", "novel"]) {
    const unit = type === "novel" ? "章" : "集";
    const value = serializeOutline({ rough: "原有总纲", entries: [{ number: 10, phase: 0, text: "计划外也保留" }, { number: 1, phase: 1, text: "原承阶段" }, { number: 2, phase: 2, text: "原转阶段" }, { number: 3, phase: 3, text: "原合阶段" }] });
    const outline = renderToStaticMarkup(React.createElement(OutlineEditor, { value, type, units: 3, disabled: true, onChange: noop }));
    assert.ok(outline.includes(`第10${unit}`));
    assert.match(outline, /计划外也保留/);
    for (const text of ["原承阶段", "原转阶段", "原合阶段"]) assert.ok(outline.includes(text));
    assert.doesNotMatch(outline, /aria-label="起承转合"/);
    assert.match(outline, /切换全文编辑/);
    assert.ok([...outline.matchAll(/<button[^>]*aria-pressed="(?:true|false)"[^>]*>/g)].every(([button]) => !button.includes("disabled")));
    const empty = renderToStaticMarkup(React.createElement(ManuscriptEditor, { type, chapters: [], units: 3, number: 1, onNumber: noop, onChange: noop }));
    assert.ok(empty.includes(`创建新${unit}`));
    const manuscript = renderToStaticMarkup(React.createElement(ManuscriptEditor, { type, chapters: [{ number: 10, title: "旧标题", content: "旧正文" }], units: 3, number: 10, disabled: true, onNumber: noop, onChange: noop, onGenerate: noop }));
    assert.match(manuscript, /旧标题/); assert.match(manuscript, /旧正文/);
    assert.match(manuscript, /超出当前计划/);
    assert.match(manuscript, /maxLength="80"/);
    assert.ok([...manuscript.matchAll(/<button[^>]*aria-pressed="(?:true|false)"[^>]*>/g)].every(([button]) => !button.includes("disabled")));
    for (const html of [outline, manuscript, empty]) assert.ok([...html.matchAll(/<button\b[^>]*>/g)].every(([button]) => button.includes('type="button"')));
  }
});
