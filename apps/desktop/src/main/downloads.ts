// ────────────────────────────────────────────────────────────────
// Native download handling — the web app triggers downloads via blob anchors
// and direct links. We intercept `will-download` so the user gets a native
// "Save As" dialog and the file lands wherever they choose, instead of a
// silent download to a default folder.
// ────────────────────────────────────────────────────────────────

import { app, dialog, shell, BrowserWindow, type Session } from 'electron';
import * as path from 'node:path';
import { log } from './logger';

export function registerDownloadHandler(session: Session): void {
  session.on('will-download', (_event, item) => {
    const suggested = item.getFilename() || 'download';
    const defaultPath = path.join(app.getPath('downloads'), suggested);
    const win = BrowserWindow.getFocusedWindow();

    // `setSaveDialogOptions` + the ASYNCHRONOUS dialog. The synchronous one
    // blocked the whole main process while the sheet was open: every window
    // froze, IPC stopped, the tray and menus stopped responding, and the
    // embedded server lost its supervisor for as long as the user took to
    // pick a folder. Electron keeps the item alive until a save path is set,
    // so answering later is fine.
    const pick = win
      ? dialog.showSaveDialog(win, { defaultPath })
      : dialog.showSaveDialog({ defaultPath });

    void pick.then(({ canceled, filePath }) => {
      if (canceled || !filePath) {
        item.cancel();
        return;
      }
      item.setSavePath(filePath);
    }).catch((err: unknown) => {
      log.error('Save dialog failed', err);
      item.cancel();
    });

    item.once('done', (_e, state) => {
      const target = item.getSavePath();
      if (state === 'completed') {
        log.info('Download saved', { target });
        // Reveal in the OS file manager for quick access.
        shell.showItemInFolder(target);
      } else {
        log.warn('Download failed', { state, target });
      }
    });
  });
}
