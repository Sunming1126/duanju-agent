/* eslint-disable @typescript-eslint/no-require-imports */
const fs = require('fs');
const toTraditional = require('opencc-js/cn2t').Converter({from:'cn',to:'tw'});
const dir = 'src/lib/i18n/';
const result = {};
for (const line of fs.readFileSync(dir+'messages.tsv','utf8').split(/\r?\n/).filter(Boolean)) {
  const [key,...values] = line.split('\t');
  if(values.length!==3 || values.some(v=>!v.trim())) throw new Error('Invalid translation: '+key);
  if(result[key.trim()]) throw new Error('Duplicate translation: '+key);
  result[key.trim()] = [...values.map(v=>v.trim().replaceAll('\\n','\n')),toTraditional(key.trim().replaceAll('\\n','\n'))];
}
fs.writeFileSync(dir+'messages.json', JSON.stringify(result,null,2)+'\n');
console.log(Object.keys(result).length+' messages compiled for English, Japanese, Arabic and Traditional Chinese.');
