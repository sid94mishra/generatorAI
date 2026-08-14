// Throwaway probe: dumps the driver's real tool inventory so the adapter can
// be built against it instead of against guesses.
import { CuaDriver } from '@trycua/cua-driver';
import { writeFileSync } from 'node:fs';

const client = CuaDriver.create(undefined);
const toolsJson = await client.listToolsJson();
writeFileSync('probe-tools.json', toolsJson);

const tools = JSON.parse(toolsJson);
const list = Array.isArray(tools) ? tools : (tools.tools ?? []);
console.log('TOOL COUNT:', list.length);
for (const t of list) {
  const props = Object.keys(t.inputSchema?.properties ?? t.input_schema?.properties ?? {});
  console.log(`\n• ${t.name}`);
  console.log(`   args: ${props.join(', ') || '(none)'}`);
  console.log(`   ${String(t.description ?? '').slice(0, 260).replace(/\s+/g, ' ')}`);
}
