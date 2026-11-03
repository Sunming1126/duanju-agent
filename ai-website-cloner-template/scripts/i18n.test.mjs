import assert from 'node:assert/strict';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { posix } from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';
import { loadI18n } from './i18n-test-support.mjs';
const require = createRequire(import.meta.url), ts = require('typescript'), React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');
const { marketForCountry, parsePreferences, preferencesForCountry } = loadI18n('config');
const { createTranslator } = loadI18n('translate');
function loader(locale='en', market='global', hookHarness=false) {
  const cache = new Map();
  function load(path) {
    if(cache.has(path)) return cache.get(path);
    if(path.endsWith('.json')) return JSON.parse(readFileSync(new URL(`../src/${path}`,import.meta.url),'utf8'));
    const source = readFileSync(new URL(`../src/${path}`,import.meta.url),'utf8');
    const exports={};cache.set(path,exports);
    const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX,esModuleInterop:true}}).outputText;
    vm.runInThisContext(`(function(exports,require){${code}\n})`)(exports,name=>{
      if(hookHarness && name==='@/lib/i18n/provider')return {useUI:()=>createTranslator(locale),usePreferences:()=>({locale,market})};
      if(['react','react/jsx-runtime','lucide-react','next/server','geoip-country','node:net','opencc-js/cn2t'].includes(name)) return require(name);
      if(name.endsWith('.css')) return {__esModule:true,default:new Proxy({},{get:(_,key)=>String(key)})};
      if(name==='next/headers') return {headers:async()=>new Headers({'x-plotloom-preferences':`${locale}~${market}`})};
      if(name==='next/dynamic') return {__esModule:true,default:()=>()=>null};
      if(name==='next/script') return {__esModule:true,default:()=>null};
      if(name==='next/image') return {__esModule:true,default:props=>{const attributes={...props};delete attributes.priority;return React.createElement('img',attributes);}};
      if(name==='next/link') return {__esModule:true,default:props=>{const attributes={...props};delete attributes.prefetch;return React.createElement('a',attributes);},useLinkStatus:()=>({pending:false})};
      if(name==='next/navigation') return {useSearchParams:()=>new URLSearchParams(),useRouter:()=>({push(){}}),notFound(){throw Error('NOT_FOUND')}};
      const base=name.startsWith('@/')?name.slice(2):posix.normalize(posix.join(posix.dirname(path),name));
      const target=[base,`${base}.ts`,`${base}.tsx`,`${base}/index.ts`].find(p=>/\.(?:tsx?|json)$/.test(p)&&existsSync(new URL(`../src/${p}`,import.meta.url)));
      if(target)return load(target);
      throw Error(`Unresolved ${name} in ${path}`);
    });return exports;
  }
  const {LocaleProvider}=load('lib/i18n/provider.tsx');
  return {load,render(Component,props={}){return renderToStaticMarkup(React.createElement(LocaleProvider,{preferences:{locale,market}},React.createElement(Component,props)));}};
}
const visible=html=>html.replace(/<[^>]*>/g,' ').replace(/\s+/g,' ').trim();
test('country routing covers China, Japan, all 22 Arab countries and English fallback; cookies validate both fields',()=>{
  assert.equal(marketForCountry('CN'),'china');assert.equal(marketForCountry('JP'),'japan');
  for(const country of ['AE','SA','BH','KW','QA','OM','YE','IQ','JO','LB','PS','SY','EG','SD','LY','TN','DZ','MA','MR','SO','DJ','KM'])assert.equal(marketForCountry(country),'arab');
  for(const country of ['US','GB','FR','KR','IN','','XX'])assert.equal(marketForCountry(country),'global');
  assert.deepEqual(parsePreferences('ja-JP~arab'),{locale:'ja-JP',market:'arab'});
  assert.deepEqual(parsePreferences('zh-TW~china'),{locale:'zh-TW',market:'china'});
  for(const country of ['HK','MO','TW']) assert.deepEqual(preferencesForCountry(country),{locale:'zh-TW',market:'china'});
  assert.deepEqual(preferencesForCountry('CN'),{locale:'zh-CN',market:'china'});
  for(const value of ['fr~japan','en~unknown','<script>','ar','en~global~extra'])assert.equal(parsePreferences(value),undefined);
});
test('proxy resolves IP country locally, overrides spoofed internal headers, honors preferences and disables shared caching',()=>{
  const {NextRequest}=require('next/server');
  const {proxy}=loader().load('proxy.ts');
  for(const [ip,expected] of [['114.114.114.114','zh-CN~china'],['133.242.0.1','ja-JP~japan'],['94.200.0.1','ar~arab'],['8.8.8.8','en~global'],['2001:4860:4860::8888','en~global'],['::ffff:114.114.114.114','zh-CN~china'],['invalid','en~global'],['127.0.0.1','en~global']]) {
    const response=proxy(new NextRequest('https://example.test/',{headers:{'x-real-ip':ip,'x-plotloom-preferences':'ar~arab'}}));
    assert.equal(response.headers.get('x-middleware-request-x-plotloom-preferences'),expected);
    assert.match(response.headers.get('cache-control'),/private.*no-store/);
    assert.match(response.headers.get('vary'),/Cookie/);
  }
  const response=proxy(new NextRequest('https://example.test/',{headers:{'x-real-ip':'114.114.114.114',cookie:'plotloom-preferences=ja-JP~arab'}}));
  assert.equal(response.headers.get('x-middleware-request-x-plotloom-preferences'),'ja-JP~arab');
});
for(const [locale,market] of [['zh-CN','china'],['zh-TW','china'],['en','global'],['ja-JP','japan'],['ar','arab']]) {
  test(`${locale}: actual React rendering localizes home, account, all editor stages, references, worlds and samples`,()=>{
    const {load,render}=loader(locale,market);
    const helpers=load('lib/studio/inspiration.ts');
    const project=load('lib/studio/project.ts');
    const draft=helpers.initialCreationDraft('novel',undefined,{locale,market});
    const cases=[['components/sites/storyplay/home.tsx','StoryplayHome',{}],['components/studio/account-page.tsx','AccountSettings',{space:{space_id:'test',isolated:true,user:null},onUserChanged(){}}],['components/studio/navigation.tsx','StudioNav',{}],['components/studio/character-editor.tsx','CharacterEditor',{value:'',onChange(){}}],['components/studio/outline-editor.tsx','OutlineEditor',{value:'',type:'novel',units:3,onChange(){}}],['components/studio/manuscript-editor.tsx','ManuscriptEditor',{chapters:[],type:'novel',units:3,number:1,onChange(){},onNumber(){}}],['components/studio/corpus.tsx','CorpusWorkspace',{}],['components/studio/worlds.tsx','WorldWorkspace',{}],['components/studio/sample-library.tsx','SampleLibrary',{}],['components/studio/inspiration.tsx','Inspiration',{type:'novel',initialPrompt:'',onApply(){},onClose(){}}]];
    for(const kind of ['novel','short_drama']) {
      cases.push(['components/studio/work-form.tsx','WorkForm',{kind,mode:kind==='novel'?'小说创作':'剧本创作',worlds:[],onCreated(){},onClose(){}}]);
      cases.push(['components/studio/project-parameters.tsx','ProjectParameters',{type:kind,value:project.projectSettingsFromDraft(helpers.initialCreationDraft(kind,undefined,{locale,market})),worlds:[],sections:JSON.parse(readFileSync(new URL('../../third_party/storyforge/world-sections.json',import.meta.url),'utf8')),onChange(){},onWorldChange(){}}]);
      cases.push(['components/studio/project-settings.tsx','ProjectSettings',{type:kind,value:{...project.projectSettingsFromDraft(helpers.initialCreationDraft(kind,undefined,{locale,market})),creative:{genres:[kind==='novel'?'悬疑推理':'悬疑'],core:['身份反转'],styles:['温暖治愈']}},onChange(){}}]);
    }
    for(const [file,name,props] of cases) {
      const html=render(load(file)[name],props);
      assert.ok(html.length>50,file);
      if(['en','ar'].includes(locale)) assert.doesNotMatch(visible(html),/[\u3400-\u9fff\u3040-\u30ff]/,`${locale}: ${file}`);
      if(locale==='zh-TW')assert.equal(visible(html),loadI18n('traditional').toTraditional(visible(html)),file);
      assert.doesNotMatch(html,/lang="ja"/,file);
    }
    assert.equal(helpers.creationPayload({...draft,title:'Untouched user title'},'小说创作',false).output_locale,locale);
    assert.equal(helpers.creationPayload({...draft,title:'Untouched user title'},'小说创作',false).market,market);
    const samples=load('content/samples/index.ts').samplesForLocale(locale);
    assert.ok(samples.some(s=>s.work.content_type==='novel')&&samples.some(s=>s.work.content_type==='short_drama'));
    for(const sample of samples) {
      const html=render(load('components/studio/sample-reader.tsx').SampleReader,{sample});
      if(['en','ar'].includes(locale))assert.doesNotMatch(visible(html),/[\u3400-\u9fff\u3040-\u30ff]/);
      assert.equal(sample.work.output_locale,locale);
      assert.equal(sample.work.chapters.length,3);
    }
  });
}
test('translation formats nested unit labels and native errors without changing manuscript values',()=>{
  assert.equal(createTranslator('en')('第2章标题'),'chapter 2 title');
  const {localizedError}=loadI18n('translate');
  assert.equal(localizedError('一个未登记的内部错误','ar',409),createTranslator('ar')('内容或任务状态已变化，请刷新核对；当前编辑保留。'));
  const {load}=loader('en');
  const sample=load('content/samples/index.ts').samplesForLocale('ar')[0];
  const original=JSON.stringify(sample);
  const copy=load('content/samples/index.ts').sampleCreationInput(sample);
  assert.equal(copy.output_locale,'ar');assert.equal(copy.market,'arab');
  copy.world_snapshot.sections.world_rules='changed';assert.equal(JSON.stringify(sample),original);
  const raw='我的作品';
  const input={...load('lib/studio/inspiration.ts').initialCreationDraft('novel'),title:raw,premise:raw};
  const payload=load('lib/studio/inspiration.ts').creationPayload(input,'小说创作',false);
  assert.equal(payload.title,raw);assert.equal(payload.premise,raw);
  assert.equal(createTranslator('en')('删除《我的作品》'),'Delete “我的作品”');
  assert.equal(createTranslator('en')('添加“我的作品”'),'Add “我的作品”');
  const {load: loadEnglish,render: renderEnglish}=loader('en','global');
  const sampleInput=loadEnglish('lib/studio/inspiration.ts').creationPayload({...loadEnglish('lib/studio/inspiration.ts').initialCreationDraft('novel'),title:raw,premise:raw},'小说创作',false);
  const form=renderEnglish(loadEnglish('components/studio/work-form.tsx').WorkForm,{kind:'novel',mode:'小说创作',worlds:[],sampleInput,onCreated(){},onClose(){}});
  assert.ok(form.includes('value="我的作品"'));
  const referenceDraft=loadEnglish('lib/studio/inspiration.ts').initialCreationDraft('novel',{id:'ref',title:'Native source',genre:'Mystery',logline:'A key.',hook:'A room.'},{locale:'en',market:'global'});
  assert.doesNotMatch(referenceDraft.premise,/[\u3400-\u9fff]/);
});
test('full-text editors localize protocol labels reversibly while retaining all prose and whitespace',()=>{
  const {structuredText}=loadI18n('structured-text');
  const raw='【人物：Mara】\n定位：\n  Repairer\n年龄：\n  32\n性格：\n  - Patient\n背景：\n  Literal 背景： stays here.\n人物关系：\n  Eli\n【人物结束】\n\n【Plotloom 大纲 v1】\n粗纲：\n    A key is found.\n【单元 1 阶段 0】\n    Neighbors meet.\n【大纲结束】';
  for(const locale of ['en','ja-JP','ar','zh-TW']){
    const shown=structuredText(raw,locale);
    assert.equal(structuredText(shown,locale,true),raw);
    assert.ok(shown.includes('  Literal 背景： stays here.'));
    assert.doesNotMatch(shown,/^【单元|^定位：|^【大纲结束】/m);
  }
});

test('Traditional Chinese keeps literal user values, converts unknown UI/errors and preserves built-in samples',()=>{
  const {toTraditional}=loadI18n('traditional');
  const ui=createTranslator('zh-TW');
  assert.equal(ui('模型未返回有效的正文与事实摘要JSON（第2行，第1列）'),toTraditional('模型未返回有效的正文与事实摘要JSON（第2行，第1列）'));
  assert.equal(ui('删除《我的简体测试》'),'刪除《我的简体测试》');
  assert.equal(loadI18n('translate').localizedError('String should have at least 1 character','zh-TW',422),ui('输入不符合要求，请检查必填项、数量和长度。'));
  const {load}=loader('zh-TW','china');
  const library=load('content/samples/index.ts');
  const original=JSON.stringify(library.officialSamples);
  for(const sample of library.samplesForLocale('zh-TW')) {
    assert.equal(sample.work.output_locale,'zh-TW');
    const slug=sample.slug.replace('zh-TW-','');
    const source=library.getOfficialSample(slug);
    assert.equal(library.sampleDocument(sample),toTraditional(library.sampleDocument(source)));
    assert.equal(sample.work.premise,toTraditional(source.work.premise));
    assert.equal(library.getOfficialSample(slug,undefined,'zh-TW').slug,sample.slug);
    assert.equal(library.sampleCreationInput(sample).output_locale,'zh-TW');
  }
  assert.equal(JSON.stringify(library.officialSamples),original);
});

test('quick Traditional switch saves a valid independent preference cookie and reloads once',()=>{
  const saved={document:globalThis.document,window:globalThis.window,location:globalThis.location};
  let reloads=0;
  globalThis.document={cookie:''};globalThis.location={protocol:'https:'};globalThis.window={location:{reload(){reloads++;}}};
  try {
    const {load}=loader('en','global',true);
    load('components/studio/language-settings.tsx').LanguageSwitcher().props.onChange({target:{value:'zh-TW'}});
    assert.match(globalThis.document.cookie,/plotloom-preferences=zh-TW~china;/);
    assert.match(globalThis.document.cookie,/Secure/);assert.equal(reloads,1);
  }finally{Object.assign(globalThis,saved);}
});

test('Traditional sample old URLs, metadata and downloads use the same complete Traditional content without shared caching',async()=>{
  const {load}=loader('zh-TW','china');
  const library=load('content/samples/index.ts');
  const slug=library.officialSamples[0].slug;
  const traditional=library.getOfficialSample(slug,undefined,'zh-TW');
  const metadata=await load('app/samples/[slug]/page.tsx').generateMetadata({params:Promise.resolve({slug})});
  assert.ok(metadata.title.startsWith(traditional.work.title));
  const {GET}=load('app/samples/[slug]/download/route.ts');
  const response=await GET(new Request('https://example.test/samples/'+slug+'/download'),{params:Promise.resolve({slug})});
  assert.equal((await response.text()).replace(/^\uFEFF/,''),library.sampleDocument(traditional));
  assert.match(response.headers.get('cache-control'),/private.*no-store/);
  assert.match(response.headers.get('vary'),/Cookie/);
});
test('Arabic toolbar follows visual arrow direction and keeps focus without scrolling',()=>{
  const {load}=loader('ar','arab',true);
  const selected=[],focused=[];
  const oldDocument=globalThis.document;
  globalThis.document={getElementById:id=>({focus:options=>focused.push({id,options})})};
  try {
    const {ProjectToolbar}=load('components/studio/project-shell.tsx');
    const tree=ProjectToolbar({type:'novel',current:'premise',value:{premise:'',characters:'',outline:'',chapters:[],units:3},onSelect:step=>selected.push(step)});
    function nodes(node){return !node||typeof node!=='object'?[]:[node,...React.Children.toArray(node.props?.children).flatMap(nodes)];}
    const first=nodes(tree).find(node=>node.props?.role==='tab');
    for(const key of ['ArrowLeft','ArrowRight','Home','End'])first.props.onKeyDown({key,preventDefault(){}});
    assert.deepEqual(selected,['settings','chapter','premise','chapter']);
    assert.deepEqual(focused.map(item=>item.options),Array(4).fill({preventScroll:true}));
  } finally {globalThis.document=oldDocument;}
});
test('per-work region and output-language controls change independently without generation',()=>{
  const {load}=loader('en','global',true);
  const {WorkLanguageSettings}=load('components/studio/language-settings.tsx');
  const changes=[];
  const tree=WorkLanguageSettings({market:'arab',locale:'en',onChange:value=>changes.push(value)});
  function nodes(node){return !node||typeof node!=='object'?[]:[node,...React.Children.toArray(node.props?.children).flatMap(nodes)];}
  const selects=nodes(tree).filter(node=>node.type==='select');
  selects[0].props.onChange({target:{value:'japan'}});
  selects[1].props.onChange({target:{value:'ar'}});
  assert.deepEqual(changes,[{market:'japan',output_locale:'en'},{market:'arab',output_locale:'ar'}]);
});
test('all literal UI messages and world-field labels have complete translations',()=>{
  const catalogue=JSON.parse(readFileSync(new URL('../src/lib/i18n/messages.json',import.meta.url),'utf8'));
  function walk(dir){return readdirSync(new URL(`../src/${dir}`,import.meta.url),{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(`${dir}/${e.name}`):[`${dir}/${e.name}`]);}
  for(const file of [...walk('components/studio'),...walk('components/sites/storyplay'),...walk('app')].filter(f=>f.endsWith('.tsx')&&!f.includes('creation'))) {
    const source=ts.createSourceFile(file,readFileSync(new URL(`../src/${file}`,import.meta.url),'utf8'),ts.ScriptTarget.Latest,true,ts.ScriptKind.TSX);
    function visit(node){if(ts.isCallExpression(node)&&node.expression.getText(source)==='ui'&&node.arguments[0]&&ts.isStringLiteral(node.arguments[0])){
      const key=node.arguments[0].text.replace(/\s+/g,' ').trim();
      if(/[\u3400-\u9fff]/.test(key))assert.ok(catalogue[key],`${file}: ${key}`);
    }ts.forEachChild(node,visit);}visit(source);
  }
});
