#!/usr/bin/env node
import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const mobileDir = fileURLToPath(new URL('../../apps/mobile/', import.meta.url));

async function main() {
  const { values } = parseArgs({ options: {
    platform: { type: 'string' }, record: { type: 'boolean' },
    json: { type: 'boolean' }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/mobile/fingerprint.mjs --platform=ios|android [--record] [--json]');
    console.log('Exit 0: native build matches (or recorded); 2: rebuild needed; 1: fingerprint failed.');
    return;
  }
  const platform = values.platform;
  if (platform !== 'ios' && platform !== 'android') throw new Error('--platform must be ios or android');
  // Use the fingerprint version owned by this Expo SDK, including its preset defaults.
  const mobileRequire = createRequire(path.join(mobileDir, 'package.json'));
  const expoRequire = createRequire(mobileRequire.resolve('expo/package.json'));
  const { createFingerprintAsync, diffFingerprints } = expoRequire('@expo/fingerprint');
  const current = await createFingerprintAsync(mobileDir, {
    platforms: [platform], concurrentIoLimit: 2, silent: true,
  });
  const target = path.join(mobileDir, '.fingerprint', `${platform}.json`);
  if (values.record) {
    await fs.mkdir(path.dirname(target), { recursive: true });
    // A partially written file must never look like a successful recorded build.
    const temporary = `${target}.${process.pid}.tmp`;
    await fs.writeFile(temporary, `${JSON.stringify(current, null, 2)}\n`);
    await fs.rename(temporary, target);
    console.log(values.json ? JSON.stringify({ platform, hash: current.hash, recorded: true })
      : `fingerprint: ${platform} recorded ${current.hash}`);
    return;
  }
  let previous;
  try {
    previous = JSON.parse(await fs.readFile(target, 'utf8'));
    if (typeof previous.hash !== 'string' || !Array.isArray(previous.sources)) throw new Error('invalid saved fingerprint');
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error(`Cannot read ${target}: ${error.message}`);
  }
  const changed = !previous || previous.hash !== current.hash;
  const sources = previous ? diffFingerprints(previous, current).map(item => {
    const source = item.addedSource ?? item.removedSource ?? item.afterSource;
    return { change: item.op, source: source.filePath ?? source.id ?? source.type, reasons: source.reasons };
  }) : [];
  const result = { platform, rebuild: changed, hash: current.hash, recordedHash: previous?.hash ?? null, sources };
  if (values.json) console.log(JSON.stringify(result, null, 2));
  else {
    console.log(`fingerprint: ${platform} rebuild ${changed ? 'yes' : 'no'}${previous ? '' : ' (no successful build recorded)'}`);
    for (const item of sources) console.log(`  ${item.change}: ${item.source}`);
    if (changed) console.log(`After a successful build: node scripts/mobile/fingerprint.mjs --platform=${platform} --record`);
  }
  process.exitCode = changed ? 2 : 0;
}

main().catch(error => { console.error(`fingerprint: ${error.message}`); process.exitCode = 1; });
