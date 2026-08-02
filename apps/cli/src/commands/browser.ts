// ────────────────────────────────────────────────────────────────
// `generatorai browser …` — Integrated Browser CLI (v13)
//
//   generatorai browser start <workspaceId> [url]     start / attach browser
//   generatorai browser stop <workspaceId>            terminate session
//   generatorai browser status <workspaceId>          descriptor + status
//   generatorai browser navigate <workspaceId> <url>  navigate
//   generatorai browser screenshot <workspaceId>      capture a screenshot
//   generatorai browser snapshot <workspaceId>        capture DOM snapshot
//   generatorai browser inspect <workspaceId> [on|off] toggle inspector
//   generatorai browser snapshots <workspaceId>       list browser artifacts
//   generatorai browser tail <workspaceId>            follow browser.* events
//
// All commands are stateless — they talk to the running server via the
// bare fetch client and print JSON (or a summary when `--json` is off).
// ────────────────────────────────────────────────────────────────

import type { Command } from 'commander';
import chalk from 'chalk';
import type { CLIPlatformClient } from '../platform/types.js';
import { outputJson } from '../output/json.js';

async function apiJson<T = unknown>(
  base: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`HTTP ${res.status}: ${text}`);
  }
  const ctype = res.headers.get('Content-Type') ?? '';
  if (ctype.includes('application/json')) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export function registerBrowserCommands(
  program: Command,
  getClient: () => Promise<CLIPlatformClient>,
): void {
  const b = program.command('browser').description('Integrated Browser (v13)');

  // ── start ──
  b.command('start <workspaceId> [url]')
    .description('Start (or attach to) the workspace browser')
    .option('--allowed-host <host...>', 'Restrict navigation to hosts (repeatable)')
    .action(async (workspaceId: string, url: string | undefined, cmdOpts: { allowedHost?: string[] }) => {
      const opts = program.opts();
      const client = await getClient();
      const body: Record<string, unknown> = { url };
      if (cmdOpts.allowedHost?.length) {
        body['config'] = { enabled: true, allowedHosts: cmdOpts.allowedHost };
      }
      const result = await apiJson<Record<string, unknown>>(
        client.baseUrl,
        `/api/workspaces/${encodeURIComponent(workspaceId)}/browser/start`,
        { method: 'POST', body: JSON.stringify(body) },
      );
      if (opts['json']) return outputJson(result);
      process.stdout.write(chalk.green(`\n  ✓ Browser started for workspace ${workspaceId}\n`));
      process.stdout.write(`    status:    ${String(result['status'] ?? '?')}\n`);
      process.stdout.write(`    mode:      ${String(result['mode'] ?? '?')}\n`);
      process.stdout.write(`    currentUrl:${String(result['currentUrl'] ?? '(none)')}\n\n`);
    });

  // ── stop ──
  b.command('stop <workspaceId>')
    .description('Stop the workspace browser session')
    .action(async (workspaceId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const result = await apiJson<Record<string, unknown>>(
        client.baseUrl,
        `/api/workspaces/${encodeURIComponent(workspaceId)}/browser/stop`,
        { method: 'POST' },
      );
      if (opts['json']) return outputJson(result);
      process.stdout.write(chalk.green('\n  ✓ Browser stopped\n\n'));
    });

  // ── status ──
  b.command('status <workspaceId>')
    .description('Show current browser descriptor (mode/status/url)')
    .action(async (workspaceId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const result = await apiJson<Record<string, unknown>>(
        client.baseUrl,
        `/api/workspaces/${encodeURIComponent(workspaceId)}/browser/descriptor`,
      );
      if (opts['json']) return outputJson(result);
      process.stdout.write('\n');
      for (const [k, v] of Object.entries(result)) {
        if (v == null) continue;
        process.stdout.write(`  ${k.padEnd(14)}${JSON.stringify(v)}\n`);
      }
      process.stdout.write('\n');
    });

  // ── navigate ──
  b.command('navigate <workspaceId> <url>')
    .alias('goto')
    .description('Navigate the browser to a URL')
    .action(async (workspaceId: string, url: string) => {
      const opts = program.opts();
      const client = await getClient();
      const normalised = /^https?:\/\//.test(url) ? url : `https://${url}`;
      const result = await apiJson<Record<string, unknown>>(
        client.baseUrl,
        `/api/workspaces/${encodeURIComponent(workspaceId)}/browser/actions`,
        { method: 'POST', body: JSON.stringify({ kind: 'navigate', url: normalised }) },
      );
      if (opts['json']) return outputJson(result);
      const ok = result['ok'] !== false;
      process.stdout.write(chalk[ok ? 'green' : 'red'](`\n  ${ok ? '✓' : '✗'} navigate ${normalised}\n\n`));
    });

  // ── screenshot ──
  b.command('screenshot <workspaceId>')
    .description('Capture a PNG screenshot (registers as browser_screenshot artifact)')
    .action(async (workspaceId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const result = await apiJson<Record<string, unknown>>(
        client.baseUrl,
        `/api/workspaces/${encodeURIComponent(workspaceId)}/browser/actions`,
        { method: 'POST', body: JSON.stringify({ kind: 'screenshot' }) },
      );
      if (opts['json']) return outputJson(result);
      const path = String(result['artifactPath'] ?? '');
      process.stdout.write(chalk.green(`\n  ✓ Screenshot: ${path}\n\n`));
    });

  // ── snapshot ──
  b.command('snapshot <workspaceId>')
    .description('Capture a DOM snapshot (registers as browser_dom artifact)')
    .action(async (workspaceId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const result = await apiJson<Record<string, unknown>>(
        client.baseUrl,
        `/api/workspaces/${encodeURIComponent(workspaceId)}/browser/actions`,
        { method: 'POST', body: JSON.stringify({ kind: 'snapshot' }) },
      );
      if (opts['json']) return outputJson(result);
      process.stdout.write(chalk.green(`\n  ✓ DOM snapshot: ${String(result['artifactPath'] ?? '')}\n\n`));
    });

  // ── inspect ──
  b.command('inspect <workspaceId> [state]')
    .description('Toggle the element inspector overlay (state=on|off, default toggles)')
    .action(async (workspaceId: string, state: string | undefined) => {
      const opts = program.opts();
      const client = await getClient();
      const on = state ? state.toLowerCase() === 'on' : true;
      await apiJson(
        client.baseUrl,
        `/api/workspaces/${encodeURIComponent(workspaceId)}/browser/actions`,
        { method: 'POST', body: JSON.stringify({ kind: 'inspector', on }) },
      );
      if (opts['json']) return outputJson({ ok: true, on });
      process.stdout.write(chalk.green(`\n  ✓ Inspector ${on ? 'ON' : 'OFF'}\n\n`));
    });

  // ── snapshots ──
  b.command('snapshots <workspaceId>')
    .description('List browser artifacts (screenshots, DOM, HAR, selections)')
    .action(async (workspaceId: string) => {
      const opts = program.opts();
      const client = await getClient();
      const result = await apiJson<{ artifacts: Array<Record<string, unknown>> }>(
        client.baseUrl,
        `/api/workspaces/${encodeURIComponent(workspaceId)}/browser/snapshots`,
      );
      if (opts['json']) return outputJson(result);
      const artifacts = result.artifacts ?? [];
      if (artifacts.length === 0) {
        process.stdout.write('\n  (no browser artifacts yet)\n\n');
        return;
      }
      process.stdout.write('\n');
      for (const a of artifacts) {
        process.stdout.write(
          `  ${String(a['artifactType']).padEnd(20)} ${String(a['relativePath'])}\n`,
        );
      }
      process.stdout.write('\n');
    });

  // ── tail (SSE) ──
  b.command('tail <workspaceId>')
    .description('Follow browser.* events for a workspace (Ctrl+C to stop)')
    .action(async (workspaceId: string) => {
      const client = await getClient();
      const scope = 'session';
      const id = `browser:${workspaceId}`;
      const unsub = client.subscribeToStream(scope, id, (evt) => {
        if (!evt.kind.startsWith('browser.')) return;
        process.stdout.write(
          chalk.cyan(`[${new Date(evt.timestamp ?? Date.now()).toISOString()}] `) +
            chalk.bold(evt.kind) + ' ' +
            JSON.stringify(evt.data) + '\n',
        );
      }, { filter: ['browser.'] });
      await new Promise<void>((resolve) => {
        const stop = () => { unsub(); resolve(); };
        process.on('SIGINT', stop);
        process.on('SIGTERM', stop);
      });
    });
}
