import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import vm from "node:vm";

const require = createRequire(import.meta.url);
const ts = require("typescript");
function load(name) {
  const source = readFileSync(new URL(`../src/lib/studio/${name}.ts`, import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const exports = {};
  vm.runInThisContext(`(function(exports,require){${compiled}\n})`)(exports, path => {
    if (path === "./writing") return load("writing");
    throw new Error(`Unexpected dependency: ${path}`);
  });
  return exports;
}
const helpers = load("inspiration");

const analysis = (type) => ({
  title: "钟城来信", content_type: type, genre: "悬疑", mode: "灵感创作", units: 24,
  words_per_chapter: 1200, audience: "female", premise: "修表师收到来自未来的信，寻找妹妹。", characters: "", outline: "", chapters: [],
  world_id: null, world_snapshot: { name: "钟城", description: "现代都市", sections: { world_rules: "改变未来会失去记忆" } },
  creative: { genres: ["悬疑", "科幻"], core: ["未来来信"], styles: ["温暖"], highlights: "用记忆换取未来" },
  market: "china", output_locale: "zh-CN", reference_ids: [],
});

for (const type of ["novel", "short_drama"]) {
  test(`${type}: analysis fills every form field without creating chapters and preserves the original draft`, () => {
    const before = helpers.initialCreationDraft(type);
    const snapshot = JSON.stringify(before);
    const filled = helpers.applyInspiration(before, analysis(type));
    assert.equal(JSON.stringify(before), snapshot);
    assert.equal(filled.title, "钟城来信");
    assert.equal(filled.genres, "悬疑，科幻");
    assert.equal(filled.core, "未来来信");
    assert.equal(filled.styles, "温暖");
    assert.equal(filled.highlights, "用记忆换取未来");
    assert.equal(filled.world_snapshot.name, "钟城");
    assert.equal(filled.units, "24");
    assert.equal(filled.words, "1200");
    const payload = helpers.creationPayload(filled, "灵感创作", true);
    assert.equal(payload.content_type, type);
    assert.equal(payload.market, "china");
    assert.equal(payload.output_locale, "zh-CN");
    assert.deepEqual(payload.chapters, []);
    assert.equal(payload.characters, "");
    assert.equal(payload.outline, "");
  });
}

test("editing parsed fields and copied worlds reaches the final creation payload", () => {
  const draft = helpers.applyInspiration(helpers.initialCreationDraft("novel"), analysis("novel"));
  draft.premise = "用户修改后的想法";
  draft.world_id = "library-original";
  draft.world_snapshot.sections.world_rules = "用户修改后的规则";
  draft.units = "18";
  const payload = helpers.creationPayload(draft, "小说创作", true);
  assert.equal(payload.premise, "用户修改后的想法");
  assert.equal(payload.world_id, null);
  assert.equal(payload.world_snapshot.sections.world_rules, "用户修改后的规则");
  assert.equal(payload.units, 18);
});

test("type mismatches are rejected and manual type switches use the correct creation mode", () => {
  const draft = helpers.initialCreationDraft("novel");
  assert.throws(() => helpers.applyInspiration(draft, analysis("short_drama")), /类型/);
  draft.title = "标题"; draft.content_type = "short_drama";
  assert.equal(helpers.creationPayload(draft, "小说创作", false).mode, "剧本创作");
});

test("empty story is allowed only for a draft, with valid counts and tags required", () => {
  const draft = helpers.initialCreationDraft("novel");
  draft.title = "标题";
  assert.throws(() => helpers.creationPayload(draft, "小说创作", true), /故事想法/);
  assert.equal(helpers.creationPayload(draft, "小说创作", false).premise, "");
  for (const count of ["", "0", "201", "2.5", "NaN"]) {
    assert.throws(() => helpers.creationPayload({ ...draft, units: count }, "小说创作", false), /集／章数/);
  }
  assert.throws(() => helpers.creationPayload({ ...draft, core: "A，B，C，D" }, "小说创作", false), /最多3项/);
  assert.deepEqual(helpers.creationPayload({ ...draft, core: "A，A、B\nC" }, "小说创作", false).creative.core, ["A", "B", "C"]);
});

test("adaptation preserves raw material and reference ownership after filling a proposal", () => {
  const reference = { id: "cn-1", content_type: "novel", title: "参考", genre: "悬疑", logline: "找人", hook: "来信" };
  const original = helpers.initialCreationDraft("novel", reference);
  const draft = helpers.applyInspiration(original, analysis("novel"));
  const payload = helpers.creationPayload(draft, "小说改编", true, reference);
  assert.equal(payload.creative.source_text, original.premise);
  assert.deepEqual(payload.reference_ids, ["cn-1"]);
  assert.throws(() => helpers.creationPayload({ ...draft, content_type: "short_drama" }, "小说改编", true, reference), /参考素材类型/);
});
