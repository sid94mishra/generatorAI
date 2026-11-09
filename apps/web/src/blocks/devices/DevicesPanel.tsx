// ────────────────────────────────────────────────────────────────
// DevicesPanel (docs/devices §2): the Devices dock tab.
//
//   [▣ device ▾]  ● Running                       [Agent ◉]  [■ Stop]
//   [◁][○][▢]  [⟳]  [⌗ Select]  [⎙ Screenshot ▾]  [⋯]
//   ✦ The agent is using this device                     [Take over]
//   ┌──────── live screen (DeviceScreen) ────────┐
//   ● live · 1080×2424 · H.264 · 58 fps     Agent can use this device
//
// Each dock tab is its own device (DV-10); the selection is remembered per
// tab. The agent opening a device switches the first Devices tab to it.
// ────────────────────────────────────────────────────────────────

import { useCallback, useEffect, useMemo, useState } from 'react';
import type { DeviceElement, DeviceInfo, DeviceSnapshot } from '@generatorai/shared';
import { annotationPalette } from '@generatorai/design-tokens';
import { useTheme } from '@/providers/ThemeProvider.js';
import { cn } from '@/ui/lib/cn.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { Callout } from '@/ui/primitives/Callout/Callout.js';
import { EmptyState } from '@/ui/primitives/EmptyState/EmptyState.js';
import { Separator } from '@/ui/primitives/Separator/Separator.js';
import { EntityRow } from '@/ui/patterns/EntityRow/EntityRow.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { MenuGroup, MenuGroupLabel, MenuItem, MenuPopup, MenuRoot, MenuSeparator, MenuTrigger } from '@/ui/primitives/Menu/Menu.js';
import { Spinner } from '@/ui/primitives/Spinner/Spinner.js';
import { StatusDot, type DotTone } from '@/ui/primitives/StatusDot/StatusDot.js';
import { Switch } from '@/ui/primitives/Switch/Switch.js';
import { DeviceScreen } from './DeviceScreen.js';
import { DeviceSetup } from './DeviceSetup.js';
import { elementCropFile, elementJsonFile, elementSummary } from './deviceSelection.js';
import { fetchDeviceScreenshot, fetchDeviceSnapshot, sendDeviceInput } from './devicesApi.js';
import { useDeviceStream, type DeviceStreamState } from './useDeviceStream.js';
import { useDevices, useDevicesEvents } from './useDevices.js';

export interface DevicesPanelProps {
  workspaceId: string;
  /** The dock tab id: each tab remembers its own device. */
  tabId: string;
  /** Namespace of the remembered device (`chat:<id>`). */
  scopeKey: string;
  /** Selected dock tab (only it streams). */
  visible: boolean;
  /** The first Devices tab follows the device the agent opens. */
  followAgent: boolean;
  /** A picked element or screenshot for the composer. */
  onCapture?: (file: File) => void;
  /** A turn is streaming. */
  agentBusy?: boolean;
  agentName?: string;
  /** The tab's label and status dot follow the device. */
  onTabStateChange?: (state: { name: string | null; running: boolean; agentActive: boolean }) => void;
}

const storageKey = (scopeKey: string, tabId: string) => `generatorai:devices:${scopeKey}:${tabId}`;

function readStored(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string | null): void {
  try {
    if (value) window.localStorage.setItem(key, value);
    else window.localStorage.removeItem(key);
  } catch {
    // storage unavailable
  }
}

const STATE_LABEL: Record<DeviceInfo['state'], string> = {
  off: 'Off',
  starting: 'Starting…',
  running: 'Running',
  offline: 'Offline',
  unauthorized: 'Not authorised',
};

const STATE_TONE: Record<DeviceInfo['state'], DotTone> = {
  off: 'muted',
  starting: 'run',
  running: 'ok',
  offline: 'warn',
  unauthorized: 'warn',
};

const KIND_LABEL: Record<DeviceInfo['kind'], string> = {
  simulator: 'Simulator',
  emulator: 'Emulator',
  usb: 'USB',
  wifi: 'Wi-Fi',
};

const STREAM_LABEL: Record<DeviceStreamState, string> = {
  idle: 'idle',
  connecting: 'connecting…',
  live: 'live',
  reconnecting: 'reconnecting…',
  polling: 'snapshots (no video decoder)',
  failed: 'disconnected',
};

function deviceLine(d: DeviceInfo): string {
  return [d.osVersion, KIND_LABEL[d.kind], STATE_LABEL[d.state]].filter(Boolean).join(' · ');
}

export function DevicesPanel({
  workspaceId,
  tabId,
  scopeKey,
  visible,
  followAgent,
  onCapture,
  agentName,
  onTabStateChange,
}: DevicesPanelProps): React.JSX.Element {
  const { resolvedTheme, themeId } = useTheme();
  const palette = useMemo(() => annotationPalette(themeId, resolvedTheme), [themeId, resolvedTheme]);
  const devices = useDevices(workspaceId, visible);
  const key = storageKey(scopeKey, tabId);
  const [selected, setSelected] = useState<string | null>(() => readStored(key));
  const [showSetup, setShowSetup] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [snapshot, setSnapshot] = useState<DeviceSnapshot | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [requested, setRequested] = useState<string | null>(null);
  const [panelError, setPanelError] = useState<string | null>(null);

  const listing = devices.listing;
  // No remembered device: the one this chat has open, else nothing.
  const effective = selected ?? listing?.open ?? null;
  const device = listing?.devices.find((d) => d.key === effective) ?? null;
  const running = device?.state === 'running';

  const select = useCallback(
    (next: string | null) => {
      setSelected(next);
      writeStored(key, next);
      setSelecting(false);
      setSnapshot(null);
    },
    [key],
  );

  useDevicesEvents(workspaceId, (event) => {
    if (event.kind === 'devices.opened' && event.by === 'agent' && followAgent) select(event.device);
    if (event.kind === 'devices.access_requested') setRequested(event.device);
    if (event.kind === 'devices.opened' || event.kind === 'devices.closed') void devices.refresh(true);
  });

  const stream = useDeviceStream({ workspaceId, device: running ? device.key : null, enabled: visible && running });
  const agentAccess = stream.agentAccess ?? device?.agentAccess ?? false;

  useEffect(() => {
    onTabStateChange?.({ name: device?.name ?? null, running, agentActive: stream.agentActive });
  }, [onTabStateChange, device?.name, running, stream.agentActive]);

  // Select mode reads the element tree once when it starts.
  useEffect(() => {
    if (!selecting || !device || !running) return;
    let cancelled = false;
    setSnapshot(null);
    fetchDeviceSnapshot(workspaceId, device.key).then(
      (s) => {
        if (!cancelled) setSnapshot(s);
      },
      (err: Error) => {
        if (!cancelled) {
          setPanelError(`Could not read the screen's elements: ${err.message}`);
          setSelecting(false);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [selecting, device, running, workspaceId]);

  const onPick = useCallback(
    async (el: DeviceElement) => {
      if (!device || !snapshot || !onCapture) return;
      const now = Date.now();
      onCapture(elementJsonFile(elementSummary(device, snapshot, el), now));
      const crop = await elementCropFile(stream.canvasRef.current, el, palette.accent, now);
      if (crop) onCapture(crop);
      setSelecting(false);
      setNotice(`Added ${el.role}${el.label ? ` "${el.label}"` : ''} to the message.`);
    },
    [device, snapshot, onCapture, stream.canvasRef, palette.accent],
  );

  const screenshot = useCallback(
    async (to: 'chat' | 'file') => {
      if (!device) return;
      try {
        const blob = await fetchDeviceScreenshot(workspaceId, device.key);
        const name = `${device.name.replace(/[^\w.-]+/g, '-')}-${Date.now()}.jpg`;
        if (to === 'chat') {
          onCapture?.(new File([blob], name, { type: blob.type || 'image/jpeg' }));
          setNotice('Added a screenshot to the message.');
        } else {
          const url = URL.createObjectURL(blob);
          const a = document.createElement('a');
          a.href = url;
          a.download = name;
          a.click();
          setTimeout(() => URL.revokeObjectURL(url), 1000);
        }
      } catch (err) {
        setPanelError((err as Error).message);
      }
    },
    [device, workspaceId, onCapture],
  );

  const press = useCallback(
    (event: Parameters<typeof sendDeviceInput>[2]) => {
      if (!device) return;
      if (stream.state === 'live' && event.type !== 'rotate') stream.send(event);
      else void sendDeviceInput(workspaceId, device.key, event).catch((err: Error) => setPanelError(err.message));
    },
    [device, stream, workspaceId],
  );

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 3500);
    return () => clearTimeout(t);
  }, [notice]);

  // ── Body states ────────────────────────────────────────────

  const allDevices = listing?.devices ?? [];
  const groups = (['ios', 'android'] as const)
    .map((platform) => ({ platform, items: allDevices.filter((d) => d.platform === platform) }))
    .filter((g) => g.items.length > 0);
  const anyTooling = listing?.tooling.some((t) => t.available) ?? false;

  let body: React.ReactNode;
  if (!listing) {
    body = devices.error ? (
      <EmptyState icon="device" tone="error" title="Devices are unavailable" description={devices.error} className="h-full" />
    ) : (
      <div className="flex h-full items-center justify-center">
        <Spinner size={16} label="Loading devices" />
      </div>
    );
  } else if (!listing.enabled) {
    body = (
      <EmptyState
        icon="device"
        title="Mobile devices are off"
        description="Turn them on in Settings › Mobile devices to use simulators, emulators and phones here."
        className="h-full"
      />
    );
  } else if (showSetup || !anyTooling || allDevices.length === 0) {
    body = (
      <div className="min-h-0 flex-1 overflow-auto">
        <DeviceSetup tooling={listing.tooling} onRefresh={() => void devices.refresh(true)} refreshing={devices.loading} />
        {showSetup && anyTooling && allDevices.length > 0 && (
          <div className="px-4 pb-4">
            <Button size="sm" variant="ghost" onClick={() => setShowSetup(false)}>
              Back to the device
            </Button>
          </div>
        )}
      </div>
    );
  } else if (!device) {
    body = (
      <div data-testid="device-list" className="min-h-0 flex-1 overflow-auto p-4">
        <h3 className="text-ui font-medium text-fg">Choose a device</h3>
        <p className="mt-1 mb-3 text-small text-fg-2">Pick one to start it and see its screen here. The agent can use it too.</p>
        {groups.map((g) => (
          <section key={g.platform} className="mb-4">
            <h4 className="mb-1 text-micro uppercase tracking-wide text-fg-3">{g.platform === 'ios' ? 'iOS' : 'Android'}</h4>
            <div className="overflow-hidden rounded-card border border-line-soft">
              {g.items.map((d) => {
                const choose = () => {
                  select(d.key);
                  if (d.state === 'off') void devices.start(d.key);
                };
                return (
                  <EntityRow
                    key={d.key}
                    role="button"
                    tabIndex={0}
                    data-testid="device-list-item"
                    icon="device"
                    title={d.name}
                    subtitle={deviceLine(d)}
                    meta={<StatusDot tone={STATE_TONE[d.state]} size="sm" label={STATE_LABEL[d.state]} />}
                    className="cursor-pointer hover:bg-hover focus-visible:bg-hover focus:outline-none"
                    onClick={choose}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        choose();
                      }
                    }}
                  />
                );
              })}
            </div>
          </section>
        ))}
      </div>
    );
  } else if (device.state === 'off' || device.state === 'starting' || devices.busy.has(device.key)) {
    const starting = device.state === 'starting' || devices.busy.has(device.key);
    body = starting ? (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Spinner size={16} label={`Starting ${device.name}`} />
        <div className="text-ui text-fg">Starting {device.name}…</div>
        <div className="max-w-72 text-small text-fg-3">A virtual device can take a minute to boot the first time.</div>
      </div>
    ) : (
      <EmptyState
        icon="device"
        title={`${device.name} is off`}
        description={deviceLine(device)}
        action={
          <Button size="sm" variant="primary" icon="play" onClick={() => void devices.start(device.key)}>
            Start
          </Button>
        }
        className="h-full"
      />
    );
  } else if (device.state === 'unauthorized' || device.state === 'offline') {
    body = (
      <EmptyState
        icon="device"
        tone="error"
        title={device.state === 'unauthorized' ? `Allow USB debugging on ${device.name}` : `${device.name} is offline`}
        description={
          device.state === 'unauthorized'
            ? 'Unlock the phone and accept "Allow USB debugging" for this computer, then wait a moment.'
            : 'Reconnect the cable or restart adb debugging on the phone.'
        }
        className="h-full"
      />
    );
  } else {
    body = (
      <DeviceScreen
        canvasRef={stream.canvasRef}
        size={stream.size}
        hasFrame={stream.hasFrame}
        interactive={stream.state === 'live'}
        marks={stream.marks}
        send={stream.send}
        selecting={selecting}
        snapshot={snapshot}
        onPick={(el) => void onPick(el)}
        onCancelSelect={() => setSelecting(false)}
        label={`${device.name} screen`}
      />
    );
  }

  const live = running && listing?.enabled;
  const isIos = device?.platform === 'ios';

  return (
    <div data-testid="devices-panel" className="flex h-full w-full flex-col bg-surface text-fg">
      {/* Row 1: device, state, agent access, power */}
      <div className="flex items-center gap-2 border-b border-line-soft px-2 py-1.5">
        <MenuRoot>
          <MenuTrigger
            render={
              <Button size="sm" variant="ghost" icon="device" trailingIcon="chevron-down" data-testid="device-picker" className="min-w-0 max-w-64">
                <span className="truncate">{device ? device.name : 'Choose a device'}</span>
              </Button>
            }
          />
          <MenuPopup align="start">
            {groups.map((g, i) => (
              <MenuGroup key={g.platform}>
                {i > 0 && <MenuSeparator />}
                <MenuGroupLabel>{g.platform === 'ios' ? 'iOS simulators' : 'Android'}</MenuGroupLabel>
                {g.items.map((d) => (
                  <MenuItem
                    key={d.key}
                    icon="device"
                    description={deviceLine(d)}
                    data-testid="device-picker-item"
                    onClick={() => {
                      select(d.key);
                      setShowSetup(false);
                      if (d.state === 'off') void devices.start(d.key);
                    }}
                  >
                    {d.name}
                  </MenuItem>
                ))}
              </MenuGroup>
            ))}
            {groups.length > 0 && <MenuSeparator />}
            <MenuItem icon="refresh" onClick={() => void devices.refresh(true)}>
              Refresh
            </MenuItem>
            <MenuItem icon="info" onClick={() => setShowSetup(true)}>
              Setup help
            </MenuItem>
          </MenuPopup>
        </MenuRoot>
        {device && (
          <span className="flex shrink-0 items-center gap-1.5 text-small text-fg-2">
            <StatusDot tone={STATE_TONE[device.state]} size="sm" />
            {STATE_LABEL[device.state]}
          </span>
        )}
        <span className="flex-1" />
        {device && listing?.enabled && (
          <Switch
            data-testid="device-agent-access"
            checked={agentAccess}
            onCheckedChange={(on) => {
              setRequested(null);
              void devices.setAccess(device.key, on);
            }}
            label={<span className="text-small text-fg-2">Agent</span>}
          />
        )}
        {device && running && (device.kind === 'emulator' || device.kind === 'simulator') && (
          <IconButton size="sm" icon="stop" label={`Shut down ${device.name}`} data-testid="device-stop" loading={devices.busy.has(device.key)} onClick={() => void devices.stop(device.key)} />
        )}
      </div>

      {/* Row 2: hardware keys and tools */}
      {live && device && (
        <div className="flex items-center gap-1 border-b border-line-soft px-2 py-1" data-testid="device-toolbar">
          {!isIos && <IconButton size="sm" icon="back" label="Back" onClick={() => press({ type: 'button', button: 'back' })} />}
          <IconButton size="sm" icon="home" label="Home" onClick={() => press({ type: 'button', button: 'home' })} />
          {!isIos && <IconButton size="sm" icon="layers" label="Recent apps" onClick={() => press({ type: 'button', button: 'recents' })} />}
          <IconButton size="sm" icon="restart" label="Rotate" onClick={() => press({ type: 'rotate' })} />
          <Separator orientation="vertical" className="mx-1" />
          {onCapture && (
            <IconButton
              size="sm"
              icon="pointer"
              label={selecting ? 'Selecting — click an element to add it to the message (Esc to cancel)' : 'Select an element and add it to the message'}
              pressed={selecting}
              data-testid="device-select"
              onClick={() => setSelecting((s) => !s)}
            />
          )}
          <MenuRoot>
            <MenuTrigger render={<IconButton size="sm" icon="camera" label="Screenshot" data-testid="device-screenshot" />} />
            <MenuPopup>
              {onCapture && (
                <MenuItem icon="message" onClick={() => void screenshot('chat')}>
                  Add to message
                </MenuItem>
              )}
              <MenuItem icon="download" onClick={() => void screenshot('file')}>
                Save as file
              </MenuItem>
            </MenuPopup>
          </MenuRoot>
          <span className="flex-1" />
          <MenuRoot>
            <MenuTrigger render={<IconButton size="sm" icon="more" label="More device controls" />} />
            <MenuPopup align="end">
              <MenuItem icon="plus" onClick={() => press({ type: 'button', button: 'volume_up' })}>
                Volume up
              </MenuItem>
              <MenuItem icon="minus" onClick={() => press({ type: 'button', button: 'volume_down' })}>
                Volume down
              </MenuItem>
              <MenuItem icon="lock" onClick={() => press({ type: 'button', button: 'lock' })}>
                {isIos ? 'Lock' : 'Power'}
              </MenuItem>
              <MenuSeparator />
              <MenuItem icon="info" onClick={() => setShowSetup(true)}>
                Setup help
              </MenuItem>
            </MenuPopup>
          </MenuRoot>
        </div>
      )}

      {/* The agent is acting on this device */}
      {live && device && stream.agentActive && agentAccess && (
        <div data-testid="device-agent-strip" className="flex items-center gap-2 border-b border-line-soft bg-run-bg px-3 py-1.5 text-small text-fg">
          <StatusDot tone="run" size="sm" className="animate-pulse" />
          <span className="flex-1 truncate">{agentName ?? 'The agent'} is using this device</span>
          <Button size="sm" variant="secondary" data-testid="device-take-over" onClick={() => void devices.setAccess(device.key, false)}>
            Take over
          </Button>
        </div>
      )}

      {device && requested === device.key && !agentAccess && (
        <div className="px-2 pt-2">
          <Callout
            tone="warn"
            title={`${agentName ?? 'The agent'} asked to use ${device.name}`}
            action={
              <Button
                size="sm"
                variant="primary"
                onClick={() => {
                  setRequested(null);
                  void devices.setAccess(device.key, true);
                }}
              >
                Allow
              </Button>
            }
          >
            Only for this chat. You can take over at any time.
          </Callout>
        </div>
      )}

      {(panelError ?? devices.actionError ?? stream.error) && (
        <div className="px-2 pt-2">
          <Callout
            tone="err"
            action={
              <IconButton
                size="sm"
                icon="x"
                label="Dismiss"
                onClick={() => {
                  setPanelError(null);
                  devices.clearActionError();
                }}
              />
            }
          >
            <span className="block truncate" title={panelError ?? devices.actionError ?? stream.error ?? ''}>
              {panelError ?? devices.actionError ?? stream.error}
            </span>
          </Callout>
        </div>
      )}

      {notice && (
        <div className="px-2 pt-2" role="status">
          <Callout tone="ok">{notice}</Callout>
        </div>
      )}

      <div className="relative flex min-h-0 flex-1 flex-col">{body}</div>

      {device && live && (
        <div className="flex h-footer shrink-0 items-center gap-2 border-t border-line-soft px-3 text-small text-fg-2" data-testid="device-status">
          <StatusDot tone={stream.state === 'live' ? 'ok' : stream.state === 'failed' ? 'err' : 'warn'} size="sm" />
          <span className={cn(stream.state === 'failed' && 'text-err')}>{STREAM_LABEL[stream.state]}</span>
          <span className="truncate font-mono text-micro text-fg-3">
            {[stream.size ? `${stream.size.width}×${stream.size.height}` : null, stream.codec, stream.state === 'live' ? `${stream.fps} fps` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
          <span className="ml-auto truncate text-micro text-fg-3">{agentAccess ? 'Agent can use this device' : 'Agent access off'}</span>
        </div>
      )}
    </div>
  );
}
