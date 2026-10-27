import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
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
  const exports = {};
  cache.set(path, exports);
  vm.runInThisContext(`(function(exports,require){${compiled}\n})`)(exports, name => {
    if (["react", "react/jsx-runtime", "lucide-react"].includes(name)) return require(name);
    if (name.endsWith(".module.css")) return { __esModule: true, default: {} };
    const modules = { "@/lib/studio/api": "lib/studio/api.ts", "./api": "lib/studio/api.ts", "@/lib/studio/inspiration": "lib/studio/inspiration.ts", "@/lib/studio/writing": "lib/studio/writing.ts", "./writing": "lib/studio/writing.ts", "./writing-options": "components/studio/writing-options.tsx", "@/lib/studio/workflow": "lib/studio/workflow.ts", "@/lib/studio/creation": "lib/studio/creation.ts", "@/lib/studio/characters": "lib/studio/characters.ts", "./workflow-nav": "components/studio/workflow-nav.tsx", "./character-editor": "components/studio/character-editor.tsx" };
    if (name === "./inspiration") return { Inspiration: () => null };
    if (modules[name]) return load(modules[name]);
    throw new Error(`Unexpected dependency ${name}`);
  });
  return exports;
}
const writing = load("lib/studio/writing.ts");
const helpers = load("lib/studio/inspiration.ts");
const api = load("lib/studio/api.ts");
const { WorkForm } = load("components/studio/work-form.tsx");

for (const kind of ["novel", "short_drama"]) {
  test(`${kind}: route form has no content-type selector and shows only its own writing settings`, () => {
    const html = renderToStaticMarkup(React.createElement(WorkForm, { kind, mode: kind === "novel" ? "新建剧本" : "剧本创作", worlds: [], onCreated: () => {}, onClose: () => {} }));
    const wordInput = html.match(/<input(?=[^>]*name="words")[^>]*>/)?.[0] || "";
    assert.doesNotMatch(html, /name="content_type"|创作类型/);
    if (kind === "novel") {
      assert.match(html, /小说叙事设置/); assert.match(html, /叙事视角/); assert.match(html, /小说主分类/);
      assert.match(wordInput, /max="6000"/); assert.match(wordInput, /value="2000"/);
      assert.doesNotMatch(html, /单集目标时长|画幅形式|集尾钩子/);
    } else {
      assert.match(html, /短剧拍摄与节奏/); assert.match(html, /单集目标时长/); assert.match(html, /场景密度/);
      assert.match(wordInput, /max="3000"/); assert.match(wordInput, /value="800"/);
      assert.doesNotMatch(html, /叙事视角|叙事文风/);
    }
  });
}

test("entry type overrides old mode labels and rejects a cached draft from the other entry", () => {
  assert.equal(writing.creationMode("novel", "新建剧本"), "小说创作");
  assert.equal(writing.creationMode("novel", "剧本改写"), "小说创作");
  assert.equal(writing.creationMode("short_drama", "小说创作"), "剧本创作");
  assert.ok(writing.creationDraftKeys("short_drama", "剧本创作").includes("plotloom-new-short_drama-新建剧本-original"));
  assert.ok(writing.creationDraftKeys("novel", "灵感创作").includes("plotloom-new-novel-灵感策划-original"));
  const draft = helpers.initialCreationDraft("short_drama"); draft.title = "旧草稿";
  assert.throws(() => helpers.creationPayload(draft, "小说创作", false, undefined, "novel"), /入口不一致/);
});

test("writing parameters survive save and export payloads and remain isolated by type", () => {
  const novel = helpers.initialCreationDraft("novel"); novel.title = "第一人称小说";
  novel.novel_settings.perspective = "first_person";
  novel.novel_settings.pacing = "slow_burn";
  const payload = helpers.creationPayload(novel, "新建剧本", false, undefined, "novel");
  const work = { ...payload, id: "work-1", revision: 1, created_at: 1, updated_at: 1 };
  const saved = api.workPayload(work);
  assert.equal(saved.mode, "小说创作");
  assert.equal(saved.novel_settings.perspective, "first_person");
  assert.equal(saved.novel_settings.pacing, "slow_burn");
  assert.equal(saved.drama_settings, null);
  const drama = helpers.initialCreationDraft("short_drama"); drama.title = "横屏短剧"; drama.drama_settings.format = "horizontal_short";
  assert.equal(helpers.creationPayload(drama, "剧本创作", false).drama_settings.format, "horizontal_short");
  assert.equal(helpers.creationPayload(drama, "剧本创作", false).novel_settings, null);
});

test("novel chapter and short-drama script length budgets differ", () => {
  const novel = helpers.initialCreationDraft("novel"); novel.title = "长章"; novel.words = "5000";
  assert.equal(helpers.creationPayload(novel, "小说创作", false).words_per_chapter, 5000);
  const drama = helpers.initialCreationDraft("short_drama"); drama.title = "短剧"; drama.words = "5000";
  assert.throws(() => helpers.creationPayload(drama, "剧本创作", false), /3000/);
});
