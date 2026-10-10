# Models and providers — real model lists, provider logos, experimental flag (2026-10-10)

Decisions: D-131 (model lists, visibility), D-132 (logos). Commits: `ba9f0021` (real catalogs, Codex 0.162.1),
`f8b5006c` (server visibility), `af901187` (logos + plain picker), the Copilot error fix after it.

## 1. Why Codex showed two models

Codex's `model/list` is answered by the OpenAI backend and filtered by the account's plan **and the client
version**. Probed on this Mac with the owner's ChatGPT login (plan `free`), no model calls made:

| codex binary | visible rows | hidden rows (`includeHidden: true`) |
|---|---|---|
| 0.154.0 (pinned before) | `gpt-5.6-terra` (default), `gpt-5.6-luna` | `gpt-reserve`, `gpt-5.5`, `codex-auto-review` |
| 0.160.1 (ChatGPT.app) | `gpt-6-luna` (default), `gpt-5.6-terra`, `gpt-5.6-luna` | same three |
| 0.162.1 (pinned now) | `gpt-6-luna` (default), `gpt-5.6-terra`, `gpt-5.6-luna` | — |

So the adapter was not hardcoding or truncating anything: the pinned binary was old enough to be offered an older
catalog. Fix: pin `@openai/codex` 0.162.1 (server + desktop), re-capture the app-server schema, regenerate the
protocol types; `thread/rollback` was removed upstream, so a count-only rewind now finds the first dropped turn with
`thread/turns/list` and calls `thread/revert`. The ChatGPT.app bundle path also moved
(`Contents/Resources/codex-cli/bin/codex`) and is now found. Further models (Sol, Astra, …) are plan-gated; this
account cannot list them. Hidden rows stay hidden, as in Codex's own picker (they are internal or retired).

## 2. What each provider returns (raw field names)

| Provider | Call | Fields returned | Mapped to |
|---|---|---|---|
| Claude Code (SDK 0.3.220, CLI 2.1.291, Claude Max) | `query().supportedModels()` | `value`, `resolvedModel`, `displayName`, `description`, `supportsEffort`, `supportedEffortLevels`, `supportsAdaptiveThinking`, `supportsFastMode`, `supportsAutoMode` | id, resolvedModel, name, description, efforts, features. The `default` row (→ `claude-opus-5-5`) is folded into `opus` (`isDefault`). 12 rows → 11 models. No context window, output limit or tier is returned, so none is shown. |
| Codex (0.162.1) | `model/list` (paginated) | `id`, `model`, `displayName`, `description`, `hidden`, `isDefault`, `supportedReasoningEfforts[{reasoningEffort, description}]`, `defaultReasoningEffort`, `inputModalities`, `supportsPersonality`, `serviceTiers`, `defaultServiceTier`, `additionalSpeedTiers`, `multiAgentVersion`, `modelSpecialty`, `upgrade`, `upgradeInfo`, `availabilityNux`, `availableAccessPrograms` | id, name, description, isDefault, efforts + default, inputModalities (+ vision), features (personality, service tiers). |
| GitHub Copilot (SDK 1.0.8) | `CopilotClient.listModels()` | `id`, `name`, `capabilities.{supports.{vision, reasoningEffort}, limits.{max_prompt_tokens, max_context_window_tokens, vision}}`, `policy`, `billing.{multiplier, tokenPrices}`, `supportedReasoningEfforts`, `defaultReasoningEffort` (+ untyped `modelPickerCategory`, `modelPickerPriceCategory`) | limits, vision, efforts, category, price tier, billing, AI-credit prices. **Not verifiable here:** Copilot is not signed in on this Mac — the server now reports `Request models.list failed with message: Not authenticated. Please authenticate first.` |
| OpenCode | `GET /config/providers` | per model `id`, `name`, `limit.{context, output}`, `capabilities.{reasoning, input.image}`, plus `default` per provider | id, name, limits, reasoning/vision only when present, isDefault. Experimental (hidden); not configured by the server. |
| ACP | — | no listing call outside a session | empty (never faked). Experimental (hidden). |

Hover details compared to the raw responses (desktop, isolated server): `shots/models-and-providers/dark-details.json`
— e.g. Opus 5.5: "Resolves to claude-opus-5-5 · low, medium, high, xhigh, max · Adaptive thinking, Fast mode, Auto
mode"; Haiku 4.5: description and resolved id only (the CLI sends nothing else); GPT-5.6-Terra lists `ultra`
because Codex 0.162 returns it. The only non-provider value shown is Claude's "Default effort" — the level the
server actually runs a chat at (D-131).

## 3. Provider logos

One registry: `packages/design-tokens/src/provider-logos.ts` (sources and licences in the file). Web
`ui/primitives/ProviderLogo` and mobile `ui/primitives/ProviderLogo`, colour/mono, stories + tests. Shown in: composer
model chip and picker provider column + detail, field pickers (new-chat dialog, chat create summary, agent editor,
workflow stage/defaults), `ProviderSelect` (agent editor, stage editor — served providers only), Settings › Model
providers (web + mobile), Activity model and worker rows, background task rows and detail, the live turn header,
mobile model lists. The chat's agent chip names an agent, not a provider, so it has no logo. Home rows show no
model or provider.

## 4. Experimental providers

Stable (served by default): claude-agent, codex, copilot. Experimental (hidden): opencode, acp. Reveal: Settings ›
Model providers › Experimental providers (admin:harnesses), `PUT /api/harness/visibility`, or
`GENERATORAI_EXPERIMENTAL_PROVIDERS=opencode,acp` (or `all`). Live check on the isolated server:

```text
PUT {"visible":{"codex":false}}  → copilot=true claude-agent=true codex=false opencode=false acp=false
GET /api/harness/providers        → copilot claude-agent
GET /api/harness/models           → models: claude-agent 11
POST /providers/codex/login       → 404     POST /switch {codex} → 400
UI: picker lists Claude Code + GitHub Copilot only (hidden-codex-dark-picker.png)
Settings switch "Show OpenCode"   → /providers adds opencode (not installed) (revealed-opencode-dark-settings.png)
PUT back to defaults              → codex=true opencode=false
```

## 5. Evidence

- Isolated server from source (`DB_PATH`/`ARTIFACTS_DIR`/`WORKSPACES_DIR`/`EXTENSIONS_DIR`/`GENERATORAI_SECRETS_DIR`
  under the session scratchpad, `GENERATORAI_BIND_HOST=127.0.0.1`, dbPath asserted) + Vite + Electron dev with a
  temp `--user-data-dir`, real Claude and Codex logins. Screenshots in `docs/redesign/shots/models-and-providers/`
  (1440×900 window, Instrument dark and light): picker per provider, hover + keyboard details, settings, agent editor
  provider select, hidden/revealed states. No console errors.
- Gates: typecheck (providers, core, server, client-core, web, mobile, CLI), lint (0 errors), check:design,
  check:tokens + design-tokens tests, web build, check:bundle, check:css; tests — providers 785, core 1836, server
  846, client-core 834, web related unit 666, stories (ProviderLogo, ModelPicker, Badge, Select, Combobox) 27, mobile
  vitest 1162 + jest (ProviderLogo, BrandMark, ListRow); e2e composer + chats + settings 22/22, activity + workflow
  builder + context usage 16/16 on the Faux sandbox.

## 6. Before / after

Before: no UI screenshot was captured before the change; the "before" evidence is the Codex 0.154.0 `model/list`
table above and the old board-shaped picker (Fast / Balanced / Powerful groups from an invented Claude tier, "Long
context: No" / "Vision: Not supported" rows for fields no provider sent). After: the screenshots above.

## 7. Left open

- Copilot's live list could not be verified on this Mac (not signed in); its mapping is unchanged apart from the
  provider tag and the surfaced error.
- The packaged app at /Applications still ships codex 0.154.0 until it is rebuilt from this branch.
- Running codex 0.160/0.162 rewrote `~/.codex/models_cache.json` (Codex's own per-version cache; any Codex client
  refetches it).
- Mobile Turn sheet / Default model provider pickers are native segmented controls (text only); the model rows and
  Settings carry the logos.
