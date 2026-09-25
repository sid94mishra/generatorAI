#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// CI guard: the security invariants that must never silently regress.
//
// Written in the same spirit as `check-no-app-wide-cdp.mjs` — each rule
// encodes a specific mistake that already cost us (or would cost us) a real
// vulnerability, and matches the *dangerous construct*, not prose about it.
//
// Every rule can be waived on a single line with a trailing
// `// security-ok: <reason>` comment, so a legitimate exception is explicit,
// reviewable, and self-documenting instead of being a silently loosened rule.
//
// Run: node scripts/check-security-invariants.mjs
// ────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
// Not `globSync` from node:fs — it only landed in Node 22 and the engine floor was Node 20 when this was written, so
// every checker in the root `lint` chain died at import before its first rule.
import { globFiles } from './lib/globFiles.mjs';
import { resolve, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Files whose whole purpose is to implement/parse the thing a rule bans. */
const GLOBAL_ALLOWLIST = [
  'scripts/check-security-invariants.mjs',
  'packages/secrets/src/redaction.ts',
  'packages/secrets/src/KeyProvider.ts',
  'packages/auth/src/AuthService.ts',
];

/**
 * @typedef {{
 *   id: string,
 *   description: string,
 *   remedy: string,
 *   globs: string[],
 *   pattern: RegExp,
 *   allow?: string[],
 *   knownDebt?: Array<{ file: string, line: RegExp, reason: string, hit?: boolean }>,
 * }} Rule
 */

/** @type {Rule[]} */
const RULES = [
  {
    id: 'no-long-lived-key-in-url',
    description: 'A reusable credential must never be placed in a URL.',
    remedy:
      'Mint a short-lived single-use stream ticket instead ' +
      '(POST /api/stream/tickets), or send an Authorization header.',
    globs: ['apps/web/src/**/*.{ts,tsx}', 'apps/cli/src/**/*.ts', 'apps/desktop/src/**/*.ts'],
    // `?apiKey=` / searchParams.set('apiKey', …) — but NOT `ticket`.
    pattern: /(\?|&)apiKey=|searchParams\.set\(\s*['"]apiKey['"]/,
  },
  {
    id: 'no-direct-credential-env-reads',
    description:
      'Credential environment variables may only be read by the secrets/auth ' +
      'packages, which redact and vault them.',
    remedy:
      'Resolve the value through SecretStore (`@generatorai/secrets`) so it is ' +
      'redacted from logs and can be rotated.',
    globs: ['apps/web/src/**/*.{ts,tsx}', 'packages/core/src/**/*.ts'],
    pattern:
      /process\.env\[\s*['"](?:GENERATORAI_API_KEY|GENERATORAI_SECRET_KEY|GENERATORAI_SECRET_PASSPHRASE|ANTHROPIC_API_KEY|OPENAI_API_KEY|GITHUB_TOKEN|GH_TOKEN)['"]/,
  },
  {
    id: 'no-credential-logging',
    description: 'Authorization headers, DPoP proofs and tokens must never be logged.',
    remedy: 'Log `req.path` (never `req.url`) and pass payloads through `redactDeep`.',
    globs: ['apps/server/src/**/*.ts', 'packages/**/src/**/*.ts'],
    pattern:
      /(?:logger|log|console)\.(?:log|info|warn|error|debug)\([^)]*\b(?:req\.headers\[['"]authorization|authorizationHeader|accessToken|resumeSecret|pairingToken|refreshToken|req\.url)\b/,
  },
  {
    id: 'no-insecure-secret-fallback',
    description:
      'Electron `basic_text` is obfuscation, not encryption; it must never be ' +
      'accepted as a secret backend.',
    remedy: 'Refuse to persist and surface the reason in the security posture.',
    globs: ['apps/desktop/src/**/*.ts', 'packages/secrets/src/**/*.ts'],
    // Flags code that treats basic_text as acceptable.
    pattern: /basic_text['"]\s*\)?\s*(?:=>|\{)?\s*(?:return\s+)?(?:true|\{\s*secure:\s*true)/,
  },
  {
    id: 'no-unauthenticated-non-loopback-bind',
    description: 'A non-loopback listener must never be created outside the guarded path.',
    remedy:
      'Bind through `config.security.bindHost`, which `createSecurityContext` ' +
      'has already validated.',
    globs: ['apps/server/src/**/*.ts'],
    pattern: /\.listen\(\s*[^,)]+,\s*['"](?:0\.0\.0\.0|::)['"]/,
  },
  {
    id: 'no-default-bypass-permissions',
    description: 'An agent permission mode must never default to bypassing approvals.',
    remedy: 'Default to `workspace-write` + `on-request`; require explicit opt-in.',
    globs: ['packages/**/src/**/*.ts', 'apps/server/src/**/*.ts'],
    // Three shapes, all of which set a default:
    //   permissionMode: 'bypassPermissions'                 (literal assignment)
    //   x.permissionMode ?? 'bypassPermissions'             (nullish fallback)
    //   x.permissionMode || 'bypassPermissions'             (falsy fallback)
    // and the key is matched as a case-insensitive SUFFIX, so
    // `defaultChatPermissionMode: ChatPermissionMode = 'bypassPermissions'`
    // is caught too. The original rule only knew the first shape with a bare
    // lowercase key, which is why it stayed green while all three real
    // default sites in the codebase used the `?? 'bypassPermissions'` idiom.
    // A comparison (`=== '…'`, `!== '…'`) does not match: `[:=]` consumes one
    // `=` and the next character must then be a quote. A union TYPE whose
    // first member happens to be the literal (`type Mode = 'bypassPermissions'
    // | 'default'`) is excluded by the trailing `(?!\s*\|)` — it declares the
    // vocabulary, it does not pick a default.
    pattern:
      /(?:permissionMode|approvalPolicy|sandboxMode)\w*\s*(?:[:=]|\?\?|\|\|)\s*['"](?:bypassPermissions|never|full-access)['"](?!\s*\|)/i,
    // ── Known debt — APPLICATION-REVIEW-2026-09 §5.1/§6.7 ──────────────
    // Every entry below is a REAL fail-open default that the review found and
    // that WS-A is flipping to a safe mode. They are listed here, not waived
    // inline, because (a) the lines are being rewritten by that work and an
    // inline `security-ok` on each would be stale the moment it lands, and
    // (b) a ledger that prints its own size on every run cannot be forgotten
    // the way sixteen scattered comments can. An entry silences ONLY a line
    // that still matches its `line` regex in its `file`; once the default is
    // fixed the entry stops matching and the run prints a "stale entry —
    // remove it" notice. Do NOT add to this list to make CI green: use a
    // truthful inline `// security-ok:` for a site that is not a default.
    knownDebt: [
      { file: 'packages/core/src/services/agentModePolicy.ts', line: /defaultChatPermissionMode: ChatPermissionMode = 'bypassPermissions'/, reason: 'module-level chat default; WS-A flips to a safe mode' },
      { file: 'packages/shared/src/types/Chat.ts', line: /DEFAULT_CHAT_PERMISSION_MODE: ChatPermissionMode = 'bypassPermissions'/, reason: 'shared chat default constant; WS-A' },
      { file: 'apps/server/src/composition-root.ts', line: /defaultPermissionMode: config\.harness\?\.claudeAgent\?\.permissionMode \?\? 'bypassPermissions'/, reason: 'provider default when config is silent; WS-A' },
      { file: 'packages/core/src/services/ChatManagementService.ts', line: /permissionMode: params\.permissionMode \?\? 'bypassPermissions'/, reason: 'new-chat default; WS-A' },
      { file: 'packages/db/src/repositories/ChatRepository.ts', line: /chat\.permissionMode \?\? 'bypassPermissions'/, reason: 'legacy chat rows with a NULL column read as bypass; WS-A' },
      { file: 'packages/agent-harness-providers/src/providers/claude-agent/ClaudeAgentProvider.ts', line: /(?:defaultPermissionMode|config\.permissionMode) \?\? 'bypassPermissions'/, reason: 'provider-level fallback when neither turn nor options set a mode; WS-A' },
      { file: 'packages/agent-harness-providers/src/providers/codex/CodexProvider.ts', line: /approvalPolicy: opts\.approvalPolicy \?\? 'never'/, reason: 'Codex approval policy default; WS-A' },
    ],
  },
  {
    id: 'no-secret-fields-in-config-schemas',
    description:
      'Config schemas must hold secret *references*, never secret values.',
    remedy: 'Store a `SecretRef` and resolve it through SecretStore at use time.',
    globs: ['apps/cli/src/config/**/*.ts', 'apps/desktop/src/main/config.ts'],
    pattern: /\b(?:privateKey|resumeSecret|refreshToken|clientSecret)\s*:\s*z\.string\(\)/,
  },
  {
    id: 'no-parent-env-clone-into-harness',
    description:
      'A harness, terminal or script sandbox runs model-authored shell commands, ' +
      'so it must never inherit this process environment — which holds the vault ' +
      'key, the desktop admin token, source-control tokens and database credentials.',
    remedy:
      'Build the child environment with `buildChildEnv()` ' +
      '(packages/shared/src/config/childEnv.ts), which allowlists. Providers ' +
      'use the `buildHarnessEnv()` wrapper.',
    // Originally scoped to the providers package only, which meant every
    // actually-offending site was outside its blast radius by construction:
    // the terminal hosts, the pty host and the script sandbox all cloned
    // `process.env` and the rule could never have fired on any of them.
    globs: [
      'packages/agent-harness-providers/src/**/*.ts',
      'packages/core/src/infrastructure/terminal/**/*.ts',
      'packages/core/src/infrastructure/SandboxedScriptRunner.ts',
      'apps/pty-host/src/**/*.ts',
    ],
    // `{ ...process.env }` / `env: { ...process.env, … }` — the exact clone.
    pattern: /\{\s*\.\.\.process\.env\b/,
  },
];

const WAIVER = /\/\/\s*security-ok:/;

let failures = 0;
/** Lines silenced by a rule's knownDebt ledger this run. */
let debtTolerated = 0;
/** Ledger entries whose line no longer exists — the debt was paid; remove the entry. */
const staleDebt = [];

for (const rule of RULES) {
  const allow = new Set([...(rule.allow ?? []), ...GLOBAL_ALLOWLIST]);
  /** @type {string[]} */
  const offenders = [];

  for (const glob of rule.globs) {
    let matched;
    try {
      matched = globFiles(glob, repoRoot);
    } catch {
      continue;
    }
    for (const rel of matched) {
      const normalized = rel.split('\\').join('/');
      if (normalized.includes('node_modules') || normalized.includes('/dist/')) continue;
      if (allow.has(normalized)) continue;

      const abs = resolve(repoRoot, rel);
      let content;
      try {
        content = readFileSync(abs, 'utf8');
      } catch {
        continue;
      }
      if (!rule.pattern.test(content)) continue;

      // Re-scan line-by-line so a waiver applies precisely, and so the error
      // message points at something a human can act on.
      const lines = content.split(/\r?\n/);
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!rule.pattern.test(line)) continue;
        if (WAIVER.test(line)) continue;
        const debt = (rule.knownDebt ?? []).find((d) => d.file === normalized && d.line.test(line));
        if (debt) {
          debtTolerated += 1;
          debt.hit = true;
          continue;
        }
        offenders.push(`${normalized}:${i + 1}  ${line.trim().slice(0, 110)}`);
      }
    }
  }

  for (const d of rule.knownDebt ?? []) {
    if (!d.hit) staleDebt.push(`[${rule.id}] ${d.file} — ${d.reason}`);
  }

  if (offenders.length > 0) {
    failures += 1;
    console.error(`\n❌ [${rule.id}] ${rule.description}`);
    for (const o of offenders) console.error(`   ${o}`);
    console.error(`   → ${rule.remedy}`);
    console.error('   → If this is genuinely safe, append `// security-ok: <reason>`.');
  }
}

if (failures > 0) {
  console.error(`\n${failures} security invariant(s) violated.\n`);
  process.exit(1);
}

if (debtTolerated > 0) {
  console.warn(
    `⚠  ${debtTolerated} known fail-open default(s) tolerated via the knownDebt ledger ` +
      '(APPLICATION-REVIEW-2026-09 §5.1/§6.7). They are debt, not exceptions.',
  );
}
for (const s of staleDebt) {
  console.warn(`ℹ  stale knownDebt entry — the site no longer matches; remove it: ${s}`);
}

console.log(`✅ All ${RULES.length} security invariants hold.`);
