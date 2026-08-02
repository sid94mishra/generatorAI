# Playwright Integration Research Report

> **Date**: March 2026  
> **Scope**: Integration of Playwright browser automation into GeneratorAI workflows  
> **Sources**: `@playwright/mcp` (v0.0.68), `@playwright/cli` (v0.1.1), GeneratorAI codebase analysis

---

## Table of Contents

1. [Playwright MCP Server — Deep Dive](#1-playwright-mcp-server--deep-dive)
2. [Playwright CLI — Deep Dive](#2-playwright-cli--deep-dive)
3. [MCP vs CLI: Which to Use](#3-mcp-vs-cli-which-to-use)
4. [Playwright in AI Agent Systems](#4-playwright-in-ai-agent-systems)
5. [GeneratorAI Architecture Mapping](#5-generatorai-architecture-mapping)
6. [Integration Strategy — Recommended Approach](#6-integration-strategy--recommended-approach)
7. [System Workflow Design: E2E Testing & Debugging](#7-system-workflow-design-e2e-testing--debugging)
8. [Implementation Plan](#8-implementation-plan)

---

## 1. Playwright MCP Server — Deep Dive

### What It Is

`@playwright/mcp` is a **Model Context Protocol server** that wraps Playwright's browser automation API as MCP tools. It allows LLMs to interact with web pages through **structured accessibility snapshots** — no vision models or screenshots required (though vision is opt-in).

- **NPM Package**: `@playwright/mcp@latest`
- **Repository**: https://github.com/microsoft/playwright-mcp
- **License**: Apache-2.0
- **Stars**: 28.3k (as of March 2026)

### How It Works

The MCP server runs as either:
1. **Stdio transport** (default) — launched as a child process, communicates via stdin/stdout
2. **HTTP/SSE transport** — standalone server on a port, useful for remote or headless environments

```json
// Stdio transport (standard)
{
  "mcpServers": {
    "playwright": {
      "command": "npx",
      "args": ["@playwright/mcp@latest"]
    }
  }
}

// HTTP transport (standalone)
// Start: npx @playwright/mcp@latest --port 8931
{
  "mcpServers": {
    "playwright": {
      "url": "http://localhost:8931/mcp"
    }
  }
}
```

### Key Architecture Decisions

- **Accessibility tree, not pixels**: Uses Playwright's accessibility snapshot for deterministic tool application. No ambiguity from screenshot-based approaches.
- **LLM-friendly**: All page state returned as structured data with element references (refs), not pixel coordinates.
- **Persistent browser context**: Browser stays alive between tool calls, maintaining session state (cookies, localStorage, navigation history).

### Tools Exposed

The MCP server exposes tools in several categories:

#### Core Automation Tools
| Tool | Description |
|------|-------------|
| `browser_navigate` | Navigate to a URL |
| `browser_click` | Click an element by ref |
| `browser_type` | Type text into focused/specified element |
| `browser_fill` | Fill a form field |
| `browser_select_option` | Select dropdown option |
| `browser_check` / `browser_uncheck` | Toggle checkboxes |
| `browser_hover` | Hover over element |
| `browser_drag` | Drag and drop |
| `browser_snapshot` | Get accessibility snapshot (element tree with refs) |
| `browser_close` | Close browser |

#### Tab Management
| Tool | Description |
|------|-------------|
| `browser_tab_list` | List all tabs |
| `browser_tab_new` | Open new tab |
| `browser_tab_close` | Close a tab |
| `browser_tab_select` | Switch to tab |

#### Opt-in Capabilities (via `--caps`)
| Capability | Tools Added |
|------------|-------------|
| `vision` | `browser_screen_capture` — pixel screenshot, `browser_screen_move_mouse` / `browser_screen_click` / `browser_screen_type` / `browser_screen_drag` — coordinate-based input |
| `pdf` | `browser_pdf_save` — save page as PDF |
| `testing` | `browser_assert_snapshot` — accessibility snapshot assertions |
| `tracing` | `browser_tracing_start` / `browser_tracing_stop` — Playwright trace recording |
| `devtools` | `browser_console` — read console messages; `browser_network` — network request log |

### Key Configuration Flags

| Flag | Purpose | Relevant for GeneratorAI |
|------|---------|--------------------------|
| `--headless` | Run headless (default is headed) | **Yes** — server environments |
| `--browser <name>` | Browser: chrome, firefox, webkit, msedge | **Yes** — cross-browser testing |
| `--caps <list>` | Enable: vision, pdf, devtools, testing, tracing | **Yes** — testing capability |
| `--isolated` | Ephemeral browser profile per session | **Yes** — test isolation |
| `--viewport-size WxH` | Set viewport | **Yes** — responsive testing |
| `--device <name>` | Emulate device (e.g., "iPhone 15") | **Yes** — device testing |
| `--codegen <lang>` | Generate code from interactions ("typescript" or "none") | Maybe |
| `--output-dir <path>` | Directory for screenshots/artifacts | **Yes** — artifact storage |
| `--save-trace` | Save Playwright trace | **Yes** — debugging |
| `--save-video` | Record video | Nice to have |
| `--port <port>` | Enable HTTP transport | **Yes** — standalone mode |
| `--storage-state <path>` | Load cookies/localStorage | **Yes** — auth state |
| `--ignore-https-errors` | Skip SSL errors | **Yes** — dev/staging envs |
| `--test-id-attribute` | Custom test-id attribute | **Yes** — custom selectors |
| `--proxy-server` | Proxy configuration | Conditional |
| `--config <path>` | JSON config file | **Yes** — complex configs |

### Browser Profile Modes

1. **Persistent** (default): Profile saved to disk at `%USERPROFILE%\AppData\Local\ms-playwright\mcp-{channel}-profile`. Preserves auth state.
2. **Isolated** (`--isolated`): Ephemeral in-memory profile. Each session starts clean. Best for testing.
3. **Browser Extension**: Connect to existing browser instance via Chrome extension. No use for server-side.

---

## 2. Playwright CLI — Deep Dive

### What It Is

`@playwright/cli` is a **command-line interface** for Playwright, designed for coding agents. It uses a SKILLS-based approach rather than MCP tools.

- **NPM Package**: `@playwright/cli@latest`
- **Repository**: https://github.com/microsoft/playwright-cli
- **Version**: v0.1.1

### How It Differs from MCP

| Aspect | MCP Server | CLI |
|--------|-----------|-----|
| **Protocol** | MCP (JSON-RPC over stdio/HTTP) | Shell commands |
| **Token efficiency** | Lower — sends full tool schemas + accessibility trees | Higher — concise commands, smaller output |
| **State management** | Server manages browser lifecycle | Session-based with `--persistent` flag |
| **Integration** | MCP client needed | Any shell executor |
| **Context window usage** | Heavy — accessibility trees sent per tool | Light — agent only loads what it needs |
| **Best for** | Exploratory automation, self-healing tests, long autonomous workflows | High-throughput coding agents, test generation |

### Command Categories

```bash
# Core automation
playwright-cli open [url]           # Open browser
playwright-cli goto <url>           # Navigate
playwright-cli click <ref>          # Click element
playwright-cli fill <ref> <text>    # Fill input
playwright-cli type <text>          # Type into focused element
playwright-cli press <key>          # Press key
playwright-cli check <ref>          # Check checkbox
playwright-cli select <ref> <val>   # Select dropdown
playwright-cli hover <ref>          # Hover
playwright-cli drag <a> <b>         # Drag and drop
playwright-cli snapshot             # Get page state

# Navigation
playwright-cli go-back / go-forward / reload

# Observation
playwright-cli screenshot [ref]     # Screenshot
playwright-cli pdf                  # Save as PDF
playwright-cli console [level]      # Console messages
playwright-cli network              # Network log

# Tabs
playwright-cli tab-list / tab-new / tab-close / tab-select

# Storage
playwright-cli state-save [file]    # Save cookies/storage
playwright-cli state-load <file>    # Load cookies/storage
playwright-cli cookie-list/get/set/delete/clear
playwright-cli localstorage-list/get/set/delete/clear

# Network mocking
playwright-cli route <pattern>      # Mock requests
playwright-cli route-list / unroute

# DevTools
playwright-cli run-code <code>      # Run arbitrary Playwright code
playwright-cli tracing-start/stop   # Trace recording
playwright-cli video-start/stop     # Video recording

# Session management
playwright-cli list                 # List sessions
playwright-cli close-all / kill-all
playwright-cli -s=<name> <cmd>      # Named sessions
playwright-cli show                 # Visual dashboard
```

### Session Management

- Browser stays alive between CLI invocations within a session
- Default session is in-memory; use `--persistent` for disk persistence
- Named sessions via `-s=<name>` for parallel browser instances
- `PLAYWRIGHT_CLI_SESSION` env var for per-project sessions
- `playwright-cli show` opens a visual monitoring dashboard

---

## 3. MCP vs CLI: Which to Use

### Decision Matrix for GeneratorAI

| Criterion | MCP Server ✓ | CLI ✓ |
|-----------|:---:|:---:|
| **Copilot SDK native integration** | ✅ First-class `mcpServers` config | ❌ Requires shell tool wrapper |
| **Browser state across stages** | ✅ Server maintains context | ⚠️ Session-based, more fragile |
| **Token efficiency** | ❌ Heavy tool schemas | ✅ Lightweight commands |
| **Long-running autonomous workflows** | ✅ Designed for this | ⚠️ Better for one-shot |
| **Self-healing tests** | ✅ Rich accessibility tree context | ⚠️ Less context per call |
| **Implementation complexity** | ✅ Zero-code — just config | ❌ Need shell tool definitions |
| **Testing assertions** | ✅ `--caps=testing` built-in | ❌ Manual assertion logic |
| **Trace/video capture** | ✅ `--caps=tracing` built-in | ✅ Commands available |

### Recommendation: **Hybrid Approach**

**Primary: MCP Server** — for the AI workflow automation use case, MCP is the right choice because:

1. **GeneratorAI already supports MCP servers** in `CreateSessionParams.mcpServers` and `CopilotConfig.mcpServers`. Zero new code needed for basic integration.
2. **Copilot SDK maps MCP tools automatically** — the SDK discovers and exposes MCP tools to the model natively.
3. **Persistent browser context** is essential for multi-step E2E testing workflows.
4. **Structured accessibility data** provides the AI with semantic understanding of the page.

**Secondary: CLI-based tools** — for specific stages that need token-efficient operations (like bulk screenshot comparisons or simple navigation sequences), wrap specific `playwright-cli` commands as `ToolDefinition` handlers.

---

## 4. Playwright in AI Agent Systems

### How Modern AI Systems Use Playwright

#### Pattern 1: MCP Server Integration (Claude Desktop, VS Code, Cursor)
The AI host registers Playwright MCP as a server. All Playwright tools appear automatically to the model. The model decides which tools to call based on user intent.

```
User → "Test the login flow on staging.example.com"
AI → browser_navigate("https://staging.example.com/login")
AI → browser_snapshot() → sees login form
AI → browser_fill(ref="username-input", value="test@example.com")
AI → browser_fill(ref="password-input", value="password")
AI → browser_click(ref="login-button")
AI → browser_snapshot() → sees dashboard
AI → "Login flow works correctly ✓"
```

#### Pattern 2: Tool Definitions (Direct API wrapping)
Systems define explicit tool interfaces that call Playwright API under the hood. This gives more control but requires implementation.

```typescript
const navigateTool: ToolDefinition = {
  name: 'browser_navigate',
  description: 'Navigate browser to a URL',
  parametersSchema: {
    type: 'object',
    properties: {
      url: { type: 'string', description: 'URL to navigate to' }
    },
    required: ['url']
  },
  handler: async (args) => {
    const page = await getBrowserPage();
    await page.goto(args.url as string);
    return { url: page.url(), title: await page.title() };
  }
};
```

#### Pattern 3: Hybrid — MCP + Custom Tools
Use MCP for standard browser interactions, add custom `ToolDefinition` handlers for domain-specific operations (visual regression, performance metrics, accessibility audits).

### Best Practices for Browser Automation in AI Workflows

1. **Headless by default**: Server-side workflows should always use `--headless`
2. **Isolated sessions**: Use `--isolated` for test workflows to avoid state leakage
3. **Timeout configuration**: Set reasonable timeouts — `--timeout-action=10000` for slow apps
4. **Screenshot on failure**: Always capture screenshots when assertions fail
5. **Network control**: Use route mocking for deterministic tests
6. **Artifact management**: Configure `--output-dir` for screenshots/traces
7. **Cleanup**: Always close browsers when workflow completes (use hooks)
8. **Error context**: Enable `--caps=devtools` to get console errors on failure

---

## 5. GeneratorAI Architecture Mapping

### Current Architecture Support

GeneratorAI **already has the building blocks** for Playwright MCP integration:

#### 1. MCP Server Config (Already Exists)

`McpServerConfig` in `CreateSessionParams`:
```typescript
export interface McpServerConfig {
  type: 'http' | 'stdio';
  url?: string;      // For HTTP transport
  command?: string;   // For stdio transport
  args?: string[];    // CLI arguments
}
```

**Used in**: `CopilotAdapter.createSession()` → maps to SDK `SessionConfig.mcpServers`

#### 2. WorkflowTemplate Schema (Already Supports MCP)

The `WorkflowTemplateSchema` already defines `copilotConfig.mcpServers`:
```typescript
mcpServers: z.record(z.object({
  type: z.enum(['http', 'stdio']),
  url: z.string().optional(),
  command: z.string().optional(),
  args: z.array(z.string()).optional(),
})).default({})
```

#### 3. Tool Registration (Already Exists)

`ToolDefinition` → `createSdkTool()` → Copilot SDK `Tool`:
```typescript
export interface ToolDefinition {
  name: string;
  description: string;
  parametersSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}
```

#### 4. DAG-Based Stage Execution (Already Exists)

- `DAGScheduler` handles stage dependency resolution
- `StageExecutionService` executes prompts within stages
- `SessionAllocator` manages session lifecycle
- `EventBus` + SSE for real-time progress

#### 5. System Workflow Templates (Pattern Exists)

Existing templates: `code-generation`, `code-review`, `refactoring`, `test-generation`

Each template has: stages with prompts, variables, preprocessing steps, edges.

### What's Needed for Playwright

| Component | Status | Work Required |
|-----------|--------|--------------|
| MCP server config in sessions | ✅ Exists | None — use `mcpServers` config |
| WorkflowTemplate MCP config | ✅ Exists | None — templates already support it |
| System workflow template | ❌ Missing | Create `e2e-testing-workflow.json` |
| Custom tool definitions | ⚠️ Optional | Only if custom tools beyond MCP needed |
| Playwright browser lifecycle | ⚠️ Needs design | Hook-based cleanup on workflow end |
| Output artifact handling | ⚠️ Needs design | Screenshot/trace storage and retrieval |

---

## 6. Integration Strategy — Recommended Approach

### Approach A: Pure MCP (Recommended — Lowest Effort, Highest Value)

**No code changes required.** Just configure the Playwright MCP server in workflow templates.

```json
{
  "copilotConfig": {
    "mcpServers": {
      "playwright": {
        "type": "stdio",
        "command": "npx",
        "args": [
          "@playwright/mcp@latest",
          "--headless",
          "--isolated",
          "--caps=testing,devtools",
          "--output-dir", "./playwright-output",
          "--save-trace",
          "--viewport-size", "1280x720"
        ]
      }
    }
  }
}
```

**What this gives you**:
- All Playwright MCP tools automatically available to Copilot
- Browser assertions via `--caps=testing`
- Console/network monitoring via `--caps=devtools`
- Trace recording via `--save-trace`
- Isolated sessions per workflow run
- No code changes to core, copilot-bridge, or shared packages

**How it works in the pipeline**:
1. Workflow template defines `mcpServers.playwright`
2. `SessionAllocator` creates a Copilot session with this MCP config
3. `CopilotAdapter.createSession()` passes `mcpServers` to the SDK
4. SDK starts the Playwright MCP server as a child process
5. All `browser_*` tools become available to the model
6. Stage prompts instruct the model what to test
7. Model calls browser tools, receives accessibility snapshots, reasons, asserts
8. On workflow end, MCP server process is cleaned up by SDK

### Approach B: MCP + Custom Domain Tools (For Advanced Features)

Add custom `ToolDefinition` handlers alongside MCP for domain-specific operations:

```typescript
// Example: Visual regression tool
const visualRegressionTool: ToolDefinition = {
  name: 'visual_regression_check',
  description: 'Compare current page screenshot against baseline',
  parametersSchema: {
    type: 'object',
    properties: {
      baselinePath: { type: 'string', description: 'Path to baseline image' },
      threshold: { type: 'number', description: 'Pixel diff threshold (0-1)' }
    },
    required: ['baselinePath']
  },
  handler: async (args) => {
    // Implementation using pixelmatch or similar
  }
};

// Example: Test report generator
const generateTestReportTool: ToolDefinition = {
  name: 'generate_test_report',
  description: 'Generate a structured test report from test results',
  parametersSchema: {
    type: 'object',
    properties: {
      results: { type: 'array', description: 'Array of test results' },
      format: { type: 'string', enum: ['json', 'markdown', 'html'] }
    },
    required: ['results']
  },
  handler: async (args) => {
    // Implementation
  }
};
```

### Approach C: CLI Wrapper Tools (For Token-Efficient Bulk Operations)

Wrap `playwright-cli` commands as `ToolDefinition` for specific scenarios:

```typescript
const playwrightCliTool: ToolDefinition = {
  name: 'playwright_cli',
  description: 'Run a playwright-cli command for browser automation',
  parametersSchema: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'CLI command (open, goto, click, snapshot, screenshot, etc.)' },
      args: { type: 'array', items: { type: 'string' }, description: 'Command arguments' }
    },
    required: ['command']
  },
  handler: async (args) => {
    const { execSync } = await import('node:child_process');
    const cmd = `playwright-cli ${args.command} ${(args.args as string[] || []).join(' ')}`;
    // Sanitize command to prevent injection
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 30000 });
    return { output: result };
  }
};
```

> **Note**: CLI approach requires careful command sanitization to prevent injection. MCP is safer by design.

---

## 7. System Workflow Design: E2E Testing & Debugging

### Workflow Template: `system-e2e-testing`

#### DAG Structure

```
┌─────────────────────┐
│  Environment Setup  │  Stage 0 — Configure browser, load auth state
└─────────┬───────────┘
          │ on_success
┌─────────▼───────────┐
│  Navigation & Recon │  Stage 1 — Navigate to app, snapshot page structure
└─────────┬───────────┘
          │ on_success
┌─────────▼───────────┐
│  Test Execution     │  Stage 2 — Execute test scenarios (the core)
└────┬────────────┬───┘
     │ on_success │ on_failure
┌────▼───┐   ┌───▼──────────┐
│ Assert │   │   Debug      │  Stage 3a / 3b — Verify or diagnose
│ Results│   │   Failures   │
└────┬───┘   └───┬──────────┘
     │           │ on_completion
     └─────┬─────┘
┌──────────▼──────────┐
│  Report Generation  │  Stage 4 — Generate test report with artifacts
└─────────────────────┘
```

#### Variables

| Variable | Type | Label | Required | Description |
|----------|------|-------|----------|-------------|
| `target_url` | `string` | Target URL | Yes | The application URL to test |
| `test_scenarios` | `text` | Test Scenarios | Yes | Description of test flows to execute |
| `expected_results` | `text` | Expected Results | No | What correct behavior looks like |
| `auth_state_path` | `string` | Auth State File | No | Path to Playwright storage state for auth |
| `browser` | `choice` | Browser | No | chromium / firefox / webkit (default: chromium) |
| `viewport` | `choice` | Viewport | No | Desktop (1280x720) / Tablet (768x1024) / Mobile (375x667) |
| `test_framework` | `choice` | Report Format | No | markdown / json / html |
| `max_retries` | `number` | Max Retries | No | Retries for flaky tests |

#### Stage Definitions

**Stage 0: Environment Setup**
```
Prompts:
  - "You have access to Playwright browser automation tools. 
     Configure the browser for testing:
     - Navigate to {{target_url}} to verify it's accessible
     - Take an initial snapshot to confirm the page loads
     - Report the page title, URL, and any console errors
     
     If there are connection errors, report them immediately."
```

**Stage 1: Navigation & Reconnaissance**
```
Prompts:
  - "Explore the application at {{target_url}}:
     1. Take a snapshot of the current page structure
     2. Identify key interactive elements (forms, buttons, links, navigation)
     3. Map the main user flows visible from this page
     4. Note any accessibility issues
     5. Check for console errors or warnings
     
     Create a sitemap of discoverable pages and describe the UI structure."
```

**Stage 2: Test Execution**
```
Prompts:
  - "Execute the following test scenarios on {{target_url}}:
     
     {{test_scenarios}}
     
     For each scenario:
     1. Navigate to the starting page
     2. Perform the test actions (click, fill, select, etc.)
     3. Verify the expected outcomes
     4. Take a screenshot at each significant step
     5. Record any failures with details (expected vs actual)
     6. Check console for errors after each action
     
     Expected results: {{expected_results}}
     
     Be thorough — test edge cases, error states, and boundary conditions."
```

**Stage 3a: Assert Results** (on_success from Stage 2)
```
Prompts:
  - "Review the test execution results from the previous stage:
     1. Verify all test scenarios passed
     2. Confirm no unexpected console errors
     3. Validate page states match expected results
     4. Check for any visual anomalies in screenshots
     5. Summarize: PASS/FAIL for each scenario with evidence"
```

**Stage 3b: Debug Failures** (on_failure from Stage 2)
```
Prompts:
  - "Test failures were detected. Debug the issues:
     1. Revisit each failing test scenario
     2. Take detailed snapshots at each step
     3. Check the browser console for errors
     4. Check network requests for failed API calls
     5. Identify root causes: is it a UI bug, API error, timing issue, or test logic error?
     6. Suggest fixes and workarounds
     7. Re-attempt the failing tests if appropriate"
```

**Stage 4: Report Generation**
```
Prompts:
  - "Generate a comprehensive E2E test report in {{test_framework}} format:
     
     Include:
     1. Test Summary: total tests, passed, failed, skipped
     2. Environment: browser, viewport, URL
     3. Per-scenario results with:
        - Status (PASS/FAIL/SKIP)
        - Steps executed
        - Screenshots taken
        - Console errors captured
        - Duration
     4. Failure Analysis (if any failures)
     5. Recommendations for test improvements
     6. Overall application quality assessment"
```

#### MCP Configuration for the Template

```json
{
  "copilotConfig": {
    "model": "gpt-4.1",
    "mcpServers": {
      "playwright": {
        "type": "stdio",
        "command": "npx",
        "args": [
          "@playwright/mcp@latest",
          "--headless",
          "--isolated",
          "--caps=testing,devtools",
          "--viewport-size", "{{viewport_size}}",
          "--save-trace",
          "--output-dir", "./test-output"
        ]
      }
    }
  }
}
```

### Full Template JSON

See the accompanying file: `templates/system/e2e-testing-workflow.json`

---

## 8. Implementation Plan

### Phase 1: Zero-Code Integration (Immediate)

**Effort**: ~1 day  
**Changes**: Template file only

1. Create `templates/system/e2e-testing-workflow.json`
2. Register in `SystemWorkflowRegistry`
3. Add `@playwright/mcp` as an optional dependency in `apps/server/package.json`
4. Test with existing workflow runner

**What works immediately**:
- User creates workflow from template
- Sets `target_url` and `test_scenarios`
- Workflow runs stages, Copilot uses Playwright MCP tools
- Real browser automation happens

### Phase 2: Enhanced Artifact Handling (Short-term)

**Effort**: ~3-5 days  
**Changes**: Core + Server

1. Add artifact storage for Playwright output (screenshots, traces)
2. Expose trace viewer link in workflow run results
3. Add `post_run` hook to collect `--output-dir` contents
4. Display screenshots in web UI's WorkflowRunPage

### Phase 3: Custom Domain Tools (Medium-term)

**Effort**: ~1-2 weeks  
**Changes**: Core + New package

1. Create `@generatorai/playwright-tools` package
2. Implement custom `ToolDefinition` handlers:
   - `visual_regression_check` — baseline screenshot comparison
   - `accessibility_audit` — automated WCAG compliance check
   - `performance_check` — core web vitals measurement
   - `generate_test_report` — structured report generation
3. Register tools in composition root
4. Add to template as `tools` array

### Phase 4: Web UI Integration (Medium-term)

**Effort**: ~1-2 weeks  
**Changes**: Web app

1. Add "E2E Testing" workflow builder preset
2. Live browser preview via Playwright MCP `--port` + WebSocket
3. Screenshot gallery in run results view
4. Trace viewer embed (Playwright's trace.playwright.dev)
5. Test result dashboard component

### Dependency Installation

```bash
# Required for Phase 1
pnpm add -w @playwright/mcp

# Optional for Phase 3
pnpm add -w @playwright/test pixelmatch pngjs
```

### Key Risks & Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Playwright binary download size (~400MB) | Slower first run | Pre-install in Docker image; use `--browser=chrome` to skip others |
| Browser process leak on crash | Resource exhaustion | `post_run` hook to kill zombie processes; timeout on MCP server |
| Flaky tests due to timing | False failures | Use Playwright's built-in auto-waiting; set appropriate timeouts |
| Token usage from large accessibility trees | Cost / context limits | Use `--snapshot-mode=incremental` (default); consider CLI for bulk ops |
| Security: browser accessing internal services | Data exposure | Use `--blocked-origins` for internal hosts; `--isolated` mode |
| Windows path issues | CI/CD failures | Use forward slashes; normalize paths in output-dir config |

---

## Appendix A: Playwright MCP Environment Variables

All CLI flags have equivalent environment variables:

| Variable | Equivalent Flag |
|----------|----------------|
| `PLAYWRIGHT_MCP_HEADLESS` | `--headless` |
| `PLAYWRIGHT_MCP_BROWSER` | `--browser` |
| `PLAYWRIGHT_MCP_CAPS` | `--caps` |
| `PLAYWRIGHT_MCP_ISOLATED` | `--isolated` |
| `PLAYWRIGHT_MCP_VIEWPORT_SIZE` | `--viewport-size` |
| `PLAYWRIGHT_MCP_OUTPUT_DIR` | `--output-dir` |
| `PLAYWRIGHT_MCP_SAVE_TRACE` | `--save-trace` |
| `PLAYWRIGHT_MCP_PORT` | `--port` |
| `PLAYWRIGHT_MCP_STORAGE_STATE` | `--storage-state` |
| `PLAYWRIGHT_MCP_IGNORE_HTTPS_ERRORS` | `--ignore-https-errors` |
| `PLAYWRIGHT_MCP_NO_SANDBOX` | `--no-sandbox` |
| `PLAYWRIGHT_MCP_CDP_ENDPOINT` | `--cdp-endpoint` |

## Appendix B: Playwright MCP vs CLI Feature Comparison

| Feature | MCP | CLI |
|---------|-----|-----|
| Navigate | `browser_navigate` | `playwright-cli goto <url>` |
| Click | `browser_click` (ref-based) | `playwright-cli click <ref>` |
| Type | `browser_type` | `playwright-cli type <text>` |
| Fill | `browser_fill` | `playwright-cli fill <ref> <text>` |
| Screenshot | `browser_screen_capture` (vision cap) | `playwright-cli screenshot` |
| Snapshot | `browser_snapshot` | `playwright-cli snapshot` |
| Assertions | `browser_assert_snapshot` (testing cap) | Manual |
| Console | `browser_console` (devtools cap) | `playwright-cli console` |
| Network | `browser_network` (devtools cap) | `playwright-cli network` |
| Tracing | `browser_tracing_*` (tracing cap) | `playwright-cli tracing-*` |
| Route mock | ❌ Not available | `playwright-cli route <pattern>` |
| Cookies | ❌ Not available | `playwright-cli cookie-*` |
| LocalStorage | ❌ Not available | `playwright-cli localstorage-*` |
| Video | ❌ Not available | `playwright-cli video-*` |
| Multi-session | Single browser per server | Named sessions `-s=<name>` |
| Dashboard | ❌ | `playwright-cli show` |

## Appendix C: References

- **Playwright MCP Server**: https://github.com/microsoft/playwright-mcp
- **Playwright CLI**: https://github.com/microsoft/playwright-cli
- **Playwright Documentation**: https://playwright.dev
- **MCP Protocol Specification**: https://modelcontextprotocol.io
- **GeneratorAI Architecture**: See `docs/ARCHITECTURE_ANALYSIS.md`
