import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** agent-device exposes ESM only and does not export package.json. */
export function agentCommand(args = []) {
  let directory = path.dirname(fileURLToPath(import.meta.resolve('agent-device')));
  while (true) {
    const manifest = path.join(directory, 'package.json');
    if (fs.existsSync(manifest)) {
      const pkg = JSON.parse(fs.readFileSync(manifest, 'utf8'));
      if (pkg.name === 'agent-device') {
        const bin = typeof pkg.bin === 'string' ? pkg.bin : pkg.bin?.['agent-device'];
        if (!bin) throw new Error('Installed agent-device has no CLI entry');
        // Invoke JavaScript directly, never the Windows .cmd shim.
        return { command: process.execPath, args: [path.resolve(directory, bin), ...args] };
      }
    }
    const parent = path.dirname(directory);
    if (parent === directory) throw new Error('Cannot locate the installed agent-device manifest');
    directory = parent;
  }
}
