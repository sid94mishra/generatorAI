import fs from 'node:fs';
import path from 'node:path';
import ts from 'typescript';
import {site,repo,loadSource} from './source-loader.mjs';
const dir=path.join(site,'docs/configuration');fs.mkdirSync(dir,{recursive:true});
const inputs=[
 ['server','Server runtime','packages/shared/src/config/AppConfig.ts'],
 ['chats','Chats and interactions','packages/shared/src/config/ChatSchemas.ts'],
 ['agents','Agents and capability overrides','packages/shared/src/config/AgentSchemas.ts'],
 ['workflows','Workflow definition documents (v2 graph)','packages/workflow-spec/src/schemas/graph.ts'],
 ['automations','Automations and datasets','packages/shared/src/config/AutomationSchemas.ts'],
 ['browser','Workspace browser','packages/shared/src/config/BrowserConfigSchema.ts'],
 ['mcp','MCP connections','packages/shared/src/config/McpSchemas.ts'],
 ['extensions','Extension manifests and installation','packages/shared/src/config/ExtensionManifestSchema.ts'],
 ['widgets','Widget instances and actions','packages/shared/src/config/WidgetSchemas.ts'],
 ['orchestration','Background task contracts','packages/shared/src/config/OrchestratorSchemas.ts'],
 ['scripts','Definition records, templates and script profiles','packages/workflow-spec/src/definition.ts'],
 ['templates','Hooks, variables, prompts and result rules','packages/workflow-spec/src/schemas/common.ts'],
 ['cli','CLI and TUI configuration','packages/cli-core/src/config/schema.ts'],
];
const escape=v=>String(v??'').replaceAll('|','&#124;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('\n',' ');
const json=v=>JSON.stringify(v,(_,x)=>x instanceof RegExp?String(x):x);
function unwrap(s){const flags=[];let def;for(let n=0;n<20;n++){
 const d=s._def,t=d.typeName;
 if(t==='ZodDefault'){def=d.defaultValue();s=d.innerType;continue;}
 if(t==='ZodOptional'||t==='ZodNullable'){flags.push(t==='ZodOptional'?'optional':'nullable');s=d.innerType;continue;}
 if(t==='ZodEffects'){flags.push(d.effect.type);s=d.schema;continue;}
 if(t==='ZodCatch'){flags.push('catch fallback');s=d.innerType;continue;}
 if(t==='ZodBranded'||t==='ZodReadonly'){s=d.type||d.innerType;continue;}break;
 }return {s,flags,def};}
function typename(schema){const {s}=unwrap(schema),d=s._def,t=d.typeName;
 if(t==='ZodEnum')return d.values.map(json).join(' / ');
 if(t==='ZodLiteral')return json(d.value);
 if(t==='ZodArray')return `array of ${typename(d.type)}`;
 if(t==='ZodRecord')return `map of ${typename(d.valueType)}`;
 if(t==='ZodUnion'||t==='ZodDiscriminatedUnion')return `${t==='ZodDiscriminatedUnion'?`variants by ${d.discriminator}`:'union'} (${d.options.map(typename).join(' / ')})`;
 return t.replace('Zod','').toLowerCase()+(d.coerce?' (coerced)':'');}
function constraints(s,flags){const d=s._def,parts=[];
 for(const c of d.checks||[])parts.push(c.kind+(c.value!==undefined?` ${c.value}`:'')+(c.inclusive===false?' (exclusive)':'')+(c.regex?` ${c.regex}`:''));
 for(const key of ['minLength','maxLength','exactLength'])if(d[key])parts.push(`${key} ${d[key].value}`);
 if(d.typeName==='ZodObject')parts.push(`unknown keys: ${d.unknownKeys}`);
 parts.push(...flags.filter(x=>!['optional','nullable'].includes(x)));return parts.join('; ')||'—';}
function rows(schema,prefix='',depth=0){if(depth>18)throw Error('Unexpected recursive schema');
 const {s,flags,def}=unwrap(schema),d=s._def;
 let optional=flags.includes('optional'); if(!prefix&&d.typeName==='ZodObject')return Object.entries(s.shape).flatMap(([k,v])=>rows(v,k,depth+1));
 const probe=schema.safeParse(undefined);
 let presence=probe.success?(probe.data===undefined?'optional':`default ${json(def!==undefined?def:probe.data)}`):'required';
 if(flags.includes('nullable'))presence+='; null accepted';
 const result=[{field:prefix||'(value)',type:typename(schema),presence,constraints:constraints(s,flags)}];
 if(d.typeName==='ZodObject')for(const [k,v] of Object.entries(s.shape))result.push(...rows(v,`${prefix}.${k}`,depth+1));
 if(d.typeName==='ZodArray'&&['ZodObject','ZodUnion','ZodDiscriminatedUnion'].includes(unwrap(d.type).s._def.typeName))result.push(...rows(d.type,`${prefix}[]`,depth+1));
 if(d.typeName==='ZodRecord'&&unwrap(d.valueType).s._def.typeName==='ZodObject')result.push(...rows(d.valueType,`${prefix}.{key}`,depth+1));
 if(d.typeName==='ZodUnion'||d.typeName==='ZodDiscriminatedUnion')d.options.forEach((v,i)=>{if(unwrap(v).s._def.typeName==='ZodObject')result.push(...rows(v,`${prefix}<variant ${i+1}>`,depth+1));});
 return result;
}
const inventory=[];
for(const [slug,title,file] of inputs){
 const module=loadSource(file),source=fs.readFileSync(path.join(repo,file),'utf8');
 const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true);
 const descriptions={};
 for(const st of tree.statements)if(ts.isVariableStatement(st))for(const decl of st.declarationList.declarations){
  if(!ts.isIdentifier(decl.name))continue;
  descriptions[decl.name.text]=(st.jsDoc||[]).map(d=>typeof d.comment==='string'?d.comment:'').join(' ').trim();
 }
 const schemas=Object.entries(module).filter(([,v])=>v&&typeof v.safeParse==='function'&&v._def);
 let md=`# ${title}: configuration fields\n\nGenerated from \`${file}\` by \`npm run configuration:generate\`. These are the actual evaluated Zod contracts, including composed/partial schemas, defaults, nested objects, unions, and numeric/string limits.\n\nStart with the [configuration map](./index.md) and [worked examples](./examples.md). **Schema defaults are not necessarily effective runtime defaults**: entrypoints, persisted preferences, agent resolution, and route logic may override them. A field accepted by a schema is not a promise of UI availability or provider support.\n\nNested fields apply only when their parent/union variant is present. Arrays use \`[]\`; records use \`{key}\`. Required children of an optional object do not make that parent required. Custom refinements, transforms and cross-field rules are preserved in the source contract below and explained in the feature guides.\n\n`;
 for(const [name,schema] of schemas){const fields=rows(schema);inventory.push({file,schema:name,page:`configuration/${slug}`,fields});
 md+=`## ${name}\n\n${descriptions[name]?descriptions[name]+'\n\n':''}| Field | Type / choices | Input / default | Constraints |\n| --- | --- | --- | --- |\n`;
 md+=fields.map(r=>`| ${escape(r.field)} | ${escape(r.type)} | \`${escape(r.presence)}\` | ${escape(r.constraints)} |`).join('\n')+'\n\n';
 }
 md+=`## Complete validation contract\n\nThe following source snapshot contains the additional refinements, transformations, comments, and imported contract names. It is reference material, not a configuration file to paste into the app.\n\n<details>\n<summary>Read the complete ${path.basename(file)} source contract</summary>\n\n\`\`\`typescript\n${source.trim()}\n\`\`\`\n\n</details>\n`;
 fs.writeFileSync(path.join(dir,slug+'.md'),md);
}
fs.writeFileSync(path.join(site,'audit/configuration-inventory.json'),JSON.stringify(inventory,null,2)+'\n');
let routeMd='# Supplemental route validation contracts\n\nThese validators are declared in server route files rather than exported by the shared configuration modules. They are extracted as source, without importing route handlers or starting the server. Use the [host/client preference guide](./projects-and-settings.md) for application defaults and the [HTTP catalogue](../reference/http-routes.md) for endpoint paths. A validator is only one part of authorization and route-level semantic checks.\n\n';
let routeCount=0;
for(const name of fs.readdirSync(path.join(repo,'apps/server/src/routes')).filter(n=>n.endsWith('.ts')).sort()){
 const file='apps/server/src/routes/'+name,source=fs.readFileSync(path.join(repo,file),'utf8');
 const tree=ts.createSourceFile(file,source,ts.ScriptTarget.Latest,true),found=[];
 function visit(node){if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&/Schema$/.test(node.name.text)&&node.initializer)found.push(node);ts.forEachChild(node,visit);}visit(tree);
 if(!found.length)continue;
 routeMd+=`## ${name.replace('.ts','')}\n\nSource: \`${file}\`. Imported symbols retain their source names; see the linked feature/configuration guides for those values.\n\n`;
 for(const node of found){routeCount++;routeMd+=`### ${node.name.text}\n\n\`\`\`typescript\nconst ${node.getText(tree)};\n\`\`\`\n\n`;}
}
fs.writeFileSync(path.join(dir,'route-contracts.md'),routeMd);
console.log(`Generated ${inputs.length} configuration references, ${inventory.length} schemas, ${inventory.reduce((n,s)=>n+s.fields.length,0)} field rows.`);
console.log(`Indexed ${routeCount} supplemental route-local validation contracts.`);
