import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const ts = require('typescript');
const React = require('react');
function load(path, dependencies) {
  const source = readFileSync(new URL('../src/'+path, import.meta.url), 'utf8');
  const code = ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX,target:ts.ScriptTarget.ES2022}}).outputText;
  const exports = {};
  new Function('exports','require',code)(exports,name => dependencies[name] || require(name));
  return exports;
}
const config=load('lib/studio/creation-access.ts',{});
test('creation destinations preserve query and hash and reject external, unrelated and malformed URLs',()=>{
  const origin='https://plotloom.test';
  for(const path of ['/studio/novels/new?sample=ar-courtyard-key-novel#draft','/studio/scripts/new?mode=adapt','/studio/works/private-id?step=chapter&number=2']) assert.equal(config.creationDestination(path,origin),path);
  for(const path of ['/samples','/account','//evil.test/studio/novels/new','https://evil.test/studio/novels/new','/studio/novels/new/extra','javascript:alert(1)']) assert.equal(config.creationDestination(path,origin),null);
});
function harness(user=null, url='https://plotloom.test/') {
  const states=[], refs=[], effects=[], handlers={}, calls=[], visits=[];
  let stateIndex=0,refIndex=0;
  const saved={window:globalThis.window,document:globalThis.document,Element:globalThis.Element};
  class Element { constructor(href){this.href=href;} closest(){return this;} }
  globalThis.Element=Element;
  globalThis.window={location:{href:url,origin:'https://plotloom.test',assign:href=>visits.push(href)},addEventListener:(event,fn)=>handlers[event]=fn,removeEventListener(){},dispatchEvent:event=>handlers[event.type]?.(event)};
  globalThis.document={addEventListener:(event,fn)=>handlers[event]=fn,removeEventListener(){},getElementById:()=>null};
  const hooks={...React,useState(initial){const index=stateIndex++;if(!(index in states))states[index]=initial;return [states[index],value=>states[index]=value];},useRef(initial){return refs[refIndex++] ||= {current:initial};},useEffect(fn){effects.push(fn);}};
  const mod=load('components/studio/creation-access.tsx',{'react':hooks,'@/lib/i18n/provider':{useUI:()=>value=>value},'@/lib/studio/api':{ensureStudioSpace:async()=>{},backendRequest:async path=>{calls.push(path);return {space_id:'test',user};}},'@/lib/studio/creation-access':config,'./account-menu':{LoginDialog:()=>null},'next/navigation':{useRouter:()=>({replace:href=>visits.push(href)})}});
  return {...mod,calls,visits,handlers,render(component,props){stateIndex=0;refIndex=0;return component(props);},mount(){for(const fn of effects.splice(0))fn();},click(path){let prevented=false,stopped=false;handlers.click({target:new Element(path),preventDefault(){prevented=true;},stopPropagation(){stopped=true;}});return ()=>({prevented,stopped});},restore(){Object.assign(globalThis,saved);}};
}
const flush=()=>new Promise(resolve=>setImmediate(resolve));
test('guest clicking a creation link opens login and resumes the exact URL after success without generation',async()=>{
  const h=harness();try{
    h.render(h.CreationAccess);h.mount();await flush();
    const result=h.click('https://plotloom.test/studio/novels/new?sample=example');await flush();
    assert.deepEqual(result(),{prevented:true,stopped:true});
    const dialog=h.render(h.CreationAccess);assert.equal(typeof dialog.props.onSuccess,'function');
    dialog.props.onSuccess();assert.deepEqual(h.visits,['/studio/novels/new?sample=example']);
    assert.ok(h.calls.every(path=>path==='/studio/session'));
  }finally{h.restore();}
});
test('signed-in navigation remains a normal link and guest public links are unaffected',async()=>{
  for(const user of [null,{id:'account'}]){
    const h=harness(user);try{h.render(h.CreationAccess);h.mount();await flush();
      assert.deepEqual(h.click('https://plotloom.test/samples')(),{prevented:false,stopped:false});
      if(user)assert.deepEqual(h.click('https://plotloom.test/studio/scripts/new')(),{prevented:false,stopped:false});
    }finally{h.restore();}
  }
});
test('direct editor visits hide children until verified and guests request login; cancellation exits safely',async()=>{
  const h=harness(null,'https://plotloom.test/studio/scripts/new');try{
    h.render(h.CreationAccess);h.mount();await flush();
    assert.notEqual(h.render(h.CreationGuard,{children:'PRIVATE EDITOR'}),'PRIVATE EDITOR');h.mount();await flush();
    const dialog=h.render(h.CreationAccess);assert.equal(typeof dialog.props.onClose,'function');
    dialog.props.onClose();assert.deepEqual(h.visits,['/workspace']);
  }finally{h.restore();}
  const signed=harness({id:'account'});try{
    assert.notEqual(signed.render(signed.CreationGuard,{children:'EDITOR'}),'EDITOR');signed.mount();await flush();
    assert.equal(signed.render(signed.CreationGuard,{children:'EDITOR'}),'EDITOR');
  }finally{signed.restore();}
});
