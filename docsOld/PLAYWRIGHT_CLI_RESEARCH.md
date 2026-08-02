# Playwright CLI Integration Research

## Executive Summary

This document analyzes using the **Playwright CLI** (`npx playwright`) directly as an alternative to the **@playwright/mcp** MCP server for browser automation in GeneratorAI's agent workflow system. The CLI approach is fundamentally more token-efficient because the agent generates a complete test script as a single code block and executes it in one shot, rather than issuing dozens of individual MCP tool calls (navigate, click, type, screenshot) each requiring JSON request/response round-trips.

---

## 1. Playwright CLI — Complete Command Reference

### Installation

```bash
# Option A: Full test framework (RECOMMENDED for our use case)
pnpm add -D @playwright/test

# Option B: Library only (no test runner, scriptable API)
pnpm add -D playwright

# Install browser binaries
npx playwright install              # All browsers
npx playwright install chromium     # Chromium only
npx playwright install firefox      # Firefox only
npx playwright install webkit       # WebKit only
npx playwright install --with-deps  # Browsers + system dependencies (Linux CI)
```

**Package comparison:**

| Package | Use Case | Includes |
|---------|----------|----------|
| `@playwright/test` | Test runner + assertions + fixtures + CLI | Full test framework, `npx playwright test` command |
| `playwright` | Library mode — scripting with `node myscript.js` | Browser automation API, no test runner |
| `@playwright/browser-chromium` | Auto-download chromium on `npm install` | Browser binary only |

**Recommendation:** Install `@playwright/test` — it gives us both the test runner CLI and the library API.

### All CLI Subcommands

| Command | Purpose |
|---------|---------|
| `npx playwright test [options] [filter...]` | Run tests matching filters |
| `npx playwright codegen [url]` | Record user actions and generate test code |
| `npx playwright show-report [dir]` | Serve the HTML test report |
| `npx playwright show-trace [trace]` | Open trace viewer for debugging |
| `npx playwright install [browser...]` | Download browser binaries |
| `npx playwright install-deps [browser...]` | Install system dependencies for browsers |
| `npx playwright uninstall` | Remove installed browsers |
| `npx playwright merge-reports <dir>` | Merge blob reports from sharded runs |
| `npx playwright clear-cache` | Clear all Playwright caches |
| `npx playwright --version` | Print Playwright version |
| `npx playwright --help` | Print help |

> **Note:** The old `npx playwright screenshot <url>` and `npx playwright pdf <url>` utility commands from Playwright v1.x have been removed. Screenshots and PDF generation are now done through the test/library API (`page.screenshot()`, `page.pdf()`).

### `npx playwright test` — Full Options Reference

| Flag | Description | Default |
|------|-------------|---------|
| `-c, --config <file>` | Config file path | `playwright.config.ts` |
| `--debug` | Run with Playwright Inspector (sets PWDEBUG=1, timeout=0, headed, workers=1) | — |
| `--headed` | Show browser windows | headless |
| `-g, --grep <regex>` | Only run tests matching regex | `.*` |
| `--grep-invert <regex>` | Skip tests matching regex | — |
| `--project <name...>` | Run specific projects (supports `*` wildcard) | all |
| `-j, --workers <N>` | Concurrent workers (number or `%` of CPUs) | 50% |
| `--reporter <reporter>` | Reporter: `dot`, `line`, `list`, `json`, `junit`, `html`, `blob`, `github`, or custom path | `list` |
| `--retries <N>` | Retry count for flaky tests | 0 |
| `--timeout <ms>` | Test timeout (0 = unlimited) | 30000 |
| `--global-timeout <ms>` | Suite-level timeout | unlimited |
| `--output <dir>` | Artifact output directory | `test-results` |
| `--trace <mode>` | Tracing: `on`, `off`, `on-first-retry`, `retain-on-failure` | — |
| `--max-failures <N>` / `-x` | Stop after N failures (`-x` = stop at first) | — |
| `--fully-parallel` | Run all tests in parallel | false |
| `--forbid-only` | Fail if `test.only` is used (CI guard) | false |
| `--fail-on-flaky-tests` | Fail if any test is flaky | false |
| `--last-failed` | Re-run only previously failed tests | — |
| `--list` | List all tests without running them | — |
| `--only-changed [ref]` | Only run changed test files (git) | — |
| `--pass-with-no-tests` | Succeed even with no tests found | false |
| `--quiet` | Suppress stdio | false |
| `--repeat-each <N>` | Run each test N times | 1 |
| `--shard <current/total>` | Shard tests (e.g., `1/3`) | — |
| `--ui` | Interactive UI mode | — |
| `--ui-host <host>` | Host for UI mode | — |
| `--ui-port <port>` | Port for UI mode | — |
| `-u, --update-snapshots [mode]` | Update snapshots: `all`, `changed`, `missing`, `none` | — |
| `--ignore-snapshots` | Ignore screenshot/snapshot expectations | — |
| `--tsconfig <path>` | TypeScript config for imports | auto-detect |
| `--no-deps` | Skip project dependencies | — |

---

## 2. Token Efficiency Analysis: CLI vs MCP

### The MCP Approach (Current)

With `@playwright/mcp`, each browser action is a separate MCP tool call. A typical test flow looks like:

```
Agent → Tool Call: browser_navigate({ url: "http://localhost:3000" })
← Tool Result: { success: true, title: "My App", ... }           ~200 tokens

Agent → Tool Call: browser_snapshot({})
← Tool Result: { snapshot: "... accessibility tree ..." }          ~500 tokens

Agent → Tool Call: browser_click({ ref: "s1e5" })
← Tool Result: { success: true }                                   ~100 tokens

Agent → Tool Call: browser_type({ ref: "s2e3", text: "hello" })
← Tool Result: { success: true }                                   ~100 tokens

Agent → Tool Call: browser_screenshot({})
← Tool Result: { base64: "iVBORw0KG..." }                         ~2000 tokens (image)

Agent → Tool Call: browser_click({ ref: "submit-btn" })
← Tool Result: { success: true }                                   ~100 tokens

Agent → Tool Call: browser_snapshot({})
← Tool Result: { snapshot: "... result page ..." }                 ~500 tokens
```

**For a 10-step user flow:** ~15-20 tool calls × ~200-500 tokens each = **3,000-10,000 tokens** in tool call overhead alone, plus the agent's reasoning tokens between each call.

### The CLI Approach (Proposed)

The agent generates a complete test script and runs it in one shot:

```
Agent generates script:                                             ~300 tokens
─────────────────────────────────
import { test, expect } from '@playwright/test';

test('validate login flow', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await page.fill('#username', 'testuser');
  await page.fill('#password', 'password123');
  await page.click('button[type=submit]');
  await expect(page).toHaveURL('/dashboard');
  await expect(page.locator('h1')).toHaveText('Welcome');
  await page.screenshot({ path: 'result.png' });
});
─────────────────────────────────

Agent → single terminal command:                                    ~50 tokens
  npx playwright test login.spec.ts --reporter=json

← single result:                                                    ~500 tokens
  { suites: [...], stats: { expected: 1, unexpected: 0 }, ... }
```

**Total: ~850 tokens** vs **3,000-10,000 tokens** for the same flow.

### Why CLI Is More Token Efficient

| Factor | MCP Approach | CLI Approach |
|--------|-------------|--------------|
| **Tool call overhead** | Each action = JSON request + JSON response | Single file write + single command execution |
| **Agent reasoning** | Agent must reason between EVERY action ("now I need to click..., let me find the element...") | Agent reasons ONCE upfront to plan the entire script |
| **Element discovery** | Must call `browser_snapshot` repeatedly to find elements | Script uses Playwright's locator API (CSS, role, text) — no discovery overhead |
| **Wait/retry logic** | Agent must manually poll and retry | Built into Playwright's auto-waiting |
| **Screenshot transfer** | Base64 images in tool results = massive token cost | Screenshots saved to disk as files, only paths returned |
| **Error context** | One error at a time, agent must diagnose step by step | Full stack trace + trace file + all failures in one report |
| **Batch operations** | Impossible — one action per tool call | Natural — all actions in one script |

### Estimated Token Savings

| Scenario | MCP (tokens) | CLI (tokens) | Savings |
|----------|-------------|-------------|---------|
| Simple page navigation + screenshot | ~1,500 | ~400 | **73%** |
| 10-step form fill and submit | ~8,000 | ~900 | **89%** |
| 5-page user flow validation | ~15,000 | ~1,500 | **90%** |
| Accessibility scan + report | ~5,000 | ~800 | **84%** |
| E2E test suite (10 tests) | ~50,000+ | ~3,000 | **94%** |

---

## 3. Integration Patterns

### Pattern A: Agent Generates + Runs a Test File

The primary pattern. The agent writes a `.spec.ts` file, executes it via CLI, and reads the JSON results.

**Step 1: Agent writes the test file**
```typescript
// Generated by AI agent → saved to /tmp/playwright-tests/test-<uuid>.spec.ts
import { test, expect } from '@playwright/test';

test('validate homepage', async ({ page }) => {
  await page.goto('http://localhost:3000');
  await expect(page).toHaveTitle(/My App/);
  
  // Take screenshot for evidence
  await page.screenshot({ path: 'test-results/homepage.png', fullPage: true });
  
  // Check navigation links
  const nav = page.locator('nav');
  await expect(nav).toBeVisible();
  
  // Verify no console errors
  const errors: string[] = [];
  page.on('console', msg => { if (msg.type() === 'error') errors.push(msg.text()); });
  await page.reload();
  expect(errors).toHaveLength(0);
});
```

**Step 2: Execute via CLI**
```bash
npx playwright test test-<uuid>.spec.ts \
  --reporter=json \
  --output=test-results/<uuid> \
  --timeout=30000 \
  --workers=1
```

**Step 3: Parse JSON results**
The JSON reporter outputs structured results:
```json
{
  "config": { ... },
  "suites": [{
    "title": "",
    "specs": [{
      "title": "validate homepage",
      "ok": true,
      "tests": [{
        "status": "expected",
        "results": [{
          "status": "passed",
          "duration": 1234,
          "attachments": [
            { "name": "screenshot", "path": "test-results/homepage.png", "contentType": "image/png" }
          ],
          "steps": [
            { "title": "page.goto(http://localhost:3000)", "duration": 500 },
            { "title": "expect.toHaveTitle", "duration": 100 }
          ]
        }]
      }]
    }]
  }],
  "stats": {
    "expected": 1,
    "unexpected": 0,
    "flaky": 0,
    "skipped": 0,
    "duration": 1234
  }
}
```

### Pattern B: Quick Screenshot Capture

Use a minimal script or Playwright library mode for one-off screenshots:

```typescript
// quick-screenshot.ts (run with: npx tsx quick-screenshot.ts)
import { chromium } from 'playwright';

const url = process.argv[2];
const output = process.argv[3] || 'screenshot.png';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto(url);
await page.screenshot({ path: output, fullPage: true });
await browser.close();
console.log(JSON.stringify({ success: true, path: output }));
```

Or as an inline test:
```bash
npx playwright test --grep "screenshot" -c playwright-agent.config.ts
```

### Pattern C: Accessibility Testing

```typescript
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test('accessibility audit', async ({ page }, testInfo) => {
  await page.goto('http://localhost:3000');
  
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
  
  // Attach full results for the agent to analyze
  await testInfo.attach('a11y-results', {
    body: JSON.stringify(results, null, 2),
    contentType: 'application/json',
  });
  
  // Report violations
  if (results.violations.length > 0) {
    const summary = results.violations.map(v => ({
      rule: v.id,
      impact: v.impact,
      description: v.description,
      elements: v.nodes.length,
      targets: v.nodes.map(n => n.target),
    }));
    console.log('VIOLATIONS:', JSON.stringify(summary, null, 2));
  }
  
  expect(results.violations).toEqual([]);
});
```

### Pattern D: Multi-Page User Flow Validation

```typescript
import { test, expect } from '@playwright/test';

test('complete checkout flow', async ({ page }) => {
  // Step 1: Browse products
  await page.goto('http://localhost:3000/products');
  await page.screenshot({ path: 'test-results/step1-products.png' });
  
  // Step 2: Add to cart
  await page.click('[data-testid="product-1"] button');
  await expect(page.locator('.cart-count')).toHaveText('1');
  await page.screenshot({ path: 'test-results/step2-added.png' });
  
  // Step 3: Go to checkout
  await page.click('[data-testid="checkout-btn"]');
  await expect(page).toHaveURL('/checkout');
  
  // Step 4: Fill form
  await page.fill('#email', 'test@example.com');
  await page.fill('#address', '123 Test St');
  await page.selectOption('#country', 'US');
  await page.screenshot({ path: 'test-results/step3-checkout.png' });
  
  // Step 5: Submit order
  await page.click('button[type=submit]');
  await expect(page.locator('.order-confirmation')).toBeVisible();
  await page.screenshot({ path: 'test-results/step4-confirmed.png' });
});
```

### Pattern E: Debugging — Capture Console + Network

```typescript
import { test, expect } from '@playwright/test';

test('debug page issues', async ({ page }) => {
  const consoleMessages: { type: string; text: string }[] = [];
  const networkErrors: { url: string; status: number }[] = [];
  
  page.on('console', msg => consoleMessages.push({ type: msg.type(), text: msg.text() }));
  page.on('response', resp => {
    if (resp.status() >= 400) {
      networkErrors.push({ url: resp.url(), status: resp.status() });
    }
  });
  
  await page.goto('http://localhost:3000');
  await page.waitForLoadState('networkidle');
  
  // Output structured debug info
  console.log('CONSOLE:', JSON.stringify(consoleMessages));
  console.log('NETWORK_ERRORS:', JSON.stringify(networkErrors));
  
  // Screenshot for visual evidence
  await page.screenshot({ path: 'test-results/debug.png', fullPage: true });
  
  // Assertions
  const errors = consoleMessages.filter(m => m.type === 'error');
  expect(errors).toHaveLength(0);
  expect(networkErrors).toHaveLength(0);
});
```

---

## 4. Playwright Config for Agent Use

A minimal `playwright.config.ts` optimized for AI agent execution:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  // Tests generated by the AI agent go here
  testDir: './agent-tests',
  
  // Timeout for individual tests
  timeout: 60_000,
  
  // Expect timeout (for assertions with auto-retry)
  expect: { timeout: 10_000 },
  
  // Run tests serially — agent needs deterministic order
  fullyParallel: false,
  workers: 1,
  
  // Fail fast — stop on first failure for agent to analyze
  maxFailures: 1,
  
  // No retries — agent handles retry logic at workflow level
  retries: 0,
  
  // JSON reporter for structured results + list for human-readable terminal output
  reporter: [
    ['json', { outputFile: 'test-results/results.json' }],
    ['list'],
  ],
  
  // Capture traces on failure for detailed debugging
  use: {
    headless: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
    
    // Default viewport
    viewport: { width: 1280, height: 720 },
    
    // Useful for testing local dev servers
    baseURL: process.env.TARGET_URL || 'http://localhost:3000',
    
    // Ignore HTTPS errors for local dev
    ignoreHTTPSErrors: true,
  },
  
  // Single browser project for agent use (configurable)
  projects: [
    {
      name: 'chromium',
      use: { browserName: 'chromium' },
    },
  ],
  
  // Artifacts output
  outputDir: 'test-results/artifacts',
});
```

---

## 5. Practical Integration Architecture

### How It Fits Into GeneratorAI's Workflow System

```
┌─────────────────────────────────────────────────────────────────┐
│                    Workflow Orchestrator                         │
│                                                                 │
│  Stage 1: Test Planning                                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Agent receives test requirements                          │  │
│  │ Agent generates Playwright test script(s)                 │  │
│  │ Writes .spec.ts file(s) to agent-tests/ directory         │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                  │
│  Stage 2: Test Execution     ▼                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Agent executes: npx playwright test --reporter=json       │  │
│  │ Playwright runs ALL tests in one process                  │  │
│  │ Results → test-results/results.json                       │  │
│  │ Screenshots → test-results/artifacts/                     │  │
│  │ Traces → test-results/artifacts/ (on failure)             │  │
│  └───────────────────────────────────────────────────────────┘  │
│                              │                                  │
│  Stage 3: Analysis           ▼                                  │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │ Agent reads results.json                                  │  │
│  │ Analyzes pass/fail status, errors, durations              │  │
│  │ If failures: reads stack traces, inspects screenshots     │  │
│  │ Generates report or takes corrective action               │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Implementation Approach: Custom Tools Instead of MCP

Instead of the MCP server providing browser tools, we give the agent **three custom tools**:

```typescript
// Tool 1: Write a Playwright test file
const writePlaywrightTest: ToolDefinition = {
  name: 'write_playwright_test',
  description: 'Write a Playwright test script. The agent provides the full test code.',
  parametersSchema: {
    type: 'object',
    properties: {
      filename: { type: 'string', description: 'Test filename (e.g., "login-test.spec.ts")' },
      code: { type: 'string', description: 'Complete Playwright test code' },
    },
    required: ['filename', 'code'],
  },
  handler: async (args) => {
    const { filename, code } = args as { filename: string; code: string };
    // Sanitize filename to prevent path traversal
    const safeName = path.basename(filename);
    const testDir = path.join(process.cwd(), 'agent-tests');
    await fs.mkdir(testDir, { recursive: true });
    await fs.writeFile(path.join(testDir, safeName), code, 'utf-8');
    return { success: true, path: path.join(testDir, safeName) };
  },
};

// Tool 2: Run Playwright tests
const runPlaywrightTests: ToolDefinition = {
  name: 'run_playwright_tests',
  description: 'Execute Playwright tests and return structured JSON results.',
  parametersSchema: {
    type: 'object',
    properties: {
      testFile: { type: 'string', description: 'Optional: specific test file to run' },
      grep: { type: 'string', description: 'Optional: filter tests by title regex' },
      timeout: { type: 'number', description: 'Test timeout in ms (default: 60000)' },
      headed: { type: 'boolean', description: 'Run in headed mode (default: false)' },
    },
  },
  handler: async (args) => {
    const { testFile, grep, timeout, headed } = args as Record<string, unknown>;
    const cmd = ['npx', 'playwright', 'test'];
    if (testFile) cmd.push(path.basename(testFile as string));
    cmd.push('--reporter=json');
    cmd.push('--workers=1');
    if (grep) cmd.push(`--grep=${grep}`);
    if (timeout) cmd.push(`--timeout=${timeout}`);
    if (headed) cmd.push('--headed');
    
    const { stdout, stderr, exitCode } = await execCommand(cmd.join(' '));
    
    // Parse JSON output
    try {
      const results = JSON.parse(stdout);
      return {
        success: exitCode === 0,
        stats: results.stats,
        suites: results.suites, // Trimmed for token efficiency
        errors: exitCode !== 0 ? stderr : undefined,
      };
    } catch {
      return { success: false, stdout, stderr, exitCode };
    }
  },
};

// Tool 3: Read test artifacts (screenshots, traces)
const readTestArtifacts: ToolDefinition = {
  name: 'read_test_artifacts',
  description: 'List or read artifacts from the last test run (screenshots, traces, results).',
  parametersSchema: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['list', 'read_json'], description: 'Action to perform' },
      path: { type: 'string', description: 'File path to read (for read_json action)' },
    },
    required: ['action'],
  },
  handler: async (args) => {
    const { action, path: filePath } = args as { action: string; path?: string };
    if (action === 'list') {
      const artifacts = await glob('test-results/**/*', { nodir: true });
      return { artifacts };
    }
    if (action === 'read_json' && filePath) {
      const content = await fs.readFile(filePath, 'utf-8');
      return JSON.parse(content);
    }
    return { error: 'Invalid action' };
  },
};
```

### Alternative: Direct Terminal Execution (Simplest)

If the agent already has terminal access (like in the Copilot SDK), the simplest approach is:

1. Agent uses `fs_write` tool to create test file
2. Agent uses `run_in_terminal` to execute `npx playwright test --reporter=json`
3. Agent uses `fs_read` tool to read `test-results/results.json`

This requires no custom tools — just file system and terminal access.

---

## 6. Key Differences: MCP vs CLI

| Aspect | MCP (`@playwright/mcp`) | CLI (`npx playwright test`) |
|--------|------------------------|------------------------------|
| **Token cost per action** | ~200-500 tokens (tool call + response) | 0 (all actions in script) |
| **Token cost per session** | Scales linearly with # of actions | Nearly constant (~300 for script + ~500 for results) |
| **Latency** | Each action requires agent reasoning | All actions execute at native speed |
| **Interactive exploration** | Excellent — agent can react to what it sees | Limited — agent must predict page structure |
| **Error recovery** | Agent can adapt in real-time | Must re-generate and re-run script |
| **Screenshot handling** | Base64 in JSON = huge token cost | Saved to disk, paths returned |
| **Element discovery** | `browser_snapshot()` returns accessibility tree | Agent must know/predict selectors |
| **Page state tracking** | MCP server tracks state across calls | Each test run is independent |
| **Complex interactions** | Step-by-step with agent judgment | Script must handle all logic upfront |
| **Setup complexity** | Add MCP server config to session | Install `@playwright/test` + config file |
| **Debugging** | Agent sees each step result | Trace files + screenshots on failure |
| **Accessibility** | Built-in `browser_snapshot` for a11y tree | Need `@axe-core/playwright` package |
| **Multi-page flows** | Agent navigates page by page | Script handles entire flow |

### When to Use MCP (Still Valuable)

- **Exploratory testing**: Agent doesn't know the page structure and needs to discover it
- **Interactive debugging**: Investigating a specific issue with back-and-forth interaction
- **Single-action tasks**: "Take a screenshot of this URL" (though CLI can do this too)
- **Dynamic user guidance**: Agent needs to show the user what it sees step by step

### When to Use CLI (Better Choice)

- **Regression testing**: Running known test scripts against an app
- **User flow validation**: Testing complete multi-step workflows
- **Batch screenshots**: Capturing multiple pages in one run
- **Accessibility audits**: Full-page axe-core scans
- **CI/CD integration**: Running tests as part of a pipeline
- **Any scenario where total actions > ~5**: Token savings become significant

### Hybrid Approach (Best of Both Worlds)

Use **MCP for discovery** and **CLI for execution**:

1. Stage 1 (MCP): Agent uses `browser_snapshot` to explore the app and understand its structure
2. Stage 2 (CLI): Agent generates comprehensive Playwright tests based on what it learned
3. Stage 3 (CLI): Execute tests via CLI, get structured results
4. Stage 4 (MCP, if needed): Follow up on specific failures interactively

---

## 7. Tradeoffs & Considerations

### Advantages of CLI Approach

1. **Massive token savings** (70-95% reduction)
2. **Faster execution** — no agent reasoning between actions, native Playwright speed
3. **Better reporting** — JSON, HTML, JUnit built-in reporters
4. **Tracing** — automatic trace capture on failure for deep debugging
5. **Retry logic** — built-in retries, sharding, parallel execution
6. **Reusability** — generated scripts can be saved and rerun
7. **Standard tooling** — uses Playwright's official test framework, wide ecosystem
8. **Auto-waiting** — Playwright handles timing issues automatically

### Disadvantages of CLI Approach

1. **Agent must predict page structure** — can't explore interactively
2. **All-or-nothing execution** — can't adapt mid-test (but can re-run)
3. **Requires selector knowledge** — agent must generate correct locators
4. **Setup overhead** — need `@playwright/test` installed + browser binaries + config file
5. **File I/O** — agent must write files and read results (but this is cheap)
6. **Cold start** — browser launch overhead per test run (~2-5 seconds)

### Mitigations

| Disadvantage | Mitigation |
|-------------|-----------|
| Can't explore interactively | Use MCP for initial exploration, CLI for execution (hybrid) |
| Must predict page structure | Train agent on target app's component library / design system docs |
| Needs correct selectors | Use resilient locators: `getByRole()`, `getByText()`, `getByTestId()` |
| Setup overhead | Pre-install browsers in Docker/setup; use `only-shell` for smaller Chromium |
| Cold start | Use Playwright's `reuseExistingServer` or `webServer` config |

---

## 8. Recommended Implementation for GeneratorAI

### Phase 1: Side-by-Side Support

1. Add `@playwright/test` and `@axe-core/playwright` as workspace dependencies
2. Create an `agent-playwright.config.ts` at workspace root
3. Create a new system workflow template `e2e-testing-cli-workflow.json` that uses CLI approach
4. Keep existing MCP-based `e2e-testing-workflow.json` for interactive/exploratory use

### Phase 2: Custom Tools

Add three tools to the Copilot session when using the CLI workflow:
- `write_playwright_test` — write test files to a sandboxed directory
- `run_playwright_tests` — execute via CLI, return JSON results
- `read_test_artifacts` — list/read screenshots, traces, results

### Phase 3: Hybrid Workflows

Create a workflow that combines both approaches:
- Stage 1: MCP-based exploration (understand the app)
- Stage 2: CLI-based test generation and execution (efficient testing)
- Stage 3: CLI-based accessibility audit
- Stage 4: Report generation from JSON results

### Installation Steps

```bash
# In GeneratorAI workspace root
pnpm add -D @playwright/test @axe-core/playwright

# Install Chromium browser binary
npx playwright install chromium

# (Optional) Install all browsers
npx playwright install

# Verify installation
npx playwright --version
```

### JSON Reporter Output Format (What the Agent Parses)

```json
{
  "config": {
    "rootDir": "/path/to/project",
    "configFile": "playwright.config.ts"
  },
  "suites": [
    {
      "title": "test-file.spec.ts",
      "file": "test-file.spec.ts",
      "specs": [
        {
          "title": "test name",
          "ok": true,
          "tests": [
            {
              "projectName": "chromium",
              "status": "expected",
              "results": [
                {
                  "status": "passed",
                  "duration": 1234,
                  "error": null,
                  "attachments": [],
                  "steps": [
                    {
                      "title": "page.goto(http://localhost:3000)",
                      "category": "pw:api",
                      "duration": 450
                    }
                  ]
                }
              ]
            }
          ]
        }
      ]
    }
  ],
  "stats": {
    "startTime": "2026-03-07T10:00:00.000Z",
    "duration": 5000,
    "expected": 5,
    "unexpected": 1,
    "flaky": 0,
    "skipped": 0
  },
  "errors": [
    {
      "message": "Expected: 'Welcome'\nReceived: 'Login'",
      "location": { "file": "test.spec.ts", "line": 15, "column": 5 }
    }
  ]
}
```

---

## 9. Example: Complete Agent-Driven CLI Workflow

### The Agent's Prompt Produces This Script

```typescript
// agent-tests/checkout-flow.spec.ts
import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

test.describe('Checkout Flow Validation', () => {
  
  test('homepage loads correctly', async ({ page }) => {
    await page.goto('/');
    await expect(page).toHaveTitle(/Store/);
    await expect(page.getByRole('navigation')).toBeVisible();
    await page.screenshot({ path: 'test-results/01-homepage.png' });
  });

  test('product listing displays items', async ({ page }) => {
    await page.goto('/products');
    const products = page.locator('[data-testid="product-card"]');
    await expect(products).toHaveCount(12);  // Expect 12 products
    await page.screenshot({ path: 'test-results/02-products.png' });
  });

  test('add to cart works', async ({ page }) => {
    await page.goto('/products');
    await page.locator('[data-testid="product-card"]').first().click();
    await page.getByRole('button', { name: 'Add to Cart' }).click();
    await expect(page.getByTestId('cart-badge')).toHaveText('1');
    await page.screenshot({ path: 'test-results/03-cart.png' });
  });

  test('checkout form validation', async ({ page }) => {
    await page.goto('/checkout');
    await page.getByRole('button', { name: 'Place Order' }).click();
    // Should show validation errors
    await expect(page.getByText('Email is required')).toBeVisible();
    await page.screenshot({ path: 'test-results/04-validation.png' });
  });

  test('accessibility - homepage', async ({ page }) => {
    await page.goto('/');
    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa'])
      .analyze();
    
    if (results.violations.length > 0) {
      console.log('A11Y_VIOLATIONS:', JSON.stringify(
        results.violations.map(v => ({ id: v.id, impact: v.impact, nodes: v.nodes.length }))
      ));
    }
    expect(results.violations).toHaveLength(0);
  });
});
```

### The Agent Runs It

```bash
TARGET_URL=http://localhost:3000 npx playwright test checkout-flow.spec.ts \
  --reporter=json \
  --output=test-results \
  --workers=1 \
  --timeout=60000
```

### The Agent Reads Results and Responds

```
Test Results Summary:
✓ homepage loads correctly (1.2s)
✓ product listing displays items (0.8s) 
✓ add to cart works (1.5s)
✗ checkout form validation (2.1s) — FAILED
  Error: Expected "Email is required" to be visible, but element was not found
  → Likely the validation message uses different text or selector
✗ accessibility - homepage (1.0s) — FAILED  
  3 WCAG violations found:
  - color-contrast (serious): 5 elements
  - image-alt (critical): 2 elements  
  - link-name (serious): 1 element

3/5 tests passed. 2 failures require attention.
Screenshots saved to test-results/01-homepage.png through 04-validation.png.
```

---

## 10. Summary & Recommendation

**Use the CLI approach as the default for planned test execution.** It provides 70-95% token savings over MCP for any scenario involving more than a few browser actions. Reserve MCP for interactive exploration where the agent needs to discover unknown page structure.

The optimal integration is a **hybrid system**:
- **CLI path**: Agent generates scripts → `npx playwright test --reporter=json` → parse results
- **MCP path**: Agent explores interactively via tool calls when page structure is unknown
- **Workflow template**: New CLI-based workflow template alongside the existing MCP-based one

**Key install command:** `pnpm add -D @playwright/test @axe-core/playwright && npx playwright install chromium`
