import { execFileSync, spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, describe, expect, it } from 'vitest';

// CONVINV-R14: the package's `bin` must start as documented. It used to point
// at `src/cli.ts`, which plain Node cannot load (the workspace packages it
// imports export TypeScript source), so `generatorai-mcp serve` never started.

const pkgDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const configDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gai-mcp-bin-'));

afterAll(() => {
  fs.rmSync(configDir, { recursive: true, force: true });
});

describe('generatorai-mcp bin', () => {
  it('bundles, then `serve` answers an MCP initialize over stdio', async () => {
    execFileSync(process.execPath, ['esbuild.config.mjs'], { cwd: pkgDir, stdio: 'pipe' });
    const pkg = JSON.parse(fs.readFileSync(path.join(pkgDir, 'package.json'), 'utf8')) as { bin: Record<string, string> };
    const bin = path.join(pkgDir, pkg.bin['generatorai-mcp']!);
    expect(fs.existsSync(bin)).toBe(true);

    fs.writeFileSync(
      path.join(configDir, 'mcp-connection.json'),
      JSON.stringify({ endpoint: 'http://127.0.0.1:9', serverId: 'srv-test', secretBackend: 'local-file-key' }),
    );
    const env: NodeJS.ProcessEnv = { ...process.env, GENERATORAI_MCP_CONFIG_DIR: configDir };
    delete env['GENERATORAI_SECRET_KEY'];
    delete env['GENERATORAI_SECRET_PASSPHRASE'];
    const child = spawn(process.execPath, [bin, 'serve'], { env, stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      const reply = await new Promise<string>((resolve, reject) => {
        let out = '';
        let err = '';
        const timer = setTimeout(() => reject(new Error(`no reply; stderr: ${err}`)), 15_000);
        child.stderr.on('data', (d: Buffer) => (err += d.toString()));
        child.stdout.on('data', (d: Buffer) => {
          out += d.toString();
          if (out.includes('\n')) {
            clearTimeout(timer);
            resolve(out.split('\n')[0]!);
          }
        });
        child.on('exit', (code) => reject(new Error(`exited ${code}; stderr: ${err}`)));
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } })}\n`,
        );
      });
      expect(JSON.parse(reply)).toMatchObject({ id: 1, result: { serverInfo: { name: 'generatorai' } } });
    } finally {
      child.kill();
    }
  }, 60_000);
});
