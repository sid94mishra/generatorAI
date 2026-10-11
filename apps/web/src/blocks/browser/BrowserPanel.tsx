// ────────────────────────────────────────────────────────────────
// BrowserPanel (F-dock-04) — the Integrated Browser dock panel.
//
// A thin view over the blocks/browser hooks (P4-03): the transport
// (useBrowserDescriptor, useBrowserEvents, useBrowserLiveStream,
// useBrowserViewport), session control (useBrowserNavigation), comment /
// capture modes (useBrowserAnnotations, useBrowserCapture,
// useBrowserLiveInput), device emulation and tab state. The hooks are called
// in the order the effects ran when they lived in one file: the desktop
// auto-start races the first descriptor poll against the native probe, and
// that race is pinned by the characterization suites.
//
// Layout: BrowserToolbar · AgentBrowsingStrip (while the turn streams) ·
// DeviceEmulationBar · annotate strip · error Callout · live view
// (NativeBrowserView on desktop, else the screencast canvas with the capture
// rectangle and the overlay scrollbar) · status bar.
//
// Interactivity: the desktop native browser is always fully interactive; the
// web build follows the `webInteractivity` preference (default off: read-only
// URL pill, scroll + Comment only).
// ────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react';
import { annotationPalette } from '@generatorai/design-tokens';
import { useWebBrowserInteractivity } from '@/lib/browserInteractivity.js';
import { useTheme } from '@/providers/ThemeProvider.js';
import { Icon } from '@/ui/icons/Icon.js';
import { cn } from '@/ui/lib/cn.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { StatusDot, type DotTone } from '@/ui/primitives/StatusDot/StatusDot.js';
import { AgentBrowsingStrip } from './AgentBrowsingStrip.js';
import type { BrowserDescriptor } from './browserApi.js';
import { selectionAttachment, type BrowserSelection } from './browserEvents.js';
import { displayBrowserUrl, scrollbarThumb } from './browserInput.js';
import { BrowserEmptyState } from './BrowserEmptyState.js';
import { BrowserToolbar } from './BrowserToolbar.js';
import { DeviceEmulationBar } from './DeviceEmulationBar.js';
import { useNativeBrowserAvailable } from './nativeBrowserBridge.js';
import { NativeBrowserView } from './NativeBrowserView.js';
import { CommentTray } from './CommentTray.js';
import { useBrowserAnnotations, type BrowserCaptureHandler, type BrowserSendHandler } from './useBrowserAnnotations.js';
import { useBrowserCapture } from './useBrowserCapture.js';
import { useBrowserDescriptor } from './useBrowserDescriptor.js';
import { useBrowserEvents } from './useBrowserEvents.js';
import { useBrowserLiveInput } from './useBrowserLiveInput.js';
import { useBrowserLiveStream, type BrowserStreamState } from './useBrowserLiveStream.js';
import { useBrowserNavigation } from './useBrowserNavigation.js';
import { useBrowserTabState, type BrowserTabState } from './useBrowserTabState.js';
import { useBrowserScrollState, useBrowserViewportResize } from './useBrowserViewport.js';
import { useDeviceEmulation } from './useDeviceEmulation.js';

export type { BrowserTabState };

// ── Types ────────────────────────────────────────────────────

export interface BrowserPanelProps {
  workspaceId: string | undefined;
  /**
   * Stable per-instance id for this browser tab (the dock tab id). Each dock
   * "Browser" tab is its own native WebContentsView keyed by this id, so tabs
   * stay isolated (page, history, cookies, title, favicon). Falls back to the
   * workspace id.
   */
  tabId?: string;
  open: boolean;
  /** Host close handler; the dock owns closing, so the panel draws no close button. */
  onClose?: () => void;
  /** Called when the user picks an inspector selection / region to send to chat. */
  onCapture?: BrowserCaptureHandler;
  /** Send files as a message now (browser comments' "Send to agent"). */
  onSend?: BrowserSendHandler;
  /** True while a chat / stage turn streams: locks the share toggle and shows the AgentBrowsingStrip. */
  agentBusy?: boolean;
  /** The agent driving the turn, for the AgentBrowsingStrip ("The agent" when omitted). */
  agentName?: string;
  /** Fires when the page's tab state changes (spinner → favicon + title in the dock tab). */
  onTabStateChange?: (state: BrowserTabState) => void;
  /**
   * Namespace for this tab's last-visited URL (`chat:<chatId>`,
   * `workflow-run:<runId>`), so a remounted native view comes back on its
   * page. Omit to disable URL memory.
   */
  urlScopeKey?: string;
  /**
   * False while mounted but not the selected dock tab (P1-50): the live-view
   * socket is closed and reopens once the tab is selected again.
   */
  visible?: boolean;
}

/**
 * Chrome-like tab icon for the Browser tab: a spinner while the page loads,
 * the page favicon once loaded (a globe if it fails), a globe when idle.
 */
export function BrowserTabIcon({ state }: { state: BrowserTabState | null | undefined }): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  const favicon = state?.favicon ?? null;
  useEffect(() => { setBroken(false); }, [favicon]);
  if (state?.loading) return <Spinner size={14} label="Page loading" />;
  if (favicon && !broken) {
    return <img src={favicon} alt="" className="size-3.5 shrink-0 rounded-badge object-contain" onError={() => setBroken(true)} />;
  }
  return <Icon concept="browser" size={14} />;
}

/** The tab label for the Browser tab: the page title, or "Browser". */
export function browserTabLabel(state: BrowserTabState | null | undefined): string {
  const t = (state?.title ?? '').trim();
  return t || 'Browser';
}

// ── Status bar ───────────────────────────────────────────────

const STATUS_TONE: Record<string, DotTone> = { active: 'ok', starting: 'warn', error: 'err' };

const STREAM_NOTE: Partial<Record<BrowserStreamState, { text: string; title: string; className: string }>> = {
  connecting: { text: 'connecting…', title: 'Connecting live view…', className: 'text-fg-3' },
  reconnecting: { text: 'reconnecting…', title: 'Live-view connection dropped — retrying', className: 'text-warn' },
  degraded: {
    text: 'degraded (polling)',
    title: 'Live-view falling back to slower polling after repeated reconnect failures',
    className: 'text-err',
  },
};

function BrowserStatusBar({ descriptor, streamState, zoom }: {
  descriptor: BrowserDescriptor;
  streamState: BrowserStreamState;
  /** Page zoom, only while the device toolbar is on. */
  zoom: number | null;
}): React.JSX.Element {
  const { status, mode, viewport } = descriptor;
  const modeLabel = mode === 'screencast' ? 'live view' : mode === 'native' ? 'native view' : null;
  const details = [
    modeLabel,
    viewport ? `${viewport.width}×${viewport.height}` : null,
    zoom !== null ? `${Math.round(zoom * 100)}%` : null,
  ].filter((d): d is string => d !== null);
  const note = mode === 'screencast' ? STREAM_NOTE[streamState] : undefined;
  return (
    <div className="flex h-footer shrink-0 items-center gap-2 border-t border-line-soft px-3 text-small text-fg-2">
      <StatusDot tone={STATUS_TONE[status] ?? 'muted'} size="sm" />
      <span className="capitalize">{status}</span>
      {details.length > 0 && <span className="truncate font-mono text-micro text-fg-3">{details.join(' · ')}</span>}
      {note && <span className={cn('font-mono text-micro', note.className)} title={note.title}>{note.text}</span>}
      {descriptor.config?.visibility && (
        <span className="ml-auto font-mono text-micro text-fg-3">{descriptor.config.visibility}</span>
      )}
    </div>
  );
}

// ── Component ────────────────────────────────────────────────

export function BrowserPanel({
  workspaceId, tabId, open, onCapture, onSend, agentBusy = false, agentName, onTabStateChange, urlScopeKey, visible = true,
}: BrowserPanelProps): React.JSX.Element | null {
  const { resolvedTheme, themeId } = useTheme();
  // Colours of the overlays injected into native-browser pages (06 §4.4).
  const overlayPalette = useMemo(() => annotationPalette(themeId, resolvedTheme), [themeId, resolvedTheme]);
  // The native browser tab id for THIS panel: all native `browser.*` calls
  // key off it so each dock Browser tab is its own WebContentsView.
  const nativeTabId = tabId ?? workspaceId ?? null;
  const [error, setError] = useState<string | null>(null);

  const interactivityOn = useWebBrowserInteractivity();
  const {
    descriptor, setDescriptor, browserDenied, sessionKey, restart: restartSession, refresh: refreshDescriptor,
  } = useBrowserDescriptor({ open, workspaceId });
  const nativeAvailable = useNativeBrowserAvailable();
  // Full interactivity: the desktop native browser, or the web preference.
  // Otherwise the user can see, scroll and Comment; everything else is the agent's.
  const fullInteractivity = nativeAvailable || interactivityOn;

  const {
    inspectorOn, setInspectorOn, captureMode, setCaptureMode,
    annotateOn, items: comments, sending, notice,
    toggleAnnotate, send: sendComments, openComment, removeComment, clearComments, screenshot,
  } = useBrowserAnnotations({ open, workspaceId, nativeTabId, nativeAvailable, palette: overlayPalette, onCapture, onSend, setError });

  // Inspector selection → the chat composer via `onCapture`. One-shot:
  // Inspect turns off after a pick (InspectorScript.setEnabled(false)).
  const onSelection = (sel: BrowserSelection): void => {
    if (!onCapture) return;
    onCapture(selectionAttachment(sel), 'selection');
    setInspectorOn(false);
  };
  useBrowserEvents({ open, workspaceId, onDescriptor: setDescriptor, onSelection });

  const liveContainerRef = useBrowserViewportResize({ open, workspaceId, ready: descriptor?.ready });
  const { scrollState, setScrollState } = useBrowserScrollState({ open, workspaceId, ready: descriptor?.ready, mode: descriptor?.mode });

  const {
    restoreUrl, urlInput, setUrlInput, setUrlInputFocused, nativeUrl, onNativeUrlChange,
    loading, attachedToChat, shareTitle,
    handleStart, handleStop, handleNavigate, handleAction, handleToggleShare,
  } = useBrowserNavigation({
    open, workspaceId, nativeTabId, nativeAvailable, urlScopeKey, agentBusy,
    descriptor, setDescriptor, refreshDescriptor, restartSession, setError,
  });

  const { canvasRef: liveCanvasRef, hasFrame, streamState, sendInput } = useBrowserLiveStream({
    open, visible, workspaceId, ready: descriptor?.ready, mode: descriptor?.mode, sessionKey,
  });

  const { onNativeTitleChange, onNativeLoadingChange, onNativeFaviconChange } = useBrowserTabState({
    open, nativeAvailable, nativeUrl, descriptorStatus: descriptor?.status, descriptorUrl: descriptor?.currentUrl,
    urlScopeKey, nativeTabId, onTabStateChange,
  });

  const {
    emulationOn, emuPreset, emuWidth, emuHeight, emuDpr, emuMobile, emuZoom,
    handleToggleEmulation, handlePickPreset, handleEmuDimChange, handleEmuRotate, handleEmuZoom, handleEmuDpr, handleEmuMobile,
  } = useDeviceEmulation({ nativeAvailable, nativeTabId });

  const {
    handleLiveClick, handleLiveWheel, handleLiveMouseMove, handleLiveKeyDown, scrollBarRef, handleScrollThumbDown,
  } = useBrowserLiveInput({ canvasRef: liveCanvasRef, sendInput, inspectorOn, fullInteractivity, scrollState, setScrollState });

  const { captureRect, handleCaptureMouseDown, handleCaptureMouseMove, handleCaptureMouseUp } = useBrowserCapture({
    workspaceId, captureMode, setCaptureMode, canvasRef: liveCanvasRef, onCapture, setError,
  });

  if (!open) return null;

  const status = descriptor?.status ?? 'off';
  const isOn = descriptor?.ready === true;
  // The internal `about:blank#gai-…` discovery marker never reaches the pill.
  const pillUrl = displayBrowserUrl(descriptor?.currentUrl);
  const scrollThumb = scrollState ? scrollbarThumb(scrollState) : null;
  const nativeView = nativeAvailable && workspaceId && nativeTabId;

  return (
    <div className="flex h-full w-full flex-col bg-surface text-fg">
      <BrowserToolbar
        isOn={isOn}
        canDrive={fullInteractivity}
        nativeAvailable={nativeAvailable}
        devtoolsTabId={workspaceId ? nativeTabId : null}
        loading={loading}
        agentBusy={agentBusy}
        urlInput={urlInput}
        onUrlInput={setUrlInput}
        onUrlFocus={setUrlInputFocused}
        pillUrl={pillUrl}
        onSubmit={handleNavigate}
        onAction={(kind) => { void handleAction(kind); }}
        onStart={() => { void handleStart(); }}
        onStop={() => { void handleStop(); }}
        attachedToChat={attachedToChat}
        shareTitle={shareTitle}
        onToggleShare={() => { void handleToggleShare(); }}
        canComment={!!(onCapture || onSend)}
        annotateOn={inspectorOn || annotateOn}
        commentCount={comments.length}
        onToggleAnnotate={() => { void toggleAnnotate(); }}
        captureMode={captureMode}
        onScreenshot={(kind) => { void screenshot(kind); }}
        emulationOn={emulationOn}
        onToggleEmulation={handleToggleEmulation}
      />

      {agentBusy && isOn && <AgentBrowsingStrip agentName={agentName} />}

      {nativeAvailable && isOn && emulationOn && (
        <DeviceEmulationBar
          preset={emuPreset}
          width={emuWidth}
          height={emuHeight}
          dpr={emuDpr}
          mobile={emuMobile}
          zoom={emuZoom}
          onPickPreset={handlePickPreset}
          onDimChange={handleEmuDimChange}
          onRotate={handleEmuRotate}
          onDpr={handleEmuDpr}
          onMobile={handleEmuMobile}
          onZoom={handleEmuZoom}
        />
      )}

      {error && (
        <div className="px-2 pt-2">
          <Callout
            tone="err"
            action={<IconButton size="sm" icon="x" label="Dismiss" onClick={() => setError(null)} />}
          >
            <span className="block truncate" title={error}>{error}</span>
          </Callout>
        </div>
      )}

      {/* Live view ─────────────────────────────────────── */}
      {nativeView ? (
        <NativeBrowserView
          tabId={nativeTabId}
          workspaceId={workspaceId}
          restoreUrl={restoreUrl}
          onUrlChange={onNativeUrlChange}
          onTitleChange={onNativeTitleChange}
          onLoadingChange={onNativeLoadingChange}
          onFaviconChange={onNativeFaviconChange}
          onError={(msg) => setError(msg)}
        />
      ) : (
        <div ref={liveContainerRef} data-testid="browser-live-view" className="relative flex min-h-0 flex-1 items-center justify-center bg-sunken">
          {/* Mounted for the whole time the browser is on: the decoder needs
              somewhere to draw before the first frame, and the canvas holds the
              last frame on screen while the socket reconnects. */}
          {isOn && (
            <canvas
              ref={liveCanvasRef}
              role="img"
              aria-label="Browser live view"
              className={cn(
                'h-full w-full object-contain select-none focus:outline-none',
                !hasFrame && 'opacity-0',
                captureMode ? 'cursor-crosshair' : inspectorOn ? 'cursor-copy' : fullInteractivity ? 'cursor-pointer' : 'cursor-default',
              )}
              tabIndex={0}
              onClick={captureMode ? undefined : handleLiveClick}
              onContextMenu={(e) => { e.preventDefault(); if (!captureMode) handleLiveClick(e); }}
              onWheel={handleLiveWheel}
              onMouseMove={captureMode ? handleCaptureMouseMove : handleLiveMouseMove}
              onMouseDown={captureMode ? handleCaptureMouseDown : undefined}
              onMouseUp={captureMode ? handleCaptureMouseUp : undefined}
              onKeyDown={handleLiveKeyDown}
            />
          )}
          {!(isOn && hasFrame) && (
            <BrowserEmptyState status={status} isOn={isOn} denied={browserDenied} canDrive={fullInteractivity} />
          )}

          {/* Capture-drag rectangle */}
          {captureMode && captureRect && (
            <div
              className="pointer-events-none absolute border-2 border-ok bg-ok-bg"
              style={{ left: captureRect.x, top: captureRect.y, width: captureRect.w, height: captureRect.h }}
            />
          )}

          {/* Overlay scrollbar (headless Chromium paints none) — draggable */}
          {isOn && hasFrame && scrollThumb && (
            <div ref={scrollBarRef} className="absolute top-2 right-1.5 bottom-2 w-2.5 rounded-full bg-hover ring-1 ring-line" aria-hidden>
              <div
                onMouseDown={handleScrollThumbDown}
                className="absolute inset-x-0 cursor-grab rounded-full bg-fg-3 active:cursor-grabbing"
                style={{ top: `${scrollThumb.topPct}%`, height: `${scrollThumb.heightPct}%` }}
              />
            </div>
          )}
        </div>
      )}

      {nativeAvailable && isOn && (onCapture || onSend) && (
        <CommentTray
          items={comments}
          annotating={annotateOn}
          sending={sending}
          notice={notice}
          canSendNow={!!onSend}
          canAddToMessage={!!onCapture}
          onSendNow={() => { void sendComments('now'); }}
          onAddToMessage={() => { void sendComments('message'); }}
          onOpen={(key) => { void openComment(key); }}
          onRemove={(key) => { void removeComment(key); }}
          onClear={() => { void clearComments(); }}
        />
      )}

      {descriptor && <BrowserStatusBar descriptor={descriptor} streamState={streamState} zoom={nativeAvailable && emulationOn ? emuZoom : null} />}
    </div>
  );
}
