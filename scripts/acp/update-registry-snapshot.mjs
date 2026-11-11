#!/usr/bin/env node
// ────────────────────────────────────────────────────────────────
// Regenerates the bundled ACP Registry snapshot (docs/acp ACP-4/ACP-5): the
// catalogue a server shows before it has fetched the registry itself (first
// boot, offline, air-gapped).
//
//   node scripts/acp/update-registry-snapshot.mjs [--url <registry.json URL>]
//
// Writes, under packages/agent-harness-providers/src/providers/acp/registry/snapshot/:
//   acp-registry.snapshot.json  { fetchedAt, url, etag, registry }   — the index as published
//   acp-icons.snapshot.json     { fetchedAt, icons: { <id>: ProviderMark } } — each agent's icon,
//                               sanitised by the SAME allow-list the server uses at runtime
//                               (iconSanitizer.ts, loaded through tsx). An icon that does not
//                               survive sanitising is left out (the client shows its generic mark).
//
// Cross-platform Node; no shell. Run it by hand or in the release pipeline; do not edit the outputs.
// ────────────────────────────────────────────────────────────────

import { mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, '..', '..');
const registryDir = path.join(repoRoot, 'packages', 'agent-harness-providers', 'src', 'providers', 'acp', 'registry');
const outDir = path.join(registryDir, 'snapshot');

const DEFAULT_URL = 'https://cdn.agentclientprotocol.com/registry/v1/latest/registry.json';
const urlArg = process.argv.indexOf('--url');
const url = urlArg > 0 ? process.argv[urlArg + 1] : (process.env.GENERATORAI_ACP_REGISTRY_URL || DEFAULT_URL);

async function loadTs(file) {
  const require = createRequire(path.join(repoRoot, 'apps', 'server', 'package.json'));
  const { tsImport } = await import(pathToFileURL(require.resolve('tsx/esm/api')).href);
  return tsImport(pathToFileURL(file).href, import.meta.url);
}

async function fetchText(target, timeoutMs) {
  const res = await fetch(target, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) throw new Error(`${target}: HTTP ${res.status}`);
  return { text: await res.text(), etag: res.headers.get('etag') ?? undefined };
}

const { sanitizeSvgIcon, MAX_ICON_BYTES } = await loadTs(path.join(registryDir, 'iconSanitizer.ts'));
const { parseAcpRegistry } = await loadTs(path.join(registryDir, 'schema.ts'));

console.log(`[acp-snapshot] fetching ${url}`);
const { text, etag } = await fetchText(url, 30_000);
const registry = JSON.parse(text);
const { index, skipped } = parseAcpRegistry(registry);
if (skipped.length) console.warn(`[acp-snapshot] the parser skips ${skipped.length} entries:\n  ${skipped.join('\n  ')}`);

const icons = {};
const failed = [];
await Promise.all(
  index.agents.map(async (agent) => {
    if (!agent.icon) return;
    try {
      const { text: svg } = await fetchText(agent.icon, 10_000);
      if (Buffer.byteLength(svg) > MAX_ICON_BYTES) throw new Error('too large');
      const mark = sanitizeSvgIcon(svg);
      if (mark) icons[agent.id] = mark;
      else failed.push(`${agent.id} (nothing drawable after sanitising)`);
    } catch (err) {
      failed.push(`${agent.id} (${err instanceof Error ? err.message : String(err)})`);
    }
  }),
);

const fetchedAt = Date.now();
const sortedIcons = Object.fromEntries(Object.keys(icons).sort().map((id) => [id, icons[id]]));
await mkdir(outDir, { recursive: true });
await writeFile(
  path.join(outDir, 'acp-registry.snapshot.json'),
  `${JSON.stringify({ fetchedAt, url, ...(etag ? { etag } : {}), registry }, null, 2)}\n`,
);
await writeFile(path.join(outDir, 'acp-icons.snapshot.json'), `${JSON.stringify({ fetchedAt, icons: sortedIcons }, null, 1)}\n`);
console.log(`[acp-snapshot] ${index.agents.length} agents, ${Object.keys(icons).length} icons → ${path.relative(repoRoot, outDir)}`);
if (failed.length) console.warn(`[acp-snapshot] no icon for: ${failed.join(', ')}`);
