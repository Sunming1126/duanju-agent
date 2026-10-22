import assert from 'node:assert/strict';
import vm from 'node:vm';
import { boot, read } from './check_frontend.mjs';
const jp = boot({market:'japan'});
const cn = boot({market:'china'});
const keys = ['kbQueryPh','insQPh','insTagPh','worldviewPh','extTextPh','convTitlePh','hkNamePh','hkTagsPh','wTagsPh','wNotePh','ideaPh','heroPh','wIdeaPh','wHeroPh','catNamePh'];
for (const language of ['zh-CN','en','ja-JP']) {
  jp.context.setDuanjuLocale(language);
  for (const key of keys) {
    const value = jp.context.t(key);
    assert.notEqual(value, key);
    assert(!/龙王|龍王|打脸|馬甲|马甲|闪婚|灵气|霊気|Dragon King|spiritual energy|son-in-law/i.test(value), `${language}: ${key}: ${value}`);
  }
  for (const key of ['referenceNotice','sourceReference','synopsisTitle','excerptTitle','useReference','scriptSample']) assert.notEqual(jp.context.t(key), key);
}
const emotionOptions = jp.document.querySelectorAll('#insEmotion option');
assert.deepEqual(Array.from(emotionOptions).slice(1).map((option)=>option.value), ['恋愛','シリアス','コメディ','熱血','ほのぼの','復讐','切ない','青春']);
cn.context.setDuanjuLocale('zh-CN');
assert.match(cn.context.t('insQPh'), /龙王/);
jp.context.setDuanjuLocale('zh-CN');
assert.equal(jp.context.t('labelContentType'), '内容类型');
// Exercise the actual reference modal renderer, including safe source links and HTML escaping.
const hub = read('static/hub.js');
let captured;
const start = hub.indexOf('  function showModalView(item)');
const end = hub.indexOf('  /* ---------- 灵感库列表', start);
const context = vm.createContext({window:jp.context, showModal:(title,html)=>captured={title,html},fmtText:(s)=>String(s).replaceAll('<','&lt;'),esc:(s)=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')});
vm.runInContext(hub.slice(start,end)+';globalThis.renderReference = showModalView;',context);
context.renderReference({title:'Test',record_type:'source_reference',read_only:true,outline:'Synopsis',excerpt:'Excerpt',source_url:'https://example.com/" onclick="bad',script:'fake full script'});
assert.match(captured.html,/Synopsis/);assert.match(captured.html,/Excerpt/);
assert(!captured.html.includes('fake full script'));
assert(captured.html.includes('&quot; onclick=&quot;bad'));
context.renderReference({title:'Test',record_type:'source_reference',read_only:true,source_url:'javascript:alert(1)'});
assert(!captured.html.includes('href='));
console.log('PASS: Japan examples in 3 interface languages; China examples retained; references show synopsis/excerpts, omit fake scripts and reject unsafe source links.');
