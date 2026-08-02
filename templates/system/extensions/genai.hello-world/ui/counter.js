// Counter widget logic — served via /api/widget-assets and loaded via
// <script src="./counter.js">. Existence proves 'script-src self' works.
//
// Widget protocol:
//   widget → host: 'widget:hello' (mount) → wait for 'widget:init' → 'widget:ready'
//   widget → host: 'widget:state' { state } on every change
//   widget → host: 'widget:action' { action, payload } for semantic events
//   host → widget: 'widget:init' { props, state }, 'widget:state' { state }

let count = 0;

const valueEl = document.getElementById('value');
const msgEl = document.getElementById('msg');

function render() {
  valueEl.textContent = String(count);
}

function post(type, extra = {}) {
  window.parent.postMessage({ type, ...extra }, '*');
}

function pushState() {
  post('widget:state', { state: { count } });
}

document.getElementById('inc').addEventListener('click', () => {
  count += 1;
  render();
  pushState();
  post('widget:action', { action: 'increment', payload: { count } });
});

document.getElementById('dec').addEventListener('click', () => {
  count -= 1;
  render();
  pushState();
  post('widget:action', { action: 'decrement', payload: { count } });
});

document.getElementById('reset').addEventListener('click', () => {
  count = 0;
  render();
  pushState();
  post('widget:action', { action: 'reset', payload: { count } });
});

// Handle host messages
window.addEventListener('message', (ev) => {
  const m = ev.data;
  if (!m || typeof m !== 'object') return;
  if (m.type === 'widget:init' || m.type === 'widget:state') {
    const state = m.state ?? {};
    if (typeof state.count === 'number') {
      count = state.count;
      render();
    }
  }
});

// Mount handshake
post('widget:hello');
requestAnimationFrame(() => post('widget:ready'));
if (msgEl) msgEl.textContent = 'Counter ready — state syncs with the agent.';
