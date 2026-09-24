import fs from 'node:fs';
import path from 'node:path';
const shared = await import('file:///C:/Users/sidmishra/Desktop/New%20folder%20(2)/GeneratorAI/packages/shared/dist/index.js');
const dir = 'C:/Users/sidmishra/Desktop/New folder (2)/GeneratorAI/templates/system';
for (const f of fs.readdirSync(dir).filter(f=>f.endsWith('.json'))) {
  const raw = JSON.parse(fs.readFileSync(path.join(dir,f),'utf8'));
  const r = shared.WorkflowTemplateSchema.safeParse(raw);
  if (!r.success) { console.log(f, 'INVALID', r.error.issues.slice(0,3).map(i=>i.path.join('.')+':'+i.message)); continue; }
  const t = r.data;
  const rawKeys = new Set(); raw.stages?.forEach(s=>Object.keys(s).forEach(k=>rawKeys.add(k)));
  const parsedKeys = new Set(); t.stages.forEach(s=>Object.keys(s).forEach(k=>parsedKeys.add(k)));
  const stripped=[...rawKeys].filter(k=>!parsedKeys.has(k));
  const topStripped = Object.keys(raw).filter(k=>!(k in t));
  console.log(f, 'OK id=',t.id,'model=',t.harnessConfig?.model,'rawModel=',raw.harnessConfig?.model,'stageStripped=',stripped,'topStripped=',topStripped, 'stageOverrideModels=', t.stages.map(s=>s.harnessConfigOverrides?.model ?? '-').join(','), 'rawOverrides=', raw.stages.map(s=>s.harnessConfigOverrides? JSON.stringify(s.harnessConfigOverrides).slice(0,60):'-').join(' | '));
  // simulate import-json of an exported template
  const imp = shared.ImportWorkflowJsonSchema.safeParse(t);
  if (!imp.success) console.log('  import-json of template INVALID:', imp.error.issues.slice(0,4).map(i=>i.path.join('.')+':'+i.message));
  else console.log('  import-json top-level stripped:', Object.keys(t).filter(k=>!(k in imp.data)));
}
