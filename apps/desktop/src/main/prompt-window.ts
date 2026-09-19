// ────────────────────────────────────────────────────────────────
// A one-line text prompt.
//
// Electron does not implement `window.prompt` — it throws "prompt() is not
// supported." — so the shell's own "Add Server…" silently did nothing: it
// injected a `window.prompt` call into the renderer, caught the throw, and
// returned. Remote mode was unreachable from the UI as a result.
//
// A small modal window of our own instead. It renders a fixed local page with
// a preload that exposes exactly two calls, and the privileged work (adding a
// connection, switching the backend) stays in main where it already lives.
// ────────────────────────────────────────────────────────────────

import { BrowserWindow, ipcMain } from 'electron';
import * as path from 'node:path';
import { PROMPT_IPC } from '../shared/ipc';
import { log } from './logger';

const RESOURCES = path.join(__dirname, '..', '..', 'resources');
const PRELOAD = path.join(__dirname, '..', 'preload', 'prompt.js');

export interface PromptOptions {
  title: string;
  message: string;
  placeholder?: string;
  defaultValue?: string;
  /** Label for the confirming button. Defaults to the page's own. */
  confirmLabel?: string;
  parent?: BrowserWindow | null;
}

/** Resolves with the trimmed text, or null when the user cancels. */
export function showPrompt(options: PromptOptions): Promise<string | null> {
  const parent = options.parent && !options.parent.isDestroyed() ? options.parent : undefined;
  const win = new BrowserWindow({
    width: 460,
    height: 210,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    show: false,
    title: options.title,
    backgroundColor: '#0d1117',
    ...(parent ? { parent, modal: true } : {}),
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  const query = new URLSearchParams({
    title: options.title,
    message: options.message,
    ...(options.placeholder ? { placeholder: options.placeholder } : {}),
    ...(options.defaultValue ? { value: options.defaultValue } : {}),
    ...(options.confirmLabel ? { confirm: options.confirmLabel } : {}),
  });

  return new Promise<string | null>((resolve) => {
    let settled = false;
    const finish = (value: string | null): void => {
      if (settled) return;
      settled = true;
      ipcMain.removeListener(PROMPT_IPC.result, onResult);
      if (!win.isDestroyed()) win.close();
      resolve(value);
    };
    // Scoped to this window: two prompts at once must not answer each other.
    const onResult = (event: Electron.IpcMainEvent, value: unknown): void => {
      if (event.sender !== win.webContents) return;
      finish(typeof value === 'string' && value.trim() ? value.trim() : null);
    };

    ipcMain.on(PROMPT_IPC.result, onResult);
    // Closing the window with the titlebar or Cmd+W is a cancel.
    win.on('closed', () => finish(null));
    win.once('ready-to-show', () => win.show());
    win.loadFile(path.join(RESOURCES, 'prompt.html'), { search: query.toString() }).catch((err: unknown) => {
      log.error('Could not open the prompt window', err);
      finish(null);
    });
  });
}
