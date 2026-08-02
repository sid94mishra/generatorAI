# Extension Author Skill

Use this skill whenever the user asks you to build, author, scaffold, or
extend a **GeneratorAI extension** — almost always to create a new
**widget**: an interactive HTML/JS UI that renders full-page in the
right-pane Widget tab, or inline in the chat stream. Trigger on requests
like "build me a kanban board", "make a widget for X", "turn this into an
app I can click around in", "add a button that lets me Y" — the user
rarely says the word "extension" or "widget" explicitly.

## The mental model, in one paragraph

A widget is a small HTML page you author on the fly. It runs inside a
sandboxed iframe served from its own isolated origin — not the same origin
as the GeneratorAI app itself, so it can never read the host's cookies or
touch the host's DOM. The ONLY way the widget talks to the outside world is
a small `postMessage` protocol: it tells the host what its state is, the
host persists that state to the database, and the host relays state back
to the widget on reload. You (the agent) and the human are both just
"drivers" of that same state — a human clicking a button and you calling
`update_widget` should produce the identical visual result. That symmetry
is the single most important property a widget must have, and almost every
rule below exists to protect it.

## Available tools

You have two dedicated authoring tools:

- `write_extension` — create or overwrite a full extension bundle at
  `~/.generatorai/extensions/<extensionId>@<version>/` (user scope).
- `reload_extension` — reload the extension so its widgets appear in the
  registry without a server restart (rarely needed — `write_extension` with
  the same id already reloads atomically).

Once a widget is registered you drive it with `search_widget`,
`render_widget`, `describe_widget`, `read_widget`, `update_widget`,
`widget_action`, `widget_exec`, `list_widgets`, and `close_widget`.

## Extension shape

An extension is a folder with two required files:

```
<extensionId>@<version>/
├── extension.json    ← manifest (metadata + `entry` path)
├── index.js          ← default export `loadExtension(ai)`
└── ui/               ← widget HTML (+ optional CSS/JS siblings)
    └── <component>.html
```

### 1. `extension.json` — MANIFEST

Keep it thin. Only these fields:

```json
{
  "id": "user.<slug>",
  "name": "<Display Name>",
  "version": "1.0.0",
  "description": "<one-line description>",
  "author": { "name": "GeneratorAI Agent" },
  "license": "MIT",
  "engines": { "generatorai": ">=1.0.0" },
  "entry": "./index.js"
}
```

**Rules**
- `id` MUST be `user.<slug>` where `<slug>` is a lowercase alphanumeric/dash
  token. Never write to `genai.*` or `acme.*` — those namespaces are
  reserved and `write_extension` will reject them.
- `entry` MUST be `./index.js`. Do not use `.ts` — the runtime is plain
  Node ESM and does not transpile.

### 2. `index.js` — REGISTRATION

```js
export default function loadExtension(ai) {
  ai.registerWidget({
    id: '<componentId>',                     // slug — final id becomes "<extId>/<componentId>"
    title: '<Display Title>',
    description: '<what the widget does>',
    entry: 'ui/<componentId>.html',
    preferredSurface: 'widget',              // 'widget' (full page) | 'inline'
    keywords: ['keyword1', 'keyword2'],      // used by search_widget ranking
    // OPTIONAL — declare a typed action catalog for COMPLEX widgets so the
    // agent can drive individual verbs with widget_action / widget_exec
    // instead of overwriting the entire state:
    actions: [
      {
        name: 'moveCard',
        description: 'Move a card to another column',
        argsSchema: {
          type: 'object',
          properties: { id: { type: 'string' }, to: { type: 'string' } },
          required: ['id', 'to'],
        },
        returns: 'the updated card',
      },
    ],
  });

  ai.log.info('<Extension name> loaded.');
}
```

**Rules**
- MUST `export default` a function named `loadExtension` that receives `ai`.
- Only synchronous or awaited registration calls — do not start timers,
  listeners, fetches, or long-running work from the factory itself. Only
  `registerWidget` and `registerTool` actually take effect at runtime today;
  don't reach for `registerHook` / `registerSkill` / `registerPrompt` /
  `registerMcpServer` expecting them to do anything live yet.
- One `ai.registerWidget()` call per widget. Prefer 1-2 widgets per
  extension — if the user's request has several distinct "screens," build
  ONE widget with multiple internal views (see below) rather than several
  separate widgets, unless the pieces are genuinely independent.
- `preferredSurface` defaults to `widget` (full page). Use `inline` only
  for a very small confirm-style control that belongs in the chat stream.
- Declare `actions` ONLY for widgets that expose several distinct verbs a
  human or you would want to trigger individually (move a card, add a row,
  toggle a flag). A simple state-only widget (poll, counter, toggle) omits
  `actions` and is driven entirely with `update_widget`.

### 3. `ui/<component>.html` — WIDGET

Widgets run in a **sandboxed iframe served from a dedicated widget
origin** (a separate loopback port, isolated from the host app).
`allow-same-origin` is scoped to that isolated origin only, so the widget
CAN use `fetch`, `localStorage`, and multi-file bundles — but it can never
touch the host app's cookies or DOM, and the host can never be reached from
inside the iframe except through the message bridge. The CSP is:

```
script-src  'self' 'unsafe-inline' 'unsafe-eval'
style-src   'self' 'unsafe-inline'
connect-src 'self' <the host API origin>     ← same-folder + API only
img-src     data: blob: 'self'
font-src    'self' data:
```

**Rules**
- Same-folder assets work: `<script src="./bundle.js">`,
  `<link href="./styles.css">`, images — all relative to the widget file
  (the runtime injects a `<base>` tag). Ship multi-file bundles this way.
- **No external CDNs** — `<script src="https://cdn...">` is blocked by
  CSP. Vendor any library as a same-folder file instead.
- `fetch` is allowed ONLY to the host API origin (declared in
  `connect-src`). Never hardcode `http://localhost:3100` — the port is
  dynamic in desktop builds. For arbitrary third-party APIs, route the
  data through the agent (`widget:context` / `widget:followup-prompt`)
  rather than calling out from the iframe.
- Communicate with the host via **postMessage**, target `'*'` outbound —
  the host validates the origin on its side, so you don't need to.

### The widget protocol

```
widget → host:
  { type: 'widget:hello' }                      // sent on mount
  { type: 'widget:ready' }                      // after first render
  { type: 'widget:resize', height: <number> }   // auto-size the frame
  { type: 'widget:state', state: <object> }     // full state snapshot (persists)
  { type: 'widget:action', action: '<name>',
    payload?: <object> }                        // semantic user event (logged)
  { type: 'widget:invoke-result', invokeId,
    result?, error? }                           // reply to an agent widget:invoke
  { type: 'widget:teardown-ack', teardownId }   // reply to a teardown request
  { type: 'widget:close' }                       // dismiss self

  // ── Optional widget→agent hooks — real, wired, and worth using ──
  { type: 'widget:followup-prompt', text: '<str>' }  // post a chat prompt (wakes agent)
  { type: 'widget:context', content: '<str>' }        // buffer a model-visible note

host → widget:
  { type: 'widget:init', props, state }         // reply to hello (state = persisted)
  { type: 'widget:state', state }               // agent pushed new state
  { type: 'widget:invoke', invokeId,
    action, args }                              // agent invoked a catalog action
  { type: 'widget:teardown', teardownId }       // commit final state, then ack
```

A `widget:open-canvas` message is sometimes mentioned in older notes — it
has no handler today. Don't rely on it.

### Optional widget→agent hooks

A widget can talk back to the agent in two distinct ways. Both are fully
wired end-to-end (verified live, not aspirational) — use them when a
widget has a button that should genuinely involve the assistant:

- **`widget:followup-prompt` — wake the agent NOW.** Posts a message to
  the chat as if the user typed it, starting an agent turn immediately.
  Use for a button like "Ask the assistant to summarize this."
  ```js
  post('widget:followup-prompt', { text: 'Summarize my selections above.' });
  ```
  Don't hardcode a snapshot of "current" data into that text (e.g. "the
  counter is at 0") unless you're certain it's still true when clicked —
  the agent will trust your wording, so if the value can have changed
  since render, describe the ACTION not a stale number ("please double the
  counter"), or omit the number and let the agent call `read_widget` to
  find out.
- **`widget:context` — tell the agent silently (next turn).** Buffers a
  short, model-visible note that is injected the next time the user sends
  a message. Does NOT wake the agent. Use to keep the agent aware of what
  the user is doing without interrupting them.
  ```js
  post('widget:context', { content: 'User selected 3 items; total = $42.' });
  ```

These are optional — a simple display widget needs neither.

## Designing widgets the agent can control (REQUIRED)

The user can drive the widget with buttons, and the agent can drive it
programmatically via `update_widget(instanceId, state)` or, for complex
widgets, `widget_action`/`widget_exec`. To make both paths work, follow
these rules.

### Rule 1 — State must be declarative and idempotent.

Do NOT use imperative "commands" like `{ cmd: 'start' }`. Those don't
survive a remount: if the iframe reloads (page refresh, tab switch,
replay), the widget receives the LAST persisted state on `widget:init`
and must reconstruct the current visual from it alone.

**Bad** (imperative — breaks on remount):
```js
if (msg.state?.cmd === 'start') startTimer();
if (msg.state?.cmd === 'stop')  stopTimer();
```

**Good** (declarative — mount from state = current visual):
```js
// state shape: { running: boolean, startedAtEpoch: number|null, accumulatedMs: number }
function applyState(s) {
  running       = !!s?.running;
  startedAtEpoch = s?.startedAtEpoch ?? null;
  accumulatedMs  = s?.accumulatedMs ?? 0;
  render();       // recomputes elapsed = accumulatedMs + (running ? now - startedAtEpoch : 0)
}
```

### Rule 2 — Every state change (user OR agent) must post `widget:state`.

When a button is clicked, compute the NEW state object and:

```js
function post(type, extra = {}) {
  window.parent.postMessage({ type, ...extra }, '*');
}
function commit(newState) {
  applyState(newState);
  post('widget:state', { state: newState });  // persist through host
}
```

Now `update_widget(instanceId, { running: true, startedAtEpoch: Date.now(), accumulatedMs: 0 })`
produces the exact same visual as a user tapping "Start". The most common
way this rule gets silently violated: a click handler mutates a local
variable (a counter, an array) and calls `render()` directly WITHOUT
calling `commit()`. It looks perfectly correct in the browser — right up
until the page refreshes and the change is gone, because it was never
persisted. If you find yourself writing `foo++` or `arr.push(...)` inside
a click handler, ask whether that line is followed by a `commit()` of the
full new state.

### Rule 2b — `widget:hello` must be called unconditionally, or nothing ever renders.

The whole protocol starts with the widget announcing itself: `post('widget:hello')`
must run as plain top-level script code, not inside a function you forget to
call, not gated behind a condition. If it never fires, the host never sends
`widget:init` — which means your widget never receives its persisted state,
including any seeded data — no matter how correct your `render()` or
`applyState()` logic is. This is the single easiest bug to miss when writing
a bespoke widget from scratch (as opposed to copying the template below),
because the symptom is a widget that renders literally nothing — not even
an empty-state message — and everything else in the file can be flawless.
If you ever end up debugging a blank widget, check for this line FIRST,
before suspecting render-order or state-shape issues.

### Rule 3 — Handle `widget:init` AND `widget:state` identically.

```js
window.addEventListener('message', (ev) => {
  const m = ev.data;
  if (m?.type === 'widget:init' || m?.type === 'widget:state') {
    applyState(m.state);
  }
});
post('widget:hello');
```

`widget:init` fires on mount (state is the persisted last-known value);
`widget:state` fires when the agent calls `update_widget`. Both paths
converge on `applyState`.

### Rule 4 (COMPLEX widgets only) — handle `widget:invoke`, and fail LOUDLY.

If you declared an `actions` catalog, the agent drives individual verbs
via `widget_action` / `widget_exec`, which arrive as `widget:invoke`
messages. Run the named action, `commit()` the new declarative state, and
ALWAYS reply with `widget:invoke-result` carrying the same `invokeId`:

```js
const ACTIONS = {
  moveCard({ id, to }) {
    const card = state.cards.find((c) => c.id === id);
    if (!card) throw new Error(`no card with id "${id}"`);   // ← don't skip this check
    const cards = state.cards.map((c) => (c.id === id ? { ...c, col: to } : c));
    commit({ cards });                 // persists + re-renders (rule 2)
    return { id, to };                 // becomes the tool result the agent sees
  },
  // ...one function per declared action
};

window.addEventListener('message', (ev) => {
  const m = ev.data;
  if (m?.type === 'widget:invoke') {
    try {
      const fn = ACTIONS[m.action];
      if (!fn) throw new Error('unknown action: ' + m.action);
      const result = fn(m.args || {});
      post('widget:invoke-result', { invokeId: m.invokeId, result });
    } catch (err) {
      post('widget:invoke-result', { invokeId: m.invokeId, error: String(err && err.message || err) });
    }
  }
});
```

The `if (!card) throw ...` line matters more than it looks: the single
most common bug found when testing agent-authored action catalogs is an
action that silently does nothing when its target doesn't exist (a
`moveCard` called with an id that isn't on the board, a `deleteRow` called
twice) and STILL replies with `{ result: { ok: true } }`. That's worse
than doing nothing — it tells the agent the operation succeeded, so it
will confidently report a false result to the user. Every action must
check that its target actually exists / the operation actually applies,
and reply with `error` (not a fabricated success) when it doesn't.

### Rule 5 (recommended) — handle `widget:teardown`.

Before a widget is closed the host sends `widget:teardown` so the widget
can commit its final state. Reply with `widget:teardown-ack` (same
`teardownId`) so the close finalizes with fresh state instead of waiting
for a timeout:

```js
window.addEventListener('message', (ev) => {
  const m = ev.data;
  if (m?.type === 'widget:teardown') {
    post('widget:state', { state });                     // persist final snapshot
    post('widget:teardown-ack', { teardownId: m.teardownId });
  }
});
```

If you followed rule 2 (every change commits), state is already persisted
and this is just a fast confirmation — but always ack so close doesn't stall.

## Quality bar

A widget renders full-page in the app's own right pane, next to real,
polished product UI — a cramped or unstyled widget reads as broken, not
"in progress." Aim for this bar on every widget, not just when asked:

- **Layout that doesn't overflow.** Use flexbox/grid with `gap`, not fixed
  pixel widths that clip on a narrow pane. Long text wraps or truncates
  instead of pushing the layout sideways.
- **Both color schemes.** `color-scheme: light dark` plus a
  `@media (prefers-color-scheme: dark)` override for your custom colors —
  the widget is viewed inside a host app the user may have in either
  theme, and an all-white card in a dark app looks like an error state.
- **Real empty/loading/error states**, not just the happy path — an empty
  list should say so, not render a blank box.
- **Legible, deliberate typography and spacing** — a system font stack,
  a consistent scale for headings vs. body text, consistent padding
  between elements rather than ad hoc margins.
- **Obviously interactive controls** — buttons look like buttons (hover
  state, cursor: pointer), disabled states look disabled, and destructive
  actions (delete, reset) are visually distinct from routine ones.
- **Auto-resize** — call `post('widget:resize', { height: document.body.scrollHeight })`
  after render so the frame doesn't scroll internally when it doesn't need to.

None of this requires a component framework — it's plain CSS discipline
inside a single `<style>` block. Spend the extra effort; it's cheap and
it's the difference between a widget that feels shipped and one that
feels like a sketch.

## Multi-view widgets — "navigating" inside a widget

Widgets **cannot navigate the host application** — there is no API for a
widget to open a different page, chat, or workflow in GeneratorAI itself,
and you should not imply otherwise to the user. What you CAN build is a
single widget that behaves like its own small app with multiple screens —
a list view that opens into a detail view, a settings panel with tabs, a
short multi-step wizard. This covers the overwhelming majority of "I want
to click around in this" requests.

The pattern is exactly Rule 1 applied to navigation: keep a `view` (or
`page`, `tab` — name it for the domain) field in the declarative state,
and render conditionally on it. "Navigating" is then just another state
change that goes through the same `commit()` path as everything else —
which means the agent can navigate the widget too, by calling
`update_widget(instanceId, { view: 'detail', selectedId: 'c3' })`, and it
survives a page refresh like any other state.

```js
// state shape: { view: 'list' | 'detail', items: [...], selectedId: string|null }
function render() {
  document.getElementById('list-view').hidden = state.view !== 'list';
  document.getElementById('detail-view').hidden = state.view !== 'detail';
  if (state.view === 'detail') renderDetail(state.items.find(i => i.id === state.selectedId));
  else renderList(state.items);
}
function openDetail(id) { commit({ view: 'detail', selectedId: id }); }
function backToList()   { commit({ view: 'list', selectedId: null }); }
```

If the different views are complex enough to want individually-invokable
actions (`openItem`, `goBack`, `saveEdit`), declare them in the action
catalog exactly like any other complex-widget action (Rule 4) — a "screen
change" is not conceptually different from any other state transition.

## Minimum viable HTML template — copy this and swap the body:

```html
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="light dark" />
    <title><Title></title>
    <style>
      * { box-sizing: border-box; }
      body { margin: 0; padding: 14px; font-family: system-ui, sans-serif;
             color: inherit; background: transparent; overflow-x: hidden; }
      .card { border: 1px solid #d0d7de; border-radius: 10px;
              background: #f6f8fa; padding: 14px; }
      button { border: 1px solid #d0d7de; background: #fff;
               border-radius: 6px; padding: 6px 12px; cursor: pointer; }
      button:hover { background: #f0f2f5; }
      @media (prefers-color-scheme: dark) {
        .card { background: #161b22; border-color: #30363d; }
        button { background: #0d1117; border-color: #30363d; color: #e6edf3; }
        button:hover { background: #161b22; }
      }
    </style>
  </head>
  <body>
    <div class="card">
      <!-- YOUR UI GOES HERE -->
    </div>
    <script>
      const post = (t, extra = {}) =>
        window.parent.postMessage({ type: t, ...extra }, '*');

      // ── Single source of truth: the persisted state object ──
      let state = { /* declarative fields only, no `cmd` */ };

      function applyState(s) {
        state = { ...state, ...(s ?? {}) };
        render();
      }
      function commit(next) {
        // Called by user actions. Persists AND re-renders.
        state = { ...state, ...next };
        post('widget:state', { state });
        render();
      }
      function render() {
        // Read `state`, mutate the DOM to reflect it. Idempotent.
        post('widget:resize', { height: document.body.scrollHeight });
      }

      window.addEventListener('message', (ev) => {
        const m = ev.data;
        if (m?.type === 'widget:init' || m?.type === 'widget:state') {
          applyState(m.state);
        } else if (m?.type === 'widget:teardown') {
          post('widget:state', { state });
          post('widget:teardown-ack', { teardownId: m.teardownId });
        }
      });
      post('widget:hello');
      requestAnimationFrame(() => post('widget:ready'));
    </script>
  </body>
</html>
```

## The authoring workflow

1. **Clarify** the user's intent in ONE short question if the request is
   ambiguous (what data? what interactions? what should it look like?).
   Skip this if the request is clear.
2. **Pick** the extension id: `user.<slug>` from the widget's purpose.
3. **Call `write_extension`** with the full file tree (manifest + index.js +
   HTML). Pass files as an array of `{ path, content }` with paths relative
   to the extension root. The response includes:
     - `ok: true`
     - `registeredWidgets: [{ id: '<extId>/<componentId>', ... }]` — the
       fully-qualified widget ids the runtime just registered. **Take the
       `id` field of the first entry.**
4. **Verify before you call it done.** Re-read what you just wrote against
   Rules 1-4 above: does every click handler end in a `commit()`? Does
   every declared action check that its target actually exists before
   reporting success? This costs a few seconds and catches the two bugs
   that are otherwise invisible until someone refreshes the page or hits
   an edge case.
5. **Call `render_widget`** immediately with that `id`, passing
   `initialState` if the widget needs starting data (see "seeding vs
   driving" below). Do NOT call `search_widget` in between — the response
   already gave you the exact descriptor.
6. **Tell the user** what happened in one sentence and what they can do
   with it. Don't narrate implementation details unless asked.

### Only reach for `reload_extension` or `search_widget` when:

- `write_extension` returns `registeredWidgets: []` — that means your
  `index.js` did not register anything. Fix the file and call
  `write_extension` again (same id triggers an atomic re-install).
- The user edited files on disk outside the chat — call `reload_extension`
  to pick up the changes.
- The initial `render_widget` still fails after a clean `write_extension`
  response — then use `search_widget` to see what the registry actually has.

## Example: minimal Pomodoro timer (simple, no action catalog)

```js
// write_extension arguments
{
  "extensionId": "user.pomodoro",
  "files": [
    {
      "path": "extension.json",
      "content": "{\n  \"id\": \"user.pomodoro\",\n  \"name\": \"Pomodoro Timer\",\n  \"version\": \"1.0.0\",\n  \"description\": \"25-minute focus timer.\",\n  \"author\": {\"name\": \"GeneratorAI Agent\"},\n  \"license\": \"MIT\",\n  \"engines\": {\"generatorai\": \">=1.0.0\"},\n  \"entry\": \"./index.js\"\n}"
    },
    {
      "path": "index.js",
      "content": "export default function loadExtension(ai) {\n  ai.registerWidget({\n    id: 'timer',\n    title: 'Pomodoro Timer',\n    description: '25-minute focus timer with start/stop.',\n    entry: 'ui/timer.html',\n    preferredSurface: 'widget',\n    keywords: ['timer', 'pomodoro', 'focus']\n  });\n}"
    },
    {
      "path": "ui/timer.html",
      "content": "<!doctype html>\n<html>...</html>"
    }
  ]
}
```

Then: from `write_extension`'s response take `registeredWidgets[0].id`
(here `"user.pomodoro/timer"`) and call
`render_widget({ descriptor: 'user.pomodoro/timer' })` directly.

## Example: action-catalog design for a complex widget (kanban-style)

```js
ai.registerWidget({
  id: 'board',
  title: 'Kanban Board',
  description: 'Three-column board with card cycling',
  entry: 'ui/board.html',
  preferredSurface: 'widget',
  keywords: ['kanban', 'board', 'tasks'],
  actions: [
    { name: 'addCard', description: 'Add a card to the first column',
      argsSchema: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] } },
    { name: 'moveCard', description: 'Move a card to the next column',
      argsSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] } },
  ],
});
```

In the widget's `ACTIONS.moveCard`, look the card up by id, `throw` if it
isn't found (Rule 4), otherwise advance its column and `commit()`. This
tiny extra check is what separates a widget that reports its true state
from one that quietly lies about it.

## `notMounted` — what it means and what to do about it

`widget_action` / `widget_exec` round-trip to the **mounted** iframe, so
they only work when a browser client actually has the Widget tab open.
Right after you render a widget it is usually NOT mounted yet. So:

- **To seed a freshly-rendered widget with initial data**, pass
  `initialState` to `render_widget`, or call
  `update_widget(instanceId, { ...full state })`. Both persist WITHOUT
  needing a live client — this is the reliable way to put starting data
  into a widget you just created. Seeded state is durable: it survives a
  page refresh (the widget re-hydrates from the persisted state on
  `widget:init`), so you never need to re-seed after a reload.
- **Use `widget_action` / `widget_exec` only to drive a widget the user
  is actively viewing.** If a result comes back with `notMounted: true`,
  the widget code is FINE — do NOT rewrite it, re-render it, or edit its
  HTML. Fall back to `update_widget` (for declarative state), or tell the
  user to open the Widget tab and retry.
- If `notMounted` keeps recurring across several turns even though the
  user says the tab is open, that usually means their browser tab was
  actually closed or reloaded since the widget was rendered (a stale
  reference on your side, not a bug in the widget) — ask them to reopen
  the Widget tab rather than retrying the same call repeatedly.

```
// GOOD — seed at render time (works even before the tab is open):
render_widget({ descriptor: 'user.kanban/board', surface: 'widget',
  initialState: { cards: [{ id:'c1', text:'Design', col:'todo' }] } })

// GOOD — then drive incrementally once the user is looking at it:
widget_action({ instanceId, action: 'moveCard', args: { id:'c1', to:'doing' } })
```

To observe what the user did, call `read_widget(instanceId)` — it returns
the latest persisted state. Because Rule 2 forces every user click to
`commit()` a full state snapshot, `read_widget.state` is always an
accurate picture of the current visual. (User interactions since your
last turn are also summarized for you automatically at the top of the
turn.) If the user refers to "the widget" without giving you an id, call
`list_widgets()` first to see what's open in this chat.

## Common mistakes to avoid

- **Do NOT** import `@generatorai/*` modules in `index.js`. The `ai`
  handle is injected — that's your only dependency.
- **Do NOT** put widget HTML content in `index.js`. Put it in a separate
  `ui/*.html` file and reference it by `entry`.
- **Do NOT** register the same widget id twice, or write outside the
  extension root — the tool rejects `..` paths.
- **Do NOT** load external CDN scripts/styles from widget HTML — the CSP
  blocks external hosts. Vendor libraries as same-folder files.
- **Do NOT** use TypeScript syntax in `index.js` — it must be plain ES
  modules Node can `import()` directly.
- **Do NOT** design widget state as imperative commands (`{cmd:'start'}`)
  — see Rule 1.
- **Do NOT** mutate widget-local variables without also calling
  `commit(newState)` — see Rule 2. This is the single most common cause
  of "it worked when I clicked it but broke after a refresh."
- **Do NOT** let an action reply with success when it didn't actually do
  anything (target not found, no-op edit) — see Rule 4. Report `error`
  honestly; a false "ok" is worse than a slow failure.
- **Do NOT** claim a widget can navigate the host application (open a
  different chat, page, or workflow) — that capability does not exist.
  Build a multi-view widget instead (see above) if the user wants
  something to "click around in."
- **Do NOT** claim success after `update_widget` without having actually
  verified the state shape matches what the widget's `applyState` expects
  — mismatched field names are a silent no-op, not an error.
- **Do NOT** use `confirm()`, `alert()`, or `prompt()` for anything,
  including delete confirmations. The iframe sandbox is `allow-scripts
  allow-forms allow-same-origin` — it does NOT include `allow-modals`, so
  these native dialogs are silently suppressed by the browser: `confirm()`
  returns immediately without ever showing anything, so `if (confirm(...))`
  always takes the "cancelled" branch and the button appears to do
  nothing. Build confirmation as ordinary widget state instead — e.g. a
  delete button that first flips to "Really delete?" (a `confirming: true`
  field, Rule 1) and commits the delete only on the second click.
- **Do NOT** forget that a `commit()`/`widget:state` post REPLACES the
  entire persisted state on the host side — it is not merged server-side.
  If your state has a collection (`notes`, `cards`, `items`) alongside a
  scalar you're updating (`view`, `currentId`), a commit that only
  includes the scalar fields silently wipes the collection. Always spread
  the full current state and override just the changed keys:
  `commit({ ...state, view: 'list' })`, never `commit({ view: 'list' })`
  when `state` holds anything else worth keeping.

## Agent-side interaction pattern

Once the widget follows Rules 1-3, driving a SIMPLE (state-only) widget is
a one-liner:

```
update_widget({
  instanceId: '<from render_widget>',
  state: { running: true, startedAtEpoch: 1710000000000, accumulatedMs: 0 }
})
```

Driving a COMPLEX widget (one that declared an `actions` catalog + Rule 4):

```
// discover the verbs + arg shapes
describe_widget({ instanceId: '<id>' })

// invoke ONE verb
widget_action({ instanceId: '<id>', action: 'moveCard', args: { id: 'c1', to: 'done' } })

// or run SEVERAL verbs in one script (code mode) — reads state between calls
widget_exec({ instanceId: '<id>', code: `
  const s = await read();
  for (const c of s.cards.filter(c => c.col === 'todo')) {
    await widget.moveCard({ id: c.id, to: 'doing' });
  }
  log('promoted', s.cards.length, 'cards');
` })
```

Prefer `widget_action` / `widget_exec` over `update_widget` for complex
widgets: you never reproduce the whole state, and you can pass
`expectedUpdatedAt` (from a prior `read_widget`) for optimistic
concurrency so a concurrent user edit is never clobbered.

**Never** use `run_playwright_code`, `open_browser_page`, or any generic
browser tool to click widget buttons. The widget lives in an isolated-
origin iframe reachable only via the postMessage bridge; browser
automation cannot address it. `widget_action` / `widget_exec` /
`update_widget` are the only correct paths.
