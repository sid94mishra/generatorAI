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

import { readFileSync, globSync } from 'node:fs';
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
    pattern:
      /(?:permissionMode|approvalPolicy|sandboxMode)\s*[:=]\s*['"](?:bypassPermissions|never|full-access)['"]/,
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
      'A harness runs model-authored shell commands, so it must never inherit ' +
      'this process environment — which holds the vault key, the desktop admin ' +
      'token, source-control tokens and database credentials.',
    remedy:
      'Build the child environment with `buildHarnessEnv()` ' +
      '(packages/agent-harness-providers/src/childEnv.ts), which allowlists.',
    globs: ['packages/agent-harness-providers/src/**/*.ts'],
    // `{ ...process.env }` / `env: { ...process.env, … }` — the exact clone.
    pattern: /\{\s*\.\.\.process\.env\b/,
  },
];

const WAIVER = /\/\/\s*security-ok:/;

let failures = 0;

for (const rule of RULES) {
  const allow = new Set([...(rule.allow ?? []), ...GLOBAL_ALLOWLIST]);
  /** @type {string[]} */
  const offenders = [];

  for (const glob of rule.globs) {
    let matched;
    try {
      matched = globSync(glob, { cwd: repoRoot });
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
        offenders.push(`${normalized}:${i + 1}  ${line.trim().slice(0, 110)}`);
      }
    }
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

console.log(`✅ All ${RULES.length} security invariants hold.`);
