// Preload for the small "ask for one line of text" window. Deliberately tiny:
// it exposes exactly two calls and no app bridge, because that window renders
// a fixed local page and needs nothing else.

import { contextBridge, ipcRenderer } from 'electron';
import { PROMPT_IPC } from '../shared/ipc';

contextBridge.exposeInMainWorld('generatoraiPrompt', {
  submit: (value: string): void => {
    ipcRenderer.send(PROMPT_IPC.result, value);
  },
  cancel: (): void => {
    ipcRenderer.send(PROMPT_IPC.result, null);
  },
});
