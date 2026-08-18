// ────────────────────────────────────────────────────────────────
// ComputerService safety tests.
//
// These assert the gate ORDER, not just the gate existence: a blocklist that
// runs after consent, or a fence that runs after dispatch, passes a naive
// "does it refuse?" test while still being exploitable.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
  AgentEvent,
  ComputerActionResult,
  ComputerCapabilities,
  ComputerConsentDecision,
  ILogger,
  WorkspaceArtifactRecord,
} from '@generatorai/shared';
import { AppConfigSchema } from '@generatorai/shared';
import { ComputerService } from '../ComputerService.js';
import type {
  ComputerAuditEntry,
  ComputerConsentScope,
  ComputerStoredGrant,
  IComputerAuditSink,
  IComputerConsentStore,
} from '../ComputerService.js';
import type {
  ActionRequest,
  ComputerAppIdentity,
  ComputerHandle,
  ComputerRuntimeStatus,
  IComputerBridge,
  ListAppsResult,
  ListWindowsResult,
  SnapshotRequest,
  VerifyRequest,
  VerifyResult,
} from '../../domain/ports/IComputerBridge.js';
import { NullComputerBridge } from '../../infrastructure/computer/NullComputerBridge.js';

const CTX = { workspaceId: 'ws-1', workspaceRoot: '/tmp/ws-1', chatId: 'chat-1' };

const CAPS: ComputerCapabilities = {
  platform: 'darwin',
  provider: 'fake',
  providerVersion: '1',
  supports: {
    listApps: true, listWindows: true, snapshot: true, screenshot: true,
    elementBounds: true, backgroundClick: true, backgroundType: true,
    setValue: true, performAction: true, scroll: true, drag: true,
    hotkey: true, pasteText: true,
  },
  limitations: [],
};

interface FakeApp {
  id: string;
  name: string;
  pid: number;
  windowTitles: string[];
}

class FakeBridge implements IComputerBridge {
  readonly id = 'fake';
  actCalls: ActionRequest[] = [];
  snapshotCalls: SnapshotRequest[] = [];
  nextSnapshotId = 'snap-1';
  elements = [
    { index: 0, role: 'button', label: 'Send', secure: false, value: null, traits: [], actions: ['AXPress'], childCount: 0 },
    { index: 1, role: 'textField', label: 'Message', secure: false, value: '', traits: [], actions: ['AXConfirm'], childCount: 0 },
  ];

  constructor(private readonly apps: FakeApp[]) {}

  async isAvailable(): Promise<boolean> { return true; }
  async runtime(): Promise<ComputerRuntimeStatus> {
    return { provider: this.id, host: 'in-process', state: 'ready' };
  }
  async capabilities(): Promise<ComputerCapabilities> { return CAPS; }

  async start(opts: { workspaceId: string }): Promise<ComputerHandle> {
    return { workspaceId: opts.workspaceId, provider: this.id, providerVersion: '1', hostRef: 'fake', operational: true };
  }
  async stop(): Promise<void> { this.recording = false; }

  recordingStarts: unknown[] = [];
  recording = false;
  /** Set to make the driver refuse a start, exercising the disarm path. */
  refuseRecording = false;

  async startRecording(_h: ComputerHandle, req: unknown) {
    if (this.refuseRecording) {
      return { recording: false, refusal: { code: 'provider_unavailable' as const, message: 'no' } };
    }
    this.recordingStarts.push(req);
    this.recording = true;
    return { recording: true, outputDir: '/tmp/run' };
  }
  async stopRecording() {
    this.recording = false;
    return { recording: false };
  }
  async recordingState() {
    return { recording: this.recording };
  }

  async listApps(): Promise<ListAppsResult> {
    return {
      apps: this.apps.map((a) => ({ id: a.id, name: a.name, pid: a.pid, frontmost: false, windowCount: a.windowTitles.length })),
    };
  }

  async listWindows(_h: ComputerHandle, app: ComputerAppIdentity): Promise<ListWindowsResult> {
    const found = this.apps.find((a) => a.pid === app.pid);
    return {
      windows: (found?.windowTitles ?? []).map((title, index) => ({
        id: 100 + index, title, index, focused: index === 0, minimised: false,
      })),
    };
  }

  async launchApp(_h: ComputerHandle, name: string) {
    const found = this.apps.find((a) => a.name.toLowerCase().includes(name.toLowerCase()));
    if (!found) return { refusal: { code: 'target_lost' as const, message: 'not found' } };
    return { app: { appId: found.id, name: found.name, pid: found.pid } };
  }

  async bringToFront(): Promise<ComputerActionResult> {
    return { ok: true, snapshot: null, screenshot: null, action: { path: 'accessibility' } };
  }

  async snapshot(_h: ComputerHandle, req: SnapshotRequest): Promise<ComputerActionResult> {
    this.snapshotCalls.push(req);
    return {
      ok: true,
      screenshot: null,
      snapshot: {
        snapshotId: this.nextSnapshotId,
        app: { id: req.app.appId, name: req.app.name, pid: req.app.pid },
        window: { id: 100, title: 'Main', index: 0, focused: true },
        elements: this.elements,
        truncated: null,
        capturedAt: Date.now(),
      },
    };
  }

  async act(_h: ComputerHandle, req: ActionRequest): Promise<ComputerActionResult> {
    this.actCalls.push(req);
    return {
      ok: true,
      snapshot: null,
      screenshot: null,
      action: { path: 'accessibility', verification: { state: 'verified' } },
    };
  }

  verifyCalls: VerifyRequest[] = [];
  verifyOutcome: VerifyResult['outcome'] = 'satisfied';

  async verify(_h: ComputerHandle, req: VerifyRequest): Promise<VerifyResult> {
    this.verifyCalls.push(req);
    return { outcome: this.verifyOutcome, results: [{ outcome: this.verifyOutcome }] };
  }
}

class RecordingConsent implements IComputerConsentStore {
  stored = new Map<string, ComputerStoredGrant>();
  prompts: { appId: string; scope: ComputerConsentScope }[] = [];
  answer: ComputerConsentDecision = 'allow_once';
  /** Set to make prompt() hang, exercising the service-side deadline. */
  hang = false;

  async find(workspaceId: string, appIdentity: string) {
    return this.stored.get(`${workspaceId}:${appIdentity}`) ?? null;
  }
  async save(
    workspaceId: string,
    appIdentity: string,
    _label: string,
    decision: 'always_allow' | 'deny',
    scope: ComputerConsentScope,
  ) {
    this.stored.set(`${workspaceId}:${appIdentity}`, { decision, scope });
  }
  async prompt(req: { app: ComputerAppIdentity; scope: ComputerConsentScope }) {
    this.prompts.push({ appId: req.app.appId, scope: req.scope });
    if (this.hang) return new Promise<ComputerConsentDecision>(() => {});
    return this.answer;
  }
}

class RecordingAudit implements IComputerAuditSink {
  entries: ComputerAuditEntry[] = [];
  async record(entry: ComputerAuditEntry): Promise<void> { this.entries.push(entry); }
}

function makeService(
  apps: FakeApp[],
  overrides: Partial<ReturnType<typeof baseConfig>> = {},
): {
  service: ComputerService;
  bridge: FakeBridge;
  consent: RecordingConsent;
  audit: RecordingAudit;
  events: AgentEvent[];
  artifacts: WorkspaceArtifactRecord[];
} {
  const bridge = new FakeBridge(apps);
  const consent = new RecordingConsent();
  const audit = new RecordingAudit();
  const events: AgentEvent[] = [];
  const artifacts: WorkspaceArtifactRecord[] = [];
  const eventBus = { emit: async (_s: string, e: AgentEvent) => { events.push(e); return e; } };
  const artifactRepo = { create: async (a: WorkspaceArtifactRecord) => { artifacts.push(a); } };
  const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogger;

  const service = new ComputerService(
    artifactRepo as never,
    eventBus as never,
    logger,
    consent,
    audit,
    { ...baseConfig(), ...overrides },
    [bridge, new NullComputerBridge()],
  );
  return { service, bridge, consent, audit, events, artifacts };
}

function baseConfig() {
  return AppConfigSchema.parse({}).computerUse;
}

const SLACK: FakeApp = { id: 'com.tinyspeck.slackmacgap', name: 'Slack', pid: 42, windowTitles: ['#general'] };
const VAULT: FakeApp = { id: 'com.1password.1password', name: '1Password', pid: 43, windowTitles: ['Vault'] };
const DISGUISED: FakeApp = { id: 'com.example.notes', name: 'Notes', pid: 44, windowTitles: ['Bitwarden — Unlock'] };
const OTHER: FakeApp = { id: 'com.example.other', name: 'Other', pid: 45, windowTitles: ['Other'] };

describe('ComputerService feature gate', () => {
  beforeEach(() => { delete process.env['GENERATORAI_COMPUTER_USE']; });

  it('is off by default', () => {
    const { service } = makeService([SLACK]);
    expect(service.isEnabled()).toBe(false);
  });

  it('refuses every operation while disabled, without touching a bridge', async () => {
    const { service, bridge } = makeService([SLACK]);
    const result = await service.snapshot(CTX, { by: 'appId', appId: SLACK.id });
    expect(result.refusal?.code).toBe('provider_unavailable');
    expect(bridge.snapshotCalls).toHaveLength(0);
  });

  it('env kill switch beats an enabled config', async () => {
    const { service } = makeService([SLACK], { ...baseConfig(), enabled: true });
    expect(service.isEnabled()).toBe(true);
    for (const token of ['0', 'false', 'OFF', 'no', 'disabled']) {
      process.env['GENERATORAI_COMPUTER_USE'] = token;
      expect(service.isEnabled()).toBe(false);
    }
    delete process.env['GENERATORAI_COMPUTER_USE'];
  });
});

describe('ComputerService blocklist', () => {
  beforeEach(() => { delete process.env['GENERATORAI_COMPUTER_USE']; });

  const enabled = () => ({ ...baseConfig(), enabled: true });

  it('hides blocked apps from the agent entirely', async () => {
    const { service } = makeService([SLACK, VAULT], enabled());
    const { apps } = await service.listApps(CTX);
    expect(apps.map((a) => a.id)).toEqual([SLACK.id]);
  });

  it('hides an app whose window title gives it away', async () => {
    const { service } = makeService([SLACK, DISGUISED], enabled());
    const { apps } = await service.listApps(CTX);
    expect(apps.map((a) => a.id)).toEqual([SLACK.id]);
  });

  it('refuses a blocked app addressed by id, name, or pid', async () => {
    for (const ref of [
      { by: 'appId', appId: VAULT.id } as const,
      { by: 'appName', appName: VAULT.name } as const,
      { by: 'pid', pid: VAULT.pid } as const,
    ]) {
      const { service, bridge } = makeService([VAULT], enabled());
      const result = await service.snapshot(CTX, ref);
      // Indistinguishable from "no such app" on purpose — an `app_blocked`
      // code would let the agent probe by name and learn a password manager
      // is running.
      expect(result.refusal?.code).toBe('target_lost');
      expect(bridge.snapshotCalls).toHaveLength(0);
    }
  });

  it('returns the same refusal for a blocked app and a missing one', async () => {
    const blocked = makeService([VAULT], enabled());
    const missing = makeService([SLACK], enabled());
    const a = await blocked.service.snapshot(CTX, { by: 'appName', appName: VAULT.name });
    const b = await missing.service.snapshot(CTX, { by: 'appName', appName: 'Nonexistent' });
    expect(a.refusal).toEqual(b.refusal);
  });

  it('fails closed when window enumeration fails', async () => {
    const { service, bridge } = makeService([SLACK], enabled());
    bridge.listWindows = async () => { throw new Error('transport died'); };
    const { apps } = await service.listApps(CTX);
    expect(apps).toHaveLength(0);
    const result = await service.snapshot(CTX, { by: 'appId', appId: SLACK.id });
    expect(result.refusal?.code).toBe('target_lost');
  });

  it('runs the blocklist BEFORE consent, so a block is never promptable', async () => {
    const { service, consent } = makeService([VAULT], enabled());
    await service.snapshot(CTX, { by: 'appId', appId: VAULT.id });
    expect(consent.prompts).toHaveLength(0);
  });

  it('audits the block with the matched field', async () => {
    const { service, audit } = makeService([VAULT], enabled());
    await service.snapshot(CTX, { by: 'appId', appId: VAULT.id });
    const entry = audit.entries.find((e) => e.refusalCode === 'app_blocked');
    expect(entry?.blockedOn).toMatch(/^bundleId:/);
  });

  it('emits a refusal event so the block is visible in the transcript', async () => {
    const { service, events } = makeService([VAULT], enabled());
    await service.snapshot(CTX, { by: 'appId', appId: VAULT.id });
    expect(events.some((e) => e.kind === 'computer.refusal')).toBe(true);
  });
});

describe('ComputerService live preview', () => {
  beforeEach(() => { delete process.env['GENERATORAI_COMPUTER_USE']; });

  const enabled = () => ({ ...baseConfig(), enabled: true });

  it('re-arms the preview on a new session after the old one goes away', async () => {
    // Sessions are closed by the idle sweeper and recreated by the next
    // action. Recording lives on the session, so without re-arming the panel
    // keeps showing a live badge while nothing is being captured.
    const { service, bridge } = makeService([SLACK], enabled());
    await service.startRecording(CTX, { outputDir: '/tmp/run' });
    expect(bridge.recordingStarts).toHaveLength(1);

    await service.stop(CTX.workspaceId, 'idle');
    await service.listApps(CTX);

    expect(bridge.recordingStarts).toHaveLength(2);
    expect((await service.recordingState(CTX.workspaceId)).recording).toBe(true);
  });

  it('reports an armed preview as on while no session is open', async () => {
    // Nothing is captured in that gap, but nothing happens in it either: no
    // session means no agent activity to miss.
    const { service } = makeService([SLACK], enabled());
    await service.startRecording(CTX, { outputDir: '/tmp/run' });
    await service.stop(CTX.workspaceId, 'idle');

    expect((await service.recordingState(CTX.workspaceId)).recording).toBe(true);
  });

  it('stops re-arming once the operator turns the preview off', async () => {
    const { service, bridge } = makeService([SLACK], enabled());
    await service.startRecording(CTX, { outputDir: '/tmp/run' });
    await service.stopRecording(CTX.workspaceId);

    await service.stop(CTX.workspaceId, 'idle');
    await service.listApps(CTX);

    expect(bridge.recordingStarts).toHaveLength(1);
    expect((await service.recordingState(CTX.workspaceId)).recording).toBe(false);
  });

  it('disarms after a stop issued with no session open', async () => {
    const { service, bridge } = makeService([SLACK], enabled());
    await service.startRecording(CTX, { outputDir: '/tmp/run' });
    await service.stop(CTX.workspaceId, 'idle');
    await service.stopRecording(CTX.workspaceId);

    await service.listApps(CTX);

    expect(bridge.recordingStarts).toHaveLength(1);
  });

  it('gives up re-arming when the driver refuses, rather than retrying forever', async () => {
    const { service, bridge } = makeService([SLACK], enabled());
    await service.startRecording(CTX, { outputDir: '/tmp/run' });
    await service.stop(CTX.workspaceId, 'idle');

    bridge.refuseRecording = true;
    await service.listApps(CTX);
    expect((await service.recordingState(CTX.workspaceId)).recording).toBe(false);

    bridge.refuseRecording = false;
    await service.stop(CTX.workspaceId, 'idle');
    await service.listApps(CTX);
    expect(bridge.recordingStarts).toHaveLength(1);
  });
});

describe('ComputerService blind input', () => {
  beforeEach(() => { delete process.env['GENERATORAI_COMPUTER_USE']; });

  const enabled = () => ({ ...baseConfig(), enabled: true, allowSyntheticFallback: true });
  const press = {
    type: 'pressKey' as const,
    target: { app: { appId: SLACK.id, name: SLACK.name, pid: SLACK.pid }, window: { by: 'focused' } },
    key: 'a',
  } satisfies ActionRequest;

  /** Makes the bridge deliver synthetic input the driver cannot confirm. */
  function goBlind(bridge: FakeBridge) {
    bridge.act = async (_h, req) => {
      bridge.actCalls.push(req);
      return {
        ok: true,
        snapshot: null,
        screenshot: null,
        action: { path: 'synthetic' as const, verification: { state: 'unverified' as const } },
      };
    };
  }

  it('stops the agent once unconfirmed synthetic input piles up', async () => {
    const { service, bridge } = makeService([SLACK], enabled());
    goBlind(bridge);

    for (let i = 0; i < 5; i += 1) {
      expect((await service.act(CTX, { by: 'appId', appId: SLACK.id }, press)).refusal).toBeUndefined();
    }
    const blocked = await service.act(CTX, { by: 'appId', appId: SLACK.id }, press);

    expect(blocked.refusal?.code).toBe('provider_unavailable');
    expect(blocked.refusal?.message).toMatch(/could not be confirmed/);
    expect(bridge.actCalls).toHaveLength(5);
  });

  it('tells the agent how to prove the window is still reachable', async () => {
    const { service, bridge } = makeService([SLACK], enabled());
    goBlind(bridge);
    for (let i = 0; i < 5; i += 1) await service.act(CTX, { by: 'appId', appId: SLACK.id }, press);

    const message = (await service.act(CTX, { by: 'appId', appId: SLACK.id }, press)).refusal?.message ?? '';
    expect(message).toMatch(/Stop sending input/);
    expect(message).toMatch(/computer_snapshot/);
  });

  it('is cleared by a snapshot that finds the window focused', async () => {
    // Chromium/Electron hosts never confirm synthetic input, so without this
    // the breaker fired on the 6th keystroke of every VS Code run while the
    // accessibility layer was demonstrably healthy.
    const { service, bridge } = makeService([SLACK], enabled());
    goBlind(bridge);
    for (let i = 0; i < 5; i += 1) await service.act(CTX, { by: 'appId', appId: SLACK.id }, press);

    const read = await service.snapshot(CTX, { by: 'appId', appId: SLACK.id });
    expect(read.snapshot?.window.focused).toBe(true);

    for (let i = 0; i < 5; i += 1) {
      expect((await service.act(CTX, { by: 'appId', appId: SLACK.id }, press)).refusal).toBeUndefined();
    }
  });

  it('records the stop in the audit trail', async () => {
    const { service, bridge, audit } = makeService([SLACK], enabled());
    goBlind(bridge);
    for (let i = 0; i < 6; i += 1) await service.act(CTX, { by: 'appId', appId: SLACK.id }, press);

    expect(audit.entries.some((e) => e.refusalCode === 'provider_unavailable')).toBe(true);
  });

  it('forgives a confirmed synthetic action in between', async () => {
    // Synthetic input landing proves the driver can still reach the window, so
    // the streak is not evidence of a blind session.
    const { service, bridge } = makeService([SLACK], enabled());
    goBlind(bridge);

    for (let i = 0; i < 4; i += 1) await service.act(CTX, { by: 'appId', appId: SLACK.id }, press);
    bridge.act = async (_h, req) => {
      bridge.actCalls.push(req);
      return {
        ok: true,
        snapshot: null,
        screenshot: null,
        action: { path: 'synthetic' as const, verification: { state: 'verified' as const } },
      };
    };
    await service.act(CTX, { by: 'appId', appId: SLACK.id }, press);
    goBlind(bridge);
    for (let i = 0; i < 5; i += 1) {
      expect((await service.act(CTX, { by: 'appId', appId: SLACK.id }, press)).refusal).toBeUndefined();
    }
  });

  it('is not reset by an accessibility action that succeeds alongside blind input', async () => {
    // Measured against a real run: `bring_to_front` kept returning verified
    // while every keystroke was rejected by the Windows foreground lock. If
    // that cleared the streak the breaker would never fire when it matters.
    const { service, bridge } = makeService([SLACK], enabled());
    let syntheticTurn = true;
    bridge.act = async (_h, req) => {
      bridge.actCalls.push(req);
      const blind = syntheticTurn;
      return {
        ok: true,
        snapshot: null,
        screenshot: null,
        action: {
          path: blind ? ('synthetic' as const) : ('accessibility' as const),
          verification: { state: blind ? ('unverified' as const) : ('verified' as const) },
        },
      };
    };
    for (let i = 0; i < 5; i += 1) {
      syntheticTurn = true;
      await service.act(CTX, { by: 'appId', appId: SLACK.id }, press);
      syntheticTurn = false;
      await service.act(CTX, { by: 'appId', appId: SLACK.id }, press);
    }
    syntheticTurn = true;
    const blocked = await service.act(CTX, { by: 'appId', appId: SLACK.id }, press);

    expect(blocked.refusal?.code).toBe('provider_unavailable');
  });

  it('leaves accessibility-driven actions alone', async () => {
    // Those are verifiable and do not touch the user's focus, so they must not
    // be caught by a control aimed at blind synthetic input.
    const { service, bridge } = makeService([SLACK], enabled());
    bridge.act = async (_h, req) => {
      bridge.actCalls.push(req);
      return {
        ok: true,
        snapshot: null,
        screenshot: null,
        action: { path: 'accessibility' as const, verification: { state: 'unverified' as const } },
      };
    };
    for (let i = 0; i < 8; i += 1) {
      expect((await service.act(CTX, { by: 'appId', appId: SLACK.id }, press)).refusal).toBeUndefined();
    }
  });
});

describe('ComputerService run-scoped consent', () => {
  beforeEach(() => { delete process.env['GENERATORAI_COMPUTER_USE']; });

  const enabled = () => ({ ...baseConfig(), enabled: true, allowSyntheticFallback: true });
  const press = {
    type: 'pressKey' as const,
    target: { app: { appId: SLACK.id, name: SLACK.name, pid: SLACK.pid }, window: { by: 'focused' } },
    key: 'a',
  } satisfies ActionRequest;

  it('stops asking for the rest of the run, including synthetic input', async () => {
    // A standing grant deliberately never covers synthetic, so before this the
    // only way through a long task was answering a prompt every few actions —
    // and an unanswered one expires as a denial and ends the run.
    const { service, consent } = makeService([SLACK], enabled());
    consent.answer = 'allow_run';
    await service.act(CTX, { by: 'appId', appId: SLACK.id }, press);
    expect(consent.prompts).toHaveLength(1);

    consent.answer = 'deny';
    for (let i = 0; i < 3; i += 1) {
      expect((await service.act(CTX, { by: 'appId', appId: SLACK.id }, press)).refusal).toBeUndefined();
    }
    expect(consent.prompts).toHaveLength(1);
  });

  it('is dropped when the desktop session ends', async () => {
    const { service, consent } = makeService([SLACK], enabled());
    consent.answer = 'allow_run';
    await service.act(CTX, { by: 'appId', appId: SLACK.id }, press);

    await service.stop(CTX.workspaceId, 'idle');
    consent.answer = 'deny';

    expect((await service.act(CTX, { by: 'appId', appId: SLACK.id }, press)).refusal?.code).toBe(
      'consent_denied',
    );
  });

  it('does not leak to another chat', async () => {
    const { service, consent } = makeService([SLACK], enabled());
    consent.answer = 'allow_run';
    await service.act(CTX, { by: 'appId', appId: SLACK.id }, press);

    consent.answer = 'deny';
    const otherChat = { ...CTX, chatId: 'a-different-chat' };
    expect((await service.act(otherChat, { by: 'appId', appId: SLACK.id }, press)).refusal?.code).toBe(
      'consent_denied',
    );
  });

  it('is never written to the persistent grant store', async () => {
    // It must not outlive the run, so nothing about it belongs on disk.
    const { service, consent } = makeService([SLACK], enabled());
    consent.answer = 'allow_run';
    await service.act(CTX, { by: 'appId', appId: SLACK.id }, press);

    expect(consent.stored.size).toBe(0);
  });
});

describe('ComputerService consent', () => {
  const enabled = () => ({ ...baseConfig(), enabled: true });

  it('refuses and audits when the user denies', async () => {
    const { service, consent, audit, bridge } = makeService([SLACK], enabled());
    consent.answer = 'deny';
    const result = await service.snapshot(CTX, { by: 'appId', appId: SLACK.id });
    expect(result.refusal?.code).toBe('consent_denied');
    expect(bridge.snapshotCalls).toHaveLength(0);
    expect(audit.entries.some((e) => e.refusalCode === 'consent_denied')).toBe(true);
  });

  it('a stored deny short-circuits without re-prompting', async () => {
    const { service, consent } = makeService([SLACK], enabled());
    await consent.save(CTX.workspaceId, SLACK.id, 'Slack', 'deny', 'read');
    const result = await service.snapshot(CTX, { by: 'appId', appId: SLACK.id });
    expect(result.refusal?.code).toBe('consent_denied');
    expect(consent.prompts).toHaveLength(0);
  });

  it('always_allow is persisted and reused', async () => {
    const { service, consent } = makeService([SLACK], enabled());
    consent.answer = 'always_allow';
    await service.snapshot(CTX, { by: 'appId', appId: SLACK.id });
    expect(consent.stored.get(`${CTX.workspaceId}:${SLACK.id}`)).toEqual({
      decision: 'always_allow',
      scope: 'read',
    });
    consent.prompts.length = 0;
    await service.snapshot(CTX, { by: 'appId', appId: SLACK.id });
    expect(consent.prompts).toHaveLength(0);
  });

  it('a read grant does not authorise a mutation', async () => {
    const { service, consent } = makeService([SLACK], enabled());
    consent.answer = 'always_allow';
    const snap = await service.snapshot(CTX, { by: 'appId', appId: SLACK.id });
    consent.prompts.length = 0;
    await service.act(CTX, { by: 'appId', appId: SLACK.id }, {
      type: 'click', snapshotId: snap.snapshot!.snapshotId, elementIndex: 0,
    });
    expect(consent.prompts.map((p) => p.scope)).toEqual(['mutate']);
  });

  it('a hung prompt expires into a denial instead of hanging the call', async () => {
    const { service, consent } = makeService([SLACK], { ...enabled(), consentTtlSeconds: 10 });
    consent.hang = true;
    vi.useFakeTimers();
    const pending = service.snapshot(CTX, { by: 'appId', appId: SLACK.id });
    await vi.advanceTimersByTimeAsync(11_000);
    const result = await pending;
    vi.useRealTimers();
    expect(result.refusal?.code).toBe('consent_denied');
  });

  it('treats an out-of-union decision as a denial', async () => {
    const { service, consent, bridge } = makeService([SLACK], enabled());
    consent.answer = undefined as unknown as ComputerConsentDecision;
    const result = await service.snapshot(CTX, { by: 'appId', appId: SLACK.id });
    expect(result.refusal?.code).toBe('consent_denied');
    expect(bridge.snapshotCalls).toHaveLength(0);
  });

  it('allow_once is never persisted', async () => {
    const { service, consent } = makeService([SLACK], enabled());
    consent.answer = 'allow_once';
    await service.snapshot(CTX, { by: 'appId', appId: SLACK.id });
    expect(consent.stored.size).toBe(0);
  });

  it('a stored grant never covers synthetic input', async () => {
    const { service, consent } = makeService([SLACK], {
      ...enabled(),
      allowSyntheticFallback: true,
    });
    await consent.save(CTX.workspaceId, SLACK.id, 'Slack', 'always_allow', 'synthetic');
    consent.answer = 'allow_once';
    await service.act(CTX, { by: 'appId', appId: SLACK.id }, {
      type: 'typeText',
      target: { app: { appId: SLACK.id, name: SLACK.name, pid: SLACK.pid }, window: { by: 'focused' } },
      text: 'hello',
    });
    expect(consent.prompts.map((p) => p.appId)).toContain(SLACK.id);
  });

  it('never persists an always_allow for synthetic input', async () => {
    const { service, consent } = makeService([SLACK], { ...enabled(), allowSyntheticFallback: true });
    consent.answer = 'always_allow';
    await service.act(CTX, { by: 'appId', appId: SLACK.id }, {
      type: 'typeText',
      target: { app: { appId: SLACK.id, name: SLACK.name, pid: SLACK.pid }, window: { by: 'focused' } },
      text: 'hello',
    });
    expect(consent.stored.size).toBe(0);
  });
});

describe('ComputerService snapshot fencing', () => {
  const enabled = () => ({ ...baseConfig(), enabled: true });

  async function snapshotted() {
    const harness = makeService([SLACK], enabled());
    harness.consent.answer = 'always_allow';
    const snap = await harness.service.snapshot(CTX, { by: 'appId', appId: SLACK.id });
    return { ...harness, snapshotId: snap.snapshot!.snapshotId };
  }

  it('rejects an unknown snapshotId without dispatching', async () => {
    const { service, bridge } = await snapshotted();
    const result = await service.act(CTX, { by: 'appId', appId: SLACK.id }, {
      type: 'click', snapshotId: 'never-issued', elementIndex: 0,
    });
    expect(result.refusal?.code).toBe('stale_snapshot');
    expect(bridge.actCalls).toHaveLength(0);
  });

  it('invalidates the fence after any action, forcing a re-snapshot', async () => {
    const { service, bridge, snapshotId } = await snapshotted();
    const first = await service.act(CTX, { by: 'appId', appId: SLACK.id }, {
      type: 'click', snapshotId, elementIndex: 0,
    });
    expect(first.ok).toBe(true);
    const second = await service.act(CTX, { by: 'appId', appId: SLACK.id }, {
      type: 'click', snapshotId, elementIndex: 0,
    });
    expect(second.refusal?.code).toBe('stale_snapshot');
    expect(bridge.actCalls).toHaveLength(1);
  });

  it('rejects an element index outside the snapshot', async () => {
    const { service, snapshotId } = await snapshotted();
    const result = await service.act(CTX, { by: 'appId', appId: SLACK.id }, {
      type: 'click', snapshotId, elementIndex: 99,
    });
    expect(result.refusal?.code).toBe('stale_snapshot');
  });

  it('accepts a sparse index from a query-filtered snapshot', async () => {
    // A `query`ed snapshot is a PROJECTION: it returns few elements but keeps
    // their real window indices, so index 455 can legitimately arrive from a
    // 2-element view. Fencing on the view's LENGTH rejected exactly the
    // elements the projection existed to reach, and the agent's only recovery
    // was to stop using `query` and re-read whole windows.
    const harness = makeService([SLACK], enabled());
    harness.consent.answer = 'always_allow';
    harness.bridge.elements = [
      { index: 45, role: 'cell', label: 'A1', secure: false, value: '', traits: [], actions: ['AXPress'], childCount: 0 },
      { index: 455, role: 'cell', label: 'A1', secure: false, value: '', traits: [], actions: ['AXPress'], childCount: 0 },
    ];
    const snap = await harness.service.snapshot(CTX, { by: 'appId', appId: SLACK.id }, { query: 'A1' });

    const result = await harness.service.act(CTX, { by: 'appId', appId: SLACK.id }, {
      type: 'click', snapshotId: snap.snapshot!.snapshotId, elementIndex: 455,
    });
    expect(result.ok).toBe(true);
    expect(harness.bridge.actCalls).toHaveLength(1);
  });

  it('rejects an action the element never advertised', async () => {
    const { service, bridge, snapshotId } = await snapshotted();
    const result = await service.act(CTX, { by: 'appId', appId: SLACK.id }, {
      type: 'performAction', snapshotId, elementIndex: 0, actionName: 'AXDelete',
    });
    // Not `stale_snapshot`: the snapshot is current, so telling the agent it is
    // stale sends it round a re-snapshot loop that can never help.
    expect(result.refusal?.code).toBe('unsupported_action');
    expect(result.refusal?.message).toMatch(/AXPress/);
    expect(bridge.actCalls).toHaveLength(0);
  });

  it('accepts an advertised action', async () => {
    const { service, snapshotId } = await snapshotted();
    const result = await service.act(CTX, { by: 'appId', appId: SLACK.id }, {
      type: 'performAction', snapshotId, elementIndex: 0, actionName: 'AXPress',
    });
    expect(result.ok).toBe(true);
  });

  it('lets only one of two concurrent calls sharing a snapshotId through', async () => {
    // Both pass any pre-permit fence check; the loser must be rejected inside
    // the critical section rather than acting on a UI the winner just moved.
    const { service, bridge, snapshotId } = await snapshotted();
    const req = { type: 'click', snapshotId, elementIndex: 0 } as const;
    const results = await Promise.all([
      service.act(CTX, { by: 'appId', appId: SLACK.id }, req),
      service.act(CTX, { by: 'appId', appId: SLACK.id }, req),
    ]);
    expect(bridge.actCalls).toHaveLength(1);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => r.refusal?.code === 'stale_snapshot')).toHaveLength(1);
  });

  it('refuses when the app exits between consent and dispatch', async () => {
    const { service, bridge, snapshotId, consent } = await snapshotted();
    consent.answer = 'always_allow';
    bridge.listApps = async () => ({ apps: [] });
    const result = await service.act(CTX, { by: 'appId', appId: SLACK.id }, {
      type: 'click', snapshotId, elementIndex: 0,
    });
    expect(result.refusal?.code).toBe('target_lost');
  });
});

describe('ComputerService synthetic input', () => {
  const enabled = () => ({ ...baseConfig(), enabled: true });

  const typeText: ActionRequest = {
    type: 'typeText',
    target: { app: { appId: SLACK.id, name: SLACK.name, pid: SLACK.pid }, window: { by: 'focused' } },
    text: 'hello',
  };

  it('is refused while allowSyntheticFallback is off', async () => {
    const { service, bridge, audit } = makeService([SLACK], enabled());
    const result = await service.act(CTX, { by: 'appId', appId: SLACK.id }, typeText);
    expect(result.refusal?.code).toBe('background_unavailable');
    expect(bridge.actCalls).toHaveLength(0);
    expect(audit.entries.some((e) => e.refusalCode === 'background_unavailable')).toBe(true);
  });

  it.each(['clickPoint', 'typeText', 'pressKey', 'pasteText', 'scroll', 'drag'] as const)(
    'classifies %s as synthetic',
    async (type) => {
      const target = { app: { appId: SLACK.id, name: SLACK.name, pid: SLACK.pid }, window: { by: 'focused' } } as const;
      const requests: Record<string, ActionRequest> = {
        clickPoint: { type: 'clickPoint', target, x: 1, y: 1 },
        typeText: { type: 'typeText', target, text: 'x' },
        pressKey: { type: 'pressKey', target, key: 'a' },
        pasteText: { type: 'pasteText', target, text: 'x' },
        scroll: { type: 'scroll', target, deltaX: 0, deltaY: 1 },
        drag: { type: 'drag', target, from: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
      };
      const { service, bridge } = makeService([SLACK], enabled());
      const result = await service.act(CTX, { by: 'appId', appId: SLACK.id }, requests[type]!);
      expect(result.refusal?.code).toBe('background_unavailable');
      expect(bridge.actCalls).toHaveLength(0);
    },
  );

  it('is allowed once explicitly opted into', async () => {
    const { service, bridge, consent } = makeService([SLACK], { ...enabled(), allowSyntheticFallback: true });
    consent.answer = 'allow_once';
    const result = await service.act(CTX, { by: 'appId', appId: SLACK.id }, typeText);
    expect(result.ok).toBe(true);
    expect(bridge.actCalls).toHaveLength(1);
  });
});

describe('ComputerService audit and events', () => {
  const enabled = () => ({ ...baseConfig(), enabled: true });

  it('records the element label as the target, never typed content', async () => {
    const { service, audit, consent } = makeService([SLACK], enabled());
    consent.answer = 'always_allow';
    const snap = await service.snapshot(CTX, { by: 'appId', appId: SLACK.id });
    await service.act(CTX, { by: 'appId', appId: SLACK.id }, {
      type: 'setValue', snapshotId: snap.snapshot!.snapshotId, elementIndex: 1, value: 'super-secret-token',
    });
    const entry = audit.entries.find((e) => e.action === 'setValue');
    expect(entry?.target).toBe('Message');
    expect(JSON.stringify(audit.entries)).not.toContain('super-secret-token');
  });

  it('never puts typed content into an emitted event', async () => {
    const { service, events, consent } = makeService([SLACK], enabled());
    consent.answer = 'always_allow';
    const snap = await service.snapshot(CTX, { by: 'appId', appId: SLACK.id });
    await service.act(CTX, { by: 'appId', appId: SLACK.id }, {
      type: 'setValue', snapshotId: snap.snapshot!.snapshotId, elementIndex: 1, value: 'super-secret-token',
    });
    expect(JSON.stringify(events)).not.toContain('super-secret-token');
  });

  it('overwrites a caller-supplied target app so consent and delivery cannot diverge', async () => {
    const { service, bridge, consent } = makeService([SLACK, OTHER], {
      ...enabled(),
      allowSyntheticFallback: true,
    });
    consent.answer = 'allow_once';
    await service.act(CTX, { by: 'appId', appId: SLACK.id }, {
      type: 'typeText',
      // Caller names Slack in `ref` but points the payload at another app.
      target: { app: { appId: OTHER.id, name: OTHER.name, pid: OTHER.pid }, window: { by: 'focused' } },
      text: 'hello',
    });
    const dispatched = bridge.actCalls[0]!;
    if (dispatched.type !== 'typeText') throw new Error('expected typeText');
    expect(dispatched.target.app.appId).toBe(SLACK.id);
    expect(consent.prompts[0]?.appId).toBe(SLACK.id);
  });

  it('does not announce a session for a non-operational bridge', async () => {
    const events: AgentEvent[] = [];
    const eventBus = { emit: async (_s: string, e: AgentEvent) => { events.push(e); return e; } };
    const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogger;
    const service = new ComputerService(
      { create: async () => {} } as never,
      eventBus as never,
      logger,
      new RecordingConsent(),
      new RecordingAudit(),
      { ...baseConfig(), enabled: true },
      [new NullComputerBridge()],
    );
    const result = await service.snapshot(CTX, { by: 'appId', appId: SLACK.id });
    expect(result.refusal?.code).toBe('provider_unavailable');
    expect(events.some((e) => e.kind === 'computer.session_started')).toBe(false);
  });
});
