// ────────────────────────────────────────────────────────────────
// BrowserToolbar (F-dock-04) — two rows inside the URL form:
//
//   [◀] [▶] [↻]  ┌──── URL ────┐  [Sharing]  [Start]
//   [Annotate n] [Screenshot ▾] [device] ………………………… [⋯ DevTools] [■]
//
// Annotate (D-140) is one mode: hover, click an element or drag an area,
// comment; the comments collect in the tray under the page. Screenshot puts
// the visible area, the full page or a dragged area into the message.
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
import {
  MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger,
} from '@/ui/primitives/Menu/Menu.js';

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
  // Annotate / screenshot — only where there is a chat to send them to
  canComment: boolean;
  annotateOn: boolean;
  /** Saved comments (the count on the Annotate button). */
  commentCount: number;
  onToggleAnnotate: () => void;
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
    ? 'Annotating — click an element or drag across an area to comment. Click to finish'
    : 'Annotate — comment on elements or areas of the page and send them to the agent';

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
          <Button
            variant="ghost"
            size="sm"
            icon="message"
            pressed={p.annotateOn}
            onClick={p.onToggleAnnotate}
            title={annotateTitle}
            aria-label={annotateTitle}
            data-testid="browser-annotate"
          >
            Annotate
            {p.commentCount > 0 ? <span className="font-mono text-micro text-run tabular-nums">{p.commentCount}</span> : null}
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
                render={<IconButton size="sm" icon="more" label="Browser options" tooltip={false} title="More — open browser DevTools" />}
              />
              <MenuPopup align="end">
                <MenuGroup>
                  <MenuGroupLabel>Developer tools</MenuGroupLabel>
                  <MenuItem icon="tool" onClick={() => openNativeDevtools(tabId)}>Open DevTools</MenuItem>
                  <MenuItem icon="activity" onClick={() => openNativeDevtools(tabId, 'network')}>Open Network tab</MenuItem>
                  <MenuItem icon="terminal" onClick={() => openNativeDevtools(tabId, 'console')}>Open Console tab</MenuItem>
                </MenuGroup>
                <MenuSeparator />
                <MenuItem icon="pointer" onClick={() => openNativeDevtools(tabId, 'elements')}>Inspect elements</MenuItem>
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
