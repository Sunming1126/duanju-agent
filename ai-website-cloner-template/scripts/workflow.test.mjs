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
const characters = load("lib/studio/characters.ts");
const workflow = load("lib/studio/workflow.ts");
const inspiration = load("lib/studio/inspiration.ts");
const creation = load("lib/studio/creation.ts");
const { CharacterEditor } = load("components/studio/character-editor.tsx");
const { WorkflowNav } = load("components/studio/workflow-nav.tsx");

test("AI introduction is preserved as text without becoming a role; explicit numeric ages stay editable", () => {
  const intro = "按作品前提限定，只设计两位人物。\n\n";
  const text = intro + "【人物：林知】\n定位：主角\n年龄：28岁\n背景：修表师\n\n【人物：林成】\n定位：父亲\n背景：修表铺店主";
  const cards = characters.parseCharacters(text);
  assert.deepEqual(cards.map(card => card.name), ["林知", "林成"]);
  assert.equal(cards[0].age, "28");assert.equal(cards[0].preamble, intro);
  assert.equal(characters.serializeCharacters(cards), text);
  const edited = characters.serializeCharacters([{ ...cards[0], background: "修改后的经历", source: undefined }, cards[1]]);
  assert.ok(edited.startsWith(intro));assert.equal(characters.parseCharacters(edited).length, 2);
  const mixed = "### 李明（主角）\n欲望：找到父亲。\n\n【人物：张河】\n定位：对手\n背景：守门人";
  assert.deepEqual(characters.parseCharacters(mixed).map(card => card.name), ["李明", "张河"]);
});

test("character cards round-trip empty fields, literal labels, punctuation and trailing newlines while typing", () => {
  const card = { ...characters.newCharacter(), name: "", role: "Love interest \n背景：仍属定位", age: "约三十岁", traits: ["聪明，嘴硬", "善良、怕事"], background: "  第一行\n背景：这句话属于经历\n【人物：这是经历中的标题】\n【人物结束】\n\n", relationships: "姐姐：未命名\n人物关系：原文标签\n" };
  const text = characters.serializeCharacters([card]);
  const parsed = characters.parseCharacters(text)[0];
  for (const key of Object.keys(card)) assert.deepEqual(parsed[key], card[key], key);
  assert.equal(characters.serializeCharacters([parsed]), text);
  assert.deepEqual(characters.parseCharacters("  \n"), []);
});

test("opening legacy prose never loses facts and editing one card retains the other original block", () => {
  const first = "林朔，32岁，女，退役救援队员。\n弱点：肩伤。\n对白口吻：话少。";
  const second = "杜岸，36岁，负责人。\n成长：承认自己忽略投诉。";
  const cards = characters.parseCharacters(`${first}\n\n${second}`);
  assert.equal(cards.length, 2); assert.equal(cards[0].name, "林朔"); assert.equal(cards[0].age, "32");
  assert.equal(cards[0].background, first); assert.equal(cards[1].source, second);
  const edited = characters.serializeCharacters([{ ...cards[0], role: "主角", source: undefined }, cards[1]]);
  const reread = characters.parseCharacters(edited);
  assert.equal(reread.length, 2); assert.equal(reread[0].background, first); assert.equal(reread[1].name, "杜岸"); assert.ok(edited.endsWith(second));
  const unknown = "人物还没有名字。\n很长的经历，包含谁也不知道的秘密。";
  assert.equal(characters.parseCharacters(unknown)[0].background, unknown);
});

test("new AI labelled blocks and old Markdown profiles retain unknown desire, weakness and growth fields", () => {
  const text = "【人物：苏舟】\n定位：男主\n年龄：26\n性格：机智、冷静\n背景：货郎\n弱点：冒进\n人物关系：柳霜的盟友\n\n【人物：柳霜】\n定位：女主\n背景：掌柜";
  const cards = characters.parseCharacters(text);
  assert.equal(cards.length, 2); assert.equal(cards[0].role, "男主"); assert.equal(cards[0].age, "26");
  assert.deepEqual(cards[0].traits, ["机智", "冷静"]); assert.match(cards[0].background, /弱点：冒进/);
  const markdown = "### 1. 李明（主角）\n欲望：找人。\n弱点：胆小。\n\n### 2. 张河（对手）\n成长：学会承担。";
  const old = characters.parseCharacters(markdown);
  assert.equal(old.length, 2); assert.equal(old[0].name, "李明");
  assert.match(old[0].background, /欲望：找人/); assert.match(old[1].background, /成长：学会承担/);
});

test("role card UI offers editable fields, relationships, full text fallback, add and confirmed delete entry", () => {
  const text = characters.serializeCharacters([{ ...characters.newCharacter(), name: "苏舟", age: "26", relationships: "柳霜的盟友" }]);
  const html = renderToStaticMarkup(React.createElement(CharacterEditor, { value: text, onChange() {} }));
  for (const label of ["姓名", "定位", "年龄", "性格", "背景", "人物关系", "添加角色", "切换全文编辑", "删除此角色"]) assert.ok(html.includes(label), label);
  assert.match(html, /aria-pressed="true"/); assert.match(html, /柳霜的盟友/);
  const empty = renderToStaticMarkup(React.createElement(CharacterEditor, { value: "", onChange() {} }));
  assert.match(empty, /添加第一位角色/);
});

test("new wizard payload and browser restore retain all four stages, selected step and independent chapter copies", () => {
  const draft = inspiration.initialCreationDraft("novel");
  Object.assign(draft, { title: "书名", premise: "故事", characters: "人物", outline: "大纲", chapters: [{ number: 2, title: "第二章", content: "已写的小说" }], step: "chapter", chapter_number: 2 });
  const restored = { ...inspiration.initialCreationDraft("novel"), ...JSON.parse(JSON.stringify(draft)) };
  const payload = inspiration.creationPayload(restored, "小说创作", true);
  assert.equal(payload.characters, "人物"); assert.equal(payload.outline, "大纲"); assert.equal(payload.chapters[0].content, "已写的小说");
  assert.equal(restored.step, "chapter"); assert.equal(restored.chapter_number, 2);
  payload.chapters[0].content = "改后的副本"; assert.equal(restored.chapters[0].content, "已写的小说");
  const old = { ...inspiration.initialCreationDraft("novel"), ...{ title: "旧草稿", premise: "旧想法" } };
  assert.deepEqual(inspiration.creationPayload(old, "小说创作", false).chapters, []);
});

test("inspiration refills story settings without deleting manually written characters, outline or chapters", () => {
  const draft = inspiration.initialCreationDraft("short_drama");
  Object.assign(draft, { title: "旧名", premise: "旧故事", characters: "原人物", outline: "原大纲", chapters: [{ number: 1, title: "第一集", content: "原剧本" }] });
  const next = inspiration.applyInspiration(draft, { ...inspiration.creationPayload(draft, "剧本创作", false), title: "新名", premise: "新设定" });
  assert.equal(next.characters, draft.characters); assert.equal(next.outline, draft.outline); assert.deepEqual(next.chapters, draft.chapters);
  assert.equal(next.premise, "新设定");
});

test("reducing units or malformed duplicate chapter numbers cannot silently delete written chapters", () => {
  const draft = inspiration.initialCreationDraft("novel"); draft.title = "标题";
  draft.chapters = [{ number: 12, title: "末章", content: "须保留" }]; draft.units = "3";
  assert.throws(() => inspiration.creationPayload(draft, "小说创作", false), /最大编号/);
  assert.equal(draft.chapters[0].content, "须保留");
  draft.units = "12"; draft.chapters.push({ ...draft.chapters[0] });
  assert.throws(() => inspiration.creationPayload(draft, "小说创作", false), /重复/);
});

test("navigation is available without inspiration, separates current view from progress and counts distinct manuscripts", () => {
  const value = { premise: "故事", characters: "人物", outline: "", units: 3, chapters: [{ number: 1, content: "第一章" }, { number: 1, content: "重复" }] };
  assert.equal(workflow.writingProgress(value).completed, 1);
  assert.equal(workflow.writingProgress(value).chapter, false);
  for (const type of ["novel", "short_drama"]) {
    const html = renderToStaticMarkup(React.createElement(WorkflowNav, { type, current: "outline", value, onSelect() {} }));
    assert.equal((html.match(/role="tab"/g) || []).length, 4);
    assert.match(html, /aria-selected="true"/); assert.match(html, /当前步骤/); assert.match(html, /已填写/);
    assert.ok(html.includes(type === "novel" ? "章节大纲" : "分集大纲"));
  }
});

test("deep links restore only a valid step and number and never encode automatic generation", () => {
  assert.deepEqual(workflow.writingDestination("?step=characters&number=2"), { step: "characters", number: 2 });
  assert.deepEqual(workflow.writingDestination("?step=world&number=201&generate=1"), { step: "premise", number: 1 });
  const url = workflow.workEditorUrl("id/1", { step: "chapter", number: 2 });
  assert.equal(url, "/studio/works/id%2F1?step=chapter&number=2");
  assert.deepEqual(workflow.writingDestination("?step=settings&number=2&generate=1"), { step: "settings", number: 2 });
  assert.deepEqual(workflow.editorSteps,['premise','settings','characters','outline','chapter']);
  assert.deepEqual(workflow.writingSteps,['premise','characters','outline','chapter']);
  assert.equal(workflow.nextEditorStep('premise'),'settings');
  assert.equal(workflow.nextEditorStep('settings'),'characters');
  assert.equal(workflow.nextEditorStep('chapter'),undefined);
});

test('settings creates a saved draft at its own view but can never enqueue a settings action',async()=>{
  const previous=globalThis.fetch;let calls=0;
  try{
    globalThis.fetch=async url=>{if(url.endsWith('/session'))return Response.json({space_id:'settings',isolated:true});calls++;return Response.json({id:'settings-work',revision:1});};
    const result=await creation.createWorkForStep({}, {generate:false,step:'settings',number:1},()=>{});
    assert.equal(calls,1);assert.equal(workflow.workEditorUrl(result.work.id,{step:'settings',number:1}),'/studio/works/settings-work?step=settings&number=1');
    await assert.rejects(creation.createWorkForStep({}, {generate:true,step:'settings',number:1},()=>assert.fail('must not create')),/先保存/);
    assert.equal(calls,1);
  }finally{globalThis.fetch=previous;}
});

test("first AI request saves every stage first and uses saved id, revision and selected chapter exactly once", async () => {
  const previous = globalThis.fetch; const calls = [];
  try {
    globalThis.fetch = async (url, options) => {
      if (url.endsWith("/session")) return Response.json({ space_id: "workflow", isolated: true });
      calls.push({ url, body: JSON.parse(options.body) });
      return Response.json(url.endsWith("/jobs") ? { id: "job-1" } : { id: "work-1", revision: 3, ...JSON.parse(options.body) });
    };
    const draft = inspiration.initialCreationDraft("novel"); Object.assign(draft, { title: "新书", premise: "故事", characters: "人物", outline: "大纲", chapters: [{ number: 2, title: "章名", content: "正文" }] });
    let saved;
    const result = await creation.createWorkForStep(inspiration.creationPayload(draft, "小说创作", true), { generate: true, step: "chapter", number: 2 }, work => { saved = work; assert.equal(calls.length, 1); });
    assert.equal(result.warning, ""); assert.equal(saved.id, "work-1"); assert.equal(calls.length, 2);
    assert.equal(calls[0].body.chapters[0].content, "正文"); assert.equal(calls[1].body.revision, 3); assert.equal(calls[1].body.action, "chapter"); assert.equal(calls[1].body.number, 2);
  } finally { globalThis.fetch = previous; }
});

test("creation conflict blocks AI, while a failed job retains the saved work with warning and no retry", async () => {
  const previous = globalThis.fetch; let calls = 0;
  try {
    globalThis.fetch = async () => { calls++; return Response.json({ detail: "创建失败" }, { status: 409 }); };
    await assert.rejects(creation.createWorkForStep({}, { generate: true, step: "characters", number: 1 }, () => assert.fail("must not mark saved")), /创建失败/);
    assert.equal(calls, 1); calls = 0; let saved;
    globalThis.fetch = async url => { calls++; return url.endsWith("/jobs") ? Response.json({ detail: "排队已满" }, { status: 429 }) : Response.json({ id: "saved", revision: 1 }); };
    const result = await creation.createWorkForStep({}, { generate: true, step: "characters", number: 1 }, work => { saved = work; });
    assert.equal(calls, 2); assert.equal(saved.id, "saved"); assert.equal(result.work.id, "saved"); assert.match(result.warning, /已保存/);
    calls = 0;
    await creation.createWorkForStep({}, { generate: false, step: "outline", number: 1 }, () => {});
    assert.equal(calls, 1);
  } finally { globalThis.fetch = previous; }
});

test('one-click creation saves both work types and submits one full-plan job from every editor view', async () => {
  const previous = globalThis.fetch;
  try {
    for (const type of ['novel', 'short_drama']) for (const step of workflow.editorSteps) {
      const calls = [];
      globalThis.fetch = async (url, options) => {
        if (url.endsWith('/session')) return Response.json({space_id:'all-create',isolated:true});
        calls.push({url, body:JSON.parse(options.body)});
        return Response.json(url.endsWith('/jobs') ? {id:'all-job'} : {id:'all-work',revision:7});
      };
      const draft = inspiration.initialCreationDraft(type);
      Object.assign(draft, {title:'完整创作',premise:'原创故事',units:'3',characters:'手写人物',outline:'手写大纲',chapters:[{number:2,title:'保留章名',content:'手写正文'}]});
      let saved = false;
      const result = await creation.createWorkForStep(inspiration.creationPayload(draft, type === 'novel' ? '小说创作' : '剧本创作', true), {generate:true,all:true,step,number:2}, () => { saved=true;assert.equal(calls.length,1); });
      assert.equal(result.warning,'');assert.ok(saved);assert.equal(calls.length,2);
      assert.equal(calls[0].body.content_type,type);assert.equal(calls[0].body.units,3);
      assert.equal(calls[0].body.chapters[0].content,'手写正文');
      assert.deepEqual(calls[1].body,{revision:7,action:'premise',number:1,mode:'all',request_key:'create-all-work-all'});
    }
  } finally { globalThis.fetch=previous; }
});

test('one-click creation retains the saved draft and never retries an unconfirmed full-plan job', async () => {
  const previous = globalThis.fetch;const calls=[];let saved;
  try {
    globalThis.fetch = async (url, options) => {
      if(url.endsWith('/session'))return Response.json({space_id:'all-error',isolated:true});
      calls.push({url,body:JSON.parse(options.body)});
      if(url.endsWith('/jobs'))throw new Error('response lost');
      return Response.json({id:'retained-all',revision:1});
    };
    const result=await creation.createWorkForStep({}, {generate:true,all:true,step:'settings',number:2}, work=>{saved=work;});
    assert.equal(saved.id,'retained-all');assert.equal(result.work.id,saved.id);
    assert.match(result.warning,/已保存/);assert.equal(calls.length,2);assert.equal(calls[1].body.mode,'all');
  } finally { globalThis.fetch=previous; }
});
