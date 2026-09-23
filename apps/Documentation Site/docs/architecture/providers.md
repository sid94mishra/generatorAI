---
title: Agent providers
description: Provider routing, readiness, instances, capabilities, and the limits of each adapter.
---

# Agent providers

The application talks to providers through `IAgentHarness` in `packages/core/src/domain/ports/IAgentHarness.ts`. `packages/agent-harness-providers` implements that port and translates provider-specific sessions, tools, approvals, model catalogs, and stream messages into common application types.

The five user-facing provider families are **GitHub Copilot, Claude Code through the Claude Agent SDK, Codex, OpenCode, and ACP agents**. A sixth `FauxProvider` is a deterministic test adapter, not a real model provider.

## Runtime and connection model

| Provider identifier | Adapter runtime | Configuration / readiness |
| --- | --- | --- |
| `copilot` | Copilot SDK and CLI; workspaced pool isolates working directories | Optional SDK must resolve, runtime must initialize, account/model readiness must succeed |
| `claude-agent` | Claude Agent SDK and underlying CLI | Optional SDK, credentials, live model catalog; persistent-session behavior depends on configuration |
| `codex` | `codex app-server` JSON-RPC over stdio | Resolved CLI executable, initialization, account state and live paginated model catalog |
| `opencode` | `opencode serve` HTTP API and SSE | Explicit server URL or auto-start configuration; discovers the actually bound port when spawning |
| `acp` | Configured ACP agent executable over stdio | Required command/arguments, protocol initialization; no standard ACP model catalog |
| Faux | In-process deterministic scripts | Tests and explicitly configured test runs only |

`HarnessFactory` lazy-loads adapters. `HarnessRegistry` owns readiness snapshots and model discovery. Copilot and Claude are automatically probed; Codex/OpenCode/ACP require the appropriate provider configuration before they are offered as configurable choices. Installing a CLI is not equivalent to an authenticated, usable account.

The registry can restore a disk-cached catalog for a responsive cold start and refresh it in the background. Cached readiness is provisional. A model picker should show the current server catalog instead of inventing model identifiers or assuming a provider's public model list matches this account.

## Routing and provider instances

`MultiHarness` remembers the provider that owns every conversation and routes subsequent send, abort, history, and lifecycle operations to that owner. The database persists both provider-type and provider-instance ownership.

A provider instance is an account/configuration identity, not just another label for a provider family. Per-instance home/config directories prevent two accounts of the same provider from sharing runtime credential files accidentally. A conversation whose recorded instance has been removed must not silently resume under another account; it surfaces `PROVIDER_INSTANCE_UNAVAILABLE`.

Model values such as `auto`, `default`, `inherit`, and an empty value are routing sentinels. They mean use the selected provider's default, rather than finding whichever provider happens to publish that word as a model ID.

The opt-in `agent-host` path currently bypasses the full MultiHarness/instance ownership graph. Do not enable it expecting identical multi-provider routing; see [Process hosts](./processes.md).

## Capability differences

These are **adapter declarations in the inspected code**, not promises that every model, account, client, or provider release offers identical behavior.

| Capability | Copilot | Claude Agent SDK | Codex | OpenCode | ACP default |
| --- | --- | --- | --- | --- | --- |
| Native plan mode | Yes | Yes | No | No | No |
| Native MCP configuration | No | Yes | Yes | Yes | No |
| Extra skill-directory injection | No | No | Yes | No | No |
| Provider session persistence | Yes | Yes | Yes | Yes | No |
| Full per-tool gating | Yes | Conditional on attached policy | No | No | No under default Tier-B |
| Budget tracking | No | Yes | No | No | No |
| Native computer use declaration | No | Yes | No | No | No |
| Provider conversation fork/rewind | Not declared | Yes | Yes | Not declared | Not declared |

“Full per-tool gating” is stronger than a provider occasionally requesting approval. Codex approvals are command/patch-oriented and OpenCode approvals are request-oriented; neither is advertised as a gate before every tool invocation. Claude's provider-wide declaration is true only when a default gate is installed, while conversation-specific capability checks can reflect an attached `onPreToolUse` policy.

ACP defaults to constrained Tier-B behavior and blocks computer use and unrestricted execution capability. Setting a different trust tier changes policy and requires a deliberate configuration decision; it does not add a model catalog or session persistence to ACP.

## Models, reasoning, and attachments

Vision and reasoning vary by model. Copilot's provider-level booleans defer to model discovery rather than claiming every model supports them. Codex reads supported reasoning efforts and modalities from `model/list`; Claude uses its catalog and observed runtime information. OpenCode can emit reasoning without an effort control, so its effort list is empty.

Reasoning labels in a provider-wide declaration are not a complete current model matrix. The selected model's live `reasoningEfforts` and default effort should drive controls. A configured model name must match the catalog or the provider's explicitly supported configuration.

Attachments pass through the normalized harness interface, then the adapter maps them to the provider's accepted input format. Support for images is separate from support for arbitrary local text/binary files. Check the effective model and attachment handling instead of treating a file-picker UI as evidence of universal provider support.

## Skills, tools, and hooks

GeneratorAI's `AgentResolver` builds an effective agent projection from base configuration, reusable agent, per-chat/stage overrides, and runtime overrides. Skills/MCP references resolve through the vetted artifact catalog; disabled capabilities become concrete restrictions.

Skill content being resolved by GeneratorAI does not imply that the provider accepts staged skill directories. Claude currently declares directory injection unsupported because the installed SDK does not accept that input; OpenCode can list skills but does not accept these extra roots. Codex declares extra skill-directory support.

Custom tools and built-in browser/computer/widget/plan tools still require an adapter path that exposes them correctly. Hook plumbing is not equivalent across providers; the registry explicitly reports unsupported hooks for Codex, OpenCode, and ACP. Use preview/warnings to inspect what was actually resolved.

## Failure behavior

Adapters implement deadlines, cancellation, bounded captured output, late-update guards, and approval handling. Examples include Codex JSON-RPC request deadlines, OpenCode discovered server addressing, and ACP initialization/permission deadlines. A turn's streaming lifetime is distinct from a single RPC deadline.

Provider readiness can fail while the application remains usable for browsing existing data. The server should present that failure and preserve diagnostics rather than reporting a successful empty response. The test-only Faux adapter covers deterministic event sequences but cannot certify real account authentication, rate limits, or tool behavior.

## Source evidence

- `packages/agent-harness-providers/src/HarnessFactory.ts`, `HarnessRegistry.ts`, `MultiHarness.ts`, and `ProviderInstanceRegistry.ts`
- Provider implementations under `packages/agent-harness-providers/src/providers/`
- `packages/agent-harness-providers/src/hardening/` and `src/conformance/`
- `packages/core/src/domain/ports/IAgentHarness.ts` and `IProviderInstance.ts`
- `packages/core/src/services/AgentResolver.ts`, `AgentStagingService.ts`, and `ArtifactCatalog.ts`

Related: [Execution](./execution.md), [Extensions and MCP](./extensions.md), and [Configuration](../reference/configuration.md).
