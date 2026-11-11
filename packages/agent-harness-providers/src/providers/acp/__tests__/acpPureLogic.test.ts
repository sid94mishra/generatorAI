// docs/acp — the pure logic the ACP provider and installer rest on: config options → models,
// platform keys and distribution choice, registry parse tolerance, icon sanitising, cmd
// normalisation, zip-slip, and Windows `.cmd` wrapping.

import { describe, expect, it } from 'vitest';
import path from 'node:path';
import { configOptionsToModels, findSelectOption, matchSelectValue, planModeValue, type AcpConfigOption } from '../configOptions.js';
import {
  isPathInside,
  posixCommandLine,
  powershellCommandLine,
  quoteCmdArg,
  resolveAgentCmd,
  resolveSpawnTarget,
  safeArchiveEntryPath,
} from '../launch.js';
import { acpPlatformKey, binaryTargetFor, isMuslLinux, pickDistribution } from '../registry/platform.js';
import { parseAcpRegistry, type AcpRegistryAgent } from '../registry/schema.js';
import { sanitizeSvgIcon } from '../registry/iconSanitizer.js';
import { archiveKindOf, parsePackageSpec, versionDirName } from '../registry/installer.js';
import { acpModelId, splitAcpModelId } from '../AcpProvider.js';

const MODEL: AcpConfigOption = {
  type: 'select',
  id: 'model',
  name: 'Model',
  category: 'model',
  currentValue: 'b',
  options: [
    { group: 'g1', name: 'Group one', options: [{ value: 'a', name: 'A', description: 'first' }] },
    { group: 'g2', name: 'Group two', options: [{ value: 'b', name: 'B' }, { value: 'a', name: 'A again' }] },
  ],
};
const EFFORT: AcpConfigOption = {
  type: 'select',
  id: 'think',
  name: 'Thinking',
  category: 'thought_level',
  currentValue: 'high',
  options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }],
};

describe('config options → models (ACP-2)', () => {
  it('flattens groups in order, de-duplicates values, marks the current one and keeps the group as category', () => {
    const models = configOptionsToModels([MODEL, EFFORT], { agentLabel: 'Gemini' });
    expect(models.map((m) => m.id)).toEqual(['a', 'b']);
    expect(models[0]).toMatchObject({ name: 'A', description: 'first', category: 'Group one' });
    expect(models[0]!.isDefault).toBeUndefined();
    expect(models[1]).toMatchObject({ isDefault: true, category: 'Group two' });
  });

  it('puts thought_level on the current model only (its levels depend on the model)', () => {
    const [a, b] = configOptionsToModels([MODEL, EFFORT], { agentLabel: 'X' });
    expect(a!.reasoningEfforts).toBeUndefined();
    expect(b).toMatchObject({ supportsReasoning: true, reasoningEfforts: ['low', 'high'], defaultReasoningEffort: 'high' });
  });

  it('an agent with no model option offers its default model', () => {
    expect(configOptionsToModels([], { agentLabel: 'Goose' })).toEqual([{ id: '', name: "Goose (agent's default model)", isDefault: true }]);
    expect(configOptionsToModels(null, { agentLabel: 'Goose' })).toHaveLength(1);
  });

  it('finds options by category first, then by id when the agent sent no category', () => {
    const uncategorised: AcpConfigOption = { ...MODEL, category: null };
    expect(findSelectOption([uncategorised], 'model')?.id).toBe('model');
    const custom: AcpConfigOption = { ...MODEL, id: 'llm', category: null };
    expect(findSelectOption([custom], 'model')).toBeUndefined();
    // Array order is the agent's priority.
    const second: AcpConfigOption = { ...MODEL, id: 'model2' };
    expect(findSelectOption([MODEL, second], 'model')?.id).toBe('model');
    // A boolean option is never a select.
    expect(findSelectOption([{ type: 'boolean', id: 'model', name: 'x', currentValue: true }], 'model')).toBeUndefined();
  });

  it('matches values exactly, then case-insensitively by value or name; finds a plan mode', () => {
    expect(matchSelectValue(MODEL as Extract<AcpConfigOption, { type: 'select' }>, 'b')).toBe('b');
    expect(matchSelectValue(EFFORT as Extract<AcpConfigOption, { type: 'select' }>, 'HIGH')).toBe('high');
    expect(matchSelectValue(EFFORT as Extract<AcpConfigOption, { type: 'select' }>, 'medium')).toBeUndefined();
    const mode = { type: 'select', id: 'm', name: 'Mode', currentValue: 'code', options: [{ value: 'code', name: 'Code' }, { value: 'architect', name: 'Plan (read-only)' }] } as const;
    expect(planModeValue({ ...mode, options: [...mode.options] })).toBe('architect');
  });

  it('model ids name their agent', () => {
    expect(acpModelId('gemini', 'gemini-2.5-pro')).toBe('gemini/gemini-2.5-pro');
    expect(acpModelId('goose', '')).toBe('goose');
    expect(splitAcpModelId('opencode/anthropic/claude')).toEqual({ agentId: 'opencode', value: 'anthropic/claude' });
    expect(splitAcpModelId('goose')).toEqual({ agentId: 'goose', value: '' });
  });
});

describe('platform key and distribution choice (ACP-6)', () => {
  const agent = (binary: AcpRegistryAgent['distribution']['binary'], npx = false, uvx = false): AcpRegistryAgent => ({
    id: 'x', name: 'X', version: '1.0.0', description: '',
    distribution: {
      ...(binary ? { binary } : {}),
      ...(npx ? { npx: { package: 'x@1.0.0' } } : {}),
      ...(uvx ? { uvx: { package: 'x==1.0.0' } } : {}),
    },
  });
  const target = (name: string) => ({ archive: `https://e.x/${name}.tar.gz`, cmd: './x' });

  it('maps OS/arch, and adds -musl on a musl Linux only', () => {
    expect(acpPlatformKey('darwin', 'arm64', false)).toBe('darwin-aarch64');
    expect(acpPlatformKey('win32', 'x64', false)).toBe('windows-x86_64');
    expect(acpPlatformKey('linux', 'x64', false)).toBe('linux-x86_64');
    expect(acpPlatformKey('linux', 'arm64', true)).toBe('linux-aarch64-musl');
    expect(acpPlatformKey('darwin', 'x64', true)).toBe('darwin-x86_64');
    expect(acpPlatformKey('freebsd', 'x64', false)).toBeNull();
    expect(acpPlatformKey('linux', 'ia32', false)).toBeNull();
  });

  it('detects musl from the absence of glibcVersionRuntime', () => {
    expect(isMuslLinux('linux', undefined)).toBe(true);
    expect(isMuslLinux('linux', '2.39')).toBe(false);
    expect(isMuslLinux('darwin', undefined)).toBe(false);
  });

  it('musl never falls back to a glibc build; glibc may use a static musl build', () => {
    const glibcOnly = agent({ 'linux-x86_64': target('gnu') });
    expect(binaryTargetFor(glibcOnly, 'linux-x86_64-musl')).toBeNull();
    expect(pickDistribution(glibcOnly, 'linux-x86_64-musl')).toEqual({ kind: null, reason: expect.stringContaining('musl') });
    const muslOnly = agent({ 'linux-x86_64-musl': target('musl') });
    expect(binaryTargetFor(muslOnly, 'linux-x86_64')?.key).toBe('linux-x86_64-musl');
    const both = agent({ 'linux-x86_64': target('gnu'), 'linux-x86_64-musl': target('musl') });
    expect(binaryTargetFor(both, 'linux-x86_64')?.key).toBe('linux-x86_64');
    expect(binaryTargetFor(both, 'linux-x86_64-musl')?.key).toBe('linux-x86_64-musl');
  });

  it('prefers a binary for this platform, then npx; uvx is unsupported', () => {
    expect(pickDistribution(agent({ 'darwin-aarch64': target('m') }, true), 'darwin-aarch64').kind).toBe('binary');
    expect(pickDistribution(agent({ 'darwin-aarch64': target('m') }, true), 'windows-x86_64').kind).toBe('npx');
    expect(pickDistribution(agent(undefined, false, true), 'darwin-aarch64')).toEqual({ kind: null, reason: expect.stringContaining('uv') });
    expect(pickDistribution(agent({ 'darwin-aarch64': target('m') }), 'windows-x86_64')).toEqual({ kind: null, reason: expect.stringContaining('windows-x86_64') });
  });
});

describe('registry parse tolerance (ACP-4)', () => {
  it('keeps valid agents, skips malformed ones and bad targets, ignores unknown keys and platforms', () => {
    const { index, skipped } = parseAcpRegistry({
      version: '1.0.0',
      extensions: [],
      agents: [
        { id: 'good', name: 'Good', version: '1.0.0', description: 'd', future: true, distribution: { npx: { package: 'good@1.0.0', args: ['--acp'] } } },
        { id: 'Bad Id', name: 'x', version: '1', description: '', distribution: { npx: { package: 'x' } } },
        { name: 'no id', version: '1', distribution: {} },
        {
          id: 'mixed', name: 'Mixed', version: '2.0.0', description: '',
          distribution: {
            binary: {
              'darwin-aarch64': { archive: 'https://e.x/a.zip', cmd: './a', sha256: 'not-a-sha' },
              'linux-x86_64': { archive: 'not a url', cmd: './a' },
              'solaris-sparc': { archive: 'https://e.x/s.zip', cmd: './s' },
            },
          },
        },
        { id: 'empty', name: 'Empty', version: '1.0.0', description: '', distribution: { binary: {} } },
        { id: 'good', name: 'Dup', version: '1.0.0', description: '', distribution: { npx: { package: 'g@1' } } },
        'garbage',
      ],
    });
    expect(index.agents.map((a) => a.id)).toEqual(['good', 'mixed']);
    // An invalid sha256 is dropped (the install is then labelled unverified), the target is kept.
    expect(index.agents[1]!.distribution.binary?.['darwin-aarch64']).toEqual({ archive: 'https://e.x/a.zip', cmd: './a' });
    expect(index.agents[1]!.distribution.binary?.['linux-x86_64']).toBeUndefined();
    expect(skipped.join('\n')).toMatch(/Bad Id/);
    expect(skipped.join('\n')).toMatch(/linux-x86_64 is malformed/);
    expect(skipped.join('\n')).toMatch(/empty: no usable distribution/);
    expect(skipped.join('\n')).toMatch(/good: listed twice/);
  });

  it('refuses a body that is not an index', () => {
    expect(() => parseAcpRegistry({ nope: true })).toThrow(/agents/);
    expect(() => parseAcpRegistry(null)).toThrow();
  });
});

describe('icon sanitiser (ACP-5)', () => {
  it('keeps allowed geometry and currentColor paint, takes the viewBox', () => {
    const mark = sanitizeSvgIcon(
      '<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 1200 1200"><title>x</title>' +
        '<path fill="currentColor" d="M0 0L10 10Z" onclick="alert(1)"/><circle cx="1" cy="2" r="3" stroke="currentColor"/></svg>',
    );
    expect(mark).toEqual({
      viewBox: '0 0 1200 1200',
      nodes: [
        { tag: 'path', attrs: { fill: 'currentColor', d: 'M0 0L10 10Z' } },
        { tag: 'circle', attrs: { cx: '1', cy: '2', r: '3', stroke: 'currentColor' } },
      ],
    });
  });

  it('drops scripts, styles, text, use/href, foreign objects and hard-coded colours', () => {
    const mark = sanitizeSvgIcon(
      '<svg viewBox="0 0 16 16" fill="currentColor">' +
        '<script>alert(1)</script><style>path{fill:red}</style><text x="1">Hi</text>' +
        '<use href="https://evil/x.svg#a"/><foreignObject><div/></foreignObject><image href="https://evil/i.png"/>' +
        '<g transform="translate(1,2) scale(2)"><rect x="0" y="0" width="4" height="4" fill="#ff0000" style="fill:red"/></g>' +
        '<path d="M0 0 L javascript:alert(1)"/><polygon points="0,0 1,1 2,0" fill="none"/></svg>',
    );
    expect(mark).toEqual({
      viewBox: '0 0 16 16',
      nodes: [
        {
          tag: 'g',
          attrs: { fill: 'currentColor' },
          children: [
            { tag: 'g', attrs: { transform: 'translate(1,2) scale(2)' }, children: [{ tag: 'rect', attrs: { x: '0', y: '0', width: '4', height: '4' } }] },
            // The path's d failed the pattern, so the attribute is gone (the element draws nothing but is harmless).
            { tag: 'path', attrs: {} },
            { tag: 'polygon', attrs: { points: '0,0 1,1 2,0', fill: 'none' } },
          ],
        },
      ],
    });
  });

  it('falls back to width/height for the viewBox, and refuses non-SVG, malformed or empty input', () => {
    expect(sanitizeSvgIcon('<svg width="24" height="24"><path d="M1 1"/></svg>')?.viewBox).toBe('0 0 24 24');
    expect(sanitizeSvgIcon('<html><path d="M1 1"/></html>')).toBeNull();
    expect(sanitizeSvgIcon('<svg><path d="M1 1"></svg>')).toBeNull();
    expect(sanitizeSvgIcon('<svg viewBox="0 0 16 16"><text>A</text></svg>')).toBeNull();
    expect(sanitizeSvgIcon('<!DOCTYPE svg [<!ENTITY x SYSTEM "file:///etc/passwd">]><svg>&x;</svg>')).toBeNull();
  });
});

describe('cmd normalisation, zip-slip and Windows wrapping (ACP-6)', () => {
  const root = path.resolve('/tmp/agents/goose/1.0.0');

  it('resolves registry commands with either separator inside the install directory', () => {
    expect(resolveAgentCmd(root, './goose-package\\goose.exe')).toBe(path.join(root, 'goose-package', 'goose.exe'));
    expect(resolveAgentCmd(root, 'harn.exe')).toBe(path.join(root, 'harn.exe'));
    expect(resolveAgentCmd(root, './dist-package/cursor-agent')).toBe(path.join(root, 'dist-package', 'cursor-agent'));
    for (const bad of ['../goose', './a/../../b', '/usr/bin/sh', 'C:\\Windows\\cmd.exe', '\\\\server\\share\\x', '', './']) {
      expect(() => resolveAgentCmd(root, bad), bad).toThrow();
    }
  });

  it('refuses archive entries that are absolute, drive-relative or climb out', () => {
    expect(safeArchiveEntryPath(root, 'bin/goose')).toBe(path.join(root, 'bin', 'goose'));
    expect(safeArchiveEntryPath(root, 'dir/')).toBe(path.join(root, 'dir'));
    expect(safeArchiveEntryPath(root, './a/./b')).toBe(path.join(root, 'a', 'b'));
    for (const bad of ['../evil', 'a/../../evil', '/etc/passwd', 'C:/x', 'c:x', '\\evil', 'a\\..\\..\\evil', 'a\0b', '.', '']) {
      expect(safeArchiveEntryPath(root, bad), JSON.stringify(bad)).toBeNull();
    }
    expect(isPathInside(root, path.join(root, 'x'))).toBe(true);
    expect(isPathInside(root, root)).toBe(false);
    expect(isPathInside(root, `${root}-other/x`)).toBe(false);
  });

  it('spawns everything directly except Windows batch files, which go through cmd.exe /d /s /c', () => {
    expect(resolveSpawnTarget('/opt/a/goose', ['acp'], 'linux')).toEqual({ file: '/opt/a/goose', args: ['acp'] });
    expect(resolveSpawnTarget('C:\\a\\goose.exe', ['acp'], 'win32')).toEqual({ file: 'C:\\a\\goose.exe', args: ['acp'] });
    // A .cmd elsewhere is not special.
    expect(resolveSpawnTarget('/x/agent.cmd', [], 'darwin').file).toBe('/x/agent.cmd');
    const t = resolveSpawnTarget('C:\\Program Files\\Agent\\cursor-agent.cmd', ['--acp', 'a b', 'x&y'], 'win32', 'C:\\Windows\\System32\\cmd.exe');
    expect(t.file).toBe('C:\\Windows\\System32\\cmd.exe');
    expect(t.windowsVerbatimArguments).toBe(true);
    expect(t.args.slice(0, 3)).toEqual(['/d', '/s', '/c']);
    // The command's space and every argument's quotes and metacharacters are caret-escaped (args twice).
    expect(t.args[3]).toBe('"C:\\Program^ Files\\Agent\\cursor-agent.cmd ^^^"--acp^^^" ^^^"a^^^ b^^^" ^^^"x^^^&y^^^""');
  });

  it('refuses arguments cmd.exe cannot pass to a batch file literally', () => {
    for (const bad of ['a"b', '%PATH%', 'a\nb']) expect(() => quoteCmdArg(bad), bad).toThrow(/cmd\.exe/);
    expect(() => resolveSpawnTarget('C:\\a\\x.bat', ['50%'], 'win32')).toThrow();
    // Trailing backslashes are doubled before the closing quote (MSVCRT).
    expect(quoteCmdArg('C:\\dir\\')).toBe('^^^"C:\\dir\\\\^^^"');
  });

  it('renders the terminal sign-in for POSIX shells and PowerShell', () => {
    expect(posixCommandLine('/opt/a b/agent', ['--login', "it's"], { MODE: 'x y', 'BAD-NAME': 'z' }))
      .toBe("MODE='x y' '/opt/a b/agent' --login 'it'\\''s'");
    expect(powershellCommandLine('C:\\a\\agent.exe', ['--login'], { MODE: "it's" }))
      .toBe("$env:MODE='it''s'; & 'C:\\a\\agent.exe' '--login'");
  });
});

describe('installer helpers', () => {
  it('classifies archives by URL and refuses installers', () => {
    expect(archiveKindOf('https://x/a.zip')).toBe('zip');
    expect(archiveKindOf('https://x/a.tar.gz?x=1')).toBe('tar.gz');
    expect(archiveKindOf('https://x/a.tgz')).toBe('tar.gz');
    expect(archiveKindOf('https://x/a.tar.bz2')).toBe('tar.bz2');
    expect(archiveKindOf('https://x/sigit-linux-arm64')).toBe('raw');
    expect(archiveKindOf('https://x/sigit-win-x64.exe')).toBe('raw');
    for (const bad of ['https://x/a.dmg', 'https://x/a.tar.xz', 'https://x/a.msi', 'https://x/a.tar', 'nope']) expect(archiveKindOf(bad)).toBeNull();
  });

  it('parses package specs and makes version directory names safe', () => {
    expect(parsePackageSpec('@google/gemini-cli@0.68.0')).toEqual({ name: '@google/gemini-cli', version: '0.68.0' });
    expect(parsePackageSpec('cline@3.0.74')).toEqual({ name: 'cline', version: '3.0.74' });
    expect(parsePackageSpec('@scope/pkg')).toEqual({ name: '@scope/pkg' });
    expect(versionDirName('2026.11.05')).toBe('2026.11.05');
    expect(versionDirName('1.0/../x')).toBe('1.0_.._x');
    expect(versionDirName('..')).not.toBe('..');
  });
});
