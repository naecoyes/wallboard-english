// Dependency-free release checks. Never read local credential values.
import { execFileSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const files=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root}).toString().split('\0').filter(Boolean);
const source=[...new Set(files)].filter(f=>/\.(?:js|mjs)$/.test(f));
for(const file of source) execFileSync(process.execPath,['--check',resolve(root,file)],{stdio:'pipe'});
const sw=readFileSync(resolve(root,'sw.js'),'utf8');
const assets=new Set([...sw.matchAll(/'\.\/(.*?)'/g)].map(m=>m[1]).filter(Boolean));
for(const asset of assets) assert.ok(existsSync(resolve(root,asset)),'Missing SW asset: '+asset);
for(const file of source.filter(f=>f.startsWith('js/'))) {
  const text=readFileSync(resolve(root,file),'utf8');
  for(const match of text.matchAll(/(?:from\s*|import\s*\()\s*['"](\.[^'"]+)['"]/g)) {
    const dependency=resolve(root,dirname(file),match[1]);
    if(dependency.endsWith('/config.local.js')) continue;
    assert.ok(existsSync(dependency),file+' imports missing '+match[1]);
    assert.ok(assets.has(dependency.slice(root.length+1)),file+' imports module absent from SW: '+match[1]);
  }
}
assert.ok(!files.some(f=>f==='js/config.local.js'),'Local configuration must never be tracked');
execFileSync('git',['check-ignore','-q','js/config.local.js'],{cwd:root});
console.log(`Release checks passed: ${source.length} JavaScript files, ${assets.size} cached assets.`);
