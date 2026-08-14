// Throwaway probe: pins the real `get_desktop_state` payload shape against a
// live driver. See docs/plans/COMPUTER_USE_PENDING_AND_TCC_VERIFICATION.md §4.2.
import { CuaDriver } from '@trycua/cua-driver';
import { writeFileSync } from 'node:fs';

const client = CuaDriver.create(undefined);
console.log('executionMode:', client.executionMode());
console.log('isAvailable:', client.isAvailable());

const meta = await client.metadata();
console.log('metadata:', meta);

await client.startSession({ session: 'probe', captureScope: 1 });
const state = await client.getDesktopState({ session: 'probe' });

console.log('isError:', state.isError, 'errorCode:', state.errorCode, 'degraded:', state.degraded);
console.log('text (first 600):', state.text?.slice(0, 600));

if (state.structuredJson) {
  writeFileSync('probe-desktop-state.json', state.structuredJson);
  const parsed = JSON.parse(state.structuredJson);
  console.log('TOP-LEVEL KEYS:', Object.keys(parsed));
  console.log('SAMPLE:', JSON.stringify(parsed, null, 2).slice(0, 3000));
} else {
  writeFileSync('probe-desktop-state.json', state.rawJson ?? '{}');
  console.log('no structuredJson; rawJson keys:', Object.keys(JSON.parse(state.rawJson ?? '{}')));
}
await client.endSession({ session: 'probe' });
