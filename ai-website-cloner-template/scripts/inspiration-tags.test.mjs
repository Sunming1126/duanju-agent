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
const { initialCreationDraft, applyInspiration, creationPayload } = load("inspiration");

const tags = {
  genres: ["历史、架空", "悬疑，探案", "成长,冒险"],
  core: ["改造、经营", "家族，权谋", "故乡\n与远方"],
  styles: ["轻松、幽默", "冷峻，写实", "反转,悬念"],
};
function result(type) {
  return {
    title: "测试故事", content_type: type, genre: "悬疑", units: 12, words_per_chapter: 1200,
    audience: "general", premise: "一个关于寻找的故事", creative: { ...tags, highlights: "人物成长" },
    world_snapshot: null,
  };
}

for (const type of ["novel", "short_drama"]) {
  const mode = type === "novel" ? "小说创作" : "剧本创作";
  test(`${type}: analysis labels retain embedded punctuation and newlines through fill, persistence and submission`, () => {
    const input = result(type);
    const draft = applyInspiration(initialCreationDraft(type), input);
    assert.equal(draft.tag_format, "lines");
    assert.equal(draft.genres, tags.genres.join("\n"));
    assert.equal(draft.core, tags.core.join("\n"));
    assert.deepEqual(draft.tag_source, tags);
    const restored = JSON.parse(JSON.stringify(draft));
    const payload = creationPayload(restored, mode, true);
    for (const field of ["genres", "core", "styles"]) assert.deepEqual(payload.creative[field], tags[field], field);
    assert.deepEqual(input.creative.genres, tags.genres);
  });

  test(`${type}: editing one field uses lines and leaves other original tag values intact`, () => {
    const draft = applyInspiration(initialCreationDraft(type), result(type));
    draft.genres = "新题材、组合\n第二项，扩展";
    const payload = creationPayload(JSON.parse(JSON.stringify(draft)), mode, true);
    assert.deepEqual(payload.creative.genres, ["新题材、组合", "第二项，扩展"]);
    assert.deepEqual(payload.creative.core, tags.core);
    assert.deepEqual(payload.creative.styles, tags.styles);
  });
}

test("older saved drafts keep comma, Chinese comma, enumeration comma and newline as separators", () => {
  const draft = { ...initialCreationDraft("novel"), title: "旧草稿", genres: "甲,乙，丙", core: "甲、乙\n丙", styles: "明快，温暖" };
  const payload = creationPayload(JSON.parse(JSON.stringify(draft)), "小说创作", false);
  assert.deepEqual(payload.creative.genres, ["甲", "乙", "丙"]);
  assert.deepEqual(payload.creative.core, ["甲", "乙", "丙"]);
  assert.deepEqual(payload.creative.styles, ["明快", "温暖"]);
});

test("editing a label with an internal newline requires explicit confirmation of the new boundaries", () => {
  const draft = applyInspiration(initialCreationDraft("novel"), result("novel"));
  draft.core = "改造、经营\n家族，权谋\n故乡与远方";
  assert.throws(() => creationPayload(draft, "小说创作", true), /核心设定.*原始项目含有换行/);
  // The form's confirmation clears only this field's source snapshot.
  draft.tag_source = { ...draft.tag_source, core: [] };
  const payload = creationPayload(JSON.parse(JSON.stringify(draft)), "小说创作", true);
  assert.deepEqual(payload.creative.core, ["改造、经营", "家族，权谋", "故乡与远方"]);
  assert.deepEqual(payload.creative.genres, tags.genres);
  assert.deepEqual(payload.creative.styles, tags.styles);
});

test("tag counts and Unicode character lengths are checked after editing or restoring", () => {
  const input = result("novel");
  input.creative = { ...input.creative, core: ["家族，权谋"] };
  const draft = applyInspiration(initialCreationDraft("novel"), input);
  for (const [field, label, max] of [["genres", "自定义题材", 3], ["core", "核心设定", 3], ["styles", "风格", 5]]) {
    const tooMany = { ...draft, [field]: Array.from({ length: max + 1 }, (_, i) => `项目${i}`).join("\n") };
    assert.throws(() => creationPayload(tooMany, "小说创作", true), new RegExp(`${label}最多${max}项`));
    const tooLong = { ...draft, [field]: "😀".repeat(81) };
    assert.throws(() => creationPayload(tooLong, "小说创作", true), new RegExp(`${label}.*80字`));
    const atLimit = { ...draft, [field]: "😀".repeat(80) };
    assert.deepEqual(creationPayload(atLimit, "小说创作", true).creative[field], ["😀".repeat(80)]);
  }
});
