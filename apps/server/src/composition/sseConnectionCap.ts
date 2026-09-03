// ────────────────────────────────────────────────────────────────
// sseConnectionCap — SEC-04
//
// Track open SSE connections per (scope, id) and reject new ones past a
// configurable cap. Without this, a single session id could open unlimited
// EventSources and exhaust the server's file-descriptor budget (or blow
// past the browser's 6-per-origin ceiling, making the whole tab unresponsive).
//
// Routes use this in three steps:
//
//   const slot = acquireSseSlot(scope, id);
//   if (!slot.ok) {
//     res.status(503).setHeader('Retry-After', '30').json({ ... });
//     return;
//   }
//   res.on('close', slot.release);
//   // ... proceed with SSE setup
//
// Release MUST be idempotent (we call it once per `res.close`; Node may
// fire close twice for some transports).
// ────────────────────────────────────────────────────────────────

export type SseScope = 'session' | 'run' | 'chat' | 'global' | 'automation' | 'computer' | 'workspace';

/**
 * Default per-(scope,id) cap. 6 matches the browser per-origin connection
 * limit — if a single tab is over this, something is almost certainly looping.
 * Override per-scope via `setSseConnectionCap(scope, n)` or at env-boot time
 * via `GENERATORAI_SSE_CAP_PER_SCOPE` (applied to every scope uniformly).
 */
const DEFAULT_CAP = 6;

const DEFAULT_CAPS_BY_SCOPE: Record<SseScope, number> = {
  session: DEFAULT_CAP,
  run: DEFAULT_CAP,
  chat: DEFAULT_CAP,
  automation: DEFAULT_CAP,
  // Computer preview. Same as the rest: `ComputerPanel` constructs a raw
  // `EventSource`, and per the HTML spec a non-2xx response closes one
  // PERMANENTLY — the browser will not retry. A tight cap therefore turns a
  // StrictMode double-mount, an HMR re-run or a reload race into a dead panel
  // rather than a transient error. The 250 ms poll's own back-off is what
  // bounds the cost here.
  computer: DEFAULT_CAP,
  workspace: DEFAULT_CAP,
  // Global fan-out: intentionally higher — every connected tab shares one.
  global: 32,
};

function readEnvCap(): number | undefined {
  const raw = process.env['GENERATORAI_SSE_CAP_PER_SCOPE'];
  if (!raw) return undefined;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

const configuredCaps: Record<SseScope, number> = (() => {
  const defaults = { ...DEFAULT_CAPS_BY_SCOPE };
  const envCap = readEnvCap();
  if (envCap === undefined) return defaults;

  // Derived from the defaults rather than hand-enumerated. The previous form
  // listed each scope literally, so adding one silently dropped it from the
  // env path — and it also clamped `global` DOWN from 32 (P3-d), meaning an
  // operator raising the per-scope cap could break global fan-out.
  //
  // `global` is excluded rather than max'd: it is a fan-out scope every tab
  // shares, provisioned deliberately, and the env var is documented as a
  // per-scope cap. Every other scope takes the value verbatim, so an operator
  // can lower it as well as raise it.
  for (const scope of Object.keys(defaults) as SseScope[]) {
    if (scope === 'global') continue;
    defaults[scope] = envCap;
  }
  return defaults;
})();

const openCounts = new Map<string, number>();

function keyFor(scope: SseScope, id: string): string {
  return `${scope}:${id}`;
}

/** Override the cap for a specific scope at runtime (tests / fine-tuning). */
export function setSseConnectionCap(scope: SseScope, cap: number): void {
  if (cap <= 0) throw new Error(`Invalid SSE cap ${cap} for scope ${scope}`);
  configuredCaps[scope] = cap;
}

/**
 * Try to reserve a connection slot. Callers MUST invoke `release` (typically
 * via `res.on('close', slot.release)`) whether or not the connection closes
 * cleanly — otherwise the count drifts and eventually rejects legitimate
 * connections.
 */
export function acquireSseSlot(
  scope: SseScope,
  id: string,
): { ok: true; release: () => void } | { ok: false; cap: number; current: number } {
  const cap = configuredCaps[scope];
  const key = keyFor(scope, id);
  const current = openCounts.get(key) ?? 0;
  if (current >= cap) {
    return { ok: false, cap, current };
  }
  openCounts.set(key, current + 1);
  let released = false;
  return {
    ok: true,
    release: () => {
      if (released) return;
      released = true;
      const next = (openCounts.get(key) ?? 1) - 1;
      if (next <= 0) openCounts.delete(key);
      else openCounts.set(key, next);
    },
  };
}

/** Test-only snapshot of current counts. */
export function _getSseCountsForTests(): Record<string, number> {
  return Object.fromEntries(openCounts);
}
