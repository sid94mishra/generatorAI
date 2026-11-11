# ACP agents — every agent in the ACP Registry, installable from Settings

Owner request (2026-11-11): an ACP section in Settings › Model providers that lists every agent supporting the
Agent Client Protocol, with its icon; installed and signed-in agents appear in the model picker with their models.
Research (registry, client behaviour, protocol, parity): kept out of the repo; the facts this design relies on are
cited inline.

## Decisions

- **ACP-1 One driver, many agents.** The provider id stays `acp` (`HARNESS_PROVIDER_IDS` is unchanged, no
  migration). `AcpProvider` multiplexes: one ACP connection (one agent process) per enabled agent, a conversation
  bound to the agent its model names. Persisted chat config keeps `harnessType: 'acp'`.
- **ACP-2 Model ids name the agent.** An ACP model id is `<agentId>/<value>` where `value` is the agent's
  `configOptions` option value for category `model` (spec: session config options, stable since v0.10.8). An agent
  that publishes no model option offers one model, id `<agentId>`, named "<Agent> (agent's default model)".
  Effort = the `thought_level` option; mode = the `mode` option.
- **ACP-3 Sub-providers.** `HarnessProviderStatus` for `acp` carries `subProviders[]` (one per enabled agent: id,
  label, icon mark, installed / authenticated / ready / error, version) and each `HarnessCatalogModel` carries
  `subProvider`. The model picker draws one provider entry per sub-provider (key `acp:<agentId>`, the agent's own
  label and icon); selecting a model still sets provider `acp`.
- **ACP-4 Registry-backed catalogue.** Index: `https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json`
  (github.com/agentclientprotocol/registry). The server caches it under its data dir (refresh at most hourly, plus a
  manual refresh, `If-None-Match`), falling back to a bundled snapshot. `GENERATORAI_ACP_REGISTRY_URL` overrides the
  URL (tests, air-gapped installs).
- **ACP-5 Icons are sanitised server-side.** Registry icons are 16×16 monochrome `currentColor` SVGs. The server
  parses each against an element/attribute allow-list and serves `{viewBox, nodes}`; the web never loads a
  third-party URL. Icons are the vendors' marks, used only to identify the agent (like `provider-logos.ts`).
- **ACP-6 Install, all three OSes.** `binary` distributions: download, verify `sha256` (unverified installs are
  labelled), extract with JS extractors (zip / tar.gz / tar.bz2 / raw), reject path traversal, `chmod +x`, keep the
  launch path inside the install dir. `npx` distributions: `npm install <pkg@ver> --save-exact --prefix <dir>` with
  the system Node (login-shell PATH) and launch `node <bin>` — never `npx` (no `npx.cmd` on Windows, no network on
  launch). Windows `.cmd`/`.bat` launchers go through `cmd.exe /d /s /c` with strict quoting. `uvx` is shown as not
  supported yet. Layout: `<data>/acp/agents/<id>/<version>/`.
- **ACP-7 Natively supported agents stay listed.** The registry includes Claude, Codex, GitHub Copilot and OpenCode,
  which have first-class providers. They are listed with "Also available as a native provider" and can still be
  enabled; the native provider is the recommended one.
- **ACP-8 Sign-in.** The client advertises `auth.terminal`. `agent` auth methods call `authenticate`; `terminal`
  methods run the agent's own command plus the method's `args`/`env` in an app terminal, then the connection
  re-initialises. Readiness: installed → initialised → authenticated (`auth/status` when advertised, otherwise a
  model probe that does not return `-32000`).
- **ACP-9 Stability.** `acp` becomes `stable`: the ACP section is always shown; with no agent enabled the provider
  reports "No ACP agents enabled" and the picker shows nothing for it.
- **ACP-10 Custom agents.** A typed command (`{command, args, env}`) remains for an agent not in the registry, as a
  "Custom agent" entry in the same section.
