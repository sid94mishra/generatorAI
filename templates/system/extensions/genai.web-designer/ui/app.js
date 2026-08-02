/* Web App Designer — widget logic. Plain classic script, no bundler. */
(function () {
  'use strict';

  const uid = (p) => p + '_' + Math.random().toString(36).slice(2, 9);
  const post = (type, extra) => window.parent.postMessage(Object.assign({ type }, extra || {}), '*');
  const nowTs = () => Date.now();

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  let toastTimer = null;
  function toast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
  }

  const EXAMPLE_PROMPTS = [
    'A pricing page for a SaaS product with 3 tiers',
    'A personal portfolio landing page for a photographer',
    'A dashboard for a fitness tracking app',
    'A signup form with social login for a startup',
  ];

  function defaultState() {
    return {
      requirement: '',
      current: null, // { id, html, summary, ts }
      history: [], // [{id, html, summary, ts}]
      activity: [],
    };
  }

  let state = defaultState();
  let viewMode = 'preview'; // local — 'preview' | 'code'
  let device = 'desktop'; // local — 'desktop' | 'tablet' | 'mobile'
  let newConfirming = false;

  function deepClone(v) {
    if (typeof structuredClone === 'function') return structuredClone(v);
    return JSON.parse(JSON.stringify(v));
  }

  function commitState(mutator, logEntry) {
    const draft = deepClone(state);
    mutator(draft);
    if (logEntry) {
      draft.activity = draft.activity.concat([{ id: uid('a'), ts: nowTs(), who: logEntry.who || 'user', message: logEntry.message }]);
    }
    state = draft;
    post('widget:state', { state });
    render();
  }

  function applyState(next) {
    if (next && typeof next === 'object' && ('current' in next)) state = next;
    render();
  }

  // ───────────────────────── actions (agent + user share these) ─────────────────────────
  const Actions = {
    updateDesign({ html, summary }) {
      if (typeof html !== 'string' || !html.trim()) throw new Error('html must be a non-empty string');
      const entry = { id: uid('v'), html, summary: summary || 'Updated design', ts: nowTs() };
      commitState((d) => {
        d.current = entry;
        d.history = d.history.concat([entry]);
      }, { who: 'agent', message: entry.summary });
      return { id: entry.id };
    },
    restoreVersion({ versionId }) {
      const v = state.history.find((h) => h.id === versionId);
      if (!v) throw new Error(`no version with id "${versionId}"`);
      const entry = { id: uid('v'), html: v.html, summary: `Restored: ${v.summary}`, ts: nowTs() };
      commitState((d) => {
        d.current = entry;
        d.history = d.history.concat([entry]);
      }, { who: 'agent', message: entry.summary });
    },
    addNote({ text }) {
      if (!text || !String(text).trim()) throw new Error('text is required');
      commitState(() => {}, { who: 'agent', message: String(text).trim() });
    },
  };

  // ───────────────────────── rendering ─────────────────────────
  function render() {
    const hasDesign = !!state.current;
    document.getElementById('headerActions').style.display = hasDesign ? 'flex' : 'none';
    document.getElementById('historyPane').style.display = hasDesign ? 'flex' : 'none';
    document.getElementById('chatPane').style.display = hasDesign ? 'flex' : 'none';
    document.getElementById('bodyGrid').style.gridTemplateColumns = hasDesign ? '220px 1fr 300px' : '1fr';

    const col = document.getElementById('canvasCol');
    if (!hasDesign) {
      col.innerHTML = renderHero();
      wireHero();
    } else {
      col.innerHTML = renderWorkspace();
      wireWorkspace();
    }
    if (hasDesign) {
      renderHistory();
      renderActivity();
    }
    post('widget:resize', { height: document.body.scrollHeight });
  }

  function renderHero() {
    return `<div class="hero">
      <div class="hero-icon">${iconSpark()}</div>
      <h1>What do you want to design?</h1>
      <p class="sub">Describe a web app or page in plain language — the agent will design a real, working mock and you'll see it live here.</p>
      <textarea id="reqInput" placeholder="e.g. A pricing page for a SaaS product with 3 tiers, light and modern"></textarea>
      <div class="hero-actions">
        <button class="btn primary" id="designBtn">${iconSpark()} Design it</button>
      </div>
      <div class="chips" id="chips">
        ${EXAMPLE_PROMPTS.map((p) => `<button class="chip" data-prompt="${escapeHtml(p)}">${escapeHtml(p)}</button>`).join('')}
      </div>
    </div>`;
  }
  function wireHero() {
    const input = document.getElementById('reqInput');
    document.getElementById('designBtn').addEventListener('click', () => submitRequirement(input.value));
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submitRequirement(input.value); });
    document.getElementById('chips').addEventListener('click', (e) => {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      input.value = chip.dataset.prompt;
      submitRequirement(input.value);
    });
  }
  function submitRequirement(text) {
    const v = (text || '').trim();
    if (!v) return;
    commitState((d) => { d.requirement = v; }, { who: 'user', message: v });
    post('widget:followup-prompt', { text: `Design this: ${v}` });
    toast('Sent to the agent — designing…');
  }

  function renderWorkspace() {
    return `<div class="canvas-toolbar">
        <span style="color:var(--muted); font-size:12px;">${escapeHtml(state.current.summary || '')}</span>
      </div>
      <div class="canvas-area" id="canvasArea"></div>`;
  }
  function wireWorkspace() {
    renderCanvasArea();
  }

  function renderCanvasArea() {
    const area = document.getElementById('canvasArea');
    if (!area) return;
    if (viewMode === 'code') {
      area.innerHTML = `<div class="code-view"><pre><code>${highlightHtml(state.current.html)}</code></pre></div>`;
    } else {
      area.innerHTML = `<div class="device-frame ${device}">
        <div class="device-chrome"><span class="dot"></span><span class="dot"></span><span class="dot"></span></div>
        <iframe sandbox="allow-scripts" title="Design preview"></iframe>
      </div>`;
      const frame = area.querySelector('iframe');
      // srcdoc (not src) — a static string assignment, no navigation race.
      frame.srcdoc = state.current.html;
    }
  }

  function highlightHtml(html) {
    const esc = escapeHtml(html);
    return esc
      .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="tok-comment">$1</span>')
      .replace(/(&lt;\/?[a-zA-Z0-9-]+)/g, '<span class="tok-tag">$1</span>')
      .replace(/([a-zA-Z-]+)(=)(&quot;[^&]*?&quot;)/g, '<span class="tok-attr">$1</span>$2<span class="tok-str">$3</span>');
  }

  function renderHistory() {
    const list = document.getElementById('historyList');
    if (!state.history.length) { list.innerHTML = `<div class="version-empty">No versions yet.</div>`; return; }
    const items = state.history.slice().reverse();
    list.innerHTML = items.map((v) => `<div class="version-item${v.id === state.current.id ? ' active' : ''}" data-version-id="${v.id}">
        <div class="v-title">${escapeHtml(v.summary)}</div>
        <div class="v-time">${formatTime(v.ts)}</div>
      </div>`).join('');
  }

  function renderActivity() {
    const list = document.getElementById('activityList');
    if (!state.activity.length) { list.innerHTML = `<div class="activity-empty">No activity yet.</div>`; return; }
    const items = state.activity.slice(-60).slice().reverse();
    list.innerHTML = items.map((a) => `<div class="activity-item ${a.who}">
        <div class="who">${a.who === 'agent' ? '● Agent' : '● You'}<span class="ts">${formatTime(a.ts)}</span></div>
        <div class="msg">${escapeHtml(a.message)}</div>
      </div>`).join('');
  }
  function formatTime(ts) {
    try { return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); } catch { return ''; }
  }

  function iconSpark() {
    return '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3 1.9 4.9L19 9.8l-5.1 1.9L12 16.6l-1.9-4.9L5 9.8l5.1-1.9Z"/><path d="M19 15v4M17 17h4"/></svg>';
  }

  // ───────────────────────── header controls ─────────────────────────
  document.getElementById('viewSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-view]');
    if (!b) return;
    viewMode = b.dataset.view;
    document.querySelectorAll('#viewSeg button').forEach((x) => x.classList.toggle('active', x === b));
    renderCanvasArea();
  });
  document.querySelectorAll('#viewSeg button').forEach((b) => b.classList.toggle('active', b.dataset.view === viewMode));

  document.getElementById('deviceSeg').addEventListener('click', (e) => {
    const b = e.target.closest('button[data-device]');
    if (!b) return;
    device = b.dataset.device;
    document.querySelectorAll('#deviceSeg button').forEach((x) => x.classList.toggle('active', x === b));
    renderCanvasArea();
  });
  document.querySelectorAll('#deviceSeg button').forEach((b) => b.classList.toggle('active', b.dataset.device === device));

  document.getElementById('historyPane').addEventListener('click', (e) => {
    const item = e.target.closest('.version-item');
    if (!item) return;
    Actions.restoreVersion({ versionId: item.dataset.versionId });
  });

  document.getElementById('exportBtn').addEventListener('click', () => {
    if (!state.current) return;
    const blob = new Blob([state.current.html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'design.html';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast('Downloaded design.html');
  });

  const newBtn = document.getElementById('newBtn');
  newBtn.addEventListener('click', () => {
    if (!newConfirming) {
      newConfirming = true;
      newBtn.textContent = 'Really start over?';
      newBtn.classList.add('danger-confirm');
      setTimeout(() => { newConfirming = false; newBtn.textContent = 'New'; newBtn.classList.remove('danger-confirm'); }, 3000);
      return;
    }
    newConfirming = false;
    newBtn.textContent = 'New';
    newBtn.classList.remove('danger-confirm');
    commitState((d) => { d.current = null; d.history = []; d.requirement = ''; d.activity = []; });
  });

  document.getElementById('askBtn').addEventListener('click', () => {
    const box = document.getElementById('feedbackText');
    const v = box.value.trim();
    if (!v) return;
    post('widget:followup-prompt', { text: v });
    commitState(() => {}, { who: 'user', message: v });
    box.value = '';
    toast('Sent to the agent');
  });

  // ───────────────────────── host bridge (widget:hello is mandatory) ─────────────────────────
  window.addEventListener('message', (event) => {
    const m = event.data;
    if (!m || typeof m !== 'object') return;
    if (m.type === 'widget:init') {
      applyState(m.state && 'current' in m.state ? m.state : state);
      post('widget:ready');
    } else if (m.type === 'widget:state') {
      applyState(m.state);
    } else if (m.type === 'widget:invoke') {
      handleInvoke(m);
    } else if (m.type === 'widget:teardown') {
      post('widget:state', { state });
      post('widget:teardown-ack', { teardownId: m.teardownId });
    }
  });

  function handleInvoke(m) {
    const { invokeId, action, args } = m;
    try {
      const fn = Actions[action];
      if (!fn) throw new Error(`unknown action "${action}"`);
      const result = fn(args || {});
      Promise.resolve(result).then((r) => post('widget:invoke-result', { invokeId, result: r || { ok: true } }))
        .catch((err) => post('widget:invoke-result', { invokeId, error: String((err && err.message) || err) }));
    } catch (err) {
      post('widget:invoke-result', { invokeId, error: String((err && err.message) || err) });
    }
  }

  // Boot — MUST be unconditional at top level, or the host never sends
  // widget:init and nothing ever renders.
  render();
  post('widget:hello');
})();
