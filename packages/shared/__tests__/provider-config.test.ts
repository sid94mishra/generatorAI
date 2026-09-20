import { describe, it, expect } from 'vitest';
import { HARNESS_PROVIDER_IDS, REASONING_EFFORTS } from '../src/types/ProviderConfig.js';
import { AgentRuntimePolicySchema, ResolvePreviewSchema } from '../src/config/AgentSchemas.js';
import { CreateChatSchema } from '../src/config/ChatSchemas.js';
import { CreateWorkflowDefinitionSchema } from '../src/config/WorkflowDefinitionSchemas.js';

describe('provider configuration across authoring surfaces', () => {
  it.each(HARNESS_PROVIDER_IDS)('accepts %s for reusable agents, previews, chats and workflows', (harnessType) => {
    const config = { harnessType, model: 'catalog-model', reasoningEffort: 'high' };
    expect(AgentRuntimePolicySchema.parse(config)).toEqual(config);
    expect(ResolvePreviewSchema.parse({ harnessType }).harnessType).toBe(harnessType);
    expect(CreateChatSchema.parse({ name: 'Audit', harnessConfig: config }).harnessConfig).toEqual(config);
    expect(CreateWorkflowDefinitionSchema.parse({ name: 'Audit', harnessConfig: config }).harnessConfig).toEqual(config);
  });

  it.each(REASONING_EFFORTS)('preserves %s instead of rejecting a level offered by the model catalog', (reasoningEffort) => {
    expect(AgentRuntimePolicySchema.parse({ reasoningEffort }).reasoningEffort).toBe(reasoningEffort);
    expect(CreateChatSchema.parse({ name: 'Audit', harnessConfig: { reasoningEffort } }).harnessConfig?.reasoningEffort).toBe(reasoningEffort);
    expect(CreateWorkflowDefinitionSchema.parse({ name: 'Audit', harnessConfig: { reasoningEffort } }).harnessConfig?.reasoningEffort).toBe(reasoningEffort);
  });

  it('still rejects unknown providers and reasoning levels', () => {
    expect(AgentRuntimePolicySchema.safeParse({ harnessType: 'unknown' }).success).toBe(false);
    expect(AgentRuntimePolicySchema.safeParse({ reasoningEffort: 'unknown' }).success).toBe(false);
    expect(CreateChatSchema.safeParse({ name: 'Audit', harnessConfig: { harnessType: 'unknown' } }).success).toBe(false);
  });
});
