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
    const win = BrowserWindow.getFocusedWindow() ?? undefined;

    const target = dialog.showSaveDialogSync(win!, { defaultPath });
    if (!target) {
      item.cancel();
      return;
    }
    item.setSavePath(target);

    item.once('done', (_e, state) => {
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
