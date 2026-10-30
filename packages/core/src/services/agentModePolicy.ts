// ────────────────────────────────────────────────────────────────
// Agent-mode policy (PLN-01)
//
// Every behavioural difference between modes is resolved HERE, from the
// shared `AGENT_MODE_REGISTRY` descriptor — never from an inline
// `if (mode === 'plan')` at a call site. Adding a mode is a registry entry
// plus (optionally) an instruction block below.
// ────────────────────────────────────────────────────────────────

import {
  agentModeDescriptor,
  DEFAULT_AGENT_MODE,
  type AgentMode,
  type AgentModeDescriptor,
  type ChatPermissionMode,
} from '@generatorai/shared';
import type {
  HarnessPermissionMode,
  PermissionRequest,
} from '../domain/ports/IAgentHarness.js';
import { classifyPermissionRisk, isReadOnlyInspection, rememberablePermission, type ToolPermissionRequestPayload } from '@generatorai/shared';
import { permissionWording } from '@generatorai/shared/ui-contract';

/** The behavioural contract for a mode. Re-exported so callers need one import. */
export function resolveModeDescriptor(mode: AgentMode | undefined): AgentModeDescriptor {
  return agentModeDescriptor(mode ?? DEFAULT_AGENT_MODE);
}

/**
 * Fallback permission mode for a chat that never chose one.
 *
 * Historically this was hard-coded to `bypassPermissions`, which means a
 * remotely reachable server would run fully unattended agents with no approval
 * gate — the plan's G14. It is now a startup-configured value so the server can
 * be secure by default off-loopback while a single-user loopback install keeps
 * its autonomous behaviour. See `setDefaultChatPermissionMode`.
 */
let defaultChatPermissionMode: ChatPermissionMode = 'bypassPermissions';

/**
 * Sets the fallback permission mode for chats that did not pick one.
 *
 * Called exactly once during server startup. Deliberately a module-level
 * setting rather than a parameter: it is a deployment-posture decision, and
 * threading it through every `sendPrompt` call site would guarantee that one
 * path eventually forgets it and silently reverts to the unsafe default.
 */
export function setDefaultChatPermissionMode(mode: ChatPermissionMode): void {
  defaultChatPermissionMode = mode;
}

export function getDefaultChatPermissionMode(): ChatPermissionMode {
  return defaultChatPermissionMode;
}

/**
 * Maps an agent mode onto the harness permission mode for a turn.
 *
 * The mode's declared `permissionMode` always wins over the chat's configured
 * policy — that is what makes plan mode's read-only guarantee structural
 * rather than advisory. Only `auto`, whose descriptor asks for
 * `bypassPermissions`, defers to the chat so an operator can still opt a chat
 * into `acceptEdits`/`default` prompting.
 */
export function resolveTurnPermissionMode(
  agentMode: AgentMode,
  chatPermissionMode: ChatPermissionMode | undefined,
): HarnessPermissionMode {
  const descriptor = resolveModeDescriptor(agentMode);
  if (descriptor.permissionMode !== 'bypassPermissions') {
    return descriptor.permissionMode as HarnessPermissionMode;
  }
  return (chatPermissionMode ?? defaultChatPermissionMode) as HarnessPermissionMode;
}

/**
 * Whether a chat-level permission handler should be attached at all.
 *
 * Attaching `onPermissionRequest` is what turns tool prompts ON: with it
 * installed the Claude adapter runs `canUseTool` with
 * `allowDangerouslySkipPermissions` off and forwards every non-auto-allowed
 * call to the handler (HITL-06), and the Copilot adapter routes the SDK's
 * `onPermissionRequest` to it instead of `approveAll`. A chat that chose
 * `bypassPermissions` must therefore NOT get a handler, or every autonomous
 * chat would become a prompt storm. The chat's mode is part of the
 * conversation binding key (`ChatManagementService.conversationBindingKey`),
 * so flipping it via `PATCH /chats/:id/permission-mode` rebinds the live
 * conversation with or without the handler on the next turn.
 */
export function shouldAttachPermissionHandler(
  chatPermissionMode: ChatPermissionMode | undefined,
): boolean {
  return (chatPermissionMode ?? defaultChatPermissionMode) !== 'bypassPermissions';
}

/**
 * What the chat-level permission handler does with a tool call the harness
 * did not auto-allow itself.
 *
 *   bypassPermissions → allow  (only reachable on Copilot, which ignores the
 *                               per-turn mode and asks for everything)
 *   acceptEdits       → allow file reads/writes, prompt for the rest
 *                       (shell, network, MCP/custom tools)
 *   default / plan    → prompt for everything that reaches the handler
 *   dontAsk           → deny (Claude semantics: never block on a human)
 */
export function decideToolPermission(
  mode: HarnessPermissionMode,
  type: PermissionRequest['type'],
): 'allow' | 'prompt' | 'deny' {
  switch (mode) {
    case 'bypassPermissions':
      return 'allow';
    case 'dontAsk':
      return 'deny';
    case 'acceptEdits':
      return type === 'file_write' || type === 'file_read' ? 'allow' : 'prompt';
    case 'default':
    case 'plan':
    default:
      return 'prompt';
  }
}

/**
 * U-27b — a shell command that only writes one file inside the working directory from a heredoc
 * (`cat > src/a.ts <<'EOF' … EOF`, optionally after `mkdir -p src &&`) is a file edit: "Accept edits" allows it
 * as it allows the Write tool, instead of asking as for any shell command. The target must be a plain relative
 * path with no `..` and no dot-directory (`.git/hooks`, `.claude`, `.github`: those still ask), and the body
 * must not expand (a quoted delimiter, or no `$`, backtick or backslash). Returns the target, else null.
 */
export function heredocWriteTarget(command: string): string | null {
  const lines = command.replace(/\r\n/g, '\n').replace(/\n+$/, '').split('\n');
  if (lines.length < 2) return null;
  const head = lines[0]!.trim();
  const REL = String.raw`([\w@+./-]+)`;
  const DELIM = String.raw`<<(-?)\s*(?:'(\w+)'|"(\w+)"|(\w+))`;
  const prefix = String.raw`^(?:mkdir\s+-p\s+${REL}\s*&&\s*)?cat\s+`;
  const outFirst = new RegExp(`${prefix}>\\s*${REL}\\s+${DELIM}$`).exec(head);
  const inFirst = outFirst ? null : new RegExp(`${prefix}${DELIM}\\s+>\\s*${REL}$`).exec(head);
  const parts = outFirst
    ? [outFirst[1], outFirst[2], outFirst[3], outFirst[4], outFirst[5], outFirst[6]]
    : inFirst
      ? [inFirst[1], inFirst[6], inFirst[2], inFirst[3], inFirst[4], inFirst[5]]
      : null;
  if (!parts) return null;
  const [dir, target, dash, single, double, bare] = parts;
  const delimiter = single ?? double ?? bare;
  const closes = (line: string) => (dash ? line.replace(/^\t+/, '') : line) === delimiter;
  // The heredoc ends at the FIRST delimiter line: anything after it would run as commands.
  const end = lines.findIndex((line, i) => i > 0 && closes(line));
  if (!target || !delimiter || end !== lines.length - 1) return null;
  const body = lines.slice(1, -1).join('\n');
  if (bare && /[$`\\]/.test(body)) return null;
  const plain = (p: string, file: boolean) => {
    const parts = p.replace(/\/+$/, '').split('/');
    return (
      !p.startsWith('/') &&
      !p.startsWith('-') &&
      parts.every((seg, i) => seg !== '' && seg !== '..' && (seg !== '.' || i < parts.length - 1) && (!seg.startsWith('.') || seg === '.' || (file && i === parts.length - 1)))
    );
  };
  if (!plain(target, true) || (dir !== undefined && !plain(dir, false))) return null;
  return target;
}

/** The tool input a permission request carries: Claude's `details.input`, else Copilot's raw request fields. */
function requestInput(details: Record<string, unknown>): unknown {
  if ('input' in details) return details['input'];
  const rest: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) if (!DETAIL_META_KEYS.has(k)) rest[k] = v;
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/**
 * What the agent is told when a person denies a request with a reason: bare, "Not now." read as the platform's own
 * refusal ("The platform refused it with …"), not the user's answer (U-82).
 */
export function personDenied(reason: string): string {
  return `The user denied this request: ${reason}`;
}

/** The kind of access a request is judged as: a heredoc file write counts as a file write (U-27b), a read-only inspection line as a file read (D-150). */
export function permissionTypeOf(request: PermissionRequest): PermissionRequest['type'] {
  if (request.type !== 'shell_exec') return request.type;
  const command = fullShellCommand(requestInput((request.details ?? {}) as Record<string, unknown>));
  if (!command) return request.type;
  if (heredocWriteTarget(command)) return 'file_write';
  // D-150 — `cat`, `sed -n 1,80p`, `grep`, `git diff` inside the workspace read like the Read tool: "Accept edits"
  // allows them as it allows reads. They were half of a team run's approvals, each one a stop.
  return isReadOnlyInspection(command) ? 'file_read' : request.type;
}

/**
 * A read of a file attached to the current turn. Attachments are stored as artifacts outside the workspace, so
 * the provider asks before reading them; the person who attached a file already said the agent may read it.
 * Claude reports `{ input: { file_path } }`, Copilot `{ path }`.
 */
export function isAttachedFileRead(request: PermissionRequest, attachedPaths: readonly string[] | undefined): boolean {
  if (request.type !== 'file_read' || !attachedPaths?.length) return false;
  const details = (request.details ?? {}) as Record<string, unknown>;
  const input = (details['input'] ?? {}) as Record<string, unknown>;
  const target = [input['file_path'], input['path'], details['path']].find((v): v is string => typeof v === 'string');
  if (!target) return false;
  const norm = (p: string) => p.replace(/\\/g, '/');
  return attachedPaths.some((p) => norm(p) === norm(target));
}

// The person approves what the card shows, so a multi-line command must arrive whole (the card scrolls); 600
// characters cut a six-commit line after its second commit (U-72). Pushes and attention asks clip their own text.
const INPUT_SUMMARY_MAX_CHARS = 16_000;
const SECRET_KEY_PATTERN = /token|secret|password|passwd|api[_-]?key|authorization|cookie/i;

/** Redacts secret-looking keys and bounds the rendering so a card never ships a raw env dump. */
function summariseToolInput(input: unknown, maxChars: number = INPUT_SUMMARY_MAX_CHARS): string {
  const redact = (value: unknown, depth: number): unknown => {
    if (depth > 4) return '…';
    if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
    if (value && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = SECRET_KEY_PATTERN.test(k) ? '[redacted]' : redact(v, depth + 1);
      }
      return out;
    }
    return value;
  };
  let text: string;
  if (input === undefined || input === null) text = '';
  else if (typeof input === 'string') text = input;
  else {
    try {
      text = JSON.stringify(redact(input, 0), null, 1) ?? '';
    } catch {
      text = String(input);
    }
  }
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

/**
 * The full command line of a shell request, from whichever field its provider uses: Claude `input.command`,
 * Codex `command`, Copilot `fullCommandText`, ACP `rawInput.command` (an argv array is joined). Never the display
 * summary — that one is cut at its length cap, and a cut command must not be judged by its head (U-16).
 */
export function fullShellCommand(input: unknown, depth = 0): string | undefined {
  if (typeof input === 'string') return input.trim() ? input : undefined;
  if (!input || typeof input !== 'object' || depth > 2) return undefined;
  const o = input as Record<string, unknown>;
  for (const key of ['command', 'cmd', 'fullCommandText']) {
    const v = o[key];
    if (typeof v === 'string' && v.trim()) return v;
    if (Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string')) return (v as string[]).join(' ');
  }
  return fullShellCommand(o['rawInput'], depth + 1);
}

/** Keys the adapters add to `details` that describe the request, not the tool's input. */
const DETAIL_META_KEYS = new Set(['toolName', 'input', 'toolUseID', 'blockedPath', 'decisionReason', 'kind', 'alwaysAsk']);

/**
 * Builds the durable, display-safe payload for a `tool_permission` gate.
 *
 * Claude's adapter puts `{ toolName, input }` in `details`; Copilot's puts the
 * raw SDK request (`kind`, plus kind-specific fields such as
 * `fullCommandText`/`path`/`url`). Both are reduced to one shape here so the
 * three clients render a single card component.
 */
export function buildToolPermissionPayload(
  request: PermissionRequest,
  permissionMode: HarnessPermissionMode,
): ToolPermissionRequestPayload {
  const details = (request.details ?? {}) as Record<string, unknown>;
  const toolName =
    typeof details['toolName'] === 'string' && details['toolName'].length > 0
      ? details['toolName']
      : typeof details['kind'] === 'string' && details['kind'].length > 0
        ? details['kind']
        : request.type;
  const input = requestInput(details);
  const inputSummary = summariseToolInput(input);
  // MG-04: stamped once, here, so the stored gate, its event, the attention
  // ask and the push all carry the same verdict.
  const { risk, reasons } = classifyPermissionRisk({ type: request.type, toolName, inputSummary });
  // D-107: what the card asks, in words, for every client (the push and the attention ask too).
  const { title, kindLabel } = permissionWording(toolName, request.type);
  // U-16 (D-147): what "Allow for this chat / run" would remember, judged on the FULL request.
  const remember = rememberablePermission({
    type: request.type,
    toolName,
    command: request.type === 'shell_exec' ? fullShellCommand(input) : undefined,
    inputSummary: summariseToolInput(input, Number.POSITIVE_INFINITY),
    alwaysAsk: details['alwaysAsk'] === true,
  });
  return {
    title,
    kindLabel,
    toolName,
    type: request.type,
    description: request.description,
    inputSummary,
    permissionMode: permissionMode as ToolPermissionRequestPayload['permissionMode'],
    risk,
    ...(reasons.length > 0 ? { riskReasons: reasons } : {}),
    rememberRules: remember.rules,
    ...(remember.refusal ? { rememberRefusal: remember.refusal } : {}),
  };
}

/**
 * Shared rule appended to every mode's instructions.
 *
 * The `plans/` folder is the human review record. If the agent rewrote its own
 * plan after a reviewer commented on it, an "approved" plan would no longer be
 * the artefact that was approved. Reads stay allowed — the agent must be able
 * to re-read its plan while implementing it.
 */
const PLANS_FOLDER_RULE = `The \`plans/\` folder in the workspace is managed by the system and is the
user's review record. You may READ files there, but never create, edit, move or
delete anything inside it — the platform records plans for you.`;

/** Shared markdown skeleton so a plan reads the same however it was produced. */
const PLAN_TEMPLATE = `   # <Short imperative title>

   ## Goal
   One paragraph: what changes for the user when this is done.

   ## Approach
   The chosen approach and, briefly, what you rejected and why.

   ## Changes
   A table or list of concrete edits: file path → what changes there.

   ## Risks & edge cases
   What could break, and what you will do about it.

   ## Verification
   How the change will be proven to work (tests, commands, manual checks).`;

/**
 * Plan-mode workflow instructions (blocking gate).
 *
 * Claude receives this via `planModeInstructions`, which replaces the default
 * code-implementation workflow body inside the plan-mode system reminder (the
 * CLI still wraps it with its read-only preamble and ExitPlanMode footer).
 * Copilot gets the same guidance appended to the system message.
 */
export const PLAN_MODE_INSTRUCTIONS = `You are in PLAN MODE. Do not modify any files, run mutating commands, or start implementing.

Your job this turn is to produce a clear, reviewable implementation plan.

1. RESEARCH — read the relevant code, configuration, and docs. Prefer reading
   real files over assuming. Note the exact files you would change.
2. ASK — if the request is ambiguous, or there are two or more defensible
   approaches, ask the user before committing to one. Use your question tool
   with concrete, mutually exclusive options and a short trade-off for each.
   Do not ask about things you can determine by reading the code.
3. WRITE THE PLAN — as markdown, in your reply, using this structure:

${PLAN_TEMPLATE}

4. SUBMIT — call your exit-plan-mode tool to hand the plan to the user for
   approval. Write the FULL plan text in your reply first; the reply is what
   gets captured as the plan document.

Keep the plan specific and short enough to review. Do not pad it.

${PLANS_FOLDER_RULE}`;

/**
 * Auto-mode instructions (non-blocking plan capture).
 *
 * The native exit-plan-mode tool is only registered while the session is in
 * plan mode, so an autonomous turn CANNOT use it. Instead the host exposes
 * `record_plan`, which files the plan and returns immediately. The agent then
 * implements without waiting — the plan is a durable record of intent, not a
 * gate.
 *
 * Delivered via the system message, which is fixed for the life of the
 * conversation while the mode is chosen per turn. The wording is therefore
 * explicitly scoped to "when you are NOT in plan mode" so it stays correct if
 * the user switches to Plan without the conversation being rebuilt.
 *
 * Kept SHORT on purpose: this rides along on every request of every chat. It
 * used to inline the whole plan template (~150 tokens) that the \`record_plan\`
 * tool description already spells out, and named an "exit-plan-mode tool" that
 * only one provider has.
 */
export const AUTO_MODE_PLAN_INSTRUCTIONS = `PLAN RECORDING (applies when you are NOT in plan mode)

Work autonomously: do not wait for approval or ask the user to confirm before
acting.

If the user asks for a plan — or the task is large enough that you would
naturally write one first — call \`record_plan\` ONCE, before you start
editing, with the full plan as markdown: a short imperative title, then Goal,
Approach, Changes (file → edit), Risks & edge cases, Verification. It returns
immediately and does NOT pause you: carry straight on and implement. Skip it
for trivial single-file edits.

In plan mode this section does not apply — follow your plan-mode instructions,
which end in a submission the user has to approve.

${PLANS_FOLDER_RULE}`;

/**
 * Providers whose runtime has a plan mode of its own: it tells the model it is
 * planning and gives it a tool that submits the plan for approval.
 */
const NATIVE_PLAN_GATE_PROVIDERS: ReadonlySet<string> = new Set(['claude-agent', 'copilot']);

export function providerHasNativePlanGate(harnessType: string | undefined): boolean {
  return NATIVE_PLAN_GATE_PROVIDERS.has(harnessType ?? 'copilot');
}

/**
 * Plan mode for a provider with no plan mode (Codex, OpenCode, ACP).
 *
 * Sent in front of the user's prompt on a plan turn, because for these
 * providers nothing else says "you are planning": their system message is
 * fixed for the life of the conversation and the mode is chosen per turn.
 * Submission goes through `record_plan`, which in plan mode blocks until the
 * user has decided (see `ChatManagementService.recordPlan`).
 */
export const PLAN_MODE_TURN_PREFIX =
  PLAN_MODE_INSTRUCTIONS.replace(
    /4\. SUBMIT[\s\S]*?gets captured as the plan document\./,
    `4. SUBMIT — call \`record_plan\` with the title and the FULL plan. In plan mode
   that call WAITS for the user's decision and its result tells you what they
   chose: approved (then, and only then, implement), changes requested (revise
   and submit again), or dismissed (stop).`,
  ) + '\n\n--- The user\'s request follows ---\n\n';

/** The instruction block for a mode, or `undefined` when it needs none. */
export function instructionsForMode(mode: AgentMode | undefined): string | undefined {
  const descriptor = resolveModeDescriptor(mode);
  if (descriptor.planGate === 'blocking') return PLAN_MODE_INSTRUCTIONS;
  if (descriptor.usesRecordPlanTool) return AUTO_MODE_PLAN_INSTRUCTIONS;
  return undefined;
}

/**
 * Builds the system-message append used by providers that have no native
 * plan-mode reminder (Copilot).
 */
export function buildPlanModeSystemAppend(custom?: string): string {
  return `\n\n${custom ?? PLAN_MODE_INSTRUCTIONS}`;
}

/** Prompt sent back to the agent once a plan is approved. */
export function buildApprovalContinuationPrompt(title: string): string {
  return (
    `The plan "${title}" was APPROVED by the user. ` +
    `Implement it now, following the plan exactly. ` +
    `If you discover the plan is wrong, stop and explain rather than improvising.`
  );
}
