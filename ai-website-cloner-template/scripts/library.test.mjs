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
    if (name === "next/link") return { __esModule: true, default: props => { const attributes = { ...props }; delete attributes.prefetch; return React.createElement("a", attributes); }, useLinkStatus: () => ({ pending: false }) };
    if (name === "next/dynamic") return { __esModule: true, default: () => () => null };
    const modules = {
      "./api": "lib/studio/api.ts", "@/lib/studio/api": "lib/studio/api.ts", "@/lib/studio/library": "lib/studio/library.ts", "@/lib/studio/legacy": "lib/studio/legacy.ts",
      "@/components/sites/storyplay/shared": "components/sites/storyplay/shared.tsx", "./navigation": "components/studio/navigation.tsx",
    };
    if (modules[name]) return load(modules[name]);
    throw new Error(`Unexpected initial library dependency: ${name}`);
  });
  return exports;
}
const library = load("lib/studio/library.ts");
const { WorksLibrary } = load("components/studio/works-library.tsx");
const works = [
  { id: "n", title: "Novel Letter", content_type: "novel", genre: "悬疑", archived: false, units: 12, completed_units: 3, revision: 2, updated_at: 3000, created_at: 1000 },
  { id: "s", title: "Archived Script", content_type: "short_drama", genre: "都市", archived: true, units: 8, completed_units: 2, revision: 1, updated_at: 2000, created_at: 2000 },
];

test("all works includes both archived and active records; combined search, type and status filters work", () => {
  assert.deepEqual(library.visibleWorks(works, "", "", "all", "updated").map(work => work.id), ["n", "s"]);
  assert.deepEqual(library.visibleWorks(works, "  SCRIPT ", "short_drama", "archived", "updated").map(work => work.id), ["s"]);
  assert.deepEqual(library.visibleWorks(works, "Letter", "novel", "archived", "updated"), []);
  assert.deepEqual(library.visibleWorks(works, "", "", "active", "updated").map(work => work.id), ["n"]);
});

test("sorting changes the visible order without mutating the stored list", () => {
  const before = JSON.stringify(works);
  assert.deepEqual(library.visibleWorks(works, "", "", "all", "created").map(work => work.id), ["s", "n"]);
  assert.deepEqual(library.visibleWorks(works, "", "", "all", "title").map(work => work.id), ["s", "n"]);
  assert.equal(JSON.stringify(works), before);
});

test("library renders archived and active cards together, per-work delete actions and no duplicate creation links", () => {
  library.rememberLibrary(works);
  const html = renderToStaticMarkup(React.createElement(WorksLibrary));
  assert.match(html, /Novel Letter/);
  assert.match(html, /Archived Script/);
  assert.match(html, /已归档/);
  assert.match(html, /aria-label="删除《Novel Letter》"/);
  assert.match(html, /aria-label="删除《Archived Script》"/);
  assert.match(html, /作品排序/);
  assert.doesNotMatch(html, />新建小说<|>新建剧本<|完整创作页面 · 保留原始输入/);
  assert.equal((html.match(/class="library-card /g) || []).length, 2);
  assert.match(html, /<details class="library-import"><summary>/);
});
