// `generatorai skill …` — the workflow authoring skill for coding agents
// (P06 WP-6.7).
//
// The skill bundle (`generatorai-workflow-author`: SKILL.md, reference/*,
// schema/*, examples/*, scripts/validate.mjs) is generated from the
// workflow spec and served by the connected server, so the copy an agent
// holds matches the schema that server validates against. `--from <dir>`
// installs a local bundle instead (a checkout's
// `skills/generatorai-workflow-author`).
//
//   skill install --target claude   copies it to `.claude/skills/` (the
//                                    project with --project, else the user's
//                                    home) and prints the MCP config.
//   skill install --target codex    asks the installed Codex where its skill
//                                    roots are (`codex app-server` →
//                                    `skills/list`, else `$CODEX_HOME/
//                                    config.toml`), copies it there and
//                                    prints the `[mcp_servers.generatorai]`
//                                    snippet. Sources disagree between
//                                    `~/.codex/skills` and `~/.agents/skills`,
//                                    so the path is never hard-coded: when
//                                    Codex names no root, `--dir` is required.
//   skill print [path]               one bundle file (SKILL.md by default).
//
// No slash commands and no MCP prompts: the agent finds the skill by its
// description, and the MCP server adds the tools and the resources.

import { spawn } from 'node:child_process';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { createInterface } from 'node:readline';
import { z } from 'zod';
import { renameWithRetry } from '@generatorai/shared/node';
import { WORKFLOW_AUTHOR_SKILL } from '@generatorai/workflow-spec';
import { defineCommand, type CommandSpec } from '../registry/CommandSpec.js';
import { CliError } from '../errors/CliError.js';
import type { CliContext } from '../context/CliContext.js';
import { inputSchema, readTextFile, record } from './_shared.js';

export const SKILL_GROUP = {
  name: 'skill',
  summary: 'The workflow authoring skill for coding agents (Claude Code, Codex)',
  order: 25,
};

const TARGETS = ['claude', 'codex'] as const;
type Target = (typeof TARGETS)[number];

/** The MCP server command every snippet names (`packages/mcp-server`, paired once with `generatorai-mcp pair <code>`). */
const MCP_COMMAND = 'generatorai-mcp';
const MCP_ARGS = ['serve'];
const MCP_PAIRING =
  'Pair the MCP server with this GeneratorAI server once: `generatorai device invite --platform mcp --scopes ' +
  'exec:agent,read:workflows,write:workflows`, then `generatorai-mcp pair <code>`.';

// ── The bundle ──────────────────────────────────────────────────────

interface SkillBundle {
  name: string;
  schemaHash: string | null;
  source: string;
  files: Array<{ path: string; text: string }>;
}

/** A bundle path that stays inside the bundle (never absolute, never `..`). */
function safeBundlePath(rel: string): string {
  const norm = rel.replace(/\\/g, '/');
  if (!norm || norm.startsWith('/') || /^[a-zA-Z]:/.test(norm) || norm.split('/').some((p) => p === '' || p === '.' || p === '..')) {
    throw new CliError('VALIDATION', `Refusing the bundle path "${rel}": it leaves the skill directory.`);
  }
  return norm;
}

async function bundleFromServer(ctx: CliContext): Promise<SkillBundle> {
  const index = await ctx.api.definitions.skill();
  if (!Array.isArray(index?.files) || !index.files.length) {
    throw new CliError('NOT_FOUND', 'The server has no workflow authoring skill bundle.', {
      hint: 'Install a local bundle with --from <dir> (a checkout\'s skills/generatorai-workflow-author).',
    });
  }
  const files: SkillBundle['files'] = [];
  for (const file of index.files) {
    files.push({ path: safeBundlePath(file), text: await ctx.api.definitions.skillFile(file) });
  }
  return { name: index.name || WORKFLOW_AUTHOR_SKILL, schemaHash: index.schemaHash, source: ctx.baseUrl || 'the server', files };
}

/** Every file under `dir` except `evals/` (the same set the server serves). */
async function bundleFromDir(dir: string): Promise<SkillBundle> {
  const root = path.resolve(dir);
  try {
    await fs.access(path.join(root, 'SKILL.md'));
  } catch {
    throw new CliError('VALIDATION', `${root} is not a skill bundle (it has no SKILL.md).`);
  }
  const files: SkillBundle['files'] = [];
  const walk = async (rel: string): Promise<void> => {
    for (const entry of await fs.readdir(path.join(root, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (child !== 'evals') await walk(child);
      } else if (entry.isFile()) {
        files.push({ path: child, text: await fs.readFile(path.join(root, child), 'utf8') });
      }
    }
  };
  await walk('');
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { name: WORKFLOW_AUTHOR_SKILL, schemaHash: null, source: root, files };
}

/**
 * Writes the bundle into `skillDir` as one swap: every file goes into a
 * staging directory next to it, then the old directory is moved aside and
 * the staging one renamed into place. An agent never reads a half-written
 * skill, and files a newer bundle dropped do not linger.
 */
async function installBundle(bundle: SkillBundle, skillDir: string): Promise<{ replaced: boolean }> {
  const stamp = `${process.pid}-${Date.now()}`;
  const staging = `${skillDir}.staging-${stamp}`;
  const previous = `${skillDir}.old-${stamp}`;
  try {
    await fs.mkdir(path.dirname(skillDir), { recursive: true });
    for (const file of bundle.files) {
      const target = path.join(staging, ...file.path.split('/'));
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.writeFile(target, file.text, 'utf8');
    }
    let replaced = false;
    try {
      await fs.access(skillDir);
      renameWithRetry(skillDir, previous);
      replaced = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    try {
      renameWithRetry(staging, skillDir);
    } catch (error) {
      if (replaced) renameWithRetry(previous, skillDir);
      throw error;
    }
    if (replaced) await fs.rm(previous, { recursive: true, force: true });
    return { replaced };
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    throw new CliError('INTERNAL', `Could not install the skill into ${skillDir}.`, {
      hint: error instanceof Error ? error.message : String(error),
      cause: error,
    });
  }
}

// ── Codex: where its skills live ────────────────────────────────────

type SkillScope = 'user' | 'repo';

interface FoundSkill {
  /** The skill's SKILL.md (or its directory). */
  path: string;
  scope: SkillScope;
}

/** The skills root a skill lives in: `<root>/<skill>/SKILL.md` → `<root>`. */
function rootOfSkill(skillPath: string): string {
  const dir = path.basename(skillPath).toLowerCase() === 'skill.md' ? path.dirname(skillPath) : skillPath;
  return path.dirname(dir);
}

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

/**
 * The roots holding the most skills of the wanted scope, most first. A
 * `.system` root (Codex's own bundled skills) is never a place to install.
 */
function rankRoots(skills: FoundSkill[], scope: SkillScope, cwd: string): string[] {
  const counts = new Map<string, number>();
  for (const skill of skills) {
    if (skill.scope !== scope) continue;
    const root = path.resolve(rootOfSkill(skill.path));
    if (root.split(path.sep).includes('.system')) continue;
    if (scope === 'repo' && !isInside(root, cwd)) continue;
    counts.set(root, (counts.get(root) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([root]) => root);
}

function codexHome(): string {
  const env = process.env['CODEX_HOME'];
  return env ? path.resolve(env) : path.join(os.homedir(), '.codex');
}

async function isFileAt(candidate: string): Promise<boolean> {
  try {
    return (await fs.stat(candidate)).isFile();
  } catch {
    return false;
  }
}

/** A found Codex entry point → something spawnable (Node refuses to spawn a Windows `.cmd` shim without a shell). */
async function codexCommand(found: string): Promise<{ command: string; args: string[] } | null> {
  const ext = path.extname(found).toLowerCase();
  if (ext === '.js' || ext === '.mjs' || ext === '.cjs') return { command: process.execPath, args: [found] };
  if (ext === '.cmd' || ext === '.bat' || ext === '.ps1') {
    const script = path.join(path.dirname(found), 'node_modules', '@openai', 'codex', 'bin', 'codex.js');
    return (await isFileAt(script)) ? { command: process.execPath, args: [script] } : null;
  }
  return { command: found, args: [] };
}

/** The installed Codex CLI: `CODEX_CLI_PATH` (what the Codex desktop app reads), then PATH, then the macOS app bundle. */
async function resolveCodex(): Promise<{ command: string; args: string[] } | null> {
  const explicit = process.env['CODEX_CLI_PATH']?.trim();
  if (explicit && (await isFileAt(path.resolve(explicit)))) {
    const cmd = await codexCommand(path.resolve(explicit));
    if (cmd) return cmd;
  }
  // On Windows an extensionless `codex` is a POSIX shell shim (pnpm, npm), which cannot be spawned.
  const names = process.platform === 'win32' ? ['codex.exe', 'codex.cmd', 'codex.bat'] : ['codex'];
  for (const dir of (process.env['PATH'] ?? '').split(path.delimiter).filter(Boolean)) {
    for (const name of names) {
      const candidate = path.join(dir, name);
      if (await isFileAt(candidate)) {
        const cmd = await codexCommand(candidate);
        if (cmd) return cmd;
      }
    }
  }
  if (process.platform === 'darwin') {
    for (const base of ['/Applications', path.join(os.homedir(), 'Applications')]) {
      const candidate = path.join(base, 'ChatGPT.app', 'Contents', 'Resources', 'codex');
      if (await isFileAt(candidate)) return { command: candidate, args: [] };
    }
  }
  return null;
}

interface CodexSkillsListResponse {
  data?: Array<{ cwd?: string; skills?: Array<{ path?: string; scope?: string }>; errors?: Array<{ path?: string }> }>;
}

/** How long the whole `codex app-server` exchange may take. */
const CODEX_TIMEOUT_MS = 20_000;

/**
 * Asks the installed Codex for its skills over `codex app-server` JSON-RPC
 * (stdio, one message per line): `initialize`, `initialized`, then
 * `skills/list` for `cwd`. Null when Codex is not installed or does not
 * answer; the reason goes to `notes`.
 */
async function skillsFromCodex(cwd: string, notes: string[]): Promise<FoundSkill[] | null> {
  const codex = await resolveCodex();
  if (!codex) {
    notes.push('The Codex CLI was not found (PATH, CODEX_CLI_PATH).');
    return null;
  }
  const child = spawn(codex.command, [...codex.args, 'app-server'], { cwd, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let nextId = 0;
  const pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
  const failAll = (error: Error) => {
    for (const p of pending.values()) p.reject(error);
    pending.clear();
  };
  child.on('error', (error) => failAll(error));
  child.on('exit', (code) => failAll(new Error(`codex app-server exited (${code ?? 'signal'})`)));
  child.stderr.resume();
  const lines = createInterface({ input: child.stdout, crlfDelay: Infinity });
  const write = (message: Record<string, unknown>) => {
    if (!child.stdin.destroyed) child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', ...message })}\n`);
  };
  lines.on('line', (line) => {
    let msg: { id?: number | string; method?: string; result?: unknown; error?: { message?: string } };
    try {
      msg = JSON.parse(line) as typeof msg;
    } catch {
      return;
    }
    if (msg.id !== undefined && typeof msg.method === 'string') {
      // A request from Codex: nothing here can answer it.
      write({ id: msg.id, error: { code: -32601, message: 'not supported by generatorai skill install' } });
      return;
    }
    if (typeof msg.id !== 'number') return;
    const call = pending.get(msg.id);
    if (!call) return;
    pending.delete(msg.id);
    if (msg.error) call.reject(new Error(msg.error.message ?? 'Codex refused the request'));
    else call.resolve(msg.result);
  });
  const rpc = <T>(method: string, params: unknown): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      const id = ++nextId;
      pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
      write({ id, method, params });
    });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const exchange = (async () => {
      await rpc('initialize', {
        clientInfo: { name: 'generatorai-cli', version: '0.2.0' },
        capabilities: { experimentalApi: true },
      });
      write({ method: 'initialized' });
      return rpc<CodexSkillsListResponse>('skills/list', { cwds: [cwd], forceReload: true });
    })();
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no answer within ${CODEX_TIMEOUT_MS / 1000}s`)), CODEX_TIMEOUT_MS);
    });
    const listed = await Promise.race([exchange, timeout]);
    const skills: FoundSkill[] = [];
    for (const entry of listed?.data ?? []) {
      for (const skill of entry.skills ?? []) {
        if (typeof skill.path === 'string' && (skill.scope === 'user' || skill.scope === 'repo')) {
          skills.push({ path: skill.path, scope: skill.scope });
        }
      }
    }
    return skills;
  } catch (error) {
    notes.push(`codex app-server skills/list failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
    lines.close();
    // Closing stdin ends the app-server; the kill is for one that ignores it.
    child.stdin.end();
    const exited = new Promise<void>((resolve) => {
      if (child.exitCode !== null || child.signalCode !== null) resolve();
      else child.once('exit', () => resolve());
    });
    await Promise.race([exited, new Promise<void>((resolve) => setTimeout(resolve, 3_000).unref())]);
    if (child.exitCode === null && child.signalCode === null) child.kill();
  }
}

/** A TOML basic ("…") or literal ('…') string value. */
function tomlString(raw: string): string | null {
  const basic = /^"((?:[^"\\]|\\.)*)"/.exec(raw);
  if (basic) return basic[1]!.replace(/\\(["\\/bfnrt])/g, (_, c: string) => ({ b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' })[c] ?? c);
  const literal = /^'([^']*)'/.exec(raw);
  return literal ? literal[1]! : null;
}

/**
 * The skill paths `$CODEX_HOME/config.toml` names: `path = …` inside a
 * `[skills…]`/`[[skills…]]` table (`[[skills.config]]` entries point at a
 * SKILL.md), and root arrays (`roots`, `extra_roots`, `paths`), whose
 * entries are skill roots themselves.
 */
async function skillsFromCodexConfig(cwd: string, notes: string[]): Promise<{ skills: FoundSkill[]; roots: string[]; file: string }> {
  const file = path.join(codexHome(), 'config.toml');
  const skills: FoundSkill[] = [];
  const roots: string[] = [];
  let text: string;
  try {
    text = await fs.readFile(file, 'utf8');
  } catch {
    notes.push(`No Codex config at ${file}.`);
    return { skills, roots, file };
  }
  let table = '';
  const scopeOf = (p: string): SkillScope => (isInside(path.resolve(p), cwd) ? 'repo' : 'user');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    const header = /^\[\[?\s*([^\]]+?)\s*\]\]?$/.exec(line);
    if (header) {
      table = header[1]!;
      continue;
    }
    if (!/^skills(\.|$)/.test(table)) continue;
    const kv = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (!kv) continue;
    const [, key, value] = kv as unknown as [string, string, string];
    if (key === 'path') {
      const p = tomlString(value);
      if (p) skills.push({ path: p, scope: scopeOf(p) });
    } else if ((key === 'roots' || key === 'extra_roots' || key === 'paths') && value.startsWith('[')) {
      for (const m of value.slice(1).matchAll(/("(?:[^"\\]|\\.)*"|'[^']*')/g)) {
        const p = tomlString(m[1]!);
        if (p) roots.push(path.resolve(p));
      }
    }
  }
  return { skills, roots, file };
}

/** Where Codex reads skills of this scope, as the installed Codex reports it. */
async function codexSkillRoot(project: boolean, cwd: string): Promise<{ root: string; source: string; others: string[] } | { root: null; notes: string[] }> {
  const scope: SkillScope = project ? 'repo' : 'user';
  const notes: string[] = [];
  const listed = await skillsFromCodex(cwd, notes);
  if (listed) {
    const ranked = rankRoots(listed, scope, cwd);
    if (ranked.length) return { root: ranked[0]!, source: 'codex app-server skills/list', others: ranked.slice(1) };
    notes.push(`Codex lists no ${scope === 'repo' ? 'repository' : 'user'} skill to learn the directory from.`);
  }
  const config = await skillsFromCodexConfig(cwd, notes);
  const ranked = [...new Set([...rankRoots(config.skills, scope, cwd), ...config.roots.filter((r) => (scope === 'repo') === isInside(r, cwd))])];
  if (ranked.length) return { root: ranked[0]!, source: config.file, others: ranked.slice(1) };
  if (config.skills.length || config.roots.length) notes.push(`${config.file} names no ${scope} skill root.`);
  return { root: null, notes };
}

// ── Config snippets ─────────────────────────────────────────────────

function claudeMcpSnippet(project: boolean): string[] {
  const json = JSON.stringify({ mcpServers: { generatorai: { command: MCP_COMMAND, args: MCP_ARGS } } }, null, 2);
  return [
    'Add the GeneratorAI MCP server (tools and the skill as resources):',
    '',
    `  claude mcp add --scope ${project ? 'project' : 'user'} generatorai -- ${MCP_COMMAND} ${MCP_ARGS.join(' ')}`,
    '',
    project ? 'or put this in .mcp.json at the project root:' : 'or the equivalent .mcp.json entry (a project-scoped server):',
    '',
    ...json.split('\n').map((l) => `  ${l}`),
  ];
}

function codexMcpSnippet(): string[] {
  return [
    `Add the GeneratorAI MCP server to ${path.join(codexHome(), 'config.toml')}:`,
    '',
    '  [mcp_servers.generatorai]',
    `  command = "${MCP_COMMAND}"`,
    `  args = [${MCP_ARGS.map((a) => `"${a}"`).join(', ')}]`,
  ];
}

// ── Commands ────────────────────────────────────────────────────────

export function skillCommands(): CommandSpec[] {
  return [
    defineCommand({
      id: 'skill.install',
      group: 'skill',
      verb: 'install',
      summary: 'Install the workflow authoring skill for Claude Code or Codex, and print the MCP config',
      description:
        'Copies the generatorai-workflow-author skill bundle (from the connected server, or --from a local directory) into ' +
        'the agent\'s skill directory and prints the MCP server config to add. Claude Code: .claude/skills/ in the current ' +
        'project (--project) or the home directory. Codex: the skill root the installed Codex reports (codex app-server ' +
        'skills/list, else $CODEX_HOME/config.toml); when it reports none, pass --dir. The skill is replaced as a whole.',
      requiresServer: true,
      sinceVersion: '0.2.0',
      examples: [
        'generatorai skill install --target claude',
        'generatorai skill install --target claude --project',
        'generatorai skill install --target codex',
        'generatorai skill install --target codex --dir ~/.agents/skills',
        'generatorai skill install --target claude --from ./skills/generatorai-workflow-author',
      ],
      args: [],
      flags: [
        { name: 'target', description: 'The agent to install for', type: 'string', choices: TARGETS, required: true },
        { name: 'project', description: 'Install into the current project instead of the user\'s home', type: 'boolean' },
        { name: 'dir', description: 'Skills root to install into (the skill goes into <dir>/generatorai-workflow-author)', type: 'string', completes: 'directory' },
        { name: 'from', description: 'Install this local bundle directory instead of the server\'s', type: 'string', completes: 'directory' },
      ],
      schema: inputSchema(
        {},
        {
          target: z.enum(TARGETS),
          project: z.boolean().optional(),
          dir: z.string().optional(),
          from: z.string().optional(),
        },
      ),
      output: { kind: 'stream' },
      async handler(ctx, { flags }) {
        const target: Target = flags.target;
        const project = Boolean(flags.project);
        const cwd = process.cwd();
        // The bundle first: nothing is asked of Codex or written when there is nothing to install.
        const bundle = flags.from ? await bundleFromDir(flags.from) : await bundleFromServer(ctx);

        let root: string;
        let rootSource: string;
        const notes: string[] = [];
        if (flags.dir) {
          root = path.resolve(flags.dir.replace(/^~(?=$|[\\/])/, os.homedir()));
          rootSource = '--dir';
        } else if (target === 'claude') {
          root = project ? path.join(cwd, '.claude', 'skills') : path.join(os.homedir(), '.claude', 'skills');
          rootSource = project ? 'the project (.claude/skills)' : 'the user (~/.claude/skills)';
        } else {
          const found = await codexSkillRoot(project, cwd);
          if (found.root === null) {
            throw new CliError('USAGE', `Could not learn where Codex reads ${project ? 'repository' : 'user'} skills.`, {
              hint:
                `${found.notes.join(' ')} The directory differs between Codex versions (~/.codex/skills, ~/.agents/skills), so ` +
                'it is not guessed: pass --dir <skills root>.',
              suggestions: ['generatorai skill install --target codex --dir <skills root>'],
            });
          }
          root = found.root;
          rootSource = found.source;
          if (found.others.length) notes.push(`Codex also reads skills from: ${found.others.join(', ')}`);
        }

        const skillDir = path.join(root, bundle.name);
        const { replaced } = await installBundle(bundle, skillDir);

        const snippet = target === 'claude' ? claudeMcpSnippet(project) : codexMcpSnippet();
        const lines = [
          `${replaced ? 'Replaced' : 'Installed'} the ${bundle.name} skill (${bundle.files.length} files) in ${skillDir}`,
          `  bundle from ${bundle.source}${bundle.schemaHash ? `, schema ${bundle.schemaHash.slice(0, 12)}` : ''}; skills root from ${rootSource}`,
          ...notes.map((n) => `  ${n}`),
          '',
          ...snippet,
          '',
          MCP_PAIRING,
        ];
        return {
          data: {
            target,
            scope: project ? 'project' : 'user',
            skillDir,
            rootSource,
            replaced,
            files: bundle.files.map((f) => f.path),
            bundleSource: bundle.source,
            schemaHash: bundle.schemaHash,
            mcp: { name: 'generatorai', command: MCP_COMMAND, args: MCP_ARGS },
          },
          message: lines.join('\n'),
        };
      },
    }),

    defineCommand({
      id: 'skill.print',
      group: 'skill',
      verb: 'print',
      summary: 'Print a file of the workflow authoring skill (SKILL.md by default)',
      description:
        'Prints one file of the generatorai-workflow-author bundle from the connected server (or --from a local directory): ' +
        'SKILL.md, reference/*.md, schema/workflow.schema.json, examples/*.json, scripts/validate.mjs.',
      requiresServer: true,
      sinceVersion: '0.2.0',
      examples: ['generatorai skill print', 'generatorai skill print reference/stages.md', 'generatorai skill print schema/workflow.schema.json > schema.json'],
      args: [{ name: 'path', description: 'Bundle-relative path (default SKILL.md)', required: false }],
      flags: [{ name: 'from', description: 'Read this local bundle directory instead of the server\'s', type: 'string', completes: 'directory' }],
      schema: inputSchema({ path: z.string().optional() }, { from: z.string().optional() }),
      output: { kind: 'raw' },
      async handler(ctx, { args, flags }) {
        const rel = safeBundlePath(args.path ?? 'SKILL.md');
        if (flags.from) {
          return record(await readTextFile(path.join(path.resolve(flags.from), ...rel.split('/')), 'skill file'));
        }
        return record(await ctx.api.definitions.skillFile(rel));
      },
    }),
  ];
}
