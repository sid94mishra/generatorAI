// ────────────────────────────────────────────────────────────────
// The textual widget degradation contract (Phase 8 item 4).
//
// The behaviour worth pinning is the honesty, not the formatting: a terminal
// must never imply it rendered a widget, must say what it is leaving out,
// and must distinguish "this widget has no data" from "this widget has no
// descriptor" — those look identical on screen and mean opposite things.
// ────────────────────────────────────────────────────────────────

import { describe, expect, it } from 'vitest';
import { degradeWidget, degradeWidgets } from '../widgetDegradation.js';

const instance = {
  id: 'w1',
  extensionId: 'acme.charts',
  title: 'Latency',
  surface: 'chat',
  status: 'active',
  state: { range: '24h' },
};

const render = {
  instanceId: 'w1',
  descriptorId: 'acme.charts:latency',
  extensionId: 'acme.charts',
  component: 'LatencyChart',
  surface: 'chat',
  title: 'Latency',
  props: { unit: 'ms' },
  state: { range: '1h' },
  assetsBase: 'https://example.test/assets',
  entry: 'index.js',
  status: 'active',
};

describe('degradeWidget', () => {
  it('never claims to have rendered the widget', () => {
    const result = degradeWidget(instance, render);
    expect(result.renderable).toBe(false);
    expect(result.reason).toMatch(/JavaScript/);
  });

  it('shows the widget\'s real props and state', () => {
    const result = degradeWidget(instance, render);
    expect(result.props).toEqual({ unit: 'ms' });
  });

  it("prefers the instance's state over the render payload's older copy", () => {
    // The payload is built when the list is assembled; a widget that posted
    // an update since then is newer on the instance. Showing the stale copy
    // is the exact failure this contract exists to prevent.
    expect(degradeWidget(instance, render).state).toEqual({ range: '24h' });
  });

  it('names what it is not showing rather than omitting it quietly', () => {
    const result = degradeWidget(instance, render);
    expect(result.limitations.join(' ')).toContain('LatencyChart');
    expect(result.limitations.join(' ')).toContain('assets');
  });

  it('reports an orphaned instance as its own state, not as an empty widget', () => {
    // No descriptor means the extension is disabled or gone — which is a
    // different problem from a widget that simply has no content, and
    // rendering both as "nothing here" hides a broken install.
    const result = degradeWidget(instance, undefined);
    expect(result.orphaned).toBe(true);
    expect(result.limitations[0]).toMatch(/No descriptor/);
    expect(result.reason).toMatch(/not providing a descriptor/);
  });

  it('refuses to offer a state write for an orphaned instance', () => {
    // There is no descriptor to consume the write meaningfully.
    expect(degradeWidget(instance, undefined).stateWritable).toBe(false);
    expect(degradeWidget(instance, render).stateWritable).toBe(true);
  });

  it('says so when there is genuinely no data to show', () => {
    const empty = degradeWidget(
      { id: 'w2' },
      { instanceId: 'w2', component: 'Empty', props: {}, state: {} },
    );
    expect(empty.limitations.join(' ')).toContain('no props or state');
  });

  it('falls back through render → instance → id for every label', () => {
    const bare = degradeWidget({ id: 'w3' }, undefined);
    expect(bare.title).toBe('w3');
    expect(bare.surface).toBe('unknown');
    expect(bare.status).toBe('unknown');
    expect(bare.extensionId).toBe('unknown');
  });
});

describe('degradeWidgets', () => {
  it('matches payloads to instances by id, leaving unmatched ones orphaned', () => {
    const results = degradeWidgets(
      [instance, { id: 'w9', title: 'Ghost' }],
      [render, { instanceId: 'nobody', component: 'X' }],
    );
    expect(results).toHaveLength(2);
    expect(results[0]?.orphaned).toBe(false);
    expect(results[1]?.orphaned).toBe(true);
    expect(results[1]?.title).toBe('Ghost');
  });

  it('ignores a payload with no instanceId rather than mis-matching it', () => {
    const results = degradeWidgets([instance], [{ component: 'X' }]);
    expect(results[0]?.orphaned).toBe(true);
  });
});

// ── "Orphaned" vs "not looked up" (open question #33) ──────────────
//
// "Orphaned" is a claim about the WIDGET; not having looked is a fact about
// the CALL. Reporting the second as the first sends someone off debugging an
// extension install that is perfectly fine.

describe('degradeWidget — scope awareness', () => {
  it('reports a widget as orphaned only when a descriptor was actually looked for', () => {
    const looked = degradeWidget(instance, undefined, { scoped: true });
    expect(looked.orphaned).toBe(true);
    expect(looked.unresolved).toBe(false);
    expect(looked.reason).toMatch(/not providing a descriptor/);
  });

  it('says the descriptor was never looked up when the call named no scope', () => {
    const unscoped = degradeWidget(instance, undefined, { scoped: false });
    expect(unscoped.orphaned).toBe(false);
    expect(unscoped.unresolved).toBe(true);
    expect(unscoped.reason).toMatch(/did not look up/);
    expect(unscoped.limitations.join(' ')).toMatch(/pass the chat, run or session/);
  });

  it('keeps the state write on offer when nothing looked', () => {
    // An unresolved widget may be perfectly healthy; refusing the write
    // would punish the caller for omitting a flag.
    expect(degradeWidget(instance, undefined, { scoped: false }).stateWritable).toBe(true);
    expect(degradeWidget(instance, undefined, { scoped: true }).stateWritable).toBe(false);
  });

  it('defaults to having looked, so the list path is unchanged', () => {
    // `degradeWidgets` always has the payloads, so its callers must not have
    // to opt in to the old behaviour.
    expect(degradeWidget(instance, undefined).orphaned).toBe(true);
    expect(degradeWidgets([instance], []).at(0)?.orphaned).toBe(true);
  });
});
