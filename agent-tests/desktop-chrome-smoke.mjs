// ────────────────────────────────────────────────────────────────
// desktop-chrome-smoke — launches the packaged-mode Electron shell and
// verifies the modernised window chrome end to end:
//
//   • the app boots (the unauthenticated-loopback regression stays fixed)
//   • the native menu has the File · Edit · View · Window · Help structure
//   • accelerators are platform-appropriate
//   • the renderer receives window chrome and applies it to <html>
//   • the header is a draggable title bar with non-draggable controls
//   • window minimise / maximise / restore round-trip through IPC
//
// Run: node agent-tests/desktop-chrome-smoke.mjs
// ────────────────────────────────────────────────────────────────

import { _electron as electron } from 'playwright-core';
import * as path from 'node:path';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DESKTOP = path.resolve(__dirname, '..', 'apps', 'desktop');
const SHOTS = path.resolve(__dirname, 'test-results', 'desktop-chrome');

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

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });

  const app = await electron.launch({
    args: [DESKTOP],
    env: {
      ...process.env,
      GENERATORAI_DESKTOP_MODE: 'standalone',
      NODE_ENV: 'production',
    },
    timeout: 120_000,
  });

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
    await new Promise((r) => setTimeout(r, 500));
    if (app.windows().length === 0) await app.waitForEvent('window', { timeout: 5000 }).catch(() => {});
  }

  check('main window loaded the SPA', Boolean(win), win ? '' : 'no http window appeared');
  if (!win) {
    await app.close();
    return;
  }

  await win.waitForLoadState('domcontentloaded');
  await win.waitForSelector('[data-testid="app-header"]', { timeout: 60_000 });

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
  const expectedTop = ['File', 'Edit', 'View', 'Window', 'Help'];
  check(
    `top-level menus are ${expectedTop.join(' · ')}`,
    expectedTop.every((l) => topLabels.includes(l)),
    `got ${JSON.stringify(topLabels)}`,
  );
  check(
    'the bespoke Go and Server menus are gone',
    !topLabels.includes('Go') && !topLabels.includes('Server'),
    `got ${JSON.stringify(topLabels)}`,
  );

  const find = (tree, label) =>
    (tree ?? []).find((i) => (i.label ?? '').replace(/&/g, '') === label);
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
  check('Toggle Right Panel exists', Boolean(find(view?.submenu, 'Toggle Right Panel')));
  check('Appearance radio group exists', Boolean(find(view?.submenu, 'Appearance')?.submenu?.length));

  check('File has Open Recent', Boolean(find(file?.submenu, 'Open Recent')));
  check('Help nests server tools under Troubleshooting', Boolean(find(help?.submenu, 'Troubleshooting')));

  // ── 2. Renderer chrome ──
  const chrome = await win.evaluate(async () => {
    const api = window.generatoraiDesktop;
    return api?.getWindowChrome ? await api.getWindowChrome() : null;
  });
  check('bridge exposes getWindowChrome', Boolean(chrome));
  check(
    'chrome reports this platform',
    chrome?.platform === process.platform,
    `${chrome?.platform} vs ${process.platform}`,
  );
  check(
    'chrome reserves space for the OS window controls',
    process.platform === 'darwin' ? chrome?.insetLeft > 0 : chrome?.insetRight > 0,
    JSON.stringify(chrome),
  );

  const docState = await win.evaluate(() => {
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    return {
      classes: [...root.classList],
      height: cs.getPropertyValue('--titlebar-height').trim(),
      insetRight: cs.getPropertyValue('--titlebar-inset-right').trim(),
      insetLeft: cs.getPropertyValue('--titlebar-inset-left').trim(),
    };
  });
  check(
    'platform class is on <html>',
    docState.classes.includes(`platform-${process.platform}`),
    JSON.stringify(docState.classes),
  );
  check('desktop-shell class is on <html>', docState.classes.includes('desktop-shell'));
  check(
    'title-bar CSS variables are published',
    docState.height !== '' && docState.height !== '0px',
    JSON.stringify(docState),
  );

  const header = await win.evaluate(() => {
    const bar = document.querySelector('[data-testid="app-titlebar"]');
    const h = document.querySelector('[data-testid="app-header"]');
    if (!bar || !h) return null;
    const barStyle = getComputedStyle(bar);
    const wco = navigator.windowControlsOverlay;
    // The right-most thing in the app header — the control most at risk of
    // being covered by the OS close button if the layout regresses.
    const lastControl = [...h.querySelectorAll('button')].pop();
    return {
      drag: barStyle.getPropertyValue('-webkit-app-region') || barStyle.getPropertyValue('app-region'),
      barPaddingRight: parseFloat(barStyle.paddingRight),
      barPaddingLeft: parseFloat(barStyle.paddingLeft),
      barHeight: parseFloat(barStyle.height),
      barBottom: bar.getBoundingClientRect().bottom,
      headerTop: h.getBoundingClientRect().top,
      headerPaddingRight: parseFloat(getComputedStyle(h).paddingRight),
      lastControlRight: lastControl?.getBoundingClientRect().right ?? null,
      wcoVisible: wco?.visible ?? false,
      wcoBottom: wco?.visible ? wco.getTitlebarAreaRect().height : null,
      wcoLeftEdge: wco?.visible
        ? wco.getTitlebarAreaRect().x + wco.getTitlebarAreaRect().width
        : null,
      innerWidth: document.documentElement.clientWidth,
      duplicateControls: Boolean(document.querySelector('[data-testid="window-controls"]')),
    };
  });
  check('a dedicated title-bar row exists', Boolean(header));
  check('the title bar is the drag region', header?.drag === 'drag', header?.drag);
  check('the SPA does not duplicate the OS window controls', header?.duplicateControls === false);
  check(
    'the app header sits BELOW the title bar',
    (header?.headerTop ?? 0) >= (header?.barBottom ?? 0),
    `header top ${header?.headerTop} vs bar bottom ${header?.barBottom}`,
  );
  check(
    'the app header keeps its full width (no reserved inset)',
    (header?.headerPaddingRight ?? 99) <= 13,
    `${header?.headerPaddingRight}px`,
  );

  if (process.platform === 'darwin') {
    check('macOS keeps its native traffic lights', chrome?.titleBarStyle === 'hidden-inset');
    check('the title bar clears the traffic lights', (header?.barPaddingLeft ?? 0) > 12);
  } else {
    check('Window Controls Overlay is active', header?.wcoVisible === true);
    check(
      'the OS controls fit inside the title-bar row',
      (header?.wcoBottom ?? 0) <= (header?.barHeight ?? 0) + 1,
      `controls ${header?.wcoBottom}px tall, row ${header?.barHeight}px`,
    );
    check(
      'title-bar content stops before the OS controls',
      Math.abs(
        header.barPaddingRight - (header.innerWidth - header.wcoLeftEdge + 12),
      ) <= 2,
      `padding ${header?.barPaddingRight}px`,
    );
    // The whole point of the change: the theme toggle must never end up
    // underneath the close button.
    check(
      'no app control is covered by the OS window controls',
      (header?.lastControlRight ?? 0) <= (header?.innerWidth ?? 0),
      `right-most control ends at ${header?.lastControlRight}, viewport ${header?.innerWidth}`,
    );
  }

  // ── 3. Window state round-trip ──
  const before = await app.evaluate(async ({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().find((w) => w.isVisible())?.isMaximized() ?? null,
  );
  await win.evaluate(async () => window.generatoraiDesktop?.window?.toggleMaximize());
  await new Promise((r) => setTimeout(r, 700));
  const after = await app.evaluate(async ({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().find((w) => w.isVisible())?.isMaximized() ?? null,
  );
  check('toggleMaximize flips window state', before !== null && after !== null && before !== after, `${before} → ${after}`);

  const reported = await win.evaluate(async () => window.generatoraiDesktop?.window?.isMaximized());
  check('isMaximized agrees with the main process', reported === after, `${reported} vs ${after}`);

  // Put it back so the screenshot is representative.
  await win.evaluate(async () => window.generatoraiDesktop?.window?.toggleMaximize());
  await new Promise((r) => setTimeout(r, 900));

  // `geometrychange` fires before the viewport width settles, so a naive
  // `innerWidth - rect.width` leaves the header padded by hundreds of pixels
  // (or none at all) after a maximise round-trip. Re-assert once it is over.
  const settled = await win.evaluate(() => {
    const bar = document.querySelector('[data-testid="app-titlebar"]');
    const wco = navigator.windowControlsOverlay;
    const rect = wco?.visible ? wco.getTitlebarAreaRect() : null;
    return {
      paddingRight: parseFloat(getComputedStyle(bar).paddingRight),
      expected: rect
        ? document.documentElement.clientWidth - rect.x - rect.width + 12
        : 12,
    };
  });
  check(
    'inset survives a maximise/restore round-trip',
    Math.abs(settled.paddingRight - settled.expected) <= 2,
    `padding ${settled.paddingRight}px, expected ~${settled.expected}px`,
  );

  // ── 4. Menu state mirroring ──
  const sidebarBefore = await win.evaluate(() =>
    Boolean(document.querySelector('[data-testid="sidebar-toggle"]')),
  );
  check('sidebar is open at boot', sidebarBefore);

  const checkedBefore = await app.evaluate(async ({ Menu }) => {
    const m = Menu.getApplicationMenu();
    const view = m?.items.find((i) => (i.label ?? '').replace(/&/g, '') === 'View');
    return view?.submenu?.items.find((i) => i.label === 'Toggle Sidebar')?.checked ?? null;
  });
  check('menu reflects the open sidebar', checkedBefore === true, String(checkedBefore));

  await win.click('[data-testid="sidebar-toggle"]');
  await new Promise((r) => setTimeout(r, 600));
  const checkedAfter = await app.evaluate(async ({ Menu }) => {
    const m = Menu.getApplicationMenu();
    const view = m?.items.find((i) => (i.label ?? '').replace(/&/g, '') === 'View');
    return view?.submenu?.items.find((i) => i.label === 'Toggle Sidebar')?.checked ?? null;
  });
  check('menu checkmark follows the renderer', checkedAfter === false, String(checkedAfter));

  // ── 5. Commands flow main → renderer ──
  await app.evaluate(async ({ BrowserWindow }) => {
    const w = BrowserWindow.getAllWindows().find((x) => x.isVisible());
    w?.webContents.send('desktop:command', 'toggle-sidebar');
  });
  await new Promise((r) => setTimeout(r, 600));
  const sidebarRestored = await win.evaluate(() =>
    Boolean(document.querySelector('[data-testid="sidebar-toggle"]')),
  );
  check('toggle-sidebar command reaches the renderer', sidebarRestored === true, String(sidebarRestored));

  await win.screenshot({ path: path.join(SHOTS, 'desktop-chrome.png') });
  console.log(`\n  screenshot → ${path.join(SHOTS, 'desktop-chrome.png')}`);

  await app.close();
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
