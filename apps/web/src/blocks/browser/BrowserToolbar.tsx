// ────────────────────────────────────────────────────────────────
// BrowserToolbar (F-dock-04) — two rows inside the URL form:
//
//   [◀] [▶] [↻]  ┌──── URL ────┐  [Sharing]  [Start]
//   [Comment] [Comments n ▾] [capture] [device] ………… [⋯ DevTools] [■]
//
// Restricted web interactivity swaps the URL field for a read-only pill and
// keeps only Share and Comment (the only way to attach an element there).
// Device, DevTools and the Comments list are desktop-native only.
// ────────────────────────────────────────────────────────────────

import type { FormEvent } from 'react';
import type { AnnotationSummary } from './browserAnnotations.js';
import { CommentsPopover } from './CommentsPopover.js';
import { openNativeDevtools } from './nativeBrowserBridge.js';
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
  // Comment / capture
  commentOn: boolean;
  annotateOn: boolean;
  onToggleComment: () => void;
  captureMode: boolean;
  onToggleCapture: () => void;
  comments: readonly AnnotationSummary[];
  commentsOpen: boolean;
  onCommentsOpenChange: (open: boolean) => void;
  onSendComments: (keys?: string[]) => void;
  onRemoveComment: (key: string) => void;
  onClearComments: () => void;
  // Device emulation
  emulationOn: boolean;
  onToggleEmulation: () => void;
}

export function BrowserToolbar(p: BrowserToolbarProps): React.JSX.Element {
  const { isOn, canDrive, nativeAvailable, loading } = p;
  const nativeTools = nativeAvailable && isOn && p.devtoolsTabId !== null;
  const tabId = p.devtoolsTabId;
  const commentTitle = p.annotateOn
    ? 'Commenting — click elements to leave notes; click to exit'
    : 'Comment — click elements to leave notes and attach them to chat';
  const captureTitle = nativeAvailable
    ? 'Comment on a region — drag to select an area, add a note, and send to chat'
    : 'Capture region — drag to select an area and attach it to chat';

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
          <Button
            variant="ghost"
            size="sm"
            icon="message"
            pressed={p.commentOn}
            onClick={p.onToggleComment}
            title={commentTitle}
            aria-label={commentTitle}
          >
            Comment
          </Button>
          {nativeAvailable && p.annotateOn && (
            <CommentsPopover
              items={p.comments}
              open={p.commentsOpen}
              onOpenChange={p.onCommentsOpenChange}
              onSend={p.onSendComments}
              onRemove={p.onRemoveComment}
              onClear={p.onClearComments}
            />
          )}
          {canDrive && (
            <IconButton size="sm" icon="camera" label={captureTitle} pressed={p.captureMode} onClick={p.onToggleCapture} />
          )}
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
