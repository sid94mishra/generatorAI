// ────────────────────────────────────────────────────────────────
// desktop-chrome-smoke — launches the Electron shell and verifies the P3
// app frame and window chrome end to end, per OS
// (docs/redesign/06-desktop-and-shell.md §3.5, §9.1; 09-verification.md §6.7):
//
//   • the app boots (the unauthenticated-loopback regression stays fixed)
//   • the native menu is File · Edit · View · Server · Window · Help
//   • accelerators are platform-appropriate
//   • the preload hands the renderer a synchronous `chrome` value and the
//     renderer applies it to <html> (`--gai-titlebar-*`, classes, data-layout)
//   • per layout:
//       mac    (macOS)                  44px traffic-light drag row in the
//                                       sidebar, lights at {16,16}, no strip
//       strip  (Windows, Linux custom)  36px draggable title strip that clears
//                                       the Window Controls Overlay
//       native (Linux default)          OS frame, back/forward row in the sidebar
//   • window minimise / maximise / restore round-trip through IPC
//   • the sidebar ⇄ rail toggle mirrors into View ▸ Toggle Sidebar, and the
//     `sidebar.toggle` command from main drives it back
//   • the window background equals the renderer's ground colour (D-25)
//
// Run: node agent-tests/desktop-chrome-smoke.mjs
//      GENERATORAI_LINUX_CUSTOM_TITLEBAR=1 node agent-tests/desktop-chrome-smoke.mjs   (Linux strip)
// ────────────────────────────────────────────────────────────────

import { _electron as electron } from 'playwright-core';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DESKTOP_DIR as DESKTOP, isolatedProfile } from './helpers/desktop-profile.mjs';
// The registry is dependency-free TypeScript; Node >= 22.18 strips its types.
// Commands go over IPC by registry id (CLAUDE.md selector rule 2): a rename
// there fails this import instead of turning the check into a silent no-op.
import { COMMANDS } from '../packages/shared/src/ui-contract/commands.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SHOTS = path.resolve(__dirname, 'test-results', 'desktop-chrome');
const SIDEBAR_TOGGLE = 'sidebar.toggle';
if (!(SIDEBAR_TOGGLE in COMMANDS)) throw new Error(`registry has no ${SIDEBAR_TOGGLE} command`);
/** IPC_EVENT.command in apps/desktop/src/shared/ipc.ts; the payload is the registry id. */
const COMMAND_CHANNEL = 'desktop:command';

// Geometry from CHROME (packages/design-tokens/src/chrome.ts).
const SIDEBAR_WIDTH = 232;
const RAIL_WIDTH = 48;
const RAIL_BREAKPOINT = 1200;
const MAC_TRAFFIC_ROW = 44;
const MAC_INSET_LEFT = 78;
const MAC_RAIL_PAGE_INSET = MAC_INSET_LEFT - RAIL_WIDTH; // 30
const STRIP_HEIGHT = 36;
const STRIP_CAPTION_CLUSTER = 138;
const NATIVE_NAV_ROW = 36;
/** Wide enough for the full sidebar (>= RAIL_BREAKPOINT) with room for the OS frame. */
const TEST_WINDOW = { width: 1320, height: 860 };

let pass = 0;
let fail = 0;
const failures = [];

function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  PASS  ${name}`);
  } else {
    fail += 1;
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Polls `read` until `ok(value)` or the timeout; returns the last value. */
async function waitFor(read, ok, timeout = 5000, interval = 150) {
  const deadline = Date.now() + timeout;
  let value = await read();
  while (!ok(value) && Date.now() < deadline) {
    await sleep(interval);
    value = await read();
  }
  return value;
}

const close = (a, b, tol = 1) => typeof a === 'number' && typeof b === 'number' && Math.abs(a - b) <= tol;

/** What platform.ts decides for this process (the launched app inherits our env). */
function expectedTitleBarStyle() {
  if (process.platform === 'darwin') return 'hidden-inset';
  if (process.platform === 'win32') return 'overlay';
  return process.env.GENERATORAI_LINUX_CUSTOM_TITLEBAR === '1' ? 'overlay' : 'native';
}

const LAYOUT_FOR_STYLE = { 'hidden-inset': 'mac', overlay: 'strip', native: 'native' };

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });

  // A fresh profile: never the developer's userData or vault key.
  const profile = isolatedProfile('gai-chrome-smoke-');
  process.on('exit', profile.cleanup);
  const app = await electron.launch({
    args: [DESKTOP, profile.arg],
    env: {
      ...process.env,
      GENERATORAI_DESKTOP_MODE: 'standalone',
      NODE_ENV: 'production',
    },
    timeout: 120_000,
  });
  // P2-R44 — hand the launched app to the profile helper so a SIGINT/SIGTERM
  // that lands after this point can close Electron before removing the
  // directory it may still hold files in.
  profile.attach(app);

  try {
  // The splash window appears first; wait for the one that actually hosts
  // the SPA rather than whichever window happens to be created first.
  let win = null;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    for (const w of app.windows()) {
      const url = w.url();
      if (url.startsWith('http://127.0.0.1') || url.startsWith('http://localhost')) {
        win = w;
        break;
      }
    }
    if (win) break;
    await sleep(500);
    if (app.windows().length === 0) await app.waitForEvent('window', { timeout: 5000 }).catch(() => {});
  }

  check('main window loaded the SPA', Boolean(win), win ? '' : 'no http window appeared');
  if (!win) {
    return;
  }

  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('[data-testid="app-frame"]', { timeout: 60_000 });

  // Main-process helpers. The SPA window is the one whose document is served
  // over http (the splash is a file:// page).
  const inMain = (fn, arg) =>
    app.evaluate(
      async ({ BrowserWindow, Menu }, [src, a]) => {
        const all = BrowserWindow.getAllWindows();
        const w =
          all.find((x) => /^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(x.webContents.getURL())) ?? all[0];
        return new Function('w', 'Menu', 'arg', `return (${src})(w, Menu, arg);`)(w, Menu, a);
      },
      [fn.toString(), arg],
    );
  const toggleSidebarChecked = () =>
    inMain((w, Menu) => {
      const m = Menu.getApplicationMenu();
      const view = m?.items.find((i) => (i.label ?? '').replace(/&/g, '') === 'View');
      return view?.submenu?.items.find((i) => i.label === 'Toggle Sidebar')?.checked ?? null;
    });

  // ── 1. Menu structure ──
  const menuTree = await app.evaluate(async ({ Menu }) => {
    const walk = (items) => items.map((i) => ({
      label: i.label,
      role: i.role,
      type: i.type,
      accelerator: i.accelerator,
      enabled: i.enabled,
      checked: i.checked,
      submenu: i.submenu ? walk(i.submenu.items) : undefined,
    }));
    const m = Menu.getApplicationMenu();
    return m ? walk(m.items) : null;
  });

  check('application menu exists', Array.isArray(menuTree));

  const topLabels = (menuTree ?? []).map((m) => (m.label ?? '').replace(/&/g, ''));
  // macOS prepends the app-name menu; everything after it is the shared bar.
  const sharedTop = process.platform === 'darwin' ? topLabels.slice(1) : topLabels;
  const expectedTop = ['File', 'Edit', 'View', 'Server', 'Window', 'Help'];
  check(
    `top-level menus are ${expectedTop.join(' · ')}`,
    JSON.stringify(sharedTop) === JSON.stringify(expectedTop),
    `got ${JSON.stringify(topLabels)}`,
  );
  check(
    'the bespoke Go menu is gone',
    !topLabels.includes('Go'),
    `got ${JSON.stringify(topLabels)}`,
  );

  const find = (tree, label) =>
    (tree ?? []).find((i) => (i.label ?? '').replace(/&/g, '') === label);

  // The top-level "Server" menu is the connection switcher (This Computer /
  // remote servers / Add Server…), native so it survives an unreachable
  // backend. The old developer tools must not return with it — they live
  // under Help ▸ Troubleshooting.
  const server = find(menuTree, 'Server');
  check(
    'Server menu is the connection switcher, not the old dev tools',
    Boolean(server) &&
      Boolean(find(server?.submenu, 'This Computer')) &&
      Boolean(find(server?.submenu, 'Add Server…')) &&
      !find(server?.submenu, 'Restart Server') &&
      !find(server?.submenu, 'Server Health'),
    JSON.stringify((server?.submenu ?? []).map((i) => i.label)),
  );
  const view = find(menuTree, 'View');
  const file = find(menuTree, 'File');
  const help = find(menuTree, 'Help');

  check('View owns the command palette', Boolean(find(view?.submenu, 'Command Palette…')));
  check(
    'command palette is on Ctrl/Cmd+K',
    /(?:Ctrl|Cmd|CmdOrCtrl)\+K/i.test(find(view?.submenu, 'Command Palette…')?.accelerator ?? ''),
    find(view?.submenu, 'Command Palette…')?.accelerator,
  );
  check('View owns navigation (Chats)', Boolean(find(view?.submenu, 'Chats')));
  // Sections come from NAV_DESTINATIONS (D-22): Home (not Dashboard) … Scripts, Agents included.
  const sectionLabels = (view?.submenu ?? []).map((i) => i.label);
  const homeAt = sectionLabels.indexOf('Home');
  check(
    'View sections follow the sidebar order',
    homeAt >= 0 &&
      ['Home', 'Chats', 'Projects', 'Agents', 'Workflows', 'Automations', 'Scripts'].every(
        (l, i) => sectionLabels[homeAt + i] === l,
      ),
    JSON.stringify(sectionLabels),
  );
  check(
    'Help ▸ Keyboard Shortcuts is bound',
    /(?:Cmd|Ctrl)\+\//.test(find(help?.submenu, 'Keyboard Shortcuts')?.accelerator ?? ''),
    find(help?.submenu, 'Keyboard Shortcuts')?.accelerator,
  );

  const chatsAccel = find(view?.submenu, 'Chats')?.accelerator ?? '';
  check(
    process.platform === 'darwin'
      ? 'section accelerator avoids Cmd+N tab-switch conflict'
      : 'section accelerator is Ctrl+<n>',
    process.platform === 'darwin' ? /Cmd\+Shift\+/.test(chatsAccel) : /Ctrl\+\d/.test(chatsAccel),
    chatsAccel,
  );

  const toggleSidebar = find(view?.submenu, 'Toggle Sidebar');
  check('Toggle Sidebar is a checkbox', toggleSidebar?.type === 'checkbox', toggleSidebar?.type);
  // TODO(06 §9.1): "Toggle Side Dock" should also be disabled on `/` (no dock
  // there, `dockOpen === null`). menu.ts does not bind `enabled` for it yet,
  // so only its presence is asserted until the dock lands (P4).
  check('Toggle Side Dock exists', Boolean(find(view?.submenu, 'Toggle Side Dock')));
  check('Appearance radio group exists', Boolean(find(view?.submenu, 'Appearance')?.submenu?.length));

  check('File has Open Recent', Boolean(find(file?.submenu, 'Open Recent')));
  check('Help nests server tools under Troubleshooting', Boolean(find(help?.submenu, 'Troubleshooting')));

  // ── 2. Bridge chrome ──
  // Synchronous, static per process: a plain value on the bridge. The async
  // getWindowChrome() IPC is gone (06 §3.6).
  const bridge = await win.evaluate(() => {
    const api = window.generatoraiDesktop;
    const c = api?.chrome;
    return {
      chrome: c ?? null,
      plainObject:
        typeof c === 'object' && c !== null && Object.getPrototypeOf(c) === Object.prototype &&
        typeof c.then !== 'function',
      getWindowChrome: typeof api?.getWindowChrome,
      onNavHistoryChanged: typeof api?.onNavHistoryChanged,
    };
  });
  const chrome = bridge.chrome;
  const expectedStyle = expectedTitleBarStyle();
  check('bridge exposes chrome as a plain object', bridge.plainObject, JSON.stringify(chrome));
  check('getWindowChrome() is removed from the bridge', bridge.getWindowChrome === 'undefined', bridge.getWindowChrome);
  check('bridge exposes onNavHistoryChanged', bridge.onNavHistoryChanged === 'function', bridge.onNavHistoryChanged);
  check(
    'chrome reports this platform',
    chrome?.platform === process.platform,
    `${chrome?.platform} vs ${process.platform}`,
  );
  check(
    `chrome titleBarStyle is ${expectedStyle}`,
    chrome?.titleBarStyle === expectedStyle,
    String(chrome?.titleBarStyle),
  );
  const style = chrome?.titleBarStyle ?? expectedStyle;
  const layout = LAYOUT_FOR_STYLE[style];
  const expectedGeometry = {
    'hidden-inset': { titleBarHeight: 0, insetLeft: MAC_INSET_LEFT, insetRight: 0 },
    overlay: { titleBarHeight: STRIP_HEIGHT, insetLeft: 0, insetRight: STRIP_CAPTION_CLUSTER },
    native: { titleBarHeight: 0, insetLeft: 0, insetRight: 0 },
  }[style];
  check(
    `chrome geometry for ${style}`,
    chrome?.titleBarHeight === expectedGeometry.titleBarHeight &&
      chrome?.insetLeft === expectedGeometry.insetLeft &&
      chrome?.insetRight === expectedGeometry.insetRight,
    `got ${JSON.stringify(chrome)}, want ${JSON.stringify(expectedGeometry)}`,
  );
  check('chrome reports isWayland', typeof chrome?.isWayland === 'boolean', JSON.stringify(chrome?.isWayland));

  // ── 3. Size the window for the full sidebar ──
  // Below RAIL_BREAKPOINT the sidebar is forced into the rail, and the
  // sidebar-row assertions below need the expanded sidebar.
  await inMain((w, _Menu, size) => {
    if (w.isFullScreen()) w.setFullScreen(false);
    if (w.isMaximized()) w.unmaximize();
    w.setSize(size.width, size.height);
  }, TEST_WINDOW);
  const viewportWidth = await waitFor(
    () => win.evaluate(() => document.documentElement.clientWidth),
    (wd) => wd >= RAIL_BREAKPOINT,
  );
  check(
    `window is at least ${RAIL_BREAKPOINT}px wide`,
    viewportWidth >= RAIL_BREAKPOINT,
    `viewport ${viewportWidth}px after setSize(${TEST_WINDOW.width}, ${TEST_WINDOW.height})`,
  );
  await waitFor(
    () => win.evaluate(() => document.querySelector('[data-testid="app-sidebar"]')?.getAttribute('data-collapsed')),
    (v) => v === 'full',
  );
  // The WCO geometry and the published insets settle a frame after a resize.
  await sleep(400);

  // ── 4. <html> state ──
  const docState = await win.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const frame = document.querySelector('[data-testid="app-frame"]');
    return {
      classes: [...root.classList],
      htmlLayout: root.getAttribute('data-layout'),
      frameLayout: frame?.getAttribute('data-layout') ?? null,
      frameSidebar: frame?.getAttribute('data-sidebar') ?? null,
      height: cs.getPropertyValue('--gai-titlebar-height').trim(),
      insetLeft: cs.getPropertyValue('--gai-titlebar-inset-left').trim(),
      insetRight: cs.getPropertyValue('--gai-titlebar-inset-right').trim(),
      legacyVars: ['--titlebar-height', '--titlebar-inset-left', '--titlebar-inset-right'].map((v) =>
        cs.getPropertyValue(v).trim(),
      ),
    };
  });
  check(
    'platform class is on <html>',
    docState.classes.includes(`platform-${process.platform}`),
    JSON.stringify(docState.classes),
  );
  check('desktop-shell class is on <html>', docState.classes.includes('desktop-shell'));
  check(
    'custom-titlebar / titlebar-overlay / titlebar-inset classes match the chrome',
    docState.classes.includes('custom-titlebar') === (style !== 'native') &&
      docState.classes.includes('titlebar-overlay') === (style === 'overlay') &&
      docState.classes.includes('titlebar-inset') === (style === 'hidden-inset'),
    JSON.stringify(docState.classes),
  );
  check(`app-frame data-layout is ${layout}`, docState.frameLayout === layout, String(docState.frameLayout));
  check('<html> data-layout matches the frame', docState.htmlLayout === layout, String(docState.htmlLayout));
  check('app-frame data-sidebar is expanded', docState.frameSidebar === 'expanded', String(docState.frameSidebar));
  check(
    '--gai-titlebar-height matches the chrome',
    parseFloat(docState.height) === expectedGeometry.titleBarHeight,
    JSON.stringify(docState),
  );
  if (style === 'hidden-inset') {
    check(
      '--gai-titlebar-inset-left reserves the traffic lights',
      parseFloat(docState.insetLeft) === MAC_INSET_LEFT,
      docState.insetLeft,
    );
  } else if (style === 'native') {
    check(
      '--gai-titlebar-inset-* are zero on the native frame',
      parseFloat(docState.insetLeft || '0') === 0 && parseFloat(docState.insetRight || '0') === 0,
      JSON.stringify(docState),
    );
  }
  check(
    'the old --titlebar-* variables are gone',
    docState.legacyVars.every((v) => v === ''),
    JSON.stringify(docState.legacyVars),
  );

  // ── 5. Per-layout geometry ──
  const geometry = () =>
    win.evaluate(() => {
      const q = (id) => document.querySelector(`[data-testid="${id}"]`);
      const box = (el) => {
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const s = getComputedStyle(el);
        return {
          top: r.top,
          bottom: r.bottom,
          left: r.left,
          right: r.right,
          width: r.width,
          height: r.height,
          drag: s.getPropertyValue('-webkit-app-region') || s.getPropertyValue('app-region'),
          paddingRight: parseFloat(s.paddingRight),
          paddingLeft: parseFloat(s.paddingLeft),
        };
      };
      const sidebar = document.querySelector('[data-testid="app-sidebar"]');
      const strip = q('app-titlebar');
      const wco = navigator.windowControlsOverlay;
      const rect = wco?.visible ? wco.getTitlebarAreaRect() : null;
      const stripControls = strip ? [...strip.querySelectorAll('button, a[href], [role="button"]')] : [];
      const last = stripControls.pop();
      const stripChildIds = ['titlebar-back', 'titlebar-forward', 'titlebar-toggle-sidebar', 'titlebar-search', 'titlebar-server'];
      return {
        innerWidth: document.documentElement.clientWidth,
        insetRightVar: parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gai-titlebar-inset-right')),
        sidebar: box(sidebar),
        sidebarCollapsed: sidebar?.getAttribute('data-collapsed') ?? null,
        dragRegion: box(q('sidebar-drag-region')),
        dragRegionIsFirst: Boolean(sidebar && q('sidebar-drag-region') && sidebar.firstElementChild === q('sidebar-drag-region')),
        navRow: box(q('sidebar-nav-row')),
        navRowBack: Boolean(q('sidebar-nav-row')?.querySelector('[data-testid="sidebar-back"]')),
        navRowForward: Boolean(q('sidebar-nav-row')?.querySelector('[data-testid="sidebar-forward"]')),
        strip: box(strip),
        stripClass: strip?.classList.contains('app-drag-region') ?? false,
        stripChildren: Object.fromEntries(
          stripChildIds.map((id) => {
            const el = strip?.querySelector(`[data-testid="${id}"]`);
            const s = el ? getComputedStyle(el) : null;
            return [id, el ? (s.getPropertyValue('-webkit-app-region') || s.getPropertyValue('app-region') || 'none') : null];
          }),
        ),
        lastStripControlRight: last?.getBoundingClientRect().right ?? null,
        lastStripControl: last ? (last.getAttribute('data-testid') ?? last.getAttribute('aria-label') ?? last.tagName) : null,
        mainCard: box(q('main-card')),
        wcoVisible: wco?.visible ?? false,
        wcoRect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null,
        duplicateControls: Boolean(q('window-controls')),
      };
    });

  const geo = await geometry();
  check('the SPA does not duplicate the OS window controls', geo.duplicateControls === false);
  check(
    `the expanded sidebar is ${SIDEBAR_WIDTH}px wide`,
    geo.sidebarCollapsed === 'full' && close(geo.sidebar?.width, SIDEBAR_WIDTH),
    `${geo.sidebarCollapsed} ${geo.sidebar?.width}px`,
  );

  if (style === 'hidden-inset') {
    // ── macOS: traffic lights in the sidebar's 44px drag row ──
    check('no title strip on macOS', geo.strip === null);
    check('no back/forward row on macOS', geo.navRow === null);
    check('sidebar-drag-region exists', Boolean(geo.dragRegion));
    check('sidebar-drag-region is the sidebar\'s first row', geo.dragRegionIsFirst);
    check(
      `sidebar-drag-region is ${MAC_TRAFFIC_ROW}px tall`,
      close(geo.dragRegion?.height, MAC_TRAFFIC_ROW),
      `${geo.dragRegion?.height}px`,
    );
    check('sidebar-drag-region is a drag region', geo.dragRegion?.drag === 'drag', geo.dragRegion?.drag);
    const buttons = await inMain((w) => (typeof w.getWindowButtonPosition === 'function' ? w.getWindowButtonPosition() : 'unsupported'));
    check(
      'traffic lights sit at {x:16, y:16}',
      buttons && typeof buttons === 'object' && buttons.x === 16 && buttons.y === 16,
      JSON.stringify(buttons),
    );
  } else if (style === 'overlay') {
    // ── Windows / Linux custom: the 36px title strip clears the WCO ──
    check('no traffic-light row outside macOS', geo.dragRegion === null);
    check('no back/forward sidebar row with a strip', geo.navRow === null);
    check('app-titlebar exists', Boolean(geo.strip));
    check(`app-titlebar is ${STRIP_HEIGHT}px tall`, close(geo.strip?.height, STRIP_HEIGHT), `${geo.strip?.height}px`);
    check('app-titlebar is the drag region', geo.strip?.drag === 'drag' && geo.stripClass, `${geo.strip?.drag} class=${geo.stripClass}`);
    // app-region is not inherited in computed style, yet a control inside a
    // drag region only receives clicks when it is explicitly `no-drag`.
    check(
      'strip controls are present and no-drag',
      Object.values(geo.stripChildren).every((v) => v === 'no-drag'),
      JSON.stringify(geo.stripChildren),
    );
    check('Window Controls Overlay is active', geo.wcoVisible === true);
    check(
      `the OS controls fit inside the ${STRIP_HEIGHT}px strip`,
      (geo.wcoRect?.height ?? Infinity) <= STRIP_HEIGHT,
      `titlebar area ${geo.wcoRect?.height}px tall`,
    );
    const freeRight = geo.wcoRect ? geo.innerWidth - geo.wcoRect.x - geo.wcoRect.width : null;
    check(
      'strip padding-right equals the WCO free-area right inset',
      freeRight !== null && close(geo.strip?.paddingRight, freeRight, 2),
      `padding ${geo.strip?.paddingRight}px, WCO inset ${freeRight}px`,
    );
    check(
      'strip padding-right is --gai-titlebar-inset-right',
      close(geo.strip?.paddingRight, geo.insetRightVar, 0.5),
      `padding ${geo.strip?.paddingRight}px, var ${geo.insetRightVar}px`,
    );
    // The whole point of the strip: no app control under the caption buttons.
    check(
      'no strip control is covered by the OS window controls',
      geo.wcoRect !== null && geo.lastStripControlRight !== null &&
        geo.lastStripControlRight <= geo.wcoRect.x + geo.wcoRect.width + 0.5,
      `${geo.lastStripControl} ends at ${geo.lastStripControlRight}, WCO free area ends at ${
        geo.wcoRect ? geo.wcoRect.x + geo.wcoRect.width : null
      }`,
    );
    check(
      'main-card sits below the strip',
      geo.mainCard !== null && geo.strip !== null && geo.mainCard.top >= geo.strip.bottom - 0.5,
      `card top ${geo.mainCard?.top} vs strip bottom ${geo.strip?.bottom}`,
    );
  } else {
    // ── Linux native frame: back/forward live in the sidebar ──
    check('no title strip on the native frame', geo.strip === null);
    check('no traffic-light row outside macOS', geo.dragRegion === null);
    check('sidebar-nav-row exists', Boolean(geo.navRow));
    check(`sidebar-nav-row is ${NATIVE_NAV_ROW}px tall`, close(geo.navRow?.height, NATIVE_NAV_ROW), `${geo.navRow?.height}px`);
    check('sidebar-nav-row holds Back and Forward', geo.navRowBack && geo.navRowForward);
    check('the native frame has no drag regions', geo.navRow?.drag !== 'drag', geo.navRow?.drag);
  }

  await win.screenshot({ path: path.join(SHOTS, `desktop-chrome-${layout}.png`) });

  // ── 6. Window state round-trip ──
  const before = await inMain((w) => w.isMaximized());
  await win.evaluate(async () => window.generatoraiDesktop?.window?.toggleMaximize());
  await sleep(700);
  const after = await inMain((w) => w.isMaximized());
  check('toggleMaximize flips window state', before !== after, `${before} → ${after}`);

  const reported = await win.evaluate(async () => window.generatoraiDesktop?.window?.isMaximized());
  check('isMaximized agrees with the main process', reported === after, `${reported} vs ${after}`);

  // Put it back so the rest of the run (and the screenshots) are representative.
  await win.evaluate(async () => window.generatoraiDesktop?.window?.toggleMaximize());
  await sleep(900);

  if (style === 'overlay') {
    // `geometrychange` fires before the viewport width settles, so a naive
    // `innerWidth - rect.width` leaves the strip padded by hundreds of pixels
    // (or none at all) after a maximise round-trip. Re-assert once it is over.
    const settled = await waitFor(geometry, (g) => {
      const r = g.wcoRect;
      return r !== null && close(g.strip?.paddingRight, g.innerWidth - r.x - r.width, 2);
    }, 3000);
    const r = settled.wcoRect;
    check(
      'strip inset survives a maximise/restore round-trip',
      r !== null && close(settled.strip?.paddingRight, settled.innerWidth - r.x - r.width, 2),
      `padding ${settled.strip?.paddingRight}px, expected ~${r ? settled.innerWidth - r.x - r.width : '?'}px`,
    );
  }

  // ── 7. Window background = the renderer's ground (D-25) ──
  // The renderer pushes the theme's chrome colours after boot; main paints
  // them with setBackgroundColor. Compare with the frame's own `bg-ground`,
  // normalised to sRGB bytes through a canvas (tokens may be oklch()).
  const rendererGround = () =>
    win.evaluate(() => {
      const el = document.querySelector('[data-testid="app-frame"]');
      if (!el) return null;
      const cv = document.createElement('canvas');
      cv.width = 1;
      cv.height = 1;
      const ctx = cv.getContext('2d');
      ctx.fillStyle = getComputedStyle(el).backgroundColor;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return { r, g, b, a };
    });
  const windowGround = async () => {
    const hex = String(await inMain((w) => w.getBackgroundColor()) ?? '').replace('#', '');
    const rgb = hex.length === 8 ? hex.slice(2) : hex; // #AARRGGBB → RRGGBB
    return {
      hex,
      r: parseInt(rgb.slice(0, 2), 16),
      g: parseInt(rgb.slice(2, 4), 16),
      b: parseInt(rgb.slice(4, 6), 16),
    };
  };
  const sameColour = (a, b) => a && b && close(a.r, b.r, 2) && close(a.g, b.g, 2) && close(a.b, b.b, 2);
  let ground = await rendererGround();
  let bg = await windowGround();
  const bgDeadline = Date.now() + 10_000;
  while (!sameColour(ground, bg) && Date.now() < bgDeadline) {
    await sleep(250);
    ground = await rendererGround();
    bg = await windowGround();
  }
  check('app-frame paints an opaque ground', ground?.a === 255, JSON.stringify(ground));
  check(
    'window background colour equals the renderer ground',
    sameColour(ground, bg),
    `window #${bg.hex}, renderer rgb(${ground?.r}, ${ground?.g}, ${ground?.b})`,
  );

  // ── 8. Sidebar ⇄ rail, mirrored into the native menu ──
  const sidebarState = () =>
    win.evaluate(() => {
      const aside = document.querySelector('[data-testid="app-sidebar"]');
      const frame = document.querySelector('[data-testid="app-frame"]');
      if (!aside) return null;
      return {
        collapsed: aside.getAttribute('data-collapsed'),
        width: Math.round(aside.getBoundingClientRect().width),
        frameSidebar: frame?.getAttribute('data-sidebar') ?? null,
      };
    });
  const isFull = (st) => st?.collapsed === 'full' && st.frameSidebar === 'expanded' && close(st.width, SIDEBAR_WIDTH);
  const isRail = (st) => st?.collapsed === 'rail' && st.frameSidebar === 'rail' && close(st.width, RAIL_WIDTH);

  const sidebarBefore = await sidebarState();
  check('sidebar is expanded at boot', isFull(sidebarBefore), JSON.stringify(sidebarBefore));
  const checkedBefore = await waitFor(toggleSidebarChecked, (v) => v === true, 3000);
  check('menu reflects the expanded sidebar', checkedBefore === true, String(checkedBefore));
  check(
    'sidebar-toggle is labelled "Hide sidebar"',
    (await win.getAttribute('[data-testid="sidebar-toggle"]', 'aria-label')) === 'Hide sidebar',
  );

  await win.click('[data-testid="sidebar-toggle"]');
  const railState = await waitFor(sidebarState, isRail);
  check('sidebar-toggle collapses the sidebar to the rail', isRail(railState), JSON.stringify(railState));
  const checkedAfter = await waitFor(toggleSidebarChecked, (v) => v === false, 3000);
  check('menu checkmark follows the renderer', checkedAfter === false, String(checkedAfter));

  const rail = await win.evaluate(() => {
    const q = (id) => document.querySelector(`[data-testid="${id}"]`);
    const dragRow = q('rail-drag-row');
    const s = dragRow ? getComputedStyle(dragRow) : null;
    const legacy = q('legacy-header');
    return {
      dragRow: dragRow
        ? {
            height: dragRow.getBoundingClientRect().height,
            drag: s.getPropertyValue('-webkit-app-region') || s.getPropertyValue('app-region'),
          }
        : null,
      server: Boolean(q('rail-server')),
      search: Boolean(q('rail-search')),
      expandLabel: q('rail-expand')?.getAttribute('aria-label') ?? null,
      legacyHeaderPaddingLeft: legacy ? parseFloat(getComputedStyle(legacy).paddingLeft) : null,
    };
  });
  check('rail-expand is labelled "Show sidebar"', rail.expandLabel === 'Show sidebar', String(rail.expandLabel));
  if (style === 'hidden-inset') {
    check('rail-drag-row exists on macOS', Boolean(rail.dragRow));
    check(`rail-drag-row is ${MAC_TRAFFIC_ROW}px tall`, close(rail.dragRow?.height, MAC_TRAFFIC_ROW), `${rail.dragRow?.height}px`);
    check('rail-drag-row is a drag region', rail.dragRow?.drag === 'drag', rail.dragRow?.drag);
    // The lights overflow the 48px rail into the card: the header gets a
    // 78 − 48 = 30px leading inset (06 §3.5) so they never cover its text.
    check(
      `rail-mode legacy header clears the traffic lights (>= ${MAC_RAIL_PAGE_INSET}px)`,
      rail.legacyHeaderPaddingLeft !== null && rail.legacyHeaderPaddingLeft >= MAC_RAIL_PAGE_INSET - 0.5,
      `padding-left ${rail.legacyHeaderPaddingLeft}px`,
    );
  } else {
    check('no rail-drag-row outside macOS', rail.dragRow === null);
  }
  if (style === 'overlay') {
    check('the strip rail omits server and search (the strip has them)', !rail.server && !rail.search, JSON.stringify(rail));
  } else {
    check('the rail has server and search buttons', rail.server && rail.search, JSON.stringify(rail));
  }
  await win.screenshot({ path: path.join(SHOTS, `desktop-chrome-${layout}-rail.png`) });

  // ── 9. Commands flow main → renderer ──
  await inMain((w, _Menu, arg) => w.webContents.send(arg.channel, arg.command), {
    channel: COMMAND_CHANNEL,
    command: SIDEBAR_TOGGLE,
  });
  const sidebarRestored = await waitFor(sidebarState, isFull);
  check(`${SIDEBAR_TOGGLE} command re-expands the sidebar`, isFull(sidebarRestored), JSON.stringify(sidebarRestored));
  const checkedRestored = await waitFor(toggleSidebarChecked, (v) => v === true, 3000);
  check('menu checkmark follows the command', checkedRestored === true, String(checkedRestored));

  await win.screenshot({ path: path.join(SHOTS, 'desktop-chrome.png') });
  console.log(`\n  screenshots → ${SHOTS}`);
  } finally {
    // P2-R44 — close before cleanup: the directory is only removed once
    // Electron (and the embedded server it spawned) has released its files.
    await app.close().catch(() => {});
    profile.cleanup();
  }
}

main()
  .then(() => {
    console.log(`\n${pass}/${pass + fail} checks passed`);
    if (failures.length) {
      console.log('\nFailures:');
      for (const f of failures) console.log(`  • ${f}`);
    }
    process.exit(fail === 0 ? 0 : 1);
  })
  .catch((err) => {
    console.error('\nHARNESS ERROR', err);
    process.exit(1);
  });
