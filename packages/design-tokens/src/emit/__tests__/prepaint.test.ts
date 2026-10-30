// The generated pre-paint script (02 §10.6, §11.2) against the TypeScript rule
// it inlines (`readStoredAppearance`): run the emitted ES5 with a stub
// localStorage / matchMedia / <html>, over a matrix of stored values, and
// require the same attributes. Any drift between first paint and the hydrated
// app is a flash; this is where it would show up.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { readStoredAppearance } from '../../appearance.js';
import {
  ACCENT_STORAGE_KEY,
  DENSITY_STORAGE_KEY,
  FONT_SIZE_STORAGE_KEY,
  MODE_STORAGE_KEY,
  REDUCE_MOTION_STORAGE_KEY,
  THEME_STORAGE_KEY,
} from '../../registry.js';
import { THEMES } from '../../themes/index.js';
import {
  PREPAINT_END,
  PREPAINT_START,
  emitPrepaint,
  emitPrepaintScript,
  prepaintCspHash,
  splicePrepaint,
} from '../prepaint.js';

interface Env {
  storage: Record<string, string>;
  systemDark?: boolean;
  systemReducedMotion?: boolean;
  /** localStorage access throws (privacy mode). */
  storageThrows?: boolean;
  /** `window.generatoraiDesktop.chrome` (desktop shell); absent in a browser tab. */
  chrome?: Record<string, unknown>;
}

interface Painted {
  classes: string[];
  attrs: Record<string, string>;
  vars?: Record<string, string>;
}

function runPrepaint(env: Env): Painted {
  const classes = new Set<string>(['stale-class', 'light']);
  const attrs: Record<string, string> = {};
  const vars: Record<string, string> = {};
  const documentElement = {
    style: { setProperty: (k: string, v: string) => (vars[k] = v) },
    classList: {
      add: (...c: string[]) => c.forEach((x) => classes.add(x)),
      remove: (...c: string[]) => c.forEach((x) => classes.delete(x)),
    },
    setAttribute: (k: string, v: string) => {
      attrs[k] = String(v);
    },
  };
  const localStorage = {
    getItem: (k: string) => {
      if (env.storageThrows) throw new Error('SecurityError');
      return Object.prototype.hasOwnProperty.call(env.storage, k) ? env.storage[k]! : null;
    },
  };
  const matchMedia = (q: string) => ({
    matches: q.includes('color-scheme') ? Boolean(env.systemDark) : Boolean(env.systemReducedMotion),
  });
  const window = env.chrome ? { generatoraiDesktop: { chrome: env.chrome } } : {};
  new Function('document', 'localStorage', 'matchMedia', 'window', emitPrepaintScript())(
    { documentElement },
    localStorage,
    matchMedia,
    window,
  );
  classes.delete('stale-class');
  return { classes: [...classes].sort(), attrs, ...(Object.keys(vars).length ? { vars } : {}) };
}

/** What the TypeScript rule says the same storage should paint. */
function expected(env: Env): Painted {
  const s = readStoredAppearance((k) => (env.storageThrows ? null : (env.storage[k] ?? null)));
  const resolved = s.mode === 'system' ? (env.systemDark ? 'dark' : 'light') : s.mode;
  const attrs: Record<string, string> = {
    'data-mode': s.mode,
    'data-theme': s.theme,
    'data-accent': s.accent,
    'data-density': s.density,
    'data-font-size': s.fontSize,
    'data-layout': 'native',
  };
  if (s.reduceMotion === 'on' || env.systemReducedMotion) attrs['data-motion'] = 'reduce';
  return { classes: [resolved], attrs };
}

const cases: Array<[string, Env]> = [
  ['cleared storage → dark instrument ink comfortable 13', { storage: {} }],
  ['storage throws → defaults', { storage: { [MODE_STORAGE_KEY]: 'light' }, storageThrows: true }],
  ['github light, no stored accent → github default accent (blue), not ink', {
    storage: { [THEME_STORAGE_KEY]: 'github', [MODE_STORAGE_KEY]: 'light' },
  }],
  ['github + explicit ink', { storage: { [THEME_STORAGE_KEY]: 'github', [ACCENT_STORAGE_KEY]: 'ink' } }],
  ['removed theme id → instrument', { storage: { [THEME_STORAGE_KEY]: 'monokai', [ACCENT_STORAGE_KEY]: 'teal' } }],
  ['junk values everywhere', {
    storage: {
      [MODE_STORAGE_KEY]: 'sepia',
      [ACCENT_STORAGE_KEY]: 'magenta',
      [DENSITY_STORAGE_KEY]: 'cosy',
      [FONT_SIZE_STORAGE_KEY]: '15',
      [REDUCE_MOTION_STORAGE_KEY]: 'yes',
    },
  }],
  ['"hasOwnProperty" is not a theme', { storage: { [THEME_STORAGE_KEY]: 'hasOwnProperty' } }],
  ['system mode, OS dark', { storage: { [MODE_STORAGE_KEY]: 'system' }, systemDark: true }],
  ['system mode, OS light', { storage: { [MODE_STORAGE_KEY]: 'system' }, systemDark: false }],
  ['compact 12 reduce-motion on', {
    storage: { [DENSITY_STORAGE_KEY]: 'compact', [FONT_SIZE_STORAGE_KEY]: '12', [REDUCE_MOTION_STORAGE_KEY]: '1' },
  }],
  ['OS asks for reduced motion', { storage: { [FONT_SIZE_STORAGE_KEY]: '14' }, systemReducedMotion: true }],
  ...THEMES.map((t): [string, Env] => [`${t.id} with no stored accent`, { storage: { [THEME_STORAGE_KEY]: t.id } }]),
];

describe('generated pre-paint script', () => {
  it.each(cases)('%s', (_label, env) => {
    expect(runPrepaint(env)).toEqual(expected(env));
  });

  it('paints the D-25 defaults on cleared storage', () => {
    expect(runPrepaint({ storage: {} })).toEqual({
      classes: ['dark'],
      attrs: {
        'data-mode': 'dark',
        'data-theme': 'instrument',
        'data-accent': 'ink',
        'data-density': 'comfortable',
        'data-font-size': '13',
        'data-layout': 'native',
      },
    });
  });

  it('applies the desktop window chrome before first paint (06 §3.6)', () => {
    const mac = runPrepaint({
      storage: {},
      chrome: { platform: 'darwin', titleBarStyle: 'hidden-inset', titleBarHeight: 0, insetLeft: 78, insetRight: 0 },
    });
    expect(mac.classes).toEqual(['custom-titlebar', 'dark', 'desktop-shell', 'platform-darwin', 'titlebar-inset']);
    expect(mac.attrs['data-layout']).toBe('mac');
    expect(mac.vars).toEqual({
      '--gai-titlebar-height': '0px',
      '--gai-titlebar-inset-left': '78px',
      '--gai-titlebar-inset-right': '0px',
    });
    const win = runPrepaint({
      storage: {},
      chrome: { platform: 'win32', titleBarStyle: 'overlay', titleBarHeight: 36, insetLeft: 0, insetRight: 138 },
    });
    expect(win.classes).toEqual(['custom-titlebar', 'dark', 'desktop-shell', 'platform-win32', 'titlebar-overlay']);
    expect(win.attrs['data-layout']).toBe('strip');
    expect(win.vars?.['--gai-titlebar-height']).toBe('36px');
    const linux = runPrepaint({
      storage: {},
      chrome: { platform: 'linux', titleBarStyle: 'native', titleBarHeight: 0, insetLeft: 0, insetRight: 0 },
    });
    expect(linux.classes).toEqual(['dark', 'desktop-shell', 'platform-linux']);
    expect(linux.attrs['data-layout']).toBe('native');
  });

  it('is one line of ES5 (no arrow functions, let/const or template strings)', () => {
    const js = emitPrepaintScript();
    expect(js).not.toMatch(/[\r\n]/);
    expect(js).not.toMatch(/=>|\blet\b|\bconst\b|`/);
    expect(js).not.toContain('</script');
  });

  it('contains every theme id and "instrument" as the fallback', () => {
    const js = emitPrepaintScript();
    for (const t of THEMES) expect(js).toContain(`"${t.id}":"${t.defaultAccent}"`);
    expect(js).toContain('t="instrument"');
  });

  it('splices between the markers and is idempotent', () => {
    const html = `<head>\n    ${PREPAINT_START}\n    old\n    ${PREPAINT_END}\n</head>`;
    const once = splicePrepaint(html);
    expect(once).toContain(emitPrepaint());
    expect(once).not.toContain('old');
    expect(splicePrepaint(once)).toBe(once);
    expect(() => splicePrepaint('<head></head>')).toThrow(/markers/);
  });

  it('apps/web/index.html carries it in <head>, and both CSP pins match its hash', () => {
    const root = fileURLToPath(new URL('../../../../../', import.meta.url));
    const html = readFileSync(`${root}apps/web/index.html`, 'utf8');
    const head = html.slice(0, html.indexOf('</head>'));
    expect(head).toContain(`<script>${emitPrepaintScript()}</script>`);
    // Before any stylesheet or module script: nothing may paint first.
    expect(html.indexOf('<script>')).toBeLessThan(html.search(/<link[^>]+stylesheet|<script type="module"/));
    const hash = prepaintCspHash();
    expect(readFileSync(`${root}apps/server/src/middleware/csp.ts`, 'utf8')).toContain(`'${hash}'`);
    expect(readFileSync(`${root}apps/desktop/src/main/session-hardening.ts`, 'utf8')).toContain(`'${hash}'`);
  });
});
