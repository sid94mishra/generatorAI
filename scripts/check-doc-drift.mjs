#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Doc-drift guard — PART 11.1: "Documentation matches code · Doc-drift check
// for the ten claims in §1.P; failing check blocks merge."
//
// §1.P is a list of ten places where a comment or a doc asserted behaviour
// the code did not have. That is a specific and nasty failure mode in this
// repo: the plan's own words are "both humans and AI agents trust
// documentation and will 'preserve' behaviour that was never written." Two of
// the ten were re-introduced *after* being fixed once, by an author reading
// the stale comment next to the code they were changing.
//
// A generic "docs match code" checker is not buildable. What IS buildable —
// and what this does — is pin each of the ten claims to the specific symbol
// that has to exist for the claim to be true. If the mechanism is deleted or
// renamed, the claim silently becomes false again and this fails.
//
// Each rule is: "this file asserts X; therefore this evidence must exist."
// A rule fails loudly rather than silently passing when its target file has
// moved, because a rule that cannot find its own subject is not a passing
// rule — it is an unenforced one, which is exactly what §1.P is about.
//
// Run: node scripts/check-doc-drift.mjs   (wired into `pnpm lint`)
// ────────────────────────────────────────────────────────────────

import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @typedef {object} DriftRule
 * @property {string} id                 §1.P row this pins.
 * @property {string} claim              The documented claim, abbreviated.
 * @property {string[]} evidence         Files that must ALL contain the pattern.
 * @property {RegExp} pattern            The mechanism that makes the claim true.
 * @property {string} remedy             What to do when this fails.
 */

/** @type {DriftRule[]} */
const RULES = [
  {
    id: '1P-1',
    claim:
      'Terminal coalesces PTY chunks, flushing every ~4 ms or at 32 KB, rather than one send per chunk.',
    // The coalescer lives at the WS boundary, not in TerminalService — the
    // doc says "terminal", so pin the file that actually implements it.
    evidence: ['apps/server/src/terminal-ws.ts'],
    // Both constants, because the documented claim names both numbers; a
    // coalescer with different thresholds is a different claim.
    pattern: /COALESCE_MS\s*=\s*4\b[\s\S]{0,200}COALESCE_BYTES\s*=\s*32\s*\*\s*1024/,
    remedy:
      'Either restore the coalescing write path or correct every comment and doc that promises it.',
  },
  {
    id: '1P-2',
    claim: 'Terminal scrollback is a bounded ring buffer, not a grow-and-slice Buffer.concat.',
    evidence: ['packages/core/src/services/TerminalService.ts'],
    pattern: /scrollbackBytes/,
    remedy:
      'Scrollback must stay byte-bounded. If the bound is removed, remove the "ring buffer" claim too.',
  },
  {
    id: '1P-4',
    claim: 'Per-workspace browser frame rate and quality are configurable, not silently re-clamped.',
    evidence: ['apps/server/src/browser-ws.ts'],
    pattern: /GENERATORAI_BROWSER_STREAM_(QUALITY|FPS)/,
    remedy:
      'The documented env vars must be read where the frame loop runs, or the docs must stop promising them.',
  },
  {
    id: '1P-5',
    claim: 'GENERATORAI_BROWSER_MAX_CONCURRENT is the browser session cap.',
    evidence: ['packages/core/src/services/BrowserService.ts'],
    pattern: /GENERATORAI_BROWSER_MAX_CONCURRENT/,
    remedy:
      'If a second, independent cap is reintroduced, document both or collapse them into one.',
  },
  {
    id: '1P-6',
    claim: 'Computer-use concurrency is read from a documented, bounded setting.',
    evidence: ['packages/core/src/services/ComputerService.ts'],
    // readBoundedInt, not a bare Number(): the bare read produced NaN from a
    // typo, which deadlocked every action while the doc still claimed a cap.
    pattern: /readBoundedInt\(\s*'GENERATORAI_MAX_COMPUTER_ACTIONS'/,
    remedy:
      'Read the cap through readBoundedInt so an invalid value cannot silently disable the bound.',
  },
  {
    id: '1P-8',
    claim: 'Stage concurrency is bounded, and the bound cannot be silently disabled by a typo.',
    evidence: ['packages/core/src/utils/Semaphore.ts'],
    // A non-finite permit count used to be accepted and then never granted.
    pattern: /Number\.isFinite\(permits\)/,
    remedy:
      'Semaphore must reject a non-finite permit count at construction rather than deadlocking at first acquire.',
  },
  {
    id: '1P-10',
    claim: 'Every stream handler acquires and releases a connection slot.',
    evidence: ['apps/server/src/composition/sseConnectionCap.ts'],
    pattern: /release/i,
    remedy:
      'A stream endpoint that never acquires a slot makes the documented invariant false. Acquire in every handler.',
  },
  {
    id: 'W18-depth',
    claim: 'The health endpoint publishes the admission flow keys: running/queued/limit per key (§3.9, P07 WP-7.2).',
    evidence: ['apps/server/src/routes/health.ts'],
    pattern: /admissionController\?\.flowSnapshot\(\)/,
    remedy: 'Re-publish the flow key snapshot on /api/health, or drop the claim from §3.9 and the tracker.',
  },
  {
    id: 'W31-env',
    claim: 'Children that run model-authored commands get an allowlisted environment.',
    evidence: [
      'packages/core/src/infrastructure/terminal/NodePtyHost.ts',
      'packages/core/src/infrastructure/terminal/FallbackChildProcessHost.ts',
      'packages/core/src/infrastructure/SandboxedScriptRunner.ts',
      'apps/pty-host/src/PtyHostServer.ts',
    ],
    pattern: /buildChildEnv\(/,
    remedy:
      'Build the child environment with buildChildEnv(). A denylist cannot satisfy "no capability by negation" (§11.1).',
  },
];

let failures = 0;
let checked = 0;

for (const rule of RULES) {
  for (const rel of rule.evidence) {
    const abs = join(repoRoot, rel);
    if (!existsSync(abs)) {
      // A rule whose subject has moved is unenforced, not satisfied.
      console.error(
        `❌ ${rule.id}: evidence file is missing: ${rel}\n` +
          `   The rule cannot be enforced, so it is treated as failing.\n` +
          `   Update scripts/check-doc-drift.mjs to point at the new location.`,
      );
      failures += 1;
      continue;
    }
    checked += 1;
    const src = readFileSync(abs, 'utf8');
    if (!rule.pattern.test(src)) {
      console.error(
        `❌ ${rule.id} — documented claim is no longer backed by code.\n` +
          `   Claim:    ${rule.claim}\n` +
          `   File:     ${rel}\n` +
          `   Expected: ${rule.pattern}\n` +
          `   Remedy:   ${rule.remedy}`,
      );
      failures += 1;
    }
  }
}


// ────────────────────────────────────────────────────────────────
// Environment-variable drift.
//
// The ten rules above pin behavioural claims. This pins a different kind of
// lie the review found: `.github/docs/operations.md` documented a table of
// environment variables of which ELEVEN OF TWELVE sampled were read by no file
// in the repository — including the four in its own flagship "production
// deployment" example, so an operator following the guide verbatim configured
// nothing at all and got the defaults.
//
// A documented variable must appear in an actual `process.env` read.
// ────────────────────────────────────────────────────────────────

function checkDocumentedEnvVars() {
  const docFiles = ['.github/docs/operations.md'];
  // Names that are genuinely not read by this repo: consumed by a dependency,
  // the container runtime, or an external tool. Each needs a reason.
  const NOT_OURS = new Set([
    'NODE_ENV',
    'PATH',
    'HOME',
    'OTEL_EXPORTER_OTLP_ENDPOINT', // read by the OTel SDK itself
    'OTEL_EXPORTER_OTLP_HEADERS',
    'OTEL_SERVICE_NAME',
    'OTEL_SDK_DISABLED', // read by the OTel SDK itself (@opentelemetry/sdk-node), not our code
    'GITHUB_TOKEN', // read by the gh CLI / provider SDKs
    'GIT_SSH_COMMAND', // read by the `git` binary itself when spawned, not our code
  ]);

  const sources = [];
  const roots = ['apps', 'packages', 'scripts', 'docker'];
  const walk = (dir) => {
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      // `release` is a packaged Electron build artifact (bundles third-party
      // CLI internals under unrelated SCREAMING_SNAKE names) — not source.
      if (
        e.name === 'node_modules' ||
        e.name === 'dist' ||
        e.name === 'dist-bundle' ||
        e.name === 'release'
      ) {
        continue;
      }
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|tsx|mjs|js|cjs)$/.test(e.name)) sources.push(full);
    }
  };
  for (const r of roots) walk(join(repoRoot, r));
  const haystack = sources.map((f) => readFileSync(f, 'utf8')).join(String.fromCharCode(10));

  let missing = 0;
  for (const rel of docFiles) {
    const abs = join(repoRoot, rel);
    if (!existsSync(abs)) continue;
    const doc = readFileSync(abs, 'utf8');
    // Only names WRITTEN like an environment variable count: a backticked
    // token (table row, inline reference — with or without a trailing
    // `=value`, e.g. `` `GENERATORAI_LOG_LEVEL=debug` ``), or a shell/CLI
    // assignment (`NAME=value`, optionally after `-e `) in a fenced example.
    // A bare SCREAMING_SNAKE token that is neither — e.g. a markdown link to
    // a doc file like `INTEGRATED_TERMINAL_PHASE2_PLAN.md` — is not written
    // the way an env var reference is written, and must not count.
    const NAME = "[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+";
    const names = new Set([
      ...[...doc.matchAll(new RegExp('`(' + NAME + ')(?:`|=)', 'g'))].map((m) => m[1]),
      ...[...doc.matchAll(new RegExp('(?:^|[\\s"\'])(' + NAME + ')=', 'gm'))].map((m) => m[1]),
    ]);
    for (const name of [...names].sort()) {
      if (NOT_OURS.has(name)) continue;
      // A variable reaches the code either directly (`process.env.NAME`) or
      // as a string literal handed to a helper — `readBoundedInt('NAME', …)`
      // is used widely here — so a bare literal counts as a read.
      if (
        haystack.includes(`process.env.${name}`) ||
        haystack.includes(`'${name}'`) ||
        haystack.includes(`"${name}"`)
      ) {
        continue;
      }
      console.error(
        `❌ env-var-drift — ${rel} documents \`${name}\`, which no file reads.
` +
          '   Remedy:   use the name the code actually reads, or delete the row. ' +
          'A documented variable that configures nothing is worse than an undocumented one.',
      );
      missing += 1;
    }
  }
  return missing;
}

failures += checkDocumentedEnvVars();

if (failures > 0) {
  console.error(
    `\n${failures} documentation claim(s) no longer match the code.\n` +
      'Either restore the mechanism or correct the documentation — §1.P exists ' +
      'because a stale comment causes the next author to "preserve" behaviour ' +
      'that was never there.',
  );
  process.exit(1);
}

console.log(`✅ All ${RULES.length} §1.P documentation claims still hold (${checked} files checked).`);
