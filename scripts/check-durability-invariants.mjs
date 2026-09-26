#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// CI guard: the W22 interrupt hazards, enforced.
//
// `DurableExecutionEngine.ts` has carried LINT-HAZ-1..4 in its header since
// the day it was written, phrased as "lint rules". They were prose. There was
// no rule anywhere in `eslint.config.mjs`, no script, and nothing in CI — so
// the very first hazard they describe (LINT-HAZ-1, "always use `withEffect()`
// so the sandwich is enforced") went unenforced long enough for `withEffect`
// itself to ship with zero production callers.
//
// Written in the same shape as `check-security-invariants.mjs` and
// `check-no-app-wide-cdp.mjs`: each rule matches the DANGEROUS CONSTRUCT, not
// prose about it, and can be waived on a single line with a trailing
// `// durability-ok: <reason>` comment so an exception is explicit and
// reviewable rather than a silently loosened rule.
//
// Run: node scripts/check-durability-invariants.mjs
// ────────────────────────────────────────────────────────────────

import { readFileSync } from 'node:fs';
import { globFiles } from './lib/globFiles.mjs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Files whose whole purpose is to implement or describe what a rule bans. */
const GLOBAL_ALLOWLIST = [
  'scripts/check-durability-invariants.mjs',
  'packages/core/src/services/DurableExecutionEngine.ts',
];

/**
 * @typedef {{
 *   id: string,
 *   description: string,
 *   remedy: string,
 *   globs: string[],
 *   pattern: RegExp,
 *   allow?: string[],
 *   multiline?: boolean,
 *   expectPresent?: boolean,
 * }} Rule
 */

/**
 * The turn-dispatch calls the engine's turn journal has to wrap. Matching the
 * CALL is the point: a new prompt site added to the executor outside its
 * journalled `turn()` is a turn that re-runs in full after every restart, and
 * that is invisible in review because the code looks like the one before it.
 */
const PROMPT_DISPATCH = /\bharness\.sendPrompt(?:AndWait)?\s*\(/;

/** @type {Rule[]} */
const RULES = [
  {
    id: 'HAZ-1-unjournalled-turn-dispatch',
    description:
      'Every agent turn the engine dispatches must go through the turn journal ' +
      '(an intent before, the settlement with its message after), or it re-runs ' +
      'in full after a restart — re-spending the tokens and re-performing every ' +
      'tool call it already made.',
    remedy:
      'Dispatch inside `StageExecutor.turn()`, which writes `stores.turns.intent` ' +
      'before the call and `stores.turns.settle` after it. If the turn genuinely ' +
      'must not be journalled, say why on the line.',
    globs: ['packages/core/src/services/engine/*.ts'],
    pattern: PROMPT_DISPATCH,
  },
  {
    id: 'HAZ-2-blind-register-write-after-read',
    description:
      'A register read followed by an unconditional `set()` of the same key ' +
      'loses a concurrent writer’s value — the `version` column exists to make ' +
      'that a detectable conflict rather than a silent overwrite.',
    remedy: 'Use `registerRepo.cas(scope, scopeId, key, expectedVersion, value)`.',
    globs: ['packages/core/src/services/**/*.ts'],
    // `registerRepo.get(...)` and `registerRepo.set(...)` of the same key on
    // one line — the compressed form of the read-modify-write.
    pattern: /registerRepo\.get\([^)]*\)[^;\n]*registerRepo\.set\(/,
  },
  {
    id: 'HAZ-3-retry-loop-around-a-gate',
    description:
      'W22 bans `while (invalid) { await gate() }` inside a stage. On resume ' +
      'the loop restarts from its own top, so the gate is re-asked and every ' +
      'pre-gate side effect runs again, once per interrupt — the exponential ' +
      'replay X-23 is about.',
    remedy:
      'Drive the retry from durable state (the operation-id epoch), not from a ' +
      'loop counter that only exists in the frame the interrupt destroys.',
    // Scoped to the files that actually own a gate. A repo-wide sweep with a
    // window this wide would be noise, and a noisy guard gets waived by habit
    // rather than by thought.
    globs: [
      'packages/core/src/services/engine/StageExecutor.ts',
      'packages/core/src/services/HitlService.ts',
      'packages/core/src/services/WorkflowRunService.ts',
      'packages/core/src/services/AutomationService.ts',
    ],
    // `while (…) { … await ….interrupt( / awaitSignal( / awaitAwakeable( … }`,
    // with a bounded window so intervening nested blocks do not hide the gate
    // the way a `[^}]*` body match does.
    pattern:
      /while\s*\([^)]*\)\s*\{[\s\S]{0,4000}?await[^;]*\.(?:interrupt|awaitSignal|awaitAwakeable)\(/,
    multiline: true,
  },
  {
    id: 'HAZ-4-unbounded-gate-wait',
    description:
      'A signal or awakeable awaited with no timeout parks a promise, a timer ' +
      'and its whole frame forever. Node clamps a delay above 2^31-1 ms to ~1 ms ' +
      'rather than throwing, so "no timeout" and "a 30-day timeout" fail in ' +
      'opposite, equally silent ways.',
    remedy:
      'Pass an explicit `timeoutMs`. `armTimer` in DurableExecutionEngine ' +
      'chains timers, so a longer-than-24h gate is expressible.',
    globs: ['packages/core/src/services/**/*.ts', 'apps/server/src/**/*.ts'],
    // The gate constructors, called with their `timeoutMs` argument OMITTED:
    // `awaitSignal(ctx, name)` — 2 args; `createAwakeable(ctx)` and
    // `recoverAwakeables(ctx)` — 1 arg. Each then silently takes the 24 h
    // default, which is a policy decision the call site should have to state.
    pattern:
      /\.(?:awaitSignal\(\s*[^,()]+,\s*[^,()]+\)|(?:createAwakeable|recoverAwakeables)\(\s*[^,()]+\))/,
  },
  {
    id: 'no-unreclaimed-durable-scope',
    description:
      '§3.4 requires "retention that fires". The stage turn journal ' +
      '(`registers`, scope `stage_run`) must keep a production release — with ' +
      'none, `registers` grows by a row per turn per stage for the lifetime of ' +
      'the deployment, which is the state this guard was added in.',
    remedy:
      'Release the journal at the terminal transition of its scope (see ' +
      '`DefaultRunLifecycle.finalize`, `stores.turns.release`).',
    globs: ['packages/core/src/services/**/*.ts'],
    // Inverted rule — see the `expectPresent` handling below.
    pattern: /releaseJournal\(|releaseScope\(|turns\.release\(/,
    expectPresent: true,
  },
];

const WAIVER = /\/\/\s*durability-ok:/;

/**
 * Blank out string literals and comments, preserving length and newlines, so
 * the paren matching below cannot be thrown off by a brace inside a string or
 * by a commented-out call.
 */
function maskLiteralsAndComments(src) {
  const out = src.split('');
  const blank = (from, to) => {
    for (let k = from; k < to && k < out.length; k += 1) {
      if (out[k] !== '\n') out[k] = ' ';
    }
  };
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    const next = src[i + 1];
    if (c === '/' && next === '/') {
      let j = i + 2;
      while (j < src.length && src[j] !== '\n') j += 1;
      blank(i, j);
      i = j;
    } else if (c === '/' && next === '*') {
      let j = i + 2;
      while (j < src.length && !(src[j] === '*' && src[j + 1] === '/')) j += 1;
      blank(i, Math.min(j + 2, src.length));
      i = j + 2;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) break;
        j += 1;
      }
      blank(i + 1, j);
      i = j + 1;
    } else {
      i += 1;
    }
  }
  return out.join('');
}

/**
 * Character ranges of the body of every journalled `turn( … )` method, by
 * balanced-bracket matching over the masked source. A dispatch inside one of
 * these is journalled by construction; a dispatch outside them all is not,
 * however close to one it happens to sit.
 *
 * △ An earlier version of this guard looked back a fixed number of lines for
 * the journalling call. Mutation testing FAILED it: an unwrapped dispatch
 * inserted just after a wrapped one was accepted. A guard that cannot fail is
 * the same thing as no guard, which is the exact failure this whole file
 * exists to stop repeating.
 */
function journalledTurnRanges(masked) {
  // The body of every `turn(` method that writes a journal intent: a dispatch
  // inside it is journalled. A `turn(` without the intent protects nothing.
  const ranges = [];
  const marker = /\bprivate\s+async\s+turn\s*\(/g;
  let m;
  while ((m = marker.exec(masked)) !== null) {
    let j = m.index + m[0].length - 1;
    let depth = 0;
    for (; j < masked.length; j += 1) {
      if (masked[j] === '(') depth += 1;
      else if (masked[j] === ')' && --depth === 0) break;
    }
    const open = masked.indexOf('{', j);
    if (open < 0) break;
    let k = open;
    depth = 0;
    for (; k < masked.length; k += 1) {
      if (masked[k] === '{') depth += 1;
      else if (masked[k] === '}' && --depth === 0) break;
    }
    if (/stores\.turns\.intent\s*\(/.test(masked.slice(open, k))) ranges.push([open, k]);
    marker.lastIndex = k;
  }
  return ranges;
}

/** Byte offset of the first character of each 0-based line. */
function lineOffsets(src) {
  const offsets = [0];
  for (let i = 0; i < src.length; i += 1) {
    if (src[i] === '\n') offsets.push(i + 1);
  }
  return offsets;
}

let failures = 0;

for (const rule of RULES) {
  const allow = new Set([...(rule.allow ?? []), ...GLOBAL_ALLOWLIST]);
  /** @type {string[]} */
  const offenders = [];
  let sawMatch = false;

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
      sawMatch = true;
      if (rule.expectPresent) break;

      const lines = content.split(/\r?\n/);

      // A rule whose pattern spans lines can never match a single line, so the
      // per-line scan below would silently report nothing — a rule that is
      // "green" because it is unable to speak. Match over the whole file
      // instead and attribute the finding to the line the match ENDS on, which
      // is the gate call itself and therefore the line a reader can act on.
      if (rule.multiline) {
        const offs = lineOffsets(content);
        const global = new RegExp(rule.pattern.source, `${rule.pattern.flags.replace('g', '')}g`);
        for (const m of content.matchAll(global)) {
          const end = (m.index ?? 0) + m[0].length;
          let lineNo = offs.findIndex((o) => o > end) - 1;
          if (lineNo < 0) lineNo = offs.length - 1;
          const line = lines[lineNo] ?? '';
          if (WAIVER.test(line)) continue;
          offenders.push(`${normalized}:${lineNo + 1}  ${line.trim().slice(0, 110)}`);
        }
        continue;
      }

      /** Lazily computed, and only for the one rule that needs them. */
      let ranges;
      let offsets;
      for (let i = 0; i < lines.length; i += 1) {
        const line = lines[i];
        if (!rule.pattern.test(line)) continue;
        if (WAIVER.test(line)) continue;

        if (rule.id === 'HAZ-1-unjournalled-turn-dispatch') {
          // A dispatch is journalled exactly when it lies inside the body of
          // the executor's `turn()` — a fact about the code, not a guess about
          // how far back to look.
          ranges ??= journalledTurnRanges(maskLiteralsAndComments(content));
          offsets ??= lineOffsets(content);
          const at = offsets[i] ?? 0;
          if (ranges.some(([from, to]) => at > from && at < to)) continue;
          // Anything else outside `turn()` must carry an explicit
          // `// durability-ok:` waiver at the call site. There is deliberately
          // no name-based exemption list — one uniform, visible mechanism,
          // because an exemption that lives in the guard is an exemption
          // nobody reviewing the call site will ever see.
        }

        offenders.push(`${normalized}:${i + 1}  ${line.trim().slice(0, 110)}`);
      }
    }
  }

  if (rule.expectPresent) {
    if (!sawMatch) {
      failures += 1;
      console.error(`\n❌ [${rule.id}] ${rule.description}`);
      console.error(`   No occurrence found under: ${rule.globs.join(', ')}`);
      console.error(`   → ${rule.remedy}`);
    }
    continue;
  }

  if (offenders.length > 0) {
    failures += 1;
    console.error(`\n❌ [${rule.id}] ${rule.description}`);
    for (const o of offenders) console.error(`   ${o}`);
    console.error(`   → ${rule.remedy}`);
    console.error('   → If this is genuinely safe, append `// durability-ok: <reason>`.');
  }
}

if (failures > 0) {
  console.error(`\n${failures} durability invariant(s) violated.\n`);
  process.exit(1);
}

console.log(`✅ All ${RULES.length} durability invariants hold.`);
