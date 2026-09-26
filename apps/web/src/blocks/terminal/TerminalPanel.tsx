// ────────────────────────────────────────────────────────────────
// TerminalPanel — one interactive shell per dock tab (F-dock-03; boards
// DockTerminal, ChatTerminal).
//
// Kit TerminalFrame: header row (cwd, host badge, "Agent working", quick
// `cd`), toolbar (Attach selection, Find `Ctrl F`) with Clear and a Kill
// behind a confirm popover, the xterm body (key-owning), the find widget, and
// a status footer built only from what the session descriptor reports.
// Session logic is `useTerminalSession`; the xterm host is `useXtermInstance`.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TerminalHostKind } from '@generatorai/shared';
import { cn } from '@/ui/lib/cn.js';
import { Icon } from '@/ui/icons/Icon.js';
import { Badge } from '@/ui/primitives/Badge/Badge.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { Kbd } from '@/ui/primitives/Kbd/Kbd.js';
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from '@/ui/primitives/Menu/Menu.js';
import { PopoverClose, PopoverPopup, PopoverRoot, PopoverTitle, PopoverTrigger } from '@/ui/primitives/Popover/Popover.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { FindWidget } from '@/ui/patterns/FindWidget/FindWidget.js';
import { TerminalFrame } from '@/ui/patterns/TerminalFrame/TerminalFrame.js';
import { shortenPath } from './shortenPath.js';
import { useTerminalSession } from './useTerminalSession.js';
import { useXtermInstance } from './useXtermInstance.js';

export interface TerminalWorktreeOption {
  /** Alias shown in the menu (e.g. `backend`). */
  alias: string;
  /** Path to `cd` into. */
  path: string;
}

export interface TerminalPanelProps {
  workspaceId: string | undefined;
  /** Stable dock tab id; keys the cached server session. */
  tabId: string;
  /** The tab's label ("Terminal 2"), named by the Kill confirmation. */
  label?: string;
  /** Receives a `.txt` File on "Attach selection"; without it Attach is disabled. */
  onCapture?: (file: File, kind: 'terminal') => void;
  /** Worktree quick-cd menu (workflow run page). */
  worktrees?: TerminalWorktreeOption[];
  /** The agent is working in this workspace (a hint badge only). */
  agentBusy?: boolean;
}

type AttachHint = { kind: 'none' } | { kind: 'empty' } | { kind: 'attached'; bytes: number };

const hostLabel: Record<TerminalHostKind, string> = {
  'node-pty': 'pty',
  'pty-host': 'pty',
  sandbox: 'sandbox',
  'fallback-child-process': 'fallback',
};

export function TerminalPanel({ workspaceId, tabId, label = 'Terminal', onCapture, worktrees, agentBusy = false }: TerminalPanelProps) {
  const xterm = useXtermInstance();
  const session = useTerminalSession(workspaceId, tabId, xterm.termRef);
  const { descriptor, connecting, error, exit } = session;
  const [attachHint, setAttachHint] = useState<AttachHint>({ kind: 'none' });
  const [killOpen, setKillOpen] = useState(false);
  const hintTimer = useRef<number | null>(null);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  // Typing goes to the find field (not the shell) the moment it opens.
  useEffect(() => {
    if (xterm.find.open) findInputRef.current?.focus();
  }, [xterm.find.open]);
  useEffect(() => () => { if (hintTimer.current != null) window.clearTimeout(hintTimer.current); }, []);

  const flashHint = useCallback((hint: AttachHint, ms: number) => {
    setAttachHint(hint);
    if (hintTimer.current != null) window.clearTimeout(hintTimer.current);
    hintTimer.current = window.setTimeout(() => setAttachHint({ kind: 'none' }), ms);
  }, []);

  const attachSelection = useCallback(() => {
    const term = xterm.termRef.current;
    if (!term) return;
    const sel = term.getSelection() ?? '';
    if (!sel.trim()) {
      flashHint({ kind: 'empty' }, 2500);
      return;
    }
    if (!onCapture) return;
    const blob = new Blob([sel], { type: 'text/plain' });
    onCapture(new File([blob], `terminal-selection-${Date.now()}.txt`, { type: 'text/plain' }), 'terminal');
    flashHint({ kind: 'attached', bytes: blob.size }, 2000);
    // Consumed: clearing the selection says so.
    try { term.clearSelection(); } catch { /* ignore */ }
  }, [xterm.termRef, onCapture, flashHint]);

  const exited = exit !== null;
  const cwdShort = useMemo(() => shortenPath(descriptor?.cwd ?? ''), [descriptor?.cwd]);
  const shellName = descriptor ? (descriptor.shell.split(/[\\/]/).pop() ?? descriptor.shell) : null;

  if (!workspaceId) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-small text-fg-3">
        Workspace not ready. Send a message first.
      </div>
    );
  }

  const header = (
    <div data-testid="terminal-header" className="flex min-w-0 flex-1 items-center gap-1.5">
      <Icon concept="terminal" size={14} className="shrink-0 text-fg-3" />
      <span data-testid="terminal-cwd" title={descriptor?.cwd} className="min-w-0 truncate font-mono text-small text-fg-2">
        {cwdShort || '…'}
      </span>
      {descriptor ? (
        <Badge className="font-mono" title={`${descriptor.shell} · pid ${descriptor.pid ?? '?'} · ${descriptor.host}`}>
          {hostLabel[descriptor.host]}
        </Badge>
      ) : null}
      {agentBusy ? (
        <Badge tone="run" icon="zap">
          Agent working
        </Badge>
      ) : null}
      {worktrees && worktrees.length > 0 ? (
        <MenuRoot>
          <MenuTrigger
            render={
              <Button variant="ghost" size="sm" icon="folder-open" trailingIcon="chevron-down" className="ml-auto" aria-label="cd to a worktree">
                cd
              </Button>
            }
          />
          <MenuPopup align="end">
            {worktrees.map((w) => (
              <MenuItem key={w.alias} description={w.path} onClick={() => session.cd(w.path)}>
                {w.alias}
              </MenuItem>
            ))}
          </MenuPopup>
        </MenuRoot>
      ) : null}
    </div>
  );

  const toolbar = (
    <>
      <Button
        variant="secondary"
        size="sm"
        icon="attach"
        data-testid="terminal-attach-to-chat"
        onClick={attachSelection}
        disabled={!onCapture}
        pressed={xterm.hasSelection && !!onCapture}
        title={
          !onCapture
            ? 'Attach is only available when a chat can receive it'
            : xterm.hasSelection
              ? 'Attach the current selection to the chat'
              : 'Select text in the terminal, then click Attach'
        }
      >
        Attach selection
      </Button>
      <Button variant="secondary" size="sm" icon="search" shortcut={['Ctrl', 'F']} pressed={xterm.find.open} onClick={xterm.openFind}>
        Find
      </Button>
    </>
  );

  const killConfirm = (killButton: React.ReactElement) => (
    // ConfirmPopover recipe (ChatTerminal board, 264 wide).
    <PopoverRoot open={killOpen} onOpenChange={(next) => setKillOpen(next)}>
      <PopoverTrigger render={killButton} />
      <PopoverPopup align="end" className="flex w-66 flex-col gap-2 p-3">
      <PopoverTitle className="m-0 text-ui font-semibold text-fg">{`Kill ${label}?`}</PopoverTitle>
      <p className="m-0 text-small leading-normal text-fg-3">
        Stops {shellName ?? 'the shell'} and whatever it is running. Scrollback is kept; close the tab to start a new shell.
      </p>
      <div className="mt-1 flex items-center justify-end gap-1.5">
        <PopoverClose render={<Button variant="ghost" size="sm" />}>
          Cancel <Kbd keys={['Esc']} aria-hidden />
        </PopoverClose>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            setKillOpen(false);
            void session.kill();
          }}
        >
          Kill process
        </Button>
      </div>
      </PopoverPopup>
    </PopoverRoot>
  );

  const status = descriptor ? (
    <>
      {exited ? (
        <Icon concept="status-failed" size={12} className="text-err" />
      ) : connecting ? (
        <Spinner size={12} label="Connecting" />
      ) : (
        <Icon concept="status-running" size={12} className="text-ok" />
      )}
      <span className="min-w-0 flex-1 truncate font-mono">
        {[shellName, descriptor.pid != null ? `pid ${descriptor.pid}` : null, descriptor.host].filter(Boolean).join(' · ')}
      </span>
      <span className="shrink-0 font-mono tabular-nums">{`${descriptor.cols}×${descriptor.rows}`}</span>
    </>
  ) : undefined;

  return (
    <TerminalFrame
      data-testid="terminal-panel"
      className={cn('h-full', descriptor?.host === 'sandbox' && 'ring-1 ring-inset ring-accent')}
      header={header}
      toolbar={toolbar}
      onClear={xterm.clear}
      killConfirm={killConfirm}
      killDisabled={exited || !descriptor}
      {...(status ? { status } : {})}
      find={
        xterm.find.open ? (
          <FindWidget
            label="Find in terminal"
            placeholder="Find…"
            query={xterm.find.query}
            onQueryChange={xterm.setFindQuery}
            {...(xterm.find.matches ? { matches: xterm.find.matches } : {})}
            onNext={xterm.findNext}
            onPrev={xterm.findPrev}
            onClose={xterm.closeFind}
            inputRef={findInputRef}
          />
        ) : undefined
      }
    >
      {descriptor?.host === 'sandbox' ? (
        <Callout tone="info" className="mb-2 shrink-0 font-sans">
          Sandbox-attached terminal — commands run inside the run&apos;s container.
        </Callout>
      ) : null}
      {descriptor?.host === 'fallback-child-process' ? (
        <Callout tone="warn" className="mb-2 shrink-0 font-sans">
          Fallback shell — vim, htop won&apos;t render. Install node-pty for a real PTY.
        </Callout>
      ) : null}
      <div className="relative min-h-0 flex-1">
        <div ref={xterm.containerRef} data-testid="terminal-container" className="absolute inset-0" />
        {attachHint.kind !== 'none' ? (
          <div
            className={cn(
              'pointer-events-none absolute top-2 left-1/2 flex -translate-x-1/2 items-center gap-1.5 rounded-control border px-3 py-1 font-sans text-small shadow-pop',
              attachHint.kind === 'empty' ? 'border-warn bg-warn-bg text-warn' : 'border-ok bg-ok-bg text-ok',
            )}
          >
            {attachHint.kind === 'empty'
              ? 'Select text in the terminal first, then click Attach.'
              : `Attached to chat (${attachHint.bytes} bytes) — will send with next message.`}
          </div>
        ) : null}
        {connecting && !error && !exited ? (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center gap-2 bg-scrim font-sans text-small text-fg">
            <Spinner size={14} label="Starting terminal" /> Starting terminal…
          </div>
        ) : null}
        {error && !exited ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-1 bg-scrim p-4 text-center font-sans">
            <Icon concept="status-failed" size={16} className="text-err" />
            <span className="text-ui font-semibold text-fg">{error}</span>
            {error === 'Terminal connection error' ? (
              <span className="text-small text-fg-3">
                The shell keeps running on the server. Reload the page to reattach; scrollback is replayed.
              </span>
            ) : null}
          </div>
        ) : null}
        {exited ? (
          <Callout data-testid="terminal-exited" tone="err" className="pointer-events-none absolute right-2 bottom-2 left-2 font-sans">
            Process exited{exit?.signal ? ` (${exit.signal})` : ''} — code {exit?.code ?? '?'}. Close the tab to restart.
          </Callout>
        ) : null}
      </div>
    </TerminalFrame>
  );
}
