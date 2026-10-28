import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { posix } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
const require=createRequire(import.meta.url), ts=require('typescript'), React=require('react');
const {renderToStaticMarkup}=require('react-dom/server');
const cache=new Map();
function load(path) {
  if(cache.has(path)) return cache.get(path);
  const compiled=ts.transpileModule(readFileSync(new URL(`../src/${path}`,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
  const exports={};cache.set(path,exports);
  vm.runInThisContext(`(function(exports,require){${compiled}\n})`)(exports,name=>{
    if(['react','react/jsx-runtime','lucide-react'].includes(name)) return require(name);
    if(name.endsWith('.css')) return {__esModule:true,default:{}};
    if(name==='next/link') return {__esModule:true,default:props=>React.createElement('a',props)};
    if(name==='./inspiration') return {Inspiration:()=>null};
    const base=name.startsWith('@/')?name.slice(2):posix.normalize(posix.join(posix.dirname(path),name));
    const target=[`${base}.ts`,`${base}.tsx`].find(p=>existsSync(new URL(`../src/${p}`,import.meta.url)));
    if(target)return load(target);throw Error(name);
  });return exports;
}
const model=load('lib/studio/project.ts'), inspiration=load('lib/studio/inspiration.ts');
const {wordDocument}=load('lib/studio/word-export.ts');
const {WorkForm}=load('components/studio/work-form.tsx');
const {ProjectToolbar}=load('components/studio/project-shell.tsx');
const generation=load('lib/studio/inline-generation.ts');

test('all four steps target their latest job and protect edits, chapters and already applied results',()=>{
  for(const action of ['premise','characters','outline','chapter']){
    const result={action,number:2,text:'生成内容',adopted:false};
    const job={id:action,mode:'single',status:'completed',base_revision:4,current:{action,number:2},results:[result]};
    const failed={...job,id:'failed',status:'failed',results:[]};
    assert.equal(generation.latestGeneration([failed,job],action,2).id,'failed');
    assert.equal(generation.canFillGeneration(job,{revision:4},false),true);
    assert.equal(generation.canFillGeneration(job,{revision:4},true),false);
    assert.equal(generation.canFillGeneration(job,{revision:5},false),false);
    assert.deepEqual(generation.pendingResults({...job,results:[{...result,adopted:true}]}),[]);
    if(action==='chapter')assert.equal(generation.latestGeneration([job],action,1),undefined);
  }
});

test('partial all-step jobs follow the adoption revision and preview preserves custom titles and unrelated fields',()=>{
  const first={action:'premise',number:1,text:'已回填',adopted:true},second={action:'chapter',number:2,text:'新正文',adopted:false};
  const job={id:'all',mode:'all',status:'running',base_revision:1,adoption_revision:2,current:{action:'chapter',number:2},results:[first,second]};
  assert.equal(generation.canFillGeneration(job,{revision:2},false),true);
  assert.equal(generation.canFillGeneration(job,{revision:1},false),false);
  assert.equal(generation.generationSignature(job),'all:1');
  assert.equal(generation.latestGeneration([job],'outline',1).id,'all');
  const work={content_type:'novel',premise:'原梗概',characters:'原人物',outline:'原大纲',chapters:[{number:1,title:'第一章',content:'原文1'},{number:2,title:'自定义章名',content:'原文2'}]};
  const preview=generation.previewGeneration(work,second);
  assert.equal(preview.chapters[1].title,'自定义章名');assert.equal(preview.chapters[1].content,'新正文');
  assert.deepEqual(preview.chapters[0],work.chapters[0]);assert.equal(work.chapters[1].content,'原文2');
  for(const field of ['premise','characters','outline'])assert.equal(preview[field],work[field]);
});

test('conflicting generation can be read as cards without enabling edits or blocking role selection',()=>{
  const {CharacterEditor}=load('components/studio/character-editor.tsx');
  const html=renderToStaticMarkup(React.createElement(CharacterEditor,{value:'【人物：甲】\n背景：甲的经历\n\n【人物：乙】\n背景：乙的经历',readOnly:true,onChange(){assert.fail('read only');}}));
  assert.match(html,/<input[^>]*disabled=""[^>]*value="甲"/);
  const list=html.match(/role="group" aria-label="角色列表">([\s\S]*?)<\/div>/)?.[1];
  const buttons=list.match(/<button[^>]*>/g);
  assert.equal(buttons.length,3);assert.ok(!buttons[0].includes('disabled'));assert.ok(!buttons[1].includes('disabled'));assert.ok(buttons[2].includes('disabled'));
});
test('toolbar mouse and keyboard selection reveal the active editor; disabled controls cannot switch',()=>{
  const oldFrame=globalThis.requestAnimationFrame,oldDocument=globalThis.document;
  const selected=[],scrolled=[],focused=[];
  try {
    globalThis.requestAnimationFrame=callback=>{callback();return 1;};
    globalThis.document={getElementById:id=>({scrollIntoView:options=>scrolled.push({id,...options}),focus:()=>focused.push(id)})};
    const props={type:'novel',current:'premise',value:{premise:'设定',characters:'',outline:'',chapters:[],units:2},onSelect:step=>selected.push(step)};
    const buttons=ProjectToolbar(props).props.children[0].props.children;
    buttons[2].props.onClick();
    buttons[0].props.onKeyDown({key:'ArrowRight',preventDefault(){}});
    assert.deepEqual(selected,['outline','characters']);
    assert.equal(scrolled.length,2);assert.ok(scrolled.every(item=>item.id==='writing-stage-panel'&&item.block==='start'));
    assert.deepEqual(focused,['writing-tab-characters']);
    const disabled=ProjectToolbar({...props,disabled:true}).props.children[0].props.children;
    disabled[1].props.onClick();disabled[0].props.onKeyDown({key:'End',preventDefault(){assert.fail('disabled');}});
    assert.equal(selected.length,2);
  } finally {globalThis.requestAnimationFrame=oldFrame;globalThis.document=oldDocument;}
});
test('multiline and punctuated inspiration tags survive editing another setting and creation',()=>{
  const draft=inspiration.initialCreationDraft('novel');draft.title='验收';
  Object.assign(draft,{genres:'悬疑，都市\n科幻',core:'身份\n反差\n时间循环',styles:'温暖、克制',tag_format:'lines',tag_source:{genres:['悬疑，都市','科幻'],core:['身份\n反差','时间循环'],styles:['温暖、克制']}});
  const settings=model.projectSettingsFromDraft(draft);
  assert.deepEqual(settings.creative.core,['身份\n反差','时间循环']);
  const next={...draft,...model.applyProjectSettings(draft,{creative:{...settings.creative,styles:['自然，克制']}})};
  const payload=inspiration.creationPayload(next,'小说创作',false);
  assert.deepEqual(payload.creative.genres,['悬疑，都市','科幻']);assert.deepEqual(payload.creative.core,['身份\n反差','时间循环']);assert.deepEqual(payload.creative.styles,['自然，克制']);
});
test('legacy comma boundaries survive chip editing; ambiguous multiline edits still require confirmation',()=>{
  let draft=inspiration.initialCreationDraft('novel');draft.title='旧稿';Object.assign(draft,{genres:'都市，悬疑',core:'秘密,反差',styles:'温暖、克制'});
  const value=model.projectSettingsFromDraft(draft);
  draft={...draft,...model.applyProjectSettings(draft,{creative:{...value.creative,core:['新核心，完整项目']}})};
  const payload=inspiration.creationPayload(draft,'小说创作',false);
  assert.deepEqual(payload.creative.genres,['都市','悬疑']);assert.deepEqual(payload.creative.styles,['温暖','克制']);assert.deepEqual(payload.creative.core,['新核心，完整项目']);
  Object.assign(draft,{core:'用户编辑\n后的边界',tag_source:{...draft.tag_source,core:['原始\n单项']}});
  const changed={...draft,...model.applyProjectSettings(draft,{creative:{...model.projectSettingsFromDraft(draft).creative,highlights:'只改亮点'}})};
  assert.throws(()=>inspiration.creationPayload(changed,'小说创作',false),/换行/);
});
test('invalid transient plan and target inputs cannot discard written manuscripts',()=>{
  const value={content_type:'novel',units:12,words_per_chapter:2000,chapters:[{number:9,title:'原名',content:'原文'}]};
  for(const input of [{units:''},{units:'8'},{units:'2.5'},{words_per_chapter:''},{words_per_chapter:'6001'}])assert.throws(()=>model.projectNumbers(value,input));
  assert.deepEqual(model.projectNumbers(value,{units:'9',words_per_chapter:'6000'}),{units:9,words_per_chapter:6000});assert.equal(value.chapters[0].content,'原文');
});
test('inspiration updates settings only and rejects plans below existing chapter numbers',()=>{
  const work={...inspiration.creationPayload({...inspiration.initialCreationDraft('novel'),title:'旧名'},'小说创作',false),id:'w',revision:7,characters:'原人物',outline:'原大纲',chapters:[{number:8,title:'八',content:'原正文'}]};
  const analysis={...work,title:'新名',units:9,characters:'不应回填',outline:'不应回填',chapters:[]};
  const next={...work,...model.settingsPatch(work,analysis)};assert.equal(next.characters,'原人物');assert.equal(next.outline,'原大纲');assert.deepEqual(next.chapters,work.chapters);assert.equal(next.revision,7);
  assert.throws(()=>model.settingsPatch(work,{...analysis,units:7}),/最大编号/);assert.throws(()=>model.settingsPatch(work,{...analysis,content_type:'short_drama'}),/类型/);
});
test('Word export escapes manuscript markup and retains titles and line breaks',()=>{
  const html=wordDocument('<作品>',[{number:1,title:'<第一章>',content:'<script>alert(1)</script>\n第二行'}]);assert.ok(!html.includes('<script>'));assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;第一章&gt;/);assert.match(html,/<br>第二行/);
});
test('both real forms contain real controls and independent settings without preview placeholders',()=>{
  for(const kind of ['short_drama','novel']){
    const html=renderToStaticMarkup(React.createElement(WorkForm,{kind,mode:kind==='novel'?'小说创作':'剧本创作',worlds:[],onCreated(){},onClose(){}}));
    assert.equal((html.match(/role="tab"/g)||[]).length,4);assert.match(html,/id="plotloom-create-form"/);assert.match(html,/保存全部内容，创建作品/);assert.match(html,/灵感创作/);assert.match(html,/创作参数与作品世界/);assert.doesNotMatch(html,/未接入|本地预览/);
  }
});
