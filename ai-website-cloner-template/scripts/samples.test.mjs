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
  const exports = {};
  cache.set(path, exports);
  vm.runInThisContext(`(function(exports,require){${compiled}\n})`)(exports, name => {
    if (["react", "react/jsx-runtime", "lucide-react"].includes(name)) return require(name);
    if (name.endsWith(".css")) return {};
    if (name === "next/link") return { __esModule: true, default: props => { const attributes = { ...props }; delete attributes.prefetch; return React.createElement("a", attributes); }, useLinkStatus: () => ({ pending: false }) };
    if (name === "next/dynamic") return { __esModule: true, default: () => () => null };
    if (name === "next/navigation") return { notFound: () => { throw new Error("NOT_FOUND"); } };
    if (name === "@/components/studio/editor") return { StudioEditor: () => null };
    if (name === "./inspiration") return { Inspiration: () => null };
    const base = name.startsWith("@/") ? name.slice(2) : posix.normalize(posix.join(posix.dirname(path), name));
    const target = [base, `${base}.ts`, `${base}.tsx`, `${base}/index.ts`].find(candidate => existsSync(new URL(`../src/${candidate}`, import.meta.url)) && /\.tsx?$/.test(candidate));
    if (target) return load(target);
    throw new Error(`Unexpected dependency ${name} in ${path}`);
  });
  return exports;
}

const samples = load("content/samples/index.ts");
const { officialSamples, sampleCreationInput, sampleCreationHref, sampleDocument } = samples;
const { SampleLibrary } = load("components/studio/sample-library.tsx");
const { SampleReader } = load("components/studio/sample-reader.tsx");
const { WorkForm } = load("components/studio/work-form.tsx");
const { creationDraftKeys } = load("lib/studio/writing.ts");
const { GET } = load("app/samples/[slug]/download/route.ts");
export { officialSamples, sampleCreationInput, sampleDocument };

test("official catalogue offers complete novel and drama examples with settings and reading notes", () => {
  assert.equal(new Set(officialSamples.map(sample => sample.slug)).size, officialSamples.length);
  for (const kind of ["novel", "short_drama"]) {
    const matching = officialSamples.filter(sample => sample.work.content_type === kind);
    assert.ok(matching.length >= 2);
    const html = renderToStaticMarkup(React.createElement(SampleLibrary, { kind }));
    assert.equal((html.match(/class="sample-card /g) || []).length, matching.length);
    for (const sample of matching) {
      const work = sample.work;
      assert.ok(work.premise && work.characters && work.outline && work.world_snapshot.sections.world_rules);
      assert.equal(work.chapters.length, work.units);
      assert.deepEqual(work.chapters.map(chapter => chapter.number), [1, 2, 3]);
      assert.ok(work.chapters.every(chapter => chapter.content.length > 300));
      assert.match(html, new RegExp(work.title));
      assert.match(html, new RegExp(`/samples/${sample.slug}/download`));
      const reader = renderToStaticMarkup(React.createElement(SampleReader, { sample }));
      for (const chapter of work.chapters) assert.ok(reader.includes(`id="chapter-${chapter.number}"`) && reader.includes(chapter.title));
      assert.ok(reader.includes(sampleCreationHref(sample)));
      assert.equal(sample.lessons.length, 3);
    }
    for (const sample of officialSamples.filter(sample => sample.work.content_type !== kind)) assert.ok(!html.includes(sample.work.title));
  }
});

test("using an official setting creates an independent typed draft and leaves official manuscripts unchanged", () => {
  for (const sample of officialSamples) {
    const original = JSON.stringify(sample);
    const input = sampleCreationInput(sample);
    assert.match(input.title, /我的版本$/);
    assert.deepEqual(input.chapters, []);
    assert.equal(input.characters, ""); assert.equal(input.outline, "");
    assert.equal(input.world_id, null); assert.deepEqual(input.reference_ids, []);
    input.world_snapshot.sections.world_rules = "我的独立世界";
    input.creative.core.push("我的新设定");
    if (input.novel_settings) input.novel_settings.perspective = "multiple";
    if (input.drama_settings) input.drama_settings.minutes_per_episode = 10;
    assert.equal(JSON.stringify(sample), original);
    const keys = creationDraftKeys(input.content_type, input.mode, `official-${sample.slug}`);
    const originals = creationDraftKeys(input.content_type, input.mode);
    assert.ok(keys.every(key => !originals.includes(key)));
  }
});

test("novel and drama creation routes reject missing, wrong-type or ambiguous samples", async () => {
  for (const [segment, kind] of [["novels", "novel"], ["scripts", "short_drama"]]) {
    const { default: Page } = load(`app/studio/${segment}/new/page.tsx`);
    for (const sample of officialSamples) {
      const query = { searchParams: Promise.resolve({ sample: sample.slug }) };
      if (sample.work.content_type !== kind) await assert.rejects(Page(query), /NOT_FOUND/);
      else {
        const element = await Page(query);
        assert.equal(element.props.kind, kind); assert.equal(element.props.sampleId, sample.slug);
        assert.deepEqual(element.props.sampleInput.chapters, []);
        const form = renderToStaticMarkup(React.createElement(WorkForm, { kind, mode: sample.work.mode, sampleId: sample.slug, sampleInput: element.props.sampleInput, worlds: [], onCreated: () => {}, onClose: () => {} }));
        assert.ok(form.includes(`${sample.work.title} · 我的版本`));
        assert.ok(form.includes(sample.work.premise));
        assert.match(form, /已载入官方样例设定/);
        assert.doesNotMatch(form, /name="content_type"/);
      }
    }
    await assert.rejects(Page({ searchParams: Promise.resolve({ sample: "missing" }) }), /NOT_FOUND/);
    const matching = officialSamples.find(sample => sample.work.content_type === kind);
    await assert.rejects(Page({ searchParams: Promise.resolve({ sample: matching.slug, reference: "corpus-other" }) }), /NOT_FOUND/);
  }
});

test("TXT downloads contain all manuscript chapters, settings and notes with Chinese filenames", async () => {
  for (const sample of officialSamples) {
    const response = await GET(new Request(`https://example.test/samples/${sample.slug}/download`), { params: Promise.resolve({ slug: sample.slug }) });
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /text\/plain; charset=utf-8/);
    assert.ok(response.headers.get("content-disposition").includes(`filename*=UTF-8''${encodeURIComponent(`Plotloom官方样例-${sample.work.title}.txt`)}`));
    const text = await response.text();
    assert.ok(text.endsWith(sampleDocument(sample)));
    assert.ok(text.includes(sample.work.premise) && text.includes(sample.work.characters) && text.includes(sample.work.outline));
    for (const chapter of sample.work.chapters) assert.ok(text.includes(chapter.content));
    for (const lesson of sample.lessons) assert.ok(text.includes(lesson.text));
  }
  const missing = await GET(new Request("https://example.test/samples/missing/download"), { params: Promise.resolve({ slug: "../../AGENT.md" }) });
  assert.equal(missing.status, 404);
  assert.equal(samples.getOfficialSample("__proto__"), undefined);
});
