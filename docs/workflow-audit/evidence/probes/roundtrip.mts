// Read-only probe: in-memory SQLite, real Drizzle repos + real WorkflowDefinitionService.
const ROOT = 'file:///C:/Users/sidmishra/Desktop/New%20folder%20(2)/GeneratorAI';
const db = await import(`${ROOT}/packages/db/src/index.ts`);
const core = await import(`${ROOT}/packages/core/src/services/WorkflowDefinitionService.ts`);
const reg = await import(`${ROOT}/packages/core/src/services/TemplateRegistry.ts`);
const shared = await import(`${ROOT}/packages/shared/src/index.ts`);

const appDb = db.createDB(':memory:'); db.migrateDB(appDb);
const defRepo = new db.DrizzleWorkflowDefinitionRepository(appDb);
const stageRepo = new db.DrizzleStageDefinitionRepository(appDb);
const edgeRepo = new db.DrizzleStageEdgeRepository(appDb);
const runRepo = new db.DrizzleWorkflowRunRepository(appDb);
const logger = { info() {}, warn() {}, debug() {}, error() {} };
const svc = new core.WorkflowDefinitionService(
  defRepo, stageRepo, edgeRepo, new reg.TemplateRegistry(logger), undefined,
  (fn: () => Promise<unknown>) => db.withTransaction(appDb, fn), runRepo,
);

// 1. createDefinition with every workflow-level field (as the route would after zod)
const createBody = shared.CreateWorkflowDefinitionSchema.parse({
  name: 'Probe', sessionMode: 'per-stage',
  skills: [{ name: 'sk1' }], agents: [{ name: 'ag1' }],
  browserConfig: { enabled: true, visibility: 'visible' },
  defaultAgentRef: 'global:helper', useWorktree: false,
  orchestratorConfig: {
    codebaseAliases: ['frontend'], autoCommit: true,
    postProcessingSteps: [{ type: 'run_script', name: 'lint', config: { type: 'run_script', script: 'npm run lint' }, failOnError: true, order: 1, enabled: true }],
    resultValidations: [{ stageIndex: 0, rules: [{ type: 'contains', value: 'OK', message: 'm' }] }],
    preprocessingSteps: [{ type: 'set_variable', name: 'x', config: { variableName: 'a', value: 'b' } }],
    gitRepositories: [{ url: 'https://x/y.git', alias: 'legacy' }],
  },
});
const def = await svc.createDefinition(createBody);
const defBack = await svc.getDefinition(def.id);
console.log('[create] zod output has postProcessingSteps[0].enabled =', (createBody.orchestratorConfig as any).postProcessingSteps[0].enabled,
  '| gitRepositories kept =', 'gitRepositories' in (createBody.orchestratorConfig as any));
console.log('[create] persisted skills=', defBack.skills, 'agents=', defBack.agents, 'browserConfig=', (defBack as any).browserConfig,
  'defaultAgentRef=', defBack.defaultAgentRef, 'useWorktree=', defBack.useWorktree);

// 2. addStage with every stage field
const s1 = await svc.addStage({
  workflowDefinitionId: def.id, name: 'A', prompts: [{ label: 'p', text: 'hi', source: 'file', filePath: 'x.md', waitForCompletion: true }],
  skills: [{ name: 'stage-skill' }], promptType: 'file', browserConfig: { enabled: true }, agentMode: 'plan',
  agentRef: 'global:helper', approvalRequired: true, outputFormat: 'json', outputSchema: { type: 'object' },
  contextSources: ['B'], expectedOutput: 'x', timeoutMs: 5000, retryPolicy: { maxRetries: 2, backoffMs: 1000, backoffMultiplier: 2 },
  iterationConfig: { subWorkflowDefinitionId: def.id, inputMapping: {}, outputMapping: {}, maxIterations: 2 },
  harnessConfigOverrides: { model: 'm1' }, condition: { type: 'expression', expression: 'true' },
} as any);
const s1Back = await stageRepo.getById(s1.id);
console.log('[addStage] returned skills=', JSON.stringify(s1.skills), 'promptType=', s1.promptType, 'browserConfig=', JSON.stringify(s1.browserConfig));
console.log('[addStage] re-read  skills=', JSON.stringify(s1Back.skills), 'promptType=', s1Back.promptType, 'browserConfig=', JSON.stringify(s1Back.browserConfig), 'agentMode=', s1Back.agentMode, 'agentRef=', s1Back.agentRef);
const s2 = await svc.addStage({ workflowDefinitionId: def.id, name: 'B', prompts: [{ label: 'p', text: 'yo', waitForCompletion: true }] } as any);
await svc.addEdge({ workflowDefinitionId: def.id, fromStageId: s1.id, toStageId: s2.id, edgeType: 'on_failure' });

// 3. clearing fields through update (route PUT body is zod partial)
const putSchema = shared.CreateStageSchema.omit({ workflowDefinitionId: true }).partial();
const clearTry = putSchema.safeParse({ timeoutMs: null, retryPolicy: null, contextSources: null });
console.log('[update] clearing timeoutMs/retryPolicy/contextSources with null accepted by route schema? ', clearTry.success);

// 4. export -> import-json round trip (the CLI `workflow clone` path)
const exported = await svc.exportAsTemplate(def.id);
const parsedImport = shared.ImportWorkflowJsonSchema.safeParse(JSON.parse(JSON.stringify(exported)));
console.log('[roundtrip] import-json schema accepts export:', parsedImport.success, parsedImport.success ? '' : JSON.stringify(parsedImport.error.issues.slice(0, 3)));
if (parsedImport.success) {
  const strippedTop = Object.keys(exported).filter((k) => !(k in parsedImport.data));
  console.log('[roundtrip] top-level keys the importer silently strips:', strippedTop);
  const imported = await svc.importFromJSON(parsedImport.data);
  const a = imported.stages.find((s: any) => s.name === 'A');
  console.log('[roundtrip] imported def orchestratorConfig=', JSON.stringify(imported.orchestratorConfig), 'projectId=', imported.projectId,
    'skills=', imported.skills, 'defaultAgentRef=', imported.defaultAgentRef, 'tags=', imported.tags);
  console.log('[roundtrip] stage A agentMode=', a.agentMode, 'approvalRequired=', a.approvalRequired, 'outputFormat=', a.outputFormat,
    'contextSources=', a.contextSources, 'iterationConfig=', a.iterationConfig, 'prompt.source=', a.prompts[0].source, 'edges=', imported.edges.map((e: any) => e.edgeType));
}

// 5. deleteStage of a stage referenced by a stage_run (history exists)
const run = await runRepo.create({ id: shared.generateId(), workflowDefinitionId: def.id, name: 'r', status: 'completed', sessionMode: 'auto', variables: {}, createdAt: new Date(), updatedAt: new Date() } as any);
const srRepo = new db.DrizzleStageRunRepository(appDb);
await srRepo.create({ id: shared.generateId(), workflowRunId: run.id, stageDefinitionId: s1.id, name: 'A', status: 'completed', currentStep: 0, totalSteps: 1, retryCount: 0, version: 0, createdAt: new Date() } as any);
try { await svc.deleteStage(s1.id); console.log('[deleteStage] succeeded'); }
catch (e: any) { console.log('[deleteStage] threw:', e.constructor.name, String(e.message).slice(0, 120)); }
const afterEdges = await edgeRepo.getByDefinitionId(def.id);
const afterStages = await stageRepo.getByDefinitionId(def.id);
console.log('[deleteStage] after failure: stages=', afterStages.map((s: any) => s.name), 'edges=', afterEdges.length);

// 6. deleteDefinition force while an automation references it is out of scope; check validate
console.log('[validate]', JSON.stringify(await svc.validateDefinition(def.id)));
process.exit(0);
