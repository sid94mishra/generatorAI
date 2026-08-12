// commands/index.ts — register all Phase 1 commands on the Commander program

import type { Command } from 'commander';
import type { CLIPlatformClient } from '../platform/types.js';
import { registerSystemCommands } from './system.js';
import { registerCopilotCommands } from './copilot.js';
import { registerConfigCommands } from './config.js';
import { registerInitCommand } from './init.js';
import { registerCompletionsCommand } from './completions.js';
import { registerChatCommands } from './chat.js';
import { registerAgentCommands } from './agent.js';
import { registerWorkflowCommands } from './workflow.js';
import { registerRunCommands } from './run.js';
import { registerOrchestratorCommands } from './orchestrator.js';
import { registerAutomationCommands } from './automation.js';
import { registerProjectCommands } from './project.js';
import { registerWorkspaceCommands } from './workspace.js';
import { registerWebhookCommands } from './webhook.js';
import { registerHarnessCommands } from './harness.js';
import { registerWorkflowScriptCommands } from './workflow-script.js';
import { registerBrowserCommands } from './browser.js';
import { registerDeviceCommands } from './device.js';

export function registerAllCommands(
  program: Command,
  getClient: () => Promise<CLIPlatformClient>,
): void {
  registerSystemCommands(program, getClient);
  // Device/credential management. Takes no client: it must work even when the
  // CLI has no credential yet (that is what `device pair` is for).
  registerDeviceCommands(program);
  registerCopilotCommands(program, getClient);
  registerConfigCommands(program, getClient);
  registerChatCommands(program, getClient);
  registerAgentCommands(program, getClient);
  registerWorkflowCommands(program, getClient);
  registerRunCommands(program, getClient);
  registerOrchestratorCommands(program, getClient);
  registerAutomationCommands(program, getClient);
  registerProjectCommands(program, getClient);
  registerWorkspaceCommands(program, getClient);
  registerWebhookCommands(program, getClient);
  registerHarnessCommands(program, getClient);
  registerWorkflowScriptCommands(program, getClient);
  registerBrowserCommands(program, getClient);
  registerInitCommand(program, getClient);
  registerCompletionsCommand(program);
}
