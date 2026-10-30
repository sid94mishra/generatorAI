// Preload for the small "ask for one line of text" window.
//
// `prompt.html` carries no script of its own (06 §7: `default-src 'none'`,
// no `script-src` — tightened in P5-11 along with the page's tokens). Every
// DOM wire-up that used to live in an inline <script> there now happens
// here instead: a preload is loaded by Electron directly, not parsed as a
// page <script>, so it is unaffected by the page's CSP.
import { ipcRenderer } from 'electron';
import { PROMPT_IPC } from '../shared/ipc';

function respond(value: string | null): void {
  ipcRenderer.send(PROMPT_IPC.result, value);
}

window.addEventListener('DOMContentLoaded', () => {
  const params = new URLSearchParams(location.search);
  const title = document.getElementById('title');
  const message = document.getElementById('message');
  const input = document.getElementById('value') as HTMLInputElement | null;
  const ok = document.getElementById('ok') as HTMLButtonElement | null;
  const cancelButton = document.getElementById('cancel');
  if (!title || !message || !input || !ok || !cancelButton) return;

  title.textContent = params.get('title') || '';
  message.textContent = params.get('message') || '';
  input.placeholder = params.get('placeholder') || '';
  input.value = params.get('value') || '';
  const confirmLabel = params.get('confirm');
  if (confirmLabel) ok.textContent = confirmLabel;

  const sync = (): void => {
    ok.disabled = input.value.trim().length === 0;
  };
  const submit = (): void => {
    if (!ok.disabled) respond(input.value.trim());
  };

  input.addEventListener('input', sync);
  ok.addEventListener('click', submit);
  cancelButton.addEventListener('click', () => respond(null));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submit();
    if (e.key === 'Escape') respond(null);
  });
  sync();
  input.focus();
});
