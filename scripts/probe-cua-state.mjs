// Throwaway probe: captures real list_apps / list_windows / get_window_state
// payloads so the adapter is built against the contract, not against guesses.
import { CuaDriver } from '@trycua/cua-driver';
import { writeFileSync } from 'node:fs';

const client = CuaDriver.create(undefined);
const SESSION = 'probe';
await client.startSession({ session: SESSION, captureScope: 1 });

const call = async (name, args = {}) => {
  const r = await client.callTool(name, JSON.stringify({ session: SESSION, ...args }));
  return { isError: r.isError, errorCode: r.errorCode, text: r.text, json: r.structuredJson };
};

const perms = await call('check_permissions');
console.log('=== check_permissions ===', perms.text?.slice(0, 300));

const apps = await call('list_apps');
console.log('\n=== list_apps === isError:', apps.isError, apps.errorCode ?? '');
if (apps.json) {
  writeFileSync('probe-list-apps.json', apps.json);
  const parsed = JSON.parse(apps.json);
  console.log('top keys:', Object.keys(parsed));
  const arr = Array.isArray(parsed) ? parsed : (parsed.apps ?? parsed.applications ?? []);
  console.log('count:', arr.length);
  console.log('first running sample:', JSON.stringify(arr.filter((a) => a.running).slice(0, 3), null, 2));
}

const wins = await call('list_windows', { on_screen_only: true });
console.log('\n=== list_windows === isError:', wins.isError, wins.errorCode ?? '');
let target = null;
if (wins.json) {
  writeFileSync('probe-list-windows.json', wins.json);
  const parsed = JSON.parse(wins.json);
  console.log('top keys:', Object.keys(parsed));
  const arr = Array.isArray(parsed) ? parsed : (parsed.windows ?? []);
  console.log('count:', arr.length);
  console.log('sample:', JSON.stringify(arr.slice(0, 4), null, 2));
  target = arr[0] ?? null;
}

if (target) {
  const pid = target.pid ?? target.process_id;
  const windowId = target.window_id ?? target.id;
  const st = await call('get_window_state', { pid, window_id: windowId, max_elements: 25, max_depth: 8 });
  console.log('\n=== get_window_state === pid', pid, 'window', windowId, 'isError:', st.isError, st.errorCode ?? '');
  if (st.json) {
    writeFileSync('probe-window-state.json', st.json);
    const parsed = JSON.parse(st.json);
    console.log('top keys:', Object.keys(parsed));
    console.log(JSON.stringify(parsed, null, 2).slice(0, 2500));
  }
}

await client.endSession({ session: SESSION });
