import fs from 'node:fs';
import path from 'node:path';
const root=path.resolve('docs');
const walk=d=>fs.readdirSync(d,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(d,e.name)):e.name.endsWith('.md')?[path.join(d,e.name)]:[]);
const pages=walk(root),errors=[];
for(const p of pages){
 const text=fs.readFileSync(p,'utf8');
 if(!/^# .+/m.test(text))errors.push(`${p}: missing H1`);
 if((text.match(/^```/gm)||[]).length%2)errors.push(`${p}: unmatched code fence`);
 for(const match of text.matchAll(/\]\((\.\.?\/[^\s)#]+)(?:#[^)]*)?\)/g)){
  if(!match[1].endsWith('.md')&&!path.extname(match[1]))errors.push(`${p}: use an explicit .md source link: ${match[1]}`);
 }
 for(const match of text.matchAll(/\]\(([^\s)]+\.md)(?:#[^)]*)?\)/g)){
  const target=match[1];if(/^https?:/.test(target))continue;
  const resolved=target.startsWith('/')?path.join(root,target):path.resolve(path.dirname(p),target);
  if(!fs.existsSync(resolved))errors.push(`${p}: missing Markdown target ${target}`);
 }
 if(/\b(TODO|FIXME|Lorem ipsum)\b/.test(text))errors.push(`${p}: unfinished marker`);
}
const inventory=JSON.parse(fs.readFileSync('audit/source-inventory.json','utf8'));
const coverage=fs.readFileSync(path.join(root,'architecture/modules.md'),'utf8');
for(const m of inventory.modules)if(!coverage.includes(m.path)&&!coverage.includes(m.name)&&!coverage.includes('`'+path.basename(m.path)+'`'))errors.push(`Module is missing from architecture guide: ${m.path}`);
const config=JSON.parse(fs.readFileSync('package.json','utf8'));
if(config.dependencies?.vue||config.devDependencies?.vitepress)errors.push('Site must use React, not Vue/VitePress');
console.log(`${pages.length} Markdown pages; ${inventory.modules.length} product modules; ${inventory.endpoints.length} HTTP route registrations.`);
if(errors.length){console.error(errors.join('\n'));process.exit(1);}console.log('Content structure, local Markdown links, module coverage, and React stack checks passed.');
