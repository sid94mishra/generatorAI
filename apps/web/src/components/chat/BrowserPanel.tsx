// ────────────────────────────────────────────────────────────────
// BrowserPanel — Integrated Browser UI (v14, VSCode-style redesign).
//
// Top bar layout (matches VSCode's Simple Browser + Sharing widget):
//
//   [◀] [▶] [↻]   ┌────── URL ─────┐   [Share] [Inspect] [Capture]
//
// Behaviour:
//   • Share button toggles "attach to chat" (VSCode `sharingState`
//     Shared/NotShared). Detach is disabled while a turn is in flight
//     (the parent passes `agentBusy`). Next user prompt auto-reattaches
//     on the server (BrowserService.reattachOnPrompt).
//   • Inspect click → element selection is auto-attached to chat
//     as a JSON File via `onCapture`. No more snapshot gallery.
//   • Capture drag → rectangle → server crops PNG → attached to chat.
//   • Web-UI user-interactivity toggle (lib/browserInteractivity.ts,
//     default OFF) hides back/forward/reload/URL bar/Stop/Capture. When
//     OFF, the user can still scroll the page and pick elements via
//     Inspect, but click/type/navigate are blocked in the SPA. Desktop
//     always runs at full interactivity.
//   • Overlay scrollbar (headless Chromium doesn't paint native
//     scrollbars) is drag-to-scroll.
//
// This file is the view. The logic lives in blocks/browser/ (P4-03): the
// transport (browserApi, useBrowserDescriptor, useBrowserEvents,
// useBrowserLiveStream, useBrowserViewport), the input mapping
// (browserInput), session control (useBrowserNavigation), comment/capture
// modes (useBrowserAnnotations, useBrowserCapture, useBrowserLiveInput),
// device emulation and tab state. The hooks are called in the order the
// effects ran when they lived here: the desktop auto-start races the first
// descriptor poll against the native probe, and that race is pinned.
// ────────────────────────────────────────────────────────────────

import { useEffect, useState } from 'react';
import {
  X, ArrowLeft, ArrowRight, RotateCw, Play, Square,
  MousePointerClick, AlertTriangle,
  Share2, Link2Off, Crop, MoreVertical, Wrench, Activity, Terminal,
  Smartphone, RotateCcw, MessageSquare, Trash, Send, Globe,
} from 'lucide-react';
import { Button, Input, Spinner } from '@/components/ui/index.js';
import { cn } from '@/lib/utils.js';
import { useWebBrowserInteractivity } from '@/lib/browserInteractivity.js';
import { useTheme } from '@/providers/ThemeProvider.js';
import { displayBrowserUrl, scrollbarThumb } from '@/blocks/browser/browserInput.js';
import { DEVICE_PRESETS, ZOOM_LEVELS } from '@/blocks/browser/deviceEmulation.js';
import { openNativeDevtools, useNativeBrowserAvailable } from '@/blocks/browser/nativeBrowserBridge.js';
import { useBrowserAnnotations, type BrowserCaptureHandler } from '@/blocks/browser/useBrowserAnnotations.js';
import { useBrowserCapture } from '@/blocks/browser/useBrowserCapture.js';
import { useBrowserDescriptor } from '@/blocks/browser/useBrowserDescriptor.js';
import { useBrowserEvents } from '@/blocks/browser/useBrowserEvents.js';
import { selectionAttachment, type BrowserSelection } from '@/blocks/browser/browserEvents.js';
import { useBrowserLiveInput } from '@/blocks/browser/useBrowserLiveInput.js';
import { useBrowserLiveStream } from '@/blocks/browser/useBrowserLiveStream.js';
import { useBrowserNavigation } from '@/blocks/browser/useBrowserNavigation.js';
import { useBrowserTabState, type BrowserTabState } from '@/blocks/browser/useBrowserTabState.js';
import { useBrowserScrollState, useBrowserViewportResize } from '@/blocks/browser/useBrowserViewport.js';
import { useDeviceEmulation } from '@/blocks/browser/useDeviceEmulation.js';
import { Checkbox } from '@/components/ui/primitives/checkbox.js';
import { NativeBrowserView } from './NativeBrowserView.js';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/primitives/dropdown-menu.js';

export type { BrowserTabState };

// ── Types ────────────────────────────────────────────────────

interface BrowserPanelProps {
  workspaceId: string | undefined;
  /**
   * Stable per-instance id for this browser tab (the RightPane tab id).
   * Each RightPane "Browser" tab is its own native WebContentsView keyed
   * by this id, so multiple browser tabs stay fully isolated (separate
   * page, history, cookies, title, favicon). Optional for non-native /
   * legacy callers — falls back to the workspace id.
   */
  tabId?: string;
  open: boolean;
  onClose: () => void;
  /** Called when the user picks an inspector selection / region to send to chat. */
  onCapture?: BrowserCaptureHandler;
  /**
   * When true the outer status/close header is hidden so this panel can
   * live inside a shared side pane host (e.g. `RightPane`).
   */
  embedded?: boolean;
  /**
   * True while a chat / stage turn is streaming. Used to disable the
   * "detach" toggle so the agent can't lose its browser mid-turn.
   */
  agentBusy?: boolean;
  /**
   * Fires when the live page's tab state changes so a host tab strip can
   * render a Chrome-like tab (spinner while loading → favicon + title).
   */
  onTabStateChange?: (state: BrowserTabState) => void;
  /**
   * Namespace under which this tab's last-visited URL is remembered, e.g.
   * `chat:<chatId>` or `workflow-run:<runId>`. Leaving the page destroys the
   * native view, so without this the tab would come back blank. Omit to
   * disable URL memory entirely.
   */
  urlScopeKey?: string;
  /**
   * False while this panel is mounted but not the selected tab (P1-50).
   *
   * The RightPane mounts every tab and hides the inactive ones, which is what
   * keeps a page alive across tab switches — and what made five browser tabs
   * hold five live screencast sockets, decoding every frame into an object
   * URL nothing painted. When false the live-view socket is closed entirely;
   * it reopens on the next frame after the tab is selected. Defaults to true
   * so non-RightPane callers are unaffected.
   */
  visible?: boolean;
}

/**
 * Chrome-like tab icon for the Browser tab: a spinner while the page is
 * loading, the page favicon once loaded (falling back to a globe if the
 * favicon fails), or a globe when idle. Pass the live `BrowserTabState`
 * surfaced by `BrowserPanel`'s `onTabStateChange`.
 */
export function BrowserTabIcon({ state }: { state: BrowserTabState | null | undefined }): React.JSX.Element {
  const [broken, setBroken] = useState(false);
  const favicon = state?.favicon ?? null;
  useEffect(() => { setBroken(false); }, [favicon]);
  if (state?.loading) return <Spinner size="sm" label="Page loading" />;
  if (favicon && !broken) {
    return (
      <img
        src={favicon}
        alt=""
        className="h-3.5 w-3.5 rounded-[3px] object-contain"
        onError={() => setBroken(true)}
      />
    );
  }
  return <Globe className="h-3.5 w-3.5" />;
}

/** The tab label for the Browser tab: the page title, or "Browser". */
export function browserTabLabel(state: BrowserTabState | null | undefined): string {
  const t = (state?.title ?? '').trim();
  return t || 'Browser';
}

// ── Component ────────────────────────────────────────────────

export function BrowserPanel({ workspaceId, tabId, open, onClose, onCapture, embedded = false, agentBusy = false, onTabStateChange, urlScopeKey, visible = true }: BrowserPanelProps): React.JSX.Element | null {
  const { resolvedTheme } = useTheme();
  // The native browser tab id for THIS panel instance. Falls back to the
  // workspace id for legacy/non-native callers. All native `browser.*`
  // calls key off this so each RightPane Browser tab is its own WCV.
  const nativeTabId = tabId ?? workspaceId ?? null;
  const [error, setError] = useState<string | null>(null);

  const interactivityOn = useWebBrowserInteractivity();
  const {
    descriptor, setDescriptor, browserDenied, sessionKey, restart: restartSession, refresh: refreshDescriptor,
  } = useBrowserDescriptor({ open, workspaceId });
  const nativeAvailable = useNativeBrowserAvailable();
  /**
   * Full interactivity is granted in these cases:
   *   1. Desktop shell exposes a native browser (always full — VSCode-style).
   *   2. Web UI user-preference `webInteractivity=true`.
   * When neither, the user can still SEE the page, SCROLL it, and use
   * Inspect to attach an element to chat. Everything else is agent-driven.
   */
  const fullInteractivity = nativeAvailable || interactivityOn;

  const {
    inspectorOn, setInspectorOn, captureMode, setCaptureMode,
    annotateOn, annotateItems, commentsOpen, setCommentsOpen,
    handleToggleInspector, handleToggleCapture, sendAnnotations, removeAnnotation, clearAnnotations,
  } = useBrowserAnnotations({ open, workspaceId, nativeTabId, nativeAvailable, theme: resolvedTheme, onCapture, setError });

  // Inspector selection → hand the element to the chat composer via
  // `onCapture`. This is what makes "click to attach element" actually
  // attach the element. One-shot UX: Inspect turns off after a pick —
  // matches the InspectorScript.setEnabled(false) auto-disable.
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
  const showNavControls = fullInteractivity;
  // The internal `about:blank#gai-…` discovery marker never reaches the pill.
  const pillUrl = displayBrowserUrl(descriptor?.currentUrl);
  const scrollThumb = scrollState ? scrollbarThumb(scrollState) : null;

  return (
    <div className="flex h-full w-full flex-col border-l border-[var(--color-border)] bg-[var(--color-card)] text-[var(--color-foreground)]">
      {!embedded && (
        <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2 text-xs">
          <div className="flex items-center gap-2">
            <span className={cn(
              'inline-block h-2 w-2 rounded-full',
              status === 'active' && 'bg-[var(--color-success)]',
              status === 'starting' && 'bg-[var(--color-warning)] animate-pulse',
              status === 'error' && 'bg-[var(--color-danger)]',
              (status === 'off' || status === 'terminated') && 'bg-[var(--color-muted-foreground)]',
            )} />
            <span className="font-medium">Integrated Browser</span>
            <span className="text-[var(--color-muted-foreground)]">· {status}</span>
            {descriptor?.mode === 'screencast' && streamState !== 'live' && streamState !== 'stopped' && (
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[10px] font-medium',
                  streamState === 'reconnecting' && 'bg-[var(--color-warning)]/20 text-[var(--color-warning)]',
                  streamState === 'degraded' && 'bg-[var(--color-danger)]/20 text-[var(--color-danger)]',
                  streamState === 'connecting' && 'bg-[var(--color-muted-foreground)]/20 text-[var(--color-muted-foreground)]',
                )}
                title={
                  streamState === 'reconnecting'
                    ? 'Live-view connection dropped — retrying'
                    : streamState === 'degraded'
                      ? 'Live-view falling back to slower polling after repeated reconnect failures'
                      : 'Connecting live view…'
                }
              >
                {streamState === 'reconnecting' && 'reconnecting…'}
                {streamState === 'degraded' && 'degraded (polling)'}
                {streamState === 'connecting' && 'connecting…'}
              </span>
            )}
          </div>
          <Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close browser panel">
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {/* Top bar — VSCode-parity chrome ───────────────── */}
      <form
        data-testid="browser-toolbar"
        onSubmit={handleNavigate}
        className="@container flex items-center gap-1.5 border-b border-[var(--color-border)] bg-[var(--color-card)] px-2 py-1.5"
      >
        {showNavControls && (
          <>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => handleAction('back')} className="text-[var(--color-foreground)] disabled:opacity-40" disabled={!isOn} aria-label="Back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => handleAction('forward')} className="text-[var(--color-foreground)] disabled:opacity-40" disabled={!isOn} aria-label="Forward">
              <ArrowRight className="h-4 w-4" />
            </Button>
            <Button type="button" variant="ghost" size="icon-sm" onClick={() => handleAction('reload')} className="text-[var(--color-foreground)] disabled:opacity-40" disabled={!isOn} aria-label="Reload">
              <RotateCw className={cn('h-4 w-4', loading === 'action' && 'animate-spin')} />
            </Button>
          </>
        )}
        {showNavControls ? (
          <Input
            type="text"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onFocus={() => setUrlInputFocused(true)}
            onBlur={() => setUrlInputFocused(false)}
            data-testid="browser-url"
            placeholder={nativeAvailable ? 'Search or enter address' : (isOn ? 'https://example.com' : 'https://…  (press Start)')}
            className="h-auto min-w-24 flex-1 rounded-full border-[var(--color-input)] bg-[var(--color-background)] px-3 py-1 text-xs text-[var(--color-foreground)] placeholder:text-[var(--color-muted-foreground)] focus:border-[var(--color-primary)]"
          />
        ) : (
          // Restricted mode — the user sees the current URL as a read-only pill.
          <div
            className="min-w-0 flex-1 truncate rounded-full border border-[var(--color-border)] bg-[var(--color-background)] px-3 py-1 text-xs text-[var(--color-muted-foreground)]"
            data-testid="browser-url"
            title={pillUrl}
          >
            {pillUrl ?? 'about:blank'}
          </div>
        )}
        {/* Right cluster: Share / Inspect / Capture / Start-Stop */}
        <div className="flex shrink-0 items-center gap-0.5">
          {isOn && (
            <Button
              type="button"
              variant="ghost"
              onClick={handleToggleShare}
              disabled={agentBusy || loading === 'share'}
              title={shareTitle}
              aria-label={shareTitle}
              aria-pressed={attachedToChat}
              className={cn(
                'h-auto gap-1 rounded px-2 py-1 text-xs font-medium',
                attachedToChat
                  ? 'bg-[var(--color-primary-emphasis)] text-[var(--color-primary-foreground)] hover:bg-[var(--color-primary)]'
                  : 'bg-[var(--color-subtle)] text-[var(--color-foreground)] hover:bg-[var(--color-emphasis)]',
                (agentBusy || loading === 'share') && 'opacity-50 cursor-not-allowed',
              )}
            >
              {attachedToChat ? <Share2 className="h-3.5 w-3.5" /> : <Link2Off className="h-3.5 w-3.5" />}
              <span className="hidden @[30rem]:inline">{attachedToChat ? 'Sharing' : 'Share'}</span>
            </Button>
          )}
          {isOn && (
            <Button
              type="button"
              variant="ghost"
              onClick={handleToggleInspector}
              className={cn(
                'h-auto gap-1 rounded px-2 py-1 text-xs text-[var(--color-foreground)] hover:bg-[var(--color-subtle)]',
                (inspectorOn || annotateOn) && 'bg-[color-mix(in_srgb,var(--color-done)_25%,transparent)] text-[var(--color-done)] hover:bg-[color-mix(in_srgb,var(--color-done)_30%,transparent)]',
              )}
              title={annotateOn ? 'Commenting — click elements to leave notes; click to exit' : 'Comment — click elements to leave notes and attach them to chat'}
              aria-pressed={inspectorOn || annotateOn}
            >
              <MousePointerClick className="h-3.5 w-3.5" />
            </Button>
          )}
          {isOn && nativeAvailable && annotateOn && (
            <DropdownMenu open={commentsOpen} onOpenChange={setCommentsOpen}>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className={cn(
                    'gap-1 px-2 text-[var(--color-foreground)]',
                    annotateItems.length > 0 && 'text-[var(--color-primary)]',
                  )}
                  title="Comments — view all notes and send to chat"
                  aria-label={`Comments (${annotateItems.length})`}
                >
                  <MessageSquare className="h-3.5 w-3.5" />
                  {annotateItems.length > 0 && (
                    <span className="rounded-full bg-[var(--color-primary)] px-1.5 text-[10px] font-semibold leading-4 text-[var(--color-primary-foreground)]">
                      {annotateItems.length}
                    </span>
                  )}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[300px] p-0">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-xs font-semibold text-[var(--color-foreground)]">
                    Comments {annotateItems.length > 0 ? `(${annotateItems.length})` : ''}
                  </span>
                  {annotateItems.length > 0 && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void clearAnnotations()}
                      className="h-6 gap-1 px-1.5 text-[11px] font-normal"
                    >
                      <Trash className="h-3 w-3" /> Clear
                    </Button>
                  )}
                </div>
                <DropdownMenuSeparator className="my-0" />
                {annotateItems.length === 0 ? (
                  <div className="px-3 py-4 text-center text-[11px] text-[var(--color-muted-foreground)]">
                    Click an element or drag a region on the page to add a comment.
                  </div>
                ) : (
                  <div className="max-h-[280px] overflow-y-auto py-1">
                    {annotateItems.map((it) => (
                      <div key={it.key} className="group flex items-start gap-2 px-3 py-1.5 hover:bg-[var(--color-subtle)]">
                        <span className="mt-0.5 flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full bg-[var(--color-primary)] text-[9px] font-bold text-[var(--color-primary-foreground)]">
                          {it.n}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-mono text-[11px] text-[var(--color-foreground)]" title={it.label}>{it.label}</div>
                          <div className={cn('truncate text-[11px]', it.comment ? 'text-[var(--color-muted-foreground)]' : 'italic text-[var(--color-muted-foreground)] opacity-60')} title={it.comment}>
                            {it.comment || 'No comment yet'}
                          </div>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-0.5 opacity-60 group-hover:opacity-100">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => void sendAnnotations([it.key])}
                            disabled={!it.comment}
                            title="Send this comment to chat"
                            aria-label="Send this comment to chat"
                            className="h-5 w-5 text-[var(--color-primary)] hover:bg-[color-mix(in_srgb,var(--color-primary)_15%,transparent)] hover:text-[var(--color-primary)] disabled:opacity-30"
                          >
                            <Send className="h-3 w-3" />
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => void removeAnnotation(it.key)}
                            title="Delete this comment"
                            aria-label="Delete this comment"
                            className="h-5 w-5 hover:text-[var(--color-danger)]"
                          >
                            <Trash className="h-3 w-3" />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                {annotateItems.some((i) => i.comment) && (
                  <>
                    <DropdownMenuSeparator className="my-0" />
                    <div className="p-2">
                      <Button
                        type="button"
                        variant="primary"
                        size="sm"
                        onClick={() => void sendAnnotations()}
                        className="w-full justify-center px-2"
                      >
                        <Send className="h-3.5 w-3.5" />
                        Send all to chat
                      </Button>
                    </div>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {isOn && showNavControls && (
            <Button
              type="button"
              variant="ghost"
              onClick={handleToggleCapture}
              className={cn(
                'h-auto gap-1 rounded px-2 py-1 text-xs text-[var(--color-foreground)] hover:bg-[var(--color-subtle)]',
                captureMode && 'bg-[var(--color-success-muted)] text-[var(--color-success)] hover:bg-[color-mix(in_srgb,var(--color-success)_25%,transparent)]',
              )}
              title={nativeAvailable ? 'Comment on a region — drag to select an area, add a note, and send to chat' : 'Capture region — drag to select an area and attach it to chat'}
              aria-pressed={captureMode}
            >
              {nativeAvailable ? <Crop className="h-3.5 w-3.5" /> : <Crop className="h-3.5 w-3.5" />}
            </Button>
          )}
          {nativeAvailable && isOn && workspaceId && (
            <Button
              type="button"
              variant="ghost"
              onClick={handleToggleEmulation}
              className={cn(
                'h-auto gap-1 rounded px-2 py-1 text-xs text-[var(--color-foreground)] hover:bg-[var(--color-subtle)]',
                emulationOn && 'bg-[color-mix(in_srgb,var(--color-primary)_20%,transparent)] text-[var(--color-primary)] hover:bg-[color-mix(in_srgb,var(--color-primary)_28%,transparent)]',
              )}
              title="Toggle device toolbar — responsive dimensions, zoom & mobile emulation"
              aria-pressed={emulationOn}
            >
              <Smartphone className="h-3.5 w-3.5" />
            </Button>
          )}
          {nativeAvailable && isOn && workspaceId && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  className="text-[var(--color-foreground)]"
                  title="More — open browser DevTools"
                  aria-label="Browser options"
                >
                  <MoreVertical className="h-3.5 w-3.5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[190px]">
                <DropdownMenuLabel>Developer Tools</DropdownMenuLabel>
                <DropdownMenuItem
                  onSelect={() => nativeTabId && openNativeDevtools(nativeTabId)}
                >
                  <Wrench className="mr-2 h-3.5 w-3.5" />
                  Open DevTools
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => nativeTabId && openNativeDevtools(nativeTabId, 'network')}
                >
                  <Activity className="mr-2 h-3.5 w-3.5" />
                  Open Network tab
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => nativeTabId && openNativeDevtools(nativeTabId, 'console')}
                >
                  <Terminal className="mr-2 h-3.5 w-3.5" />
                  Open Console tab
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() => nativeTabId && openNativeDevtools(nativeTabId, 'elements')}
                >
                  <MousePointerClick className="mr-2 h-3.5 w-3.5" />
                  Inspect Elements
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {showNavControls && (
            !isOn ? (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => void handleStart()}
                disabled={loading === 'start'}
                className="ml-1 gap-1 px-2"
              >
                {loading === 'start' ? <Spinner size="xs" label="Starting" /> : <Play className="h-3 w-3" />}
                Start
              </Button>
            ) : (
              <Button
                type="button"
                variant="ghost"
                onClick={handleStop}
                disabled={loading === 'stop'}
                title="Stop browser"
                aria-label="Stop browser"
                className="ml-1 h-auto gap-1 rounded bg-[var(--color-danger)] px-2 py-1 text-xs font-medium text-white hover:bg-[color-mix(in_srgb,var(--color-danger)_85%,black)]"
              >
                {loading === 'stop' ? <Spinner size="xs" label="Stopping" /> : <Square className="h-3 w-3" />}
              </Button>
            )
          )}
        </div>
      </form>

      {/* Device emulation bar — native desktop responsive toolbar ─── */}
      {nativeAvailable && isOn && emulationOn && (
        <div className="flex flex-wrap items-center gap-2 border-b border-[var(--color-border)] bg-[var(--color-background)] px-2 py-1.5 text-[11px] text-[var(--color-foreground)]">
          <select
            value={emuPreset}
            onChange={(e) => handlePickPreset(e.target.value)}
            className="rounded border border-[var(--color-input)] bg-[var(--color-card)] px-1.5 py-1 text-[11px] outline-none focus:border-[var(--color-primary)]"
            title="Device preset"
            aria-label="Device preset"
          >
            {DEVICE_PRESETS.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
            {emuPreset === 'custom' && <option value="custom">Custom</option>}
          </select>

          <div className="flex items-center gap-1">
            <Input
              type="number"
              min={100}
              max={4096}
              value={emuWidth}
              onChange={(e) => handleEmuDimChange(Math.max(100, Number(e.target.value) || 0), emuHeight)}
              disabled={emuPreset === 'responsive'}
              className="h-auto w-16 rounded bg-[var(--color-card)] px-1.5 py-1 text-[11px] disabled:opacity-40"
              title="Width (px)"
              aria-label="Width (px)"
            />
            <span className="text-[var(--color-muted-foreground)]">×</span>
            <Input
              type="number"
              min={100}
              max={4096}
              value={emuHeight}
              onChange={(e) => handleEmuDimChange(emuWidth, Math.max(100, Number(e.target.value) || 0))}
              disabled={emuPreset === 'responsive'}
              className="h-auto w-16 rounded bg-[var(--color-card)] px-1.5 py-1 text-[11px] disabled:opacity-40"
              title="Height (px)"
              aria-label="Height (px)"
            />
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={handleEmuRotate}
              disabled={emuPreset === 'responsive'}
              className="text-[var(--color-foreground)] disabled:opacity-40"
              title="Rotate (swap width/height)"
              aria-label="Rotate viewport"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
          </div>

          <label className="flex items-center gap-1" title="Device pixel ratio">
            <span className="text-[var(--color-muted-foreground)]">DPR</span>
            <select
              value={String(emuDpr)}
              onChange={(e) => handleEmuDpr(Number(e.target.value))}
              disabled={emuPreset === 'responsive'}
              aria-label="Device pixel ratio"
              className="rounded border border-[var(--color-input)] bg-[var(--color-card)] px-1 py-1 text-[11px] outline-none focus:border-[var(--color-primary)] disabled:opacity-40"
            >
              {[1, 1.5, 2, 3].map((d) => <option key={d} value={d}>{d}×</option>)}
            </select>
          </label>

          <label className="flex items-center gap-1" title="Emulate touch / mobile user-agent metrics">
            <Checkbox
              checked={emuMobile}
              disabled={emuPreset === 'responsive'}
              onCheckedChange={(v) => handleEmuMobile(v === true)}
            />
            <span>Mobile</span>
          </label>

          <label className="flex items-center gap-1" title="Page zoom">
            <span className="text-[var(--color-muted-foreground)]">Zoom</span>
            <select
              value={String(emuZoom)}
              onChange={(e) => handleEmuZoom(Number(e.target.value))}
              aria-label="Page zoom"
              className="rounded border border-[var(--color-input)] bg-[var(--color-card)] px-1 py-1 text-[11px] outline-none focus:border-[var(--color-primary)]"
            >
              {ZOOM_LEVELS.map((z) => <option key={z} value={z}>{Math.round(z * 100)}%</option>)}
            </select>
          </label>
        </div>
      )}

      {/* Annotate-mode status strip — the comment UI itself lives inside the
          page (native WCV overlay). Sending is via the Comments popover. */}
      {nativeAvailable && isOn && annotateOn && (
        <div className="flex items-center gap-2 border-b border-[var(--color-border)] bg-[color-mix(in_srgb,var(--color-primary)_8%,var(--color-background))] px-3 py-1.5 text-[11px] text-[var(--color-muted-foreground)]">
          <MousePointerClick className="h-3.5 w-3.5 text-[var(--color-primary)]" />
          <span>
            {annotateItems.length > 0
              ? `${annotateItems.length} comment${annotateItems.length > 1 ? 's' : ''} — open Comments to review & send`
              : 'Click an element or drag a region to leave a comment'}
          </span>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-1 border-b border-[color-mix(in_srgb,var(--color-danger)_40%,transparent)] bg-[var(--color-danger-muted)] px-3 py-1 text-[11px] text-[var(--color-danger)]">
          <AlertTriangle className="h-3 w-3 flex-shrink-0" />
          <span className="truncate" title={error}>{error}</span>
          <Button type="button" variant="ghost" size="icon-sm" className="ml-auto h-5 w-5 text-[var(--color-danger)] hover:bg-[color-mix(in_srgb,var(--color-danger)_20%,transparent)] hover:text-[var(--color-danger)]" onClick={() => setError(null)} aria-label="Dismiss">
            <X className="h-3 w-3" />
          </Button>
        </div>
      )}

      {/* Live view ─────────────────────────────────────── */}
      {nativeAvailable && workspaceId && nativeTabId ? (
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
        <div
          ref={liveContainerRef}
          data-testid="browser-live-view"
          className="relative flex flex-1 min-h-0 items-center justify-center bg-[var(--color-subtle)]"
        >
          {/*
            Mounted for the whole time the browser is on, not only once a frame
            has arrived: the decoder needs somewhere to draw before there is
            anything to show, and the canvas is also what holds the last frame
            on screen while the socket reconnects.
          */}
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
            <div data-testid="browser-empty-state" className="absolute inset-0 flex h-full items-center justify-center text-center text-sm text-[var(--color-muted-foreground)]">
              <div>
                {/* A refused device is NOT "not running": pointing it at the
                    interactive-browser setting sends the user to a control
                    that cannot fix it. The fix is a scope grant, so say so. */}
                {browserDenied ? (
                  <div className="mx-auto max-w-xs">
                    <div className="mb-1">Browser control isn’t granted to this device.</div>
                    <div className="text-xs opacity-80">
                      Grant it{' '}
                      <span className="text-[var(--color-foreground)]">Settings → Security → Devices</span>{' '}
                      on a device that is already connected. The agent can still browse on its own.
                    </div>
                  </div>
                ) : (
                  <>
                {status === 'starting' && (<><Spinner size="lg" className="mx-auto mb-2" label="Starting Chromium" /><div>Starting Chromium…</div></>)}
                {isOn && !hasFrame && (<><Spinner size="lg" className="mx-auto mb-2" label="Loading live view" /><div>Loading live view…</div></>)}
                {(status === 'off' || status === 'terminated') && (
                  <div>
                    <div className="mb-1">Browser is not running.</div>
                    {showNavControls ? (
                      <div className="text-xs opacity-80">
                        Type a URL and press <kbd className="rounded bg-[var(--color-subtle)] px-1 text-[var(--color-foreground)]">Start</kbd>.
                      </div>
                    ) : (
                      // Without full interactivity there is no URL bar, so the
                      // bare "not running" line was a dead end.
                      <div className="mx-auto max-w-xs text-xs opacity-80">
                        Ask the agent to browse a page, or enable{' '}
                        <span className="text-[var(--color-foreground)]">
                          Settings → Browser &amp; Terminal → interactive browser
                        </span>{' '}
                        to drive it yourself.
                      </div>
                    )}
                  </div>
                )}
                {status === 'error' && (
                  <div className="text-[var(--color-danger)]">
                    <AlertTriangle className="mx-auto mb-2 h-6 w-6" />
                    Browser error. Try Start again.
                  </div>
                )}
                  </>
                )}
              </div>
            </div>
          )}

          {/* Capture-drag rectangle overlay */}
          {captureMode && captureRect && (
            <div
              className="pointer-events-none absolute border-2 border-[var(--color-success)] bg-[color-mix(in_srgb,var(--color-success)_15%,transparent)]"
              style={{
                left: captureRect.x,
                top: captureRect.y + (embedded ? 0 : 0),
                width: captureRect.w,
                height: captureRect.h,
              }}
            />
          )}

          {/* Overlay scrollbar — draggable */}
          {isOn && hasFrame && scrollThumb && (
            <div
              ref={scrollBarRef}
              className="absolute right-1.5 top-2 bottom-2 w-2.5 rounded-full bg-[color-mix(in_srgb,var(--color-foreground)_15%,transparent)] shadow-lg ring-1 ring-[color-mix(in_srgb,var(--color-foreground)_20%,transparent)]"
              aria-hidden
            >
              <div
                onMouseDown={handleScrollThumbDown}
                className="absolute left-0 right-0 rounded-full bg-[color-mix(in_srgb,var(--color-foreground)_70%,transparent)] shadow-md cursor-grab active:cursor-grabbing"
                style={{ top: `${scrollThumb.topPct}%`, height: `${scrollThumb.heightPct}%` }}
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
