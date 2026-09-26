// ────────────────────────────────────────────────────────────────
// SessionComposer — ONE code path builds every agent session (P02 WP-2.8).
//
// A chat and a workflow stage are owners of the same kind of session: the
// composer decides what the model can see and do (the provider params and
// the per-turn options); the owner decides what to say and when (the chat
// turn loop, the stage script). Canonical order — the chat create path,
// which keeps an existing chat's tool and system-block order byte-identical
// (R-10):
//
//   1 base · 2 resume id · 3 workspace exposure · 4 agent projection ·
//   5 explicit spec (one precedence rule, create = resume) · 6 workspace
//   hint · 7 platform tools: browser → computer → widgets → SCM hint → MCP →
//   custom → orchestrator → hooks · skills delivery · 8 mode config ·
//   9 agent instructions LAST.
//
// Nothing a provider cannot do is dropped silently: capability loss, dropped
// MCP servers, blocked computer use and gating limits come back as
// `warnings`, which the owner emits as `harness.session_info` (C-11).
// ────────────────────────────────────────────────────────────────

import { DEFAULT_AGENT_MODE, generateId, isMcpSecretRef, parseMcpSecretRef } from '@generatorai/shared';
import type {
  AgentMode,
  AgentOverrides,
  ChatSourceControlOptions,
  ExecutionWorkspace,
  HarnessConfig,
  WorkspaceExposure,
  ResolvedAgentProjection,
} from '@generatorai/shared';
import type { SessionSpec } from '@generatorai/workflow-spec';
import type {
  CreateConversationParams,
  IAgentHarness,
  SendPromptOptions,
} from '../../domain/ports/IAgentHarness.js';
import { getDefaultChatPermissionMode, providerHasNativePlanGate, resolveTurnPermissionMode } from '../agentModePolicy.js';
import { inheritWorkerCapabilitiesFrom } from '../orchestrator/OrchestratorService.js';
import { appendAgentInstructions, applyAgentProjection, applyExplicitSpec, deliverSkills } from './agentProjection.js';
import { formatConversationBindingKey } from './bindingKey.js';
import { appendSystemBlock, systemContent, unionList, type ConversationConfig } from './cfg.js';
import { capabilityLevelsFor } from './capabilityLevels.js';
import type { GatePort, TurnContextRegistry } from './gates.js';
import { applyModeConfig, planPromptPrefix } from './modeConfig.js';
import { checkPermissionGating, turnOptionsFrom, type PermissionModeSource } from './permissionSource.js';
import { PlatformToolBinder, type BindTarget } from './PlatformToolBinder.js';
import { resolveMcp } from './resolveMcp.js';
import { ComposeError, ownerTag, type ComposeWarning, type SessionComposerDeps, type SessionOwner, type TurnPolicy } from './types.js';
import { applyWorkspaceExposure } from './workspaceExposure.js';
import { buildWorkspaceHint } from '../chatSystemHints.js';

export interface ComposeInput {
  owner: SessionOwner;
  conversationId: string;
  mode: 'create' | 'resume';
  /** The merged session the model gets (a chat's; a workflow's ⊕ the stage's). */
  spec: SessionSpec;
  /**
   * The binding-site layer whose runtime scalars beat the agent (a chat's own
   * config, a stage's own session). Defaults to `spec`.
   */
  bindingSpec?: SessionSpec | undefined;
  /** Resolver layers for the agent projection (see `AgentProjectionInput`). */
  agent?: {
    overrides?: AgentOverrides | undefined;
    baseLayer?: Partial<HarnessConfig> | undefined;
    bindingLayer?: Partial<HarnessConfig> | undefined;
  };
  /** Frozen projection: resume and retry never re-resolve. */
  agentSnapshot?: ResolvedAgentProjection | undefined;
  /** Chat-only config the spec does not model. */
  extras?: { streaming?: boolean | undefined; configDir?: string | undefined };
  /** The session's execution workspace: its managed root stages skills and plans. */
  workspace?: ExecutionWorkspace | undefined;
  /** What the session sees of the workspace (cwd, extra directories, env, hint). */
  exposure?: WorkspaceExposure | undefined;
  projectId?: string | undefined;
  /** The provider's own session handle, for a conversation re-created after a restart. */
  resumeProviderSessionId?: string | undefined;
  /** Chat: not an orchestrator worker. Stage: always (gates are durable). */
  attended: boolean;
  /** The owner's gates; undefined installs none (plan mode not wired). */
  gates?: GatePort | undefined;
  permission: {
    source: PermissionModeSource;
    /** Chat: attach this construction-time mode (see `applyModeConfig`). */
    attach?: { mode: string | undefined } | undefined;
    /** The persistent mode as the owner's binding key records it (a chat's row value). */
    bindingMode?: string | undefined;
  };
  platform: {
    browser: { autoStart: boolean; reattach?: boolean; config?: Record<string, unknown> | undefined };
    /**
     * Chat: the deployment switch decides. Stage: opt-in (`spec.computerUse`),
     * refused on bypass (PD-5). An orchestrator worker passes its parent's
     * decision: `opted_in` (refused on bypass) or `off` (review R5).
     */
    computerUse: 'switch' | 'opt_in' | 'opted_in' | 'off';
    /** Orchestrator tool set requested by the owner (a chat's `orchestratorMode`). */
    orchestrator: boolean;
    sourceControl?: ChatSourceControlOptions | undefined;
    /** Run uploads (stage only): extra skill directories, sub-agents and prompt directories. */
    uploads?:
      | { skillDirectories?: string[] | undefined; customAgents?: unknown[] | undefined; promptDirectories?: string[] | undefined }
      | undefined;
  };
}

export interface ComposeResult {
  /** Handed to `harness.createConversation` / `resumeConversation`. */
  params: CreateConversationParams;
  /** The resolved agent; owners persist `redactProjection()` of it as the snapshot. */
  projection: ResolvedAgentProjection;
  /** The provider the session runs on, when it can be told. */
  provider: string | undefined;
  bindingKey: string;
  warnings: ComposeWarning[];
  /** Per-turn provider options: the source is re-read every turn. */
  turnOptions(agentMode?: AgentMode): Promise<SendPromptOptions>;
  /** The widget-interaction digest and (for providers without one) the plan-mode prefix. */
  preparePrompt(prompt: string, agentMode: AgentMode): string;
  /** Drop the owner's registrations. */
  dispose(): void;
  /** Stamp on every turn this owner sends (`beginTurn` extra `policy`). */
  turnPolicy: TurnPolicy;
}

export class SessionComposer {
  readonly binder: PlatformToolBinder;

  constructor(
    private readonly deps: SessionComposerDeps,
    private readonly harness: IAgentHarness,
    readonly turns: TurnContextRegistry,
  ) {
    this.binder = new PlatformToolBinder(deps);
  }

  async compose(i: ComposeInput): Promise<ComposeResult> {
    const warnings: ComposeWarning[] = [];
    const binding = i.bindingSpec ?? i.spec;

    // 1. base
    const cfg: ConversationConfig = {
      conversationId: i.conversationId,
      model: i.spec.model,
      harnessType: i.spec.harnessType,
      streaming: i.extras?.streaming ?? true,
    };
    // 2. resume id — a live adapter's own record still wins.
    if (i.resumeProviderSessionId) cfg['resumeProviderSessionId'] = i.resumeProviderSessionId;

    // 3. workspace exposure (the hint is appended after the caller's message)
    const workspaceHint = i.exposure ? applyWorkspaceExposure(cfg, i.exposure) : undefined;

    // 4. agent projection
    const scope = i.owner.kind;
    const agent = await applyAgentProjection(
      cfg,
      {
        scope,
        agentRef: i.spec.agentRef,
        overrides: i.agent?.overrides,
        baseLayer: i.agent?.baseLayer,
        bindingLayer: i.agent?.bindingLayer,
        projectId: i.projectId,
        workspaceRoot: i.workspace?.rootPath,
        snapshot: i.agentSnapshot,
      },
      this.deps,
    );
    const projection = agent.projection;
    warnings.push(...agent.warnings);

    // 5. explicit spec — one precedence rule for create and resume
    applyExplicitSpec(cfg, i.spec, binding, { configDir: i.extras?.configDir });
    await this.resolveProviderSecret(cfg);
    const uploads = i.platform.uploads;
    if (uploads?.skillDirectories?.length) unionList(cfg, 'skillDirectories', uploads.skillDirectories);
    if (uploads?.customAgents?.length) {
      cfg['customAgents'] = [...((cfg['customAgents'] as unknown[] | undefined) ?? []), ...uploads.customAgents];
    }
    if (uploads?.promptDirectories?.length) unionList(cfg, 'promptDirectories', uploads.promptDirectories);

    // 6. everything appended below is a PLATFORM block. A stage without
    // file-write or shell tools gets the directories without the rules on
    // where files go (P07 WP-7.1, F O-6).
    const replaceableBase = systemContent(cfg);
    const policy = projection.toolPolicy.groups;
    const readOnlyStage = i.owner.kind === 'stage' && !!i.exposure && policy.fileWrite === false && policy.shell === false;
    appendSystemBlock(
      cfg,
      readOnlyStage
        ? buildWorkspaceHint({
            workingDirectory: i.exposure!.workingDirectory,
            scratchDir: i.exposure!.scratchDir,
            rootPath: i.exposure!.rootPath,
            mounts: i.exposure!.mounts,
            writes: false,
          })
        : workspaceHint,
    );

    const provider = await this.providerOf(cfg, i.conversationId);
    const levels = capabilityLevelsFor(provider);
    const mode = (await i.permission.source.read()) ?? getDefaultChatPermissionMode();

    const defaultMode = i.spec.defaultAgentMode ?? DEFAULT_AGENT_MODE;

    // PD-17 — a stage whose run mode its provider cannot hold is refused, and
    // so is one whose turns run under a mode it cannot hold (a `plan` default
    // agent mode runs `plan` turns whatever the run mode; review R6).
    if (i.owner.kind === 'stage') {
      const gating = checkPermissionGating(provider, mode);
      if (gating.warning) warnings.push(gating.warning);
      checkPermissionGating(provider, resolveTurnPermissionMode(defaultMode, mode));
    }
    const computerUse = computerUsePolicy(i);

    // 7. platform tools, in the canonical order
    const sessionId = i.owner.sessionId;
    const target: BindTarget = {
      owner: i.owner,
      sessionId,
      conversationId: i.conversationId,
      ...(i.workspace ? { workspaceId: i.workspace.id } : {}),
      groups: projection.toolPolicy.groups,
    };
    const toolsBefore = toolCount(cfg);
    await this.binder.browser(cfg, target, {
      autoStart: i.platform.browser.autoStart,
      ...(i.platform.browser.reattach ? { reattach: true } : {}),
      ...(i.platform.browser.config ? { browserConfig: i.platform.browser.config } : {}),
    });
    await this.binder.computer(cfg, target, {
      enabled: this.computerUseAllowed(computerUse, mode, warnings),
      refusal: () => this.computerRefusal(i.conversationId),
    });
    this.binder.widgets(cfg, target, { enabled: i.spec.widgets !== false });
    this.binder.sourceControlHint(cfg, i.platform.sourceControl);
    const mcpWarnings = await resolveMcp(
      cfg,
      i.spec.mcp?.servers as Record<string, never> | undefined,
      i.owner,
      i.conversationId,
      this.deps.mcpHub,
    );
    warnings.push(...mcpWarnings);
    this.binder.custom(cfg, target);
    const isWorker = i.owner.kind === 'chat' && !!i.owner.parentChatId;
    const orchestrator =
      !isWorker && (i.platform.orchestrator || i.spec.orchestrator === true || projection.driving?.role === 'orchestrator');
    this.binder.orchestrator(cfg, target, {
      enabled: orchestrator,
      includeAgentDiscovery: !!projection.driving,
      ...(i.owner.kind === 'stage' && orchestrator
        ? {
            stageParent: {
              stageRunId: i.owner.stageRunId,
              workflowRunId: i.owner.workflowRunId,
              sessionId,
              ...(i.workspace ? { workspaceId: i.workspace.id } : {}),
              ...(i.projectId ? { projectId: i.projectId } : {}),
              ...(typeof cfg['model'] === 'string' ? { model: cfg['model'] as string } : {}),
              ...(projection.agentRef ? { agentRef: projection.agentRef } : {}),
              inherited: inheritWorkerCapabilitiesFrom({
                harnessConfig: {
                  ...(i.spec.tools?.excluded ? { excludedTools: i.spec.tools.excluded } : {}),
                  ...(i.spec.tools?.available ? { availableTools: i.spec.tools.available } : {}),
                  ...(i.spec.harnessType ? { harnessType: i.spec.harnessType } : {}),
                  ...(i.spec.mcp?.servers ? { mcpServers: i.spec.mcp.servers as HarnessConfig['mcpServers'] } : {}),
                },
                toolPolicy: projection.toolPolicy,
                permissionMode: mode as NonNullable<Parameters<typeof inheritWorkerCapabilitiesFrom>[0]['permissionMode']>,
                computerUse,
              }),
            },
          }
        : {}),
    });
    // P06 — the workflow tools, after every other tool (R-10). Workers never
    // (they must not fan out); opt-in for plain chats (PD-23); stages when
    // their agent grants them and the provider takes host tools (RV-9).
    const groups = projection.toolPolicy.groups;
    const wantsWorkflows = !isWorker && (groups.workflows === true || groups.workflowAuthoring === true);
    if (wantsWorkflows && i.owner.kind === 'stage' && levels?.hostTools === 'none') {
      warnings.push({
        code: 'workflow_tools_unsupported',
        message: `The ${provider} provider does not take host tools: this stage gets no workflow tools (use a subworkflow stage instead)`,
        params: { provider },
      });
    } else if (wantsWorkflows) {
      this.binder.workflows(cfg, target, {
        run: groups.workflows === true,
        authoring: groups.workflowAuthoring === true,
        orchestrator: i.owner.kind === 'chat' && orchestrator,
        turnOf: () => {
          const turn = this.turns.get(i.conversationId);
          return turn ? { turnId: turn.turnId, permissionMode: turn.permissionMode } : undefined;
        },
      });
    }
    this.binder.hooks(cfg, target);
    if (levels && toolCount(cfg) > toolsBefore) {
      if (levels.hostTools === 'none') {
        warnings.push({
          code: 'host_tools_unsupported',
          message: `The ${provider} provider does not take host tools: the platform tools (browser, widgets, custom) are not available to this session`,
          params: { provider },
        });
      } else if (levels.hostTools === 'start_only' && i.mode === 'resume') {
        warnings.push({
          code: 'host_tools_start_only',
          message: `The ${provider} provider binds host tools only when a thread starts; a resumed thread keeps the tools it started with`,
          params: { provider },
        });
      }
    }
    warnings.push(...(await deliverSkills(cfg, provider, i.workspace?.rootPath, this.deps.agentStaging, i.conversationId)));

    // 8. mode config: gates, plan-mode blocks, record_plan
    applyModeConfig(cfg, {
      conversationId: i.conversationId,
      turns: this.turns,
      gates: i.gates,
      attended: i.attended,
      groups: projection.toolPolicy.groups,
      planModeInstructions: i.spec.planModeInstructions,
      attachPermissionMode: i.permission.attach,
    });

    // 9. the agent instructions, LAST
    appendAgentInstructions(cfg, projection, replaceableBase);

    const bindingKey = formatConversationBindingKey({
      harnessType: (cfg['harnessType'] as string | undefined) ?? '',
      model: (cfg['model'] as string | undefined) ?? '',
      agentRef: projection.agentRef ?? '-',
      agentVersion: projection.agentVersion ?? 0,
      permissionMode: i.permission.bindingMode,
      computerUseEnabled: this.deps.computerService?.isEnabled() ?? false,
    });

    return {
      params: cfg as unknown as CreateConversationParams,
      projection,
      provider,
      bindingKey,
      warnings,
      turnPolicy: { computerUse, groups: projection.toolPolicy.groups },
      turnOptions: async (agentMode) => {
        const options = await turnOptionsFrom(agentMode ?? defaultMode, i.permission.source);
        // PD-17 per turn: an operator's `plan` turn, or a mode switched mid-run.
        if (i.owner.kind === 'stage') checkPermissionGating(provider, options.permissionMode);
        return options;
      },
      preparePrompt: (prompt, agentMode) =>
        this.preparePrompt(i.owner, i.conversationId, cfg['harnessType'] as string | undefined, prompt, agentMode),
      dispose: () => {
        this.binder.dispose(i.owner);
        // The owner's turn context goes with it; a later owner's on a shared conversation stays (review R17).
        const turn = this.turns.get(i.conversationId);
        if (turn && ownerTag(turn.owner) === ownerTag(i.owner)) this.turns.delete(i.conversationId);
      },
    };
  }

  /**
   * What goes in front of an owner's prompt: the widget interactions since
   * its last turn (T4), and — in plan mode, for a provider without a native
   * plan gate — the plan-mode instructions (P7). Per turn, without composing.
   */
  preparePrompt(
    owner: SessionOwner,
    conversationId: string,
    harnessType: string | undefined,
    prompt: string,
    agentMode: AgentMode,
  ): string {
    const withDigest = this.binder.widgetDigest(owner, owner.sessionId) + prompt;
    const nativePlanGate =
      this.harness.capabilitiesFor?.(conversationId)?.planMode ?? providerHasNativePlanGate(harnessType);
    return planPromptPrefix(agentMode, nativePlanGate) + withDigest;
  }

  /** A fresh turn context for the owner's next turn, registered on its conversation. */
  beginTurn(
    owner: SessionOwner,
    conversationId: string,
    options: SendPromptOptions,
    extra: { turnId?: string; policy?: TurnPolicy } = {},
  ): string {
    const turnId = extra.turnId ?? generateId();
    this.turns.set(conversationId, {
      owner,
      sessionId: owner.sessionId,
      turnId,
      agentMode: options.agentMode ?? DEFAULT_AGENT_MODE,
      // A turn sent without a mode is judged by the deployment posture, never bypass.
      permissionMode: options.permissionMode ?? resolveTurnPermissionMode(options.agentMode ?? DEFAULT_AGENT_MODE, undefined),
      planIds: [],
      interactionIds: [],
      nextSequence: 0,
      cardSequence: new Map(),
      ...(extra.policy ? { policy: extra.policy } : {}),
    });
    return turnId;
  }

  /** R6 — why a `computer_*` call is refused for the turn in flight, or null. */
  private computerRefusal(conversationId: string): string | null {
    const turn = this.turns.get(conversationId);
    const policy = turn?.policy;
    if (!turn || !policy || policy.computerUse === 'switch') return null;
    if (policy.computerUse === 'off') return 'Computer use is not enabled for this session.';
    if (turn.permissionMode === 'bypassPermissions') {
      return 'Computer use is not available with tool approvals off (bypassPermissions).';
    }
    return null;
  }

  /** Chats follow the deployment switch; a stage (or its worker) must opt in, and never on a bypass run (PD-5). */
  private computerUseAllowed(policy: TurnPolicy['computerUse'], mode: string, warnings: ComposeWarning[]): boolean {
    if (policy === 'switch') return true;
    if (policy === 'off') return false;
    if (mode === 'bypassPermissions') {
      warnings.push({
        code: 'computer_use_blocked_bypass',
        message: 'Computer use is not available on a run with tool approvals off (bypassPermissions)',
      });
      return false;
    }
    return true;
  }

  /** The provider this session runs on, for capability-level decisions. */
  private async providerOf(cfg: ConversationConfig, conversationId: string): Promise<string | undefined> {
    const explicit = cfg['harnessType'] as string | undefined;
    if (explicit) return explicit;
    return this.harness.resolveProvider?.({
      conversationId,
      ...(typeof cfg['model'] === 'string' ? { model: cfg['model'] as string } : {}),
    });
  }

  /**
   * A BYOK provider's API key is a `secretref:` pointer in every spec; the
   * value is read from the secret store here, at the last moment, and never
   * reaches a provider as the pointer string.
   */
  private async resolveProviderSecret(cfg: ConversationConfig): Promise<void> {
    const provider = cfg['provider'] as { apiKey?: string } | undefined;
    const key = provider?.apiKey;
    if (!key || !isMcpSecretRef(key)) return;
    // R1 — only the BYOK namespace: the key goes to the session's `baseUrl`,
    // so it must never name an MCP credential or any other stored secret.
    if (parseMcpSecretRef(key)?.namespace !== 'provider') {
      throw new ComposeError(
        'secret_unresolved',
        `The provider API key ${key} is not a provider key; use secretref:provider/<name>`,
      );
    }
    const value = await this.deps.resolveSecretRef?.(key);
    if (value == null) {
      throw new ComposeError('secret_unresolved', `The provider API key ${key} has no value in the secret store`);
    }
    cfg['provider'] = { ...provider, apiKey: value };
  }
}

/** The owner's computer-use decision: a stage's from its spec, a worker's from its parent. */
function computerUsePolicy(i: ComposeInput): TurnPolicy['computerUse'] {
  const requested = i.platform.computerUse;
  if (requested !== 'opt_in') return requested;
  return i.spec.computerUse === true ? 'opted_in' : 'off';
}

function toolCount(cfg: ConversationConfig): number {
  return Array.isArray(cfg['tools']) ? (cfg['tools'] as unknown[]).length : 0;
}
