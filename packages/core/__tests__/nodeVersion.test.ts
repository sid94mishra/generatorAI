// U-25: a run warns when a codebase asks for a newer Node than its shells have — never for a newer one.

import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { minimumOfRange, nodeVersionWarnings, parseVersion, readNodeRequirement } from '../src/services/engine/lifecycle/nodeVersion.js';

const dirs: string[] = [];
async function repo(files: Record<string, string>): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'node-req-'));
  dirs.push(dir);
  for (const [name, text] of Object.entries(files)) await fs.writeFile(path.join(dir, name), text);
  return dir;
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((d) => fs.rm(d, { recursive: true, force: true })));
});

describe('Node requirement (U-25)', () => {
  it('reads versions and the floor of engines ranges', () => {
    expect(parseVersion('v22.11.0')).toEqual([22, 11, 0]);
    expect(parseVersion('22.x')).toEqual([22, 0, 0]);
    expect(parseVersion('lts/iron')).toBeNull();
    expect(minimumOfRange('>=20.11 <23')).toEqual([20, 11, 0]);
    expect(minimumOfRange('^20.11 || >=22')).toEqual([20, 11, 0]);
    expect(minimumOfRange('18 - 22')).toEqual([18, 0, 0]);
    expect(minimumOfRange('*')).toBeNull();
  });

  it('takes .nvmrc first, then .node-version, .tool-versions and engines; an alias says nothing', async () => {
    expect(await readNodeRequirement(await repo({ '.nvmrc': '22\n', 'package.json': '{"engines":{"node":">=18"}}' }))).toMatchObject({ source: '.nvmrc', min: [22, 0, 0] });
    expect(await readNodeRequirement(await repo({ '.tool-versions': 'pnpm 9.1.0\nnodejs 20.11.1\n' }))).toMatchObject({ source: '.tool-versions', min: [20, 11, 1] });
    expect(await readNodeRequirement(await repo({ 'package.json': '{"engines":{"node":"^22.11.0"}}' }))).toMatchObject({ source: 'package.json engines.node', min: [22, 11, 0] });
    expect(await readNodeRequirement(await repo({ '.nvmrc': 'lts/*' }))).toBeNull();
    expect(await readNodeRequirement(await repo({}))).toBeNull();
  });

  it('warns only when the shells have an older Node (or none)', async () => {
    const dir = await repo({ '.nvmrc': '22' });
    const probeOf = (v: string | null) => async () => v;
    expect(await nodeVersionWarnings({ pulse: { path: dir } }, probeOf('v26.1.0'))).toEqual([]);
    expect(await nodeVersionWarnings({ pulse: { path: dir } }, probeOf('v22.0.0'))).toEqual([]);
    const [older] = await nodeVersionWarnings({ pulse: { path: dir } }, probeOf('v20.11.1'));
    expect(older).toMatch(/pulse asks for Node 22 \(\.nvmrc\), but this run's shells use Node 20\.11\.1/);
    const [none] = await nodeVersionWarnings({ pulse: { path: dir } }, probeOf(null));
    expect(none).toMatch(/no `node` was found/);
  });
});
