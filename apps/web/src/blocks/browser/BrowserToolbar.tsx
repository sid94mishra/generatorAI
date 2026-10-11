// ────────────────────────────────────────────────────────────────
// BrowserToolbar (F-dock-04) — two rows inside the URL form:
//
//   [◀] [▶] [↻]  ┌──── URL ────┐  [Sharing]  [Start]
//   [↖] [💬 Comments n] [Screenshot ▾] [device] …………………… [⋯ Open DevTools] [■]
//
// ↖ Select element (D-145): hover the page, click an element or drag an area,
// and comment on it in the Comments panel (the Changes review's form).
// Comments toggles that panel. Screenshot puts the visible area, the full
// page or a dragged area into the message. ⋯ opens DevTools.
// Restricted web interactivity swaps the URL field for a read-only pill and
// keeps only Share and Annotate (the only way to attach an element there).
// Device, DevTools and the full/visible screenshots are desktop-native only.
// ────────────────────────────────────────────────────────────────

import type { FormEvent } from 'react';
import { openNativeDevtools } from './nativeBrowserBridge.js';
import type { BrowserScreenshotKind } from './useBrowserAnnotations.js';
import type { BrowserBusy, BrowserHistoryAction } from './useBrowserNavigation.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Input } from '@/ui/primitives/Input/Input.js';
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from '@/ui/primitives/Menu/Menu.js';

export interface BrowserToolbarProps {
  isOn: boolean;
  /** Full interactivity: nav buttons, URL input, Capture, Start/Stop. */
  canDrive: boolean;
  nativeAvailable: boolean;
  /** Native tab id for DevTools; the menu shows only with one and a workspace. */
  devtoolsTabId: string | null;
  loading: BrowserBusy | null;
  agentBusy: boolean;
  // URL
  urlInput: string;
  onUrlInput: (value: string) => void;
  onUrlFocus: (focused: boolean) => void;
  pillUrl: string | undefined;
  onSubmit: (e: FormEvent) => void;
  onAction: (kind: BrowserHistoryAction) => void;
  onStart: () => void;
  onStop: () => void;
  // Share
  attachedToChat: boolean;
  shareTitle: string;
  onToggleShare: () => void;
  // Select / comments / screenshot — only where there is a chat to send them to
  canComment: boolean;
  /** Select mode (↖) is on. */
  annotateOn: boolean;
  onToggleAnnotate: () => void;
  /** Saved comments (the count on the Comments button). */
  commentCount: number;
  commentsOpen: boolean;
  onToggleComments: () => void;
  /** Web: the dragged-area capture is armed on the live view. */
  captureMode: boolean;
  onScreenshot: (kind: BrowserScreenshotKind) => void;
  // Device emulation
  emulationOn: boolean;
  onToggleEmulation: () => void;
}

export function BrowserToolbar(p: BrowserToolbarProps): React.JSX.Element {
  const { isOn, canDrive, nativeAvailable, loading } = p;
  const nativeTools = nativeAvailable && isOn && p.devtoolsTabId !== null;
  const tabId = p.devtoolsTabId;
  const annotateTitle = p.annotateOn
    ? 'Selecting — click an element or drag across an area to comment on it (Esc to finish)'
    : 'Select an element on the page to comment on it';

  return (
    <form data-testid="browser-toolbar" onSubmit={p.onSubmit} className="@container flex flex-col border-b border-line-soft">
      <div className="flex items-center gap-1 px-2 py-1.5">
        {canDrive && (
          <>
            <IconButton size="sm" icon="back" label="Back" onClick={() => p.onAction('back')} disabled={!isOn} />
            <IconButton size="sm" icon="forward" label="Forward" onClick={() => p.onAction('forward')} disabled={!isOn} />
            <IconButton size="sm" icon="refresh" label="Reload" onClick={() => p.onAction('reload')} disabled={!isOn} />
          </>
        )}
        {canDrive ? (
          <Input
            size="sm"
            type="text"
            value={p.urlInput}
            onChange={(e) => p.onUrlInput(e.target.value)}
            onFocus={() => p.onUrlFocus(true)}
            onBlur={() => p.onUrlFocus(false)}
            data-testid="browser-url"
            placeholder={nativeAvailable ? 'Search or enter address' : (isOn ? 'https://example.com' : 'https://…  (press Start)')}
            className="mx-1 min-w-24 flex-1"
          />
        ) : (
          // Restricted mode — the user sees the current URL as a read-only pill.
          <div
            data-testid="browser-url"
            title={p.pillUrl}
            className="mx-1 min-w-0 flex-1 truncate rounded-control border border-line-soft bg-sunken px-2.5 py-1 text-small text-fg-2"
          >
            {p.pillUrl ?? 'about:blank'}
          </div>
        )}
        {isOn && (
          <Button
            variant="secondary"
            size="sm"
            icon="link"
            pressed={p.attachedToChat}
            onClick={p.onToggleShare}
            disabled={p.agentBusy || loading === 'share'}
            title={p.shareTitle}
            aria-label={p.shareTitle}
          >
            <span className="hidden @md:inline">{p.attachedToChat ? 'Sharing' : 'Share'}</span>
          </Button>
        )}
        {canDrive && !isOn && (
          <Button variant="primary" size="sm" icon="play" loading={loading === 'start'} onClick={p.onStart}>
            Start
          </Button>
        )}
      </div>

      {isOn && (
        <div className="flex items-center gap-1 px-2 pb-1.5">
          {p.canComment && (
            <IconButton
              size="sm"
              icon="pointer"
              label={annotateTitle}
              tooltip={p.annotateOn ? 'Selecting — Esc to finish' : 'Select an element to comment'}
              pressed={p.annotateOn}
              onClick={p.onToggleAnnotate}
              data-testid="browser-annotate"
            />
          )}
          {p.canComment && nativeAvailable && (
            <Button
              variant="ghost"
              size="sm"
              icon="message"
              pressed={p.commentsOpen}
              onClick={p.onToggleComments}
              title="Comments on this page"
              aria-label={`Comments (${p.commentCount})`}
              data-testid="browser-comments-toggle"
            >
              <span className="inline-flex items-center gap-1.5">
                <span className="hidden @md:inline">Comments</span>
                {p.commentCount > 0 ? <span className="font-mono text-micro text-run tabular-nums">{p.commentCount}</span> : null}
              </span>
            </Button>
          )}
          {!p.canComment ? null : canDrive && nativeAvailable ? (
            <MenuRoot>
              <MenuTrigger
                render={
                  <Button variant="ghost" size="sm" icon="camera" trailingIcon="chevron-down" data-testid="browser-screenshot" title="Screenshot — add the page to your message">
                    <span className="hidden @md:inline">Screenshot</span>
                  </Button>
                }
              />
              <MenuPopup align="start">
                <MenuItem icon="image" onClick={() => p.onScreenshot('visible')}>Visible area</MenuItem>
                <MenuItem icon="file" onClick={() => p.onScreenshot('full')}>Full page</MenuItem>
                <MenuItem icon="scan" onClick={() => p.onScreenshot('area')}>Select an area…</MenuItem>
              </MenuPopup>
            </MenuRoot>
          ) : canDrive ? (
            <IconButton
              size="sm"
              icon="camera"
              label="Screenshot an area — drag on the page to add it to your message"
              pressed={p.captureMode}
              onClick={() => p.onScreenshot('area')}
            />
          ) : null}
          {nativeTools && (
            <IconButton
              size="sm"
              icon="device"
              label="Toggle device toolbar — responsive dimensions, zoom & mobile emulation"
              pressed={p.emulationOn}
              onClick={p.onToggleEmulation}
            />
          )}
          <span className="flex-1" />
          {nativeTools && tabId !== null && (
            <MenuRoot>
              <MenuTrigger
                render={<IconButton size="sm" icon="more" label="Browser options" tooltip={false} title="More — Open DevTools" />}
              />
              <MenuPopup align="end">
                <MenuItem icon="tool" onClick={() => openNativeDevtools(tabId)}>Open DevTools</MenuItem>
              </MenuPopup>
            </MenuRoot>
          )}
          {canDrive && (
            <IconButton size="sm" icon="stop" label="Stop browser" onClick={p.onStop} disabled={loading === 'stop'} />
          )}
        </div>
      )}
    </form>
  );
}
