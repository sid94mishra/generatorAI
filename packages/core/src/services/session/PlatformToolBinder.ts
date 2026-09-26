// ────────────────────────────────────────────────────────────────
// PlatformToolBinder — the platform tool surface of one session.
//
// Browser, computer use, widgets, custom (extension) tools, the orchestrator
// tool set and the hook bridge, for either owner (chat or stage). The chat
// create path is the canonical order and must stay byte-identical (R-10):
// browser → computer → widgets → SCM hint → [MCP] → custom → orchestrator →
// workflows → hooks. The composer calls the methods in that order; each one
// appends its tools and system block and nothing else. The workflow tools
// (P06) come after every existing tool, so a session without them keeps
// its tool prefix byte-identical.
// ────────────────────────────────────────────────────────────────

import { COMPUTER_USE_SKILL_ID, COMPUTER_USE_SKILL_NAME } from '@generatorai/shared';
import type { AgentToolPolicy, ChatSourceControlOptions } from '@generatorai/shared';
import { buildBrowserToolSet } from '../../tools/browser/index.js';
import { buildComputerToolSet } from '../../tools/computer/index.js';
import { buildWidgetTools } from '../../tools/widgetTools.js';
import { buildOrchestratorToolSet } from '../../tools/orchestrator/index.js';
import { isExtensionAuthorToolName } from '../../tools/extensionAuthorTools.js';
import { buildWorkflowToolSet, WORKFLOW_AUTHORING_HINT, type WorkflowToolCaller, type WorkflowToolTurn } from '../../tools/workflows/index.js';
import type { ToolCallContext } from '../../domain/ports/IAgentHarness.js';
import { ORCHESTRATOR_SYSTEM_PROMPT } from '../orchestrator/prompts.js';
import type { StageOrchestratorParent } from '../orchestrator/OrchestratorService.js';
import {
  BROWSER_SYSTEM_HINT,
  COMPUTER_USE_SYSTEM_HINT,
  EXTENSION_AUTHORING_HINT,
  WIDGET_SYSTEM_HINT,
  buildAutoCommitHint,
} from '../chatSystemHints.js';
import { appendSystemBlock, appendTools, unionList, type ConversationConfig } from './cfg.js';
import { ownerId, ownerTag, type SessionComposerDeps, type SessionOwner } from './types.js';

/** What every binder method needs to know about the session it binds. */
export interface BindTarget {
  owner: SessionOwner;
  sessionId: string;
  conversationId: string;
  /** The session's execution workspace, when it has one. */
  workspaceId?: string;
  /** The bound agent's resolved capability groups. */
  groups: AgentToolPolicy;
}

export class PlatformToolBinder {
  constructor(private readonly deps: SessionComposerDeps) {}

  /**
   * Integrated browser: ten built-in tools plus the one-line hint, whenever
   * the session has a workspace and the agent keeps the `browser` group.
   * `autoStart` pre-boots Chromium when the workspace's browser config asks
   * for a visible browser (create paths); otherwise the first
   * `open_browser_page` call boots it lazily. `reattach` re-grants the agent
   * a browser the user detached (a fresh stage is a fresh intent).
   */
  async browser(
    cfg: ConversationConfig,
    t: BindTarget,
    opts: { autoStart: boolean; reattach?: boolean; browserConfig?: Record<string, unknown> },
  ): Promise<void> {
    const { browserService, workspaceManager } = this.deps;
    if (!browserService || !t.workspaceId || !t.groups.browser) return;
    try {
      if (opts.reattach) browserService.reattachOnPrompt(t.workspaceId);
      if (opts.autoStart) {
        const workspace = await workspaceManager?.getExecutionWorkspace(t.workspaceId);
        if (workspace) {
          // Per-session overrides (visibility, allowedHosts, evalAllowed…)
          // take effect for this session without a DB round-trip.
          if (opts.browserConfig) {
            workspace.browserConfig = {
              ...((workspace.browserConfig as Record<string, unknown> | undefined) ?? {}),
              ...opts.browserConfig,
            };
          }
          const resolved = browserService.resolveConfig(workspace.browserConfig);
          // visibility 'off' means "give the model the tools, spawn nothing".
          if (resolved.enabled && resolved.visibility !== 'off') {
            await browserService.ensureStarted(workspace).catch((err) => {
              console.warn(`[PlatformToolBinder] Browser auto-start failed for ${ownerTag(t.owner)}:`, err);
            });
          }
        }
      }
      // Registered even when Chromium is not up yet: open_browser_page
      // lazy-starts it. Browser tools go FIRST — the model's primary path.
      const tools = buildBrowserToolSet({ browserService, workspaceId: t.workspaceId, owner: ownerTag(t.owner) });
      appendTools(cfg, tools, 'start');
      appendSystemBlock(cfg, BROWSER_SYSTEM_HINT);
    } catch (err) {
      console.warn(`[PlatformToolBinder] Browser tool registration failed for ${ownerTag(t.owner)}:`, err);
    }
  }

  /**
   * Computer use: the `computer_*` tools, their hint and the staged platform
   * skill, bound to the workspace's managed root. Only when the deployment
   * switch is on and the owner allows it (`enabled`): chats follow the
   * switch, stages must opt in and are refused on bypass runs (PD-5).
   */
  async computer(
    cfg: ConversationConfig,
    t: BindTarget,
    opts: { enabled: boolean; refusal?: () => string | null },
  ): Promise<void> {
    const { computerService, workspaceManager } = this.deps;
    if (!opts.enabled || !computerService?.isEnabled() || !t.workspaceId) return;
    try {
      const workspace = await workspaceManager?.getExecutionWorkspace(t.workspaceId);
      // Screenshots and the staged skill are platform artifacts: managed
      // root, never the directory the agent edits.
      const workspaceRoot = workspace?.rootPath;
      if (!workspaceRoot) return;
      const built = buildComputerToolSet({
        computerService,
        workspaceId: t.workspaceId,
        workspaceRoot,
        ...(t.owner.kind === 'chat' ? { chatId: t.owner.chatId } : {}),
        owner: ownerTag(t.owner),
      });
      // R6 — decided per call: a run switched to bypass after binding, or a
      // later owner of a shared conversation that never opted in, is refused.
      const refusal = opts.refusal;
      const tools = refusal
        ? built.map((tool) => ({
            ...tool,
            handler: async (args: Record<string, unknown>, callCtx?: ToolCallContext) => {
              const reason = refusal();
              if (reason) throw new Error(reason);
              return tool.handler(args, callCtx);
            },
          }))
        : built;
      appendTools(cfg, tools);
      appendSystemBlock(cfg, COMPUTER_USE_SYSTEM_HINT);
      await this.registerComputerUseSkill(cfg, workspaceRoot);
    } catch (err) {
      console.warn(`[PlatformToolBinder] Computer tool registration failed for ${ownerTag(t.owner)}:`, err);
    }
  }

  /**
   * Publishes the Computer Use skill through the harness's skill mechanism,
   * so the model loads the manual itself, once, only when it needs it.
   */
  private async registerComputerUseSkill(cfg: ConversationConfig, workspaceRoot: string): Promise<void> {
    const { systemArtifacts, agentStaging } = this.deps;
    if (!systemArtifacts || !agentStaging) return;
    const skills = await systemArtifacts.listSystemArtifacts('skill');
    const skill = skills.find((s) => s.id === COMPUTER_USE_SKILL_ID);
    if (!skill) return;
    const content = await systemArtifacts.getSystemArtifactContent(skill.id);
    // Staged under our own name, never the artifact's — see COMPUTER_USE_SKILL_NAME.
    const dir = await agentStaging.ensurePlatformSkill(workspaceRoot, { name: COMPUTER_USE_SKILL_NAME, content });
    unionList(cfg, 'skills', [COMPUTER_USE_SKILL_NAME]);
    unionList(cfg, 'skillDirectories', [dir]);
  }

  /**
   * Widget tools bound to the owner's scope (chat, or run + stage run) plus
   * the widget hint. The authoring block rides along only when the session
   * actually has the authoring tools (reviews 3.7 and 5.3).
   */
  widgets(cfg: ConversationConfig, t: BindTarget, opts: { enabled: boolean }): void {
    const { widgetService, widgetRegistry } = this.deps;
    if (!opts.enabled || !widgetService || !widgetRegistry || !t.groups.widgets) return;
    const scope =
      t.owner.kind === 'chat'
        ? { chatId: t.owner.chatId }
        : { workflowRunId: t.owner.workflowRunId, stageRunId: t.owner.stageRunId };
    const tools = buildWidgetTools(
      { widgetService, widgetRegistry },
      { sessionId: t.sessionId, ...scope, assetsBase: this.deps.widgetAssetsBase ?? '' },
    );
    appendTools(cfg, tools);
    appendSystemBlock(
      cfg,
      t.groups.extensionAuthoring ? WIDGET_SYSTEM_HINT + EXTENSION_AUTHORING_HINT : WIDGET_SYSTEM_HINT,
    );
  }

  /** Agent-native source control: tell the agent the platform commits for it (chat only). */
  sourceControlHint(cfg: ConversationConfig, sourceControl: ChatSourceControlOptions | undefined): void {
    if (sourceControl?.autoCommit) appendSystemBlock(cfg, buildAutoCommitHint(sourceControl));
  }

  /**
   * Every registered custom tool, minus the extension-authoring pair unless
   * the agent grants `extensionAuthoring` (review 5.3: `reload_extension`
   * imports code into the server process, so it is never a default).
   */
  custom(cfg: ConversationConfig, t: BindTarget): void {
    const registry = this.deps.customToolRegistry;
    if (!registry || registry.size === 0) return;
    const all = registry.list();
    const tools = t.groups.extensionAuthoring
      ? all
      : all.filter((tool) => !isExtensionAuthorToolName((tool as { name?: string }).name ?? ''));
    appendTools(cfg, tools);
  }

  /**
   * The background-agent tool set, the orchestrator prompt, and the removal
   * of the harness's native delegation tools (the SDK's in-process `Agent`
   * workers evaporate with the turn; platform workers are chats). Workers
   * never get it, so they cannot recursively spawn.
   */
  orchestrator(
    cfg: ConversationConfig,
    t: BindTarget,
    opts: { enabled: boolean; includeAgentDiscovery: boolean; stageParent?: StageOrchestratorParent },
  ): void {
    const orchestratorService = this.deps.orchestratorService;
    if (!opts.enabled || !orchestratorService) return;
    if (t.owner.kind === 'stage') {
      if (!opts.stageParent) return;
      orchestratorService.registerStageParent(opts.stageParent);
    }
    const parentId = ownerId(t.owner);
    const tools = buildOrchestratorToolSet({
      orchestratorService,
      parentId,
      owner: `orchestrator:${parentId}`,
      // 7th tool only for agent-driven orchestrators: adding it
      // unconditionally would change every orchestrator chat's tool prefix.
      includeAgentDiscovery: opts.includeAgentDiscovery,
    });
    appendTools(cfg, tools);
    appendSystemBlock(cfg, `\n\n${ORCHESTRATOR_SYSTEM_PROMPT}`);
    unionList(cfg, 'excludedBuiltinTools', ['Agent', 'Task']);
  }

  /**
   * The workflow tools (P06 WP-6.1): the run group (list, describe, run,
   * check, respond, cancel) and the authoring group (guide, validate, plan,
   * draft), each when the owner's group is on; the authoring hint rides
   * along with the authoring tools. Appended LAST (R-10).
   */
  workflows(
    cfg: ConversationConfig,
    t: BindTarget,
    opts: { run: boolean; authoring: boolean; orchestrator: boolean; turnOf: () => WorkflowToolTurn | undefined },
  ): void {
    const host = this.deps.workflowTools;
    if (!host || (!opts.run && !opts.authoring)) return;
    const caller: WorkflowToolCaller =
      t.owner.kind === 'chat'
        ? { kind: 'chat', chatId: t.owner.chatId, sessionId: t.sessionId, conversationId: t.conversationId, orchestrator: opts.orchestrator }
        : { kind: 'stage', runId: t.owner.workflowRunId, stageRunId: t.owner.stageRunId, conversationId: t.conversationId };
    const tools = buildWorkflowToolSet(host, caller, { run: opts.run, authoring: opts.authoring }, { turnOf: opts.turnOf, owner: ownerTag(t.owner) });
    if (tools.length === 0) return;
    appendTools(cfg, tools);
    if (opts.authoring && host.hasAuthoring) appendSystemBlock(cfg, WORKFLOW_AUTHORING_HINT);
  }

  /** The synchronous hook bridge (HKS-01), one factory for both owners. */
  hooks(cfg: ConversationConfig, t: BindTarget): void {
    const bridge = this.deps.buildHookBridge?.({
      owner: t.owner,
      sessionId: t.sessionId,
      conversationId: t.conversationId,
    });
    if (bridge) cfg['hooks'] = bridge;
  }

  /**
   * The widget interactions the user performed since the owner's last turn,
   * as a prefix for the next prompt (T4). Drained: each interaction is
   * reported once. Empty string when there is nothing to report.
   */
  widgetDigest(owner: SessionOwner, sessionId: string): string {
    const interactions = this.deps.widgetService?.drainRecentInteractions(
      owner.kind === 'chat' ? owner.chatId : undefined,
      sessionId,
    );
    if (!interactions || interactions.length === 0) return '';
    const safeJson = (v: unknown): string => {
      try {
        const s = JSON.stringify(v);
        return s.length > 400 ? s.slice(0, 400) + '…' : s;
      } catch {
        return String(v);
      }
    };
    const lines = interactions.map((it) => {
      if (it.kind === 'action') {
        return (
          `  - ${it.instanceId} (${it.descriptorId}): action "${it.action}"` +
          (it.payload !== undefined ? ` payload=${safeJson(it.payload)}` : '')
        );
      }
      if (it.kind === 'context') {
        return `  - ${it.instanceId} (${it.descriptorId}): note → ${it.content ?? ''}`;
      }
      return `  - ${it.instanceId} (${it.descriptorId}): state changed → ${safeJson(it.state)}`;
    });
    return (
      `[Widget interactions since your last turn — the user did these; ` +
      `call read_widget(instanceId) for full current state before acting]\n` +
      lines.join('\n') +
      `\n\n`
    );
  }

  /** Drop the owner's registrations (a stage orchestrator parent). */
  dispose(owner: SessionOwner): void {
    if (owner.kind === 'stage') this.deps.orchestratorService?.unregisterStageParent(owner.stageRunId);
  }
}
