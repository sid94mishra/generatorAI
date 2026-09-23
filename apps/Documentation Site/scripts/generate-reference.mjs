import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import { fileURLToPath } from 'node:url';
const site = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repo = path.resolve(site, '../..');
const rel = p => path.relative(repo, p).replaceAll(path.sep, '/');
const read = p => fs.readFileSync(path.join(repo, p), 'utf8');
const write = (p,s) => { const dest=path.join(site,'docs',p); fs.mkdirSync(path.dirname(dest),{recursive:true}); fs.writeFileSync(dest,s); };
const scan = dir => fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name)).flatMap(e => ['node_modules','dist','dist-bundle','dist-electron','build','.expo','.git','.turbo','coverage','release','Documentation Site'].includes(e.name) || e.name.startsWith('.') ? [] : e.isDirectory()?scan(path.join(dir,e.name)):[path.join(dir,e.name)]);
const sources = ['apps','packages'].flatMap(d=>scan(path.join(repo,d))).filter(p=>/\.(tsx?|mjs|jsx?)$/.test(p)&&!/(?:__tests__|__fixtures__|e2e|\/tests\/|\.test\.|\.spec\.|\.config\.|\.d\.ts$)/.test(p));
const ast = p => ts.createSourceFile(p,read(p),ts.ScriptTarget.Latest,true,p.endsWith('tsx')?ts.ScriptKind.TSX:ts.ScriptKind.TS);
const walk = (node,visit) => {visit(node); ts.forEachChild(node,n=>walk(n,visit));};
const literal = n => n && (ts.isStringLiteral(n)||ts.isNoSubstitutionTemplateLiteral(n)) ? n.text : null;
const md = s => String(s??'').replaceAll('|','&#124;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\n',' ');
const intro = title => `# ${title}\n\nGenerated from the checked-out source by \`npm run reference:generate\`. This is a structural index, not a claim that every branch was exercised at runtime.\n\n`;
const mounts = new Map();
for(const [file,base] of [['apps/server/src/routes/index.ts','/api'],['apps/server/src/app.ts','']]) {
 const tree=ast(file), imports=new Map();
 walk(tree,n=>{if(ts.isImportDeclaration(n)&&n.importClause?.namedBindings&&ts.isNamedImports(n.importClause.namedBindings)){ for(const e of n.importClause.namedBindings.elements) imports.set(e.name.text,path.posix.normalize(path.posix.join(path.posix.dirname(file),n.moduleSpecifier.text)).replace(/\.js$/,'.ts')); }});
 walk(tree,n=>{if(ts.isCallExpression(n)&&ts.isPropertyAccessExpression(n.expression)&&n.expression.name.text==='use'&&literal(n.arguments[0])!==null){for(const arg of n.arguments.slice(1)){ if(ts.isCallExpression(arg)&&ts.isIdentifier(arg.expression)&&imports.has(arg.expression.text)) mounts.set(imports.get(arg.expression.text),base+literal(n.arguments[0])); }}});
}
const endpoints=[]; const apiDir=path.join(repo,'apps/server/src/routes');
for(const f of fs.readdirSync(apiDir).filter(f=>f.endsWith('.ts')).sort()){
 const file='apps/server/src/routes/'+f, tree=ast(file);
 walk(tree,n=>{
  if(!ts.isCallExpression(n)||!ts.isPropertyAccessExpression(n.expression)||!['get','post','put','patch','delete','options','head','all'].includes(n.expression.name.text)||n.expression.expression.getText(tree)!=='router')return;
  const route=literal(n.arguments[0]);if(route===null)return;
  const mount=mounts.get(file); const full=mount===undefined?route:(mount+(route==='/'?'':route)).replace(/\/{2,}/g,'/');
  endpoints.push({method:n.expression.name.text.toUpperCase(),path:full,source:file,line:tree.getLineAndCharacterOfPosition(n.getStart()).line+1,mounted:mount!==undefined});
 });
}
let api=intro('HTTP route catalogue')+'Read [API usage](./api.md) for authentication, error handling, streams, and the distinction between public API and internal desktop channels. Paths below come from literal router registrations and their mounts; conditional routes still require their feature flags. WebSocket upgrades are listed separately in API usage.\n\n';
for(const file of [...new Set(endpoints.map(x=>x.source))]){
 api+=`## ${path.basename(file,'.ts')}\n\nSource: \`${file}\`.\n\n| Method | Path | Source line |\n| --- | --- | --- |\n`;
 for(const e of endpoints.filter(x=>x.source===file))api+=`| \`${e.method}\` | \`${md(e.path)}\`${e.mounted?'':' (unresolved mount)'} | ${e.line} |\n`;
 api+='\n';
}
api+='## Additional route surfaces\n\nTwo regular-expression routes are deliberately listed manually: `GET /api/workspaces/:id/browser/files/*` (`browser.ts`) and `GET /api/widget-assets/:extensionId/*` (`extensions.ts`, served only on the dedicated widget origin from `index.ts`). They are not part of the literal registrations above. The latter comes from a separate router factory in the same file.\n\nSpeech, browser, and terminal WebSocket upgrades are described in [API usage](./api.md). Relay `/healthz`, `/relay/assignment`, and relay WebSocket channels belong to the separate relay app and are described in [Transports](/architecture/transports.md). The catalogue is a server route index, not an exhaustive list of every transport message.\n';
write('reference/http-routes.md',api);
const env=new Map();
for(const p of sources){const file=rel(p),tree=ast(file);walk(tree,n=>{
 let name=null;
 if(ts.isElementAccessExpression(n)&&n.expression.getText(tree)==='process.env')name=literal(n.argumentExpression);
 if(ts.isPropertyAccessExpression(n)&&n.expression.getText(tree)==='process.env')name=n.name.text;
 if(ts.isCallExpression(n)&&/^(readBoundedInt|readBoundedFloat|readEnvInt|readEnvFloat)$/.test(n.expression.getText(tree)))name=literal(n.arguments[0]);
 if(name&&/^[A-Z][A-Z0-9_]+$/.test(name)){if(!env.has(name))env.set(name,new Set());env.get(name).add(`${file}:${tree.getLineAndCharacterOfPosition(n.getStart()).line+1}`);}
 });}
let envmd=intro('Environment variable index')+'This lists static environment reads in runtime source, including platform, provider, diagnostics, and internal launch variables. **Presence does not make a variable a supported end-user setting.** Defaults and meaning are owned by each reader; see [configuration](./configuration.md) for supported setup paths. Dynamic property names, aliases, and external provider variables may not be captured. Values and local environment files are never read.\n\n| Variable | Source locations |\n| --- | --- |\n';
for(const [name,refs] of [...env].sort(([a],[b])=>a.localeCompare(b)))envmd+=`| \`${name}\` | ${[...refs].slice(0,8).map(x=>'`'+x+'`').join('<br>')}${refs.size>8?' (additional readers in source)':''} |\n`;
write('reference/environment.md',envmd);
const modules=[];
for(const root of ['apps','packages'])for(const d of fs.readdirSync(path.join(repo,root),{withFileTypes:true}).filter(d=>d.isDirectory()&&d.name!=='Documentation Site')){
 const manifest=path.join(repo,root,d.name,'package.json');if(!fs.existsSync(manifest))continue;
 const pkg=JSON.parse(fs.readFileSync(manifest,'utf8'));
 modules.push({path:`${root}/${d.name}`,name:pkg.name,version:pkg.version,private:pkg.private??false,scripts:pkg.scripts??{},dependencies:[...new Set([...Object.keys(pkg.dependencies??{}),...Object.keys(pkg.devDependencies??{}),...Object.keys(pkg.optionalDependencies??{})])].filter(x=>x.startsWith('@generatorai/'))});
}
const pages=sources.filter(p=>/apps\/web\/src\/pages\/[^/]+\.tsx$/.test(p)).map(rel);
const mobile=scan(path.join(repo,'apps/mobile/app')).filter(p=>p.endsWith('.tsx')).map(rel);
const settings=scan(path.join(repo,'apps/web/src/components/settings/sections')).filter(p=>p.endsWith('.tsx')).map(rel);
const schemas=scan(path.join(repo,'packages/shared/src/config')).filter(p=>p.endsWith('.ts')).map(rel);
let modmd=intro('Source coverage inventory')+'Use this inventory with the [module map](/architecture/modules.md), [feature index](/features/index.md), [clients](/clients/overview.md), and [settings guide](/clients/settings.md). Counts deliberately exclude this documentation site and build output. Generated entries ensure even less visible process hosts and contracts are discoverable.\n\n## Applications and packages\n\nThe top-level product modules exclude the separate `agent-tests` workspace and the nested `apps/mobile/modules/generatorai-device-key` native module; both are covered in the module map. Local dependencies include runtime, development/build-time, and optional manifest dependencies.\n\n| Directory | Package | Local manifest dependencies | Documentation |\n| --- | --- | --- | --- |\n';
for(const m of modules)modmd+=`| \`${m.path}\` | \`${m.name}\` | ${m.dependencies.map(x=>'`'+x.replace('@generatorai/','')+'`').join(', ')||'—'} | [Architecture](/architecture/modules.md) |\n`;
for(const [title,files,link] of [['Web page components',pages,'/clients/web.md'],['Mobile route files',mobile,'/clients/mobile.md'],['Desktop/web settings components',settings,'/clients/settings.md'],['Shared configuration contracts',schemas,'/reference/configuration.md']]){
 modmd+=`\n## ${title}\n\nGuide: [${title}](${link}).\n\n`+files.map(x=>'- `'+x+'`').join('\n')+'\n';
}
modmd+='\n## Count definitions\n\nWeb page component files are not unique URLs: several components handle both creation and editing. Mobile route-tree files include layouts and redirects, not just rendered screens. The 13 settings component files implement 15 registry sections: `Catalogs.tsx` contains Skills, MCP, and Templates.\n\n## Maintenance boundary\n\nThis index detects source structure, not semantic completeness. A new control within an existing page still needs an authored guide update and a human review. The docs cover the working tree including uncommitted product changes present at authoring time. Regenerate after application changes; review the diff before publishing.\n';
write('reference/coverage.md',modmd);
const cliSnapshot=read('docs/CLI_SURFACE_SNAPSHOT.md');
write('reference/cli-surface.md','# CLI and TUI reference snapshot\n\nThis is a documentation-local copy of the repository’s registry/keymap snapshot, not a newly executed CLI session. Source: `docs/CLI_SURFACE_SNAPSHOT.md`. See [CLI usage](/clients/cli.md) for workflows and current-source caveats. Refresh the upstream snapshot when command implementations change, then run this site’s reference generator.\n\n'+cliSnapshot.replace(/^# CLI \/ TUI surface snapshot\n/,'').replace(/Generated from the live registry and keymap[\s\S]*?## Totals/,'## Totals'));
const sectionRegistry = read('apps/web/src/components/settings/sectionRegistry.tsx');
const settingsSections = [...sectionRegistry.matchAll(/\{ id: '([^']+)', label: '([^']+)'/g)].map(m=>({id:m[1],label:m[2]}));
const settingsTable = '\n## Settings registry\n\nAll '+settingsSections.length+' sections from `sectionRegistry.tsx`:\n\n| Section | URL |\n| --- | --- |\n'+settingsSections.map(s=>'| '+s.label+' | `/settings/'+s.id+'` |').join('\n')+'\n';
write('reference/coverage.md',modmd+settingsTable);
const manifest={modules,endpoints,settingsSections,webPages:pages,mobileRoutes:mobile,settings,schemas,environment:[...env.keys()].sort(),sourceFiles:sources.map(rel)};
fs.mkdirSync(path.join(site,'audit'),{recursive:true});fs.writeFileSync(path.join(site,'audit/source-inventory.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({modules:modules.length,endpoints:endpoints.length,webPages:pages.length,mobileRoutes:mobile.length,settings:settings.length,environment:env.size,sourceFiles:sources.length},null,2));
