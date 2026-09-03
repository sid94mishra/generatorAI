// ────────────────────────────────────────────────────────────────
// The textual widget degradation contract (Phase 8 item 4).
//
// A widget is a piece of extension-supplied UI: a descriptor names a
// JavaScript `component` and an `entry` bundle, and the web client renders
// it in an iframe. A terminal cannot execute that, and never will.
//
// The audit asks for a CONTRACT rather than a best-effort rendering, because
// the failure mode of best-effort is a pane that shows something plausible
// and wrong — a user acting on a widget's stale `state` believing they are
// looking at its UI. The contract is therefore about what a terminal
// PROMISES, and about being explicit at every point where it cannot keep
// that promise:
//
//   1. A widget's `props` and `state` are plain JSON, and they are the
//      widget's real data. A terminal renders them, labelled as data — never
//      as "the widget".
//   2. A terminal never executes `entry`, never fetches `assetsBase`, and
//      never claims to have rendered the component. `renderable: false` is
//      always reported alongside the reason.
//   3. State is still WRITABLE: `PATCH /widgets/:id/state` takes a full
//      snapshot, so a terminal user can drive a widget's state directly even
//      though its controls are not drawn. This is the degraded interaction,
//      and it is real rather than a placeholder.
//   4. A widget whose descriptor is not registered (its extension is
//      disabled, or was uninstalled while an instance survived) has NO
//      render payload at all. That is reported as its own distinct state —
//      not as an empty widget, which would read as "it has no content".
//   5. Anything the contract cannot express is named in `limitations`, so
//      the surface says what it is not showing instead of quietly omitting
//      it.
//
// Pure: no rendering, no fetching. The TUI paints what this returns.
// ────────────────────────────────────────────────────────────────

export interface WidgetRenderPayload {
  instanceId?: string;
  descriptorId?: string;
  extensionId?: string;
  component?: string;
  surface?: string;
  title?: string;
  props?: unknown;
  state?: unknown;
  assetsBase?: string;
  entry?: string;
  status?: string;
}

export interface WidgetInstanceSummary {
  id: string;
  extensionId?: string;
  title?: string;
  surface?: string;
  status?: string;
  state?: Record<string, unknown>;
}

export interface DegradedWidget {
  instanceId: string;
  title: string;
  surface: string;
  status: string;
  extensionId: string;
  /**
   * Always `false` in a terminal — a widget's UI is JavaScript. Kept as a
   * field rather than assumed so the surface prints the reason rather than
   * silently showing data that looks like a rendering.
   */
  renderable: false;
  /** Why not, in one sentence, for the user rather than the log. */
  reason: string;
  /** The widget's own data, or `null` when it has none. */
  props: unknown;
  state: unknown;
  /** True when a descriptor was LOOKED FOR and not found — the extension is gone or disabled. */
  orphaned: boolean;
  /** True when no descriptor was looked up at all, because the call named no scope. */
  unresolved: boolean;
  /** Specific things this rendering is NOT showing. */
  limitations: string[];
  /** True when `PATCH /widgets/:id/state` can still drive it. */
  stateWritable: boolean;
}

/**
 * One widget, as much of it as a terminal can honestly show.
 *
 * `render` is the payload from `GET /api/widgets`'s `render` array, matched
 * to the instance by id; `undefined` when the server produced none, which is
 * what `orphaned` reports.
 */
export function degradeWidget(
  instance: WidgetInstanceSummary,
  render: WidgetRenderPayload | undefined,
  options: { scoped?: boolean } = {},
): DegradedWidget {
  // Open question #33 — "orphaned" is a claim about the WIDGET; not having
  // looked is a fact about the CALL. The render payload only exists on the
  // list route and only within a chat/run/session scope, so a caller that
  // gave none never had the chance to find a descriptor — reporting that as
  // "its extension is gone" would send someone debugging an install that is
  // perfectly fine.
  const looked = options.scoped !== false;
  const orphaned = looked && render === undefined;
  const unresolved = !looked && render === undefined;
  const limitations: string[] = [];

  if (unresolved) {
    limitations.push(
      'Its descriptor was not looked up — pass the chat, run or session this widget belongs to to see what it renders.',
    );
  } else if (orphaned) {
    limitations.push('No descriptor is registered for this instance — its extension may be disabled or uninstalled.');
  } else if (render) {
    if (render.component) {
      limitations.push(`Its interface (${render.component}) is JavaScript and is not executed here.`);
    }
    if (render.entry) limitations.push('Its bundled assets are not fetched.');
  }
  if (!hasContent(render?.props ?? null) && !hasContent(instance.state ?? render?.state ?? null)) {
    limitations.push('This widget carries no props or state to show.');
  }

  return {
    instanceId: instance.id,
    title: render?.title ?? instance.title ?? instance.id,
    surface: render?.surface ?? instance.surface ?? 'unknown',
    status: render?.status ?? instance.status ?? 'unknown',
    extensionId: render?.extensionId ?? instance.extensionId ?? 'unknown',
    renderable: false,
    reason: unresolved
      ? 'This call did not look up a descriptor, so only the instance’s own data is shown.'
      : orphaned
        ? 'Its extension is not providing a descriptor, so there is nothing to render even in a browser.'
        : 'A widget’s interface is JavaScript; this terminal shows its data instead.',
    props: render?.props ?? null,
    // The instance's own `state` wins over the render payload's copy: the
    // payload is built when the list is assembled, and a widget that has
    // posted a state update since then is newer on the instance.
    state: instance.state ?? render?.state ?? null,
    orphaned,
    unresolved,
    limitations,
    // An orphaned instance has no descriptor to validate a state write
    // against, so offering the edit would be offering a write that cannot be
    // meaningfully consumed. An UNRESOLVED one may well be fine — nothing
    // looked — so the write stays on offer.
    stateWritable: !orphaned,
  };
}

/** Pairs a widget list with its render payloads — the shape `GET /api/widgets` returns. */
export function degradeWidgets(
  instances: WidgetInstanceSummary[],
  render: WidgetRenderPayload[],
): DegradedWidget[] {
  const byInstance = new Map(
    render.filter((p) => typeof p.instanceId === 'string').map((p) => [p.instanceId!, p]),
  );
  return instances.map((instance) => degradeWidget(instance, byInstance.get(instance.id)));
}

function hasContent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === 'object') return Object.keys(value as object).length > 0;
  return true;
}
