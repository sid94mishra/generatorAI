// The registry, assembled.
//
// One function builds the complete command surface. Everything downstream —
// the binary, the TUI palette, completions, companion RPC and the docs — is
// derived from what this returns, so adding a command here adds it to all
// five at once.

import { CommandRegistry } from '../registry/registry.js';
import { automationCommands, AUTOMATION_GROUP } from './automation.js';
import { chatCommands, CHAT_GROUP } from './chat.js';
import { configCommands, connectCommands, CONFIG_GROUP, CONNECT_GROUP } from './connect.js';
import { deviceCommands, DEVICE_GROUP } from './device.js';
import {
  agentCommands,
  browserCommands,
  computerCommands,
  extensionCommands,
  GROUPS as PLATFORM_GROUPS,
  orchestratorCommands,
  platformCommands,
  reviewCommands,
  scriptCommands,
  templateCommands,
  widgetCommands,
} from './platform.js';
import { projectCommands, PROJECT_GROUP } from './project.js';
import { runCommands, RUN_GROUP } from './run.js';
import { systemCommands, SYSTEM_GROUP } from './system.js';
import { terminalCommands, TERMINAL_GROUP, workspaceCommands, WORKSPACE_GROUP } from './workspace.js';
import { workflowCommands, WORKFLOW_GROUP } from './workflow.js';

export interface BuildRegistryOptions {
  /** CLI version, reported by `system version` and stamped on RPC methods. */
  version?: string;
}

export function buildRegistry(options: BuildRegistryOptions = {}): CommandRegistry {
  const registry = new CommandRegistry();

  for (const group of [
    CONNECT_GROUP,
    DEVICE_GROUP,
    CHAT_GROUP,
    WORKFLOW_GROUP,
    RUN_GROUP,
    AUTOMATION_GROUP,
    PROJECT_GROUP,
    WORKSPACE_GROUP,
    TERMINAL_GROUP,
    ...PLATFORM_GROUPS,
    SYSTEM_GROUP,
    CONFIG_GROUP,
  ]) {
    registry.declareGroup(group);
  }

  registry.register(
    ...connectCommands(),
    ...deviceCommands(),
    ...chatCommands(),
    ...agentCommands(),
    ...workflowCommands(),
    ...runCommands(),
    ...automationCommands(),
    ...projectCommands(),
    ...workspaceCommands(),
    ...terminalCommands(),
    ...browserCommands(),
    ...computerCommands(),
    ...extensionCommands(),
    ...widgetCommands(),
    ...reviewCommands(),
    ...scriptCommands(),
    ...templateCommands(),
    ...orchestratorCommands(),
    ...platformCommands(),
    ...systemCommands(options.version),
    ...configCommands(),
  );

  return registry.freeze();
}

export * from './_shared.js';
