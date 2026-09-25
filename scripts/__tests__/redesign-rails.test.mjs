// Fixture tests for the redesign rails (docs/redesign/09-verification.md §2,
// P0 review R4): the design-system ratchet, the stories-present check, the
// board flattener and the ESLint layer rules. Every fixture lives under
// os.tmpdir() and is removed afterwards; nothing is written into the checkout.
//
// Runs under the root vitest "node" project:
//   pnpm exec vitest run --project node scripts/__tests__/redesign-rails.test.mjs

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ESLint } from 'eslint';
import { findMissingStories, isComponentSource } from '../../apps/web/scripts/check-stories.mjs';
import { flattenBoard } from '../redesign/render-boards.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RATCHET = path.join(REPO, 'apps', 'web', 'scripts', 'check-design-system.mjs');

const tempDirs = [];
function tempDir(prefix) {
  // realpath: macOS hands out /var/… which is a symlink to /private/var/….
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
  tempDirs.push(dir);
  return dir;
}
function put(root, rel, content) {
  const file = path.join(root, ...rel.split('/'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}
afterAll(() => {
  for (const dir of tempDirs) fs.rmSync(dir, { recursive: true, force: true });
});

// ── 1. Ratchet (check-design-system.mjs --web-dir) ─────────────────────────

describe('design-system ratchet', () => {
  let web;
  const run = (...flags) => {
    const r = spawnSync(process.execPath, [RATCHET, `--web-dir=${web}`, ...flags], { encoding: 'utf8' });
    return { status: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const baseline = () => JSON.parse(fs.readFileSync(path.join(web, 'design-system-baseline.json'), 'utf8'));
  const legacy = (n) =>
    put(web, 'src/components/Legacy.tsx', `export const Legacy = () => (\n  <div>\n${'    <span className="text-xs" />\n'.repeat(n)}  </div>\n);\n`);

  beforeAll(() => {
    web = tempDir('rails-ratchet-');
    // legacyTokenUtility reads the @theme inline block; one legacy key is enough.
    put(web, 'src/styles/globals.css', '@theme inline {\n  --color-background: var(--background);\n  --color-surface: var(--gai-surface);\n}\n');
    legacy(2);
  });

  it('--update writes the baseline and locks every zero rule', () => {
    const r = run('--update');
    expect(r.status, r.out).toBe(0);
    const b = baseline();
    expect(b.counts).toEqual({ defaultTextSize: 2 });
    expect(b.locked).toContain('rawButtonElement');
    expect(b.locked).not.toContain('defaultTextSize');
    expect(run('--strict').status).toBe(0);
  });

  it('a rise fails with file:line, and --update never raises the baseline', () => {
    legacy(3);
    const r = run();
    expect(r.status).toBe(1);
    expect(r.out).toContain('defaultTextSize: 2 → 3');
    expect(r.out).toContain('src/components/Legacy.tsx  (2 → 3)');
    expect(r.out).toMatch(/src\/components\/Legacy\.tsx:5 {2}text-xs/);

    expect(run('--update').status).toBe(1);
    expect(baseline().counts.defaultTextSize).toBe(2);
  });

  it('a fall passes, fails under --strict, and --update locks it in', () => {
    legacy(1);
    const loose = run();
    expect(loose.status, loose.out).toBe(0);
    expect(loose.out).toContain('improved');
    expect(run('--strict').status).toBe(1);
    expect(run('--update').status).toBe(0);
    expect(baseline().counts.defaultTextSize).toBe(1);
    expect(run('--strict').status).toBe(0);
  });

  it('a rule that reaches 0 is locked, and any later hit fails', () => {
    legacy(0);
    expect(run('--update').status).toBe(0);
    expect(baseline().locked).toContain('defaultTextSize');
    expect(baseline().counts.defaultTextSize).toBeUndefined();
    legacy(1);
    const r = run();
    expect(r.status).toBe(1);
    expect(r.out).toContain('defaultTextSize: locked at 0 → 1');
    legacy(0);
  });

  it('the redesign folders are hard-zero (not baselined)', () => {
    put(web, 'src/features/alpha/Page.tsx', 'export const Page = () => <div style={{ width: 240 }} />;\n');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.out).toContain('literalInlineStyle: 1 in src/{ui,blocks,features,app} (must be 0)');
    put(web, 'src/features/alpha/Page.tsx', 'export const Page = ({ w }: { w: number }) => <div style={{ width: w }} />;\n');
    expect(run().status).toBe(0);
    fs.rmSync(path.join(web, 'src', 'features'), { recursive: true });
  });

  it('stories may use raw elements and arbitrary values but not off-system vocabulary (D-45)', () => {
    put(web, 'src/ui/primitives/Button/Button.tsx', 'export function Button() {\n  return <button className="bg-accent" />;\n}\n');
    put(
      web,
      'src/ui/primitives/Button/Button.stories.tsx',
      'export const Matrix = () => (\n  <div className="w-[437px]">\n    <button>demo</button>\n    <input />\n  </div>\n);\n',
    );
    const ok = run();
    expect(ok.status, ok.out).toBe(0);
    put(web, 'src/ui/primitives/Button/Button.stories.tsx', 'export const Matrix = () => <div className="text-sm" />;\n');
    const bad = run();
    expect(bad.status).toBe(1);
    expect(bad.out).toContain('Button.stories.tsx:1');
    fs.rmSync(path.join(web, 'src', 'ui'), { recursive: true });
  });

  it('a kit component without a story fails storiesPresent', () => {
    put(web, 'src/ui/patterns/Card.tsx', 'function Card() {\n  return null;\n}\n\nexport { Card };\n');
    const r = run();
    expect(r.status).toBe(1);
    expect(r.out).toContain('storiesPresent: 1 kit component file(s)');
    fs.rmSync(path.join(web, 'src', 'ui'), { recursive: true });
  });
});

// ── 2. Stories-present ─────────────────────────────────────────────────────

describe('findMissingStories', () => {
  it('detects the component shapes, including the shadcn CLI one', () => {
    expect(isComponentSource('function Button(props) {\n  return null;\n}\n\nexport { Button, buttonVariants };\n')).toBe(true);
    expect(isComponentSource('export function Card() {}')).toBe(true);
    expect(isComponentSource('export const Row: FC<Props> = () => null;')).toBe(true);
    expect(isComponentSource('export default function Page() {}')).toBe(true);
    expect(isComponentSource('export class Boundary extends Component {}')).toBe(true);
    expect(isComponentSource("export { Button } from './Button';\nexport * from './Menu';\n")).toBe(false);
    expect(isComponentSource('const SIZES = {};\nexport const sizeOf = () => 1;\n')).toBe(false);
    expect(isComponentSource('function Local() {}\n')).toBe(false);
  });

  it('lists kit component files without a sibling story', () => {
    const web = tempDir('rails-stories-');
    put(web, 'src/ui/primitives/Button/Button.tsx', 'function Button() {\n  return null;\n}\nexport { Button };\n');
    put(web, 'src/ui/primitives/Button/index.tsx', "export { Button } from './Button';\n");
    put(web, 'src/ui/primitives/Kbd/Kbd.tsx', 'export function Kbd() {\n  return null;\n}\n');
    put(web, 'src/ui/primitives/Kbd/Kbd.stories.tsx', 'export default {};\n');
    put(web, 'src/ui/patterns/__tests__/Card.tsx', 'export function Card() {}\n');
    put(web, 'src/ui/shell/Rail.test.tsx', 'export function Rail() {}\n');
    put(web, 'src/ui/lib/Helper.tsx', 'export function Helper() {}\n'); // not a kit folder
    expect(findMissingStories(web)).toEqual(['src/ui/primitives/Button/Button.tsx']);
  });
});

// ── 3. Board flattener ─────────────────────────────────────────────────────

describe('flattenBoard', () => {
  const source = fs.readFileSync(path.join(REPO, 'docs', 'redesign', 'boards', 'web', 'Home.dc.html'), 'utf8');

  it('flattens a real board into standalone HTML', () => {
    const { html, width, height } = flattenBoard(source, { mode: 'light', accent: 'ink' });
    expect([width, height]).toEqual([1440, 900]);
    expect(html.startsWith('<!doctype html>')).toBe(true);
    expect(html).toContain('t-light acc-ink');
    for (const marker of ['{{', '<x-', '<helmet', 'text/x-dc']) expect(html).not.toContain(marker);
  });

  it('rejects an extra board prop', () => {
    const bad = source.replace(`data-props='{`, `data-props='{"density":{"editor":"enum"},`);
    expect(() => flattenBoard(bad, { mode: 'dark', accent: 'ink' })).toThrow(/unexpected board props: density/);
  });

  it('rejects a board without <helmet>', () => {
    const bad = source.replace(/<helmet>[\s\S]*?<\/helmet>/, '');
    expect(() => flattenBoard(bad, { mode: 'dark', accent: 'ink' })).toThrow(/missing <helmet>/);
  });

  it('rejects a leftover placeholder', () => {
    const bad = source.replace('{{rootClass}}', '{{rootClass}} {{density}}');
    expect(() => flattenBoard(bad, { mode: 'dark', accent: 'ink' })).toThrow(/unexpected "\{\{" left/);
  });
});

// ── 4. ESLint layers (root eslint.config.mjs) ──────────────────────────────
//
// Import targets must exist for the resolver to classify them, so the targets
// live in a temp apps/web-shaped tree, and the real config is pointed at it
// (root-path + resolver project). The linted source itself is virtual.

describe('ESLint layer rules', () => {
  let root;
  let eslint;

  beforeAll(() => {
    root = tempDir('rails-eslint-');
    put(root, 'apps/web/tsconfig.eslint.json', JSON.stringify({ compilerOptions: { baseUrl: '.', paths: { '@/*': ['./src/*'] }, jsx: 'react-jsx' } }));
    for (const f of ['ui/Y.tsx', 'blocks/Y.tsx', 'features/alpha/Y.tsx', 'features/beta/Y.tsx', 'app/Y.tsx', 'platform/Y.ts', 'stores/Y.ts', 'zzunknown/Y.ts']) {
      put(root, `apps/web/src/${f}`, 'export const a = 1;\n');
    }
    eslint = new ESLint({
      cwd: root,
      overrideConfigFile: path.join(REPO, 'eslint.config.mjs'),
      overrideConfig: {
        settings: {
          'boundaries/root-path': root,
          'import/resolver': { typescript: { project: path.join(root, 'apps', 'web', 'tsconfig.eslint.json') } },
        },
      },
    });
  });

  /** Error rule ids for `source` linted as apps/web/src/<from>. */
  async function errors(from, source) {
    const [result] = await eslint.lintText(source, { filePath: path.join(root, 'apps', 'web', 'src', ...from.split('/')) });
    return result.messages.filter((m) => m.severity === 2).map((m) => m.ruleId);
  }
  const importing = (to) => `import { a } from '${to}';\nexport const X = a;\n`;

  it.each([
    ['ui/X.tsx', '@/stores/Y', 'boundaries/dependencies'],
    ['ui/X.tsx', '@/zzunknown/Y', 'boundaries/no-unknown-dependencies'],
    ['features/alpha/X.tsx', '@/features/beta/Y', 'boundaries/dependencies'],
    ['features/alpha/X.tsx', '@/platform/Y', 'boundaries/dependencies'],
    ['features/alpha/X.tsx', '@/zzunknown/Y', 'boundaries/no-unknown-dependencies'],
    ['blocks/X.tsx', '@/features/alpha/Y', 'boundaries/dependencies'],
    ['features/alpha/X.tsx', '@tanstack/react-query', 'no-restricted-imports'],
    ['features/alpha/X.tsx', '../../providers/PlatformProvider', 'no-restricted-imports'],
  ])('%s → %s fails (%s)', async (from, to, rule) => {
    expect(await errors(from, importing(to))).toContain(rule);
  }, 60_000);

  it.each([
    ['app/X.tsx', '@/features/alpha/Y'],
    ['features/alpha/X.tsx', '@/features/alpha/Y'],
    ['ui/X.tsx', '@/ui/Y'],
  ])('%s → %s passes', async (from, to) => {
    expect(await errors(from, importing(to))).toEqual([]);
  }, 60_000);

  it('a file in an undeclared folder fails', async () => {
    expect(await errors('zzunknown/Z.ts', 'export const z = 1;\n')).toContain('boundaries/no-unknown-files');
  }, 60_000);

  it('features may import types from react-query', async () => {
    expect(await errors('features/alpha/X.tsx', "import type { UseQueryResult } from '@tanstack/react-query';\nexport type X = UseQueryResult;\n")).toEqual([]);
  }, 60_000);

  it('an off-system Tailwind class in ui/ fails', async () => {
    expect(await errors('ui/X.tsx', 'export const X = () => <div className="text-sm" />;\n')).toContain('better-tailwindcss/no-restricted-classes');
  }, 60_000);

  it('raw elements fail in ui/ but not in ui/primitives or stories (D-43, D-45)', async () => {
    const raw = 'export const X = () => <div className="w-[437px]"><button type="button" /></div>;\n';
    expect(await errors('ui/X.tsx', raw)).toContain('no-restricted-syntax');
    expect(await errors('ui/primitives/Button/Button.tsx', 'export const X = () => <button type="button" />;\n')).toEqual([]);
    expect(await errors('ui/primitives/Button/Button.stories.tsx', raw)).toEqual([]);
  }, 60_000);
});
