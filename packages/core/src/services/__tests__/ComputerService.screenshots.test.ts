// ────────────────────────────────────────────────────────────────
// ComputerService — screenshot ownership, frame integrity, dedup, audit.
//
// Everything here runs against REAL files in a REAL temp workspace and REAL
// sharp-encoded images. That is deliberate: the defects these cover are all
// "who owns this file and is it still on disk", and a mocked filesystem is
// exactly the thing that let them ship — the previous tests asserted return
// values and never once looked at the directory.
// ────────────────────────────────────────────────────────────────

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type {
  AgentEvent,
  ComputerActionResult,
  ComputerCapabilities,
  ComputerScreenshot,
  ILogger,
  WorkspaceArtifactRecord,
} from '@generatorai/shared';
import { AppConfigSchema } from '@generatorai/shared';
import { ComputerService } from '../ComputerService.js';
import type {
  ComputerAuditEntry,
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
import { snapshotPayload, actionPayload } from '../../tools/computer/computerToolTypes.js';

const sharpAvailable = await import('sharp').then(
  () => true,
  () => false,
);

const CAPS: ComputerCapabilities = {
  platform: 'win32',
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

const APP = { id: 'com.example.editor', name: 'Editor', pid: 77, windowTitles: ['Untitled'] };
const APP_REF = { by: 'appName', appName: 'Editor' } as const;

/** Encodes a real image so the codec and the validator see genuine bytes. */
async function encodePng(width: number, height: number, tint: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  return sharp({ create: { width, height, channels: 3, background: { r: tint, g: 40, b: 200 } } })
    .png()
    .toBuffer();
}

/**
 * A capture that does not compress.
 *
 * A flat-colour image encodes to a couple of hundred bytes at any resolution,
 * so it cannot exercise the byte cap no matter how large the canvas is — the
 * cap is about ENCODED size, and only incompressible content reaches it.
 */
async function encodeNoisePng(width: number, height: number): Promise<Buffer> {
  const sharp = (await import('sharp')).default;
  const raw = Buffer.allocUnsafe(width * height * 3);
  for (let i = 0; i < raw.length; i += 1) raw[i] = (i * 2654435761) % 251;
  return sharp(raw, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

class ScreenshotBridge implements IComputerBridge {
  readonly id = 'fake';
  /** Bytes the "driver" writes for the next capture. */
  nextCapture: Buffer | null = null;
  /** Relative path within the workspace the next capture is written to. */
  captureCounter = 0;
  listAppsRefusal: ListAppsResult['refusal'] = undefined;
  actRefusal: ComputerActionResult['refusal'] = undefined;

  constructor(private readonly root: string) {}

  async isAvailable(): Promise<boolean> { return true; }
  async runtime(): Promise<ComputerRuntimeStatus> {
    return { provider: this.id, host: 'in-process', state: 'ready' };
  }
  async capabilities(): Promise<ComputerCapabilities> { return CAPS; }
  async start(opts: { workspaceId: string }): Promise<ComputerHandle> {
    return { workspaceId: opts.workspaceId, provider: this.id, providerVersion: '1', hostRef: 'fake', operational: true };
  }
  async stop(): Promise<void> {}

  async listApps(): Promise<ListAppsResult> {
    if (this.listAppsRefusal) return { apps: [], refusal: this.listAppsRefusal };
    return { apps: [{ id: APP.id, name: APP.name, pid: APP.pid, frontmost: true, windowCount: 1 }] };
  }

  async listWindows(): Promise<ListWindowsResult> {
    return { windows: [{ id: 100, title: APP.windowTitles[0]!, index: 0, focused: true, minimised: false }] };
  }

  async launchApp() {
    return { app: { appId: APP.id, name: APP.name, pid: APP.pid } };
  }

  async bringToFront(): Promise<ComputerActionResult> {
    return { ok: true, snapshot: null, screenshot: null, action: { path: 'accessibility' } };
  }

  /** Writes the pending capture and returns the screenshot descriptor for it. */
  private async writeCapture(): Promise<ComputerScreenshot | null> {
    if (!this.nextCapture) return null;
    const relative = path.join('computer', `frame-${this.captureCounter++}.png`);
    const absolute = path.join(this.root, relative);
    await fs.mkdir(path.dirname(absolute), { recursive: true });
    await fs.writeFile(absolute, this.nextCapture);
    return { format: 'png', width: 640, height: 480, scale: 1, path: relative };
  }

  async snapshot(_h: ComputerHandle, req: SnapshotRequest): Promise<ComputerActionResult> {
    return {
      ok: true,
      screenshot: await this.writeCapture(),
      snapshot: {
        snapshotId: 'snap-1',
        app: { id: req.app.appId, name: req.app.name, pid: req.app.pid },
        window: { id: 100, title: 'Untitled', index: 0, focused: true },
        elements: [
          { index: 0, role: 'button', label: 'Save', secure: false, value: null, traits: [], actions: ['Invoke'], childCount: 0 },
        ],
        truncated: null,
        capturedAt: Date.now(),
      },
    };
  }

  async act(): Promise<ComputerActionResult> {
    if (this.actRefusal) return { ok: false, snapshot: null, screenshot: null, refusal: this.actRefusal };
    return {
      ok: true,
      snapshot: null,
      screenshot: await this.writeCapture(),
      action: { path: 'accessibility', actionName: 'click', verification: { state: 'verified' } },
    };
  }

  async verify(_h: ComputerHandle, _req: VerifyRequest): Promise<VerifyResult> {
    return { outcome: 'satisfied', results: [{ outcome: 'satisfied' }] };
  }
}

class AllowAll implements IComputerConsentStore {
  denyEverything = false;
  async find() { return this.denyEverything ? ({ decision: 'deny' as const, scope: 'read' as const }) : null; }
  async save() {}
  async prompt() { return 'allow_once' as const; }
}

class RecordingAudit implements IComputerAuditSink {
  entries: ComputerAuditEntry[] = [];
  async record(entry: ComputerAuditEntry): Promise<void> { this.entries.push(entry); }
}

/** An in-memory artifact repo that behaves like the real one for id lookups. */
class MemoryArtifacts {
  rows: WorkspaceArtifactRecord[] = [];
  async create(a: WorkspaceArtifactRecord): Promise<void> { this.rows.push(a); }
  async findById(id: string): Promise<WorkspaceArtifactRecord | null> {
    return this.rows.find((r) => r.id === id) ?? null;
  }
  async findByWorkspace(workspaceId: string): Promise<WorkspaceArtifactRecord[]> {
    return this.rows.filter((r) => r.workspaceId === workspaceId);
  }
  async findByStageRun(): Promise<WorkspaceArtifactRecord[]> { return []; }
  async delete(id: string): Promise<void> { this.rows = this.rows.filter((r) => r.id !== id); }
  async deleteByWorkspace(): Promise<void> { this.rows = []; }
}

let root: string;
let harness: ReturnType<typeof makeService>;

function makeService(overrides: Record<string, unknown> = {}) {
  const bridge = new ScreenshotBridge(root);
  const consent = new AllowAll();
  const audit = new RecordingAudit();
  const artifacts = new MemoryArtifacts();
  const events: AgentEvent[] = [];
  const logger: ILogger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as unknown as ILogger;
  const service = new ComputerService(
    artifacts as never,
    { emit: async (_s: string, e: AgentEvent) => { events.push(e); return e; } } as never,
    logger,
    consent,
    audit,
    { ...AppConfigSchema.parse({}).computerUse, enabled: true, allowSyntheticFallback: true, ...overrides },
    [bridge, new NullComputerBridge()],
  );
  return { service, bridge, consent, audit, artifacts, events, logger };
}

/** Files the driver/codec left inside the workspace's capture directory. */
async function captureFiles(): Promise<string[]> {
  return fs.readdir(path.join(root, 'computer')).catch(() => [] as string[]);
}

function ctx(workspaceId = 'ws-1') {
  return { workspaceId, workspaceRoot: root, chatId: 'chat-1' };
}

beforeEach(() => {
  delete process.env['GENERATORAI_COMPUTER_USE'];
  root = mkdtempSync(path.join(tmpdir(), 'cusvc-'));
  harness = makeService();
});

afterEach(async () => {
  await harness.service.dispose().catch(() => undefined);
  try {
    rmSync(root, { recursive: true, force: true });
  } catch {
    // Windows may still hold a libvips handle; a temp dir left behind must not
    // fail the suite.
  }
});

// ────────────────────────────────────────────────────────────────
// P0-f — no path may leak a file, and `shot.path` may never dangle.
// ────────────────────────────────────────────────────────────────

describe('ComputerService screenshot ownership (P0-f)', () => {
  it.runIf(sharpAvailable)('keeps exactly one file and one row for a good capture', async () => {
    const { service, bridge, artifacts } = harness;
    bridge.nextCapture = await encodePng(640, 480, 10);

    const result = await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });

    expect(result.ok).toBe(true);
    expect(artifacts.rows).toHaveLength(1);
    expect(await captureFiles()).toHaveLength(1);
    // The row and the result must agree about which file that is.
    expect(result.screenshot?.path).toBe(artifacts.rows[0]!.relativePath);
    await expect(fs.access(path.join(root, artifacts.rows[0]!.relativePath))).resolves.toBeUndefined();
  });

  it.runIf(sharpAvailable)('deletes the file when the capture fails integrity, instead of orphaning it', async () => {
    const { service, bridge, artifacts } = harness;
    const whole = await encodePng(640, 480, 10);
    // A mid-write truncation: valid PNG signature, no IEND.
    bridge.nextCapture = whole.subarray(0, Math.floor(whole.length * 0.8));

    const result = await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });

    expect(artifacts.rows).toHaveLength(0);
    // THE regression: before the fix the transcoded file survived with no row
    // pointing at it, and `pruneScreenshots` is row-driven, so nothing could
    // ever reclaim it.
    expect(await captureFiles()).toEqual([]);
    // …and `shot.path` must not still name something that is gone.
    expect(result.screenshot?.path).toBeUndefined();
    expect(result.screenshot?.dataOmitted).toBe(true);
  });

  it.runIf(sharpAvailable)('deletes the file when the capture is over the byte cap', async () => {
    const { service, bridge, artifacts } = makeService({ screenshotMaxBytes: 4_000, screenshotMaxEdge: 4096 });
    harness.service = service;
    bridge.nextCapture = await encodeNoisePng(900, 700);

    const result = await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });

    expect(artifacts.rows).toHaveLength(0);
    expect(await captureFiles()).toEqual([]);
    expect(result.screenshot?.path).toBeUndefined();
    expect(result.screenshot?.dataOmitted).toBe(true);
  });

  it.runIf(sharpAvailable)('deletes the file when the artifact row cannot be written', async () => {
    const { service, bridge, artifacts } = harness;
    bridge.nextCapture = await encodePng(640, 480, 10);
    vi.spyOn(artifacts, 'create').mockRejectedValueOnce(new Error('disk full'));

    const result = await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });

    expect(await captureFiles()).toEqual([]);
    expect(result.screenshot?.path).toBeUndefined();
  });
});

// ────────────────────────────────────────────────────────────────
// X-15 — integrity that runs on the codec actually in use, plus the latch.
// ────────────────────────────────────────────────────────────────

describe('ComputerService frame integrity (X-15)', () => {
  it.runIf(sharpAvailable)('rejects a truncated capture under the DEFAULT (webp) configuration', async () => {
    // The previous implementation gated its check on `isJpeg`, and the shipped
    // default `screenshotFormat` is webp — so this exact call validated
    // nothing at all and stored the broken frame.
    expect(AppConfigSchema.parse({}).computerUse.screenshotFormat).toBe('webp');
    const { service, bridge, artifacts } = harness;
    const whole = await encodePng(640, 480, 10);
    bridge.nextCapture = whole.subarray(0, whole.length - 40);

    await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });

    expect(artifacts.rows).toHaveLength(0);
  });

  it.runIf(sharpAvailable)('rejects a capture that is not an image at all', async () => {
    const { service, bridge, artifacts } = harness;
    bridge.nextCapture = Buffer.from('Driver error: could not capture the window'.repeat(8));

    await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });

    expect(artifacts.rows).toHaveLength(0);
    expect(await captureFiles()).toEqual([]);
  });

  it.runIf(sharpAvailable)('closes the inline path one way: a later GOOD frame still never goes inline', async () => {
    const { service, bridge, artifacts } = harness;

    // 1. A good capture, so there is a valid artifact to read back afterwards.
    bridge.nextCapture = await encodePng(640, 480, 10);
    await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });
    const goodId = artifacts.rows[0]!.id;
    await expect(service.readScreenshot('ws-1', goodId)).resolves.not.toBeNull();

    // 2. One corrupt capture trips the latch.
    const whole = await encodePng(640, 480, 30);
    bridge.nextCapture = whole.subarray(0, whole.length - 40);
    await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });

    // 3. The latch is ONE-WAY: the frame from step 1 is still perfectly valid
    //    on disk, and it still must not reach the model inline.
    await expect(service.readScreenshot('ws-1', goodId)).resolves.toBeNull();

    // 4. A brand-new good capture does not reopen it either.
    bridge.nextCapture = await encodePng(640, 480, 60);
    await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });
    const newest = artifacts.rows[artifacts.rows.length - 1]!;
    await expect(service.readScreenshot('ws-1', newest.id)).resolves.toBeNull();
  });

  it.runIf(sharpAvailable)('stays closed across the driver restart the refusal text recommends', async () => {
    // THE regression. The latch used to live on `SessionRecord`, and every path
    // that recreates a session rebuilt it with the latch OPEN again:
    // `restartRuntime()` (the Computer panel's "restart the desktop driver"
    // button — the exact remedy `ComputerService` tells the model to suggest),
    // the idle sweeper, and a driver crash. A safety latch the recommended
    // remedy clears is not a latch.
    const { service, bridge, artifacts } = harness;

    bridge.nextCapture = await encodePng(640, 480, 10);
    await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });
    const goodId = artifacts.rows[0]!.id;
    await expect(service.readScreenshot('ws-1', goodId)).resolves.not.toBeNull();

    const whole = await encodePng(640, 480, 30);
    bridge.nextCapture = whole.subarray(0, whole.length - 40);
    await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });
    await expect(service.readScreenshot('ws-1', goodId)).resolves.toBeNull();

    // Stop + reopen — a brand new SessionRecord for the same workspace.
    await service.restartRuntime(ctx());

    // The frame from step 1 is still valid on disk and the session is brand
    // new, but this capture path has already been shown to be untrustworthy.
    await expect(service.readScreenshot('ws-1', goodId)).resolves.toBeNull();

    bridge.nextCapture = await encodePng(640, 480, 90);
    await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });
    const newest = artifacts.rows[artifacts.rows.length - 1]!;
    await expect(service.readScreenshot('ws-1', newest.id)).resolves.toBeNull();
  });

  it.runIf(sharpAvailable)('stays closed when a bare stop() drops the session (idle sweep, crash)', async () => {
    const { service, bridge, artifacts } = harness;

    bridge.nextCapture = await encodePng(640, 480, 10);
    await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });
    const goodId = artifacts.rows[0]!.id;

    const whole = await encodePng(640, 480, 30);
    bridge.nextCapture = whole.subarray(0, whole.length - 40);
    await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });

    // What the idle sweeper and `handleCrash` both do: drop the record.
    await service.stop('ws-1', 'idle');
    // …and what the very next action does: silently open a new one.
    bridge.nextCapture = await encodePng(640, 480, 90);
    await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });

    await expect(service.readScreenshot('ws-1', goodId)).resolves.toBeNull();
    const newest = artifacts.rows[artifacts.rows.length - 1]!;
    await expect(service.readScreenshot('ws-1', newest.id)).resolves.toBeNull();
  });

  it.runIf(sharpAvailable)('is scoped to the workspace that produced the bad frame, not to every workspace', async () => {
    // One-way must not mean process-wide: a corrupt capture in one workspace
    // says nothing about another workspace's driver.
    const { service, bridge, artifacts } = harness;
    const whole = await encodePng(640, 480, 30);
    bridge.nextCapture = whole.subarray(0, whole.length - 40);
    await service.snapshot(ctx('ws-1'), APP_REF, { includeScreenshot: true });

    bridge.nextCapture = await encodePng(640, 480, 10);
    await service.snapshot(ctx('ws-2'), APP_REF, { includeScreenshot: true });
    const other = artifacts.rows[artifacts.rows.length - 1]!;
    expect(other.workspaceId).toBe('ws-2');
    await expect(service.readScreenshot('ws-2', other.id)).resolves.not.toBeNull();
  });

  it.runIf(sharpAvailable)('latches on a file that was corrupted AFTER it was stored', async () => {
    const { service, bridge, artifacts } = harness;
    bridge.nextCapture = await encodePng(640, 480, 10);
    await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });
    const row = artifacts.rows[0]!;

    // The inline path validates what it is about to hand over, not what was
    // once written — the write-time check cannot speak for a later truncation.
    const file = path.join(root, row.relativePath);
    const bytes = await fs.readFile(file);
    await fs.writeFile(file, bytes.subarray(0, bytes.length - 30));

    await expect(service.readScreenshot('ws-1', row.id)).resolves.toBeNull();
  });
});

// ────────────────────────────────────────────────────────────────
// X-16 — dedup on the canonical frame, surfaced where the model reads it.
// ────────────────────────────────────────────────────────────────

describe('ComputerService duplicate frames (X-16)', () => {
  it.runIf(sharpAvailable)('stores one file and one row for two identical captures', async () => {
    const { service, bridge, artifacts } = harness;
    const frame = await encodePng(640, 480, 10);

    bridge.nextCapture = frame;
    await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });
    bridge.nextCapture = Buffer.from(frame);
    const second = await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });

    expect(artifacts.rows).toHaveLength(1);
    // The duplicate capture file is gone — this is the other half of P0-f.
    expect(await captureFiles()).toHaveLength(1);
    // …and the result points at the frame it duplicates rather than at nothing,
    // so a caller that asked to SEE the screen still can.
    expect(second.screenshot?.unchanged).toBe(true);
    expect(second.screenshot?.artifactId).toBe(artifacts.rows[0]!.id);
    expect(second.screenshot?.path).toBe(artifacts.rows[0]!.relativePath);
    // The descriptor has to describe the file it now names — the driver wrote a
    // PNG, but the stored frame is the transcoded webp.
    expect(second.screenshot?.format).toBe('webp');
    expect(artifacts.rows[0]!.relativePath.endsWith('.webp')).toBe(true);
  });

  it.runIf(sharpAvailable)('does not deduplicate a genuinely different frame', async () => {
    const { service, bridge, artifacts } = harness;
    bridge.nextCapture = await encodePng(640, 480, 10);
    await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });
    bridge.nextCapture = await encodePng(640, 480, 220);
    const second = await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });

    expect(artifacts.rows).toHaveLength(2);
    expect(second.screenshot?.unchanged).toBeUndefined();
  });

  it.runIf(sharpAvailable)('reaches the MODEL — both tool payloads carry the no-retry guidance', async () => {
    const { service, bridge } = harness;
    const frame = await encodePng(640, 480, 10);

    bridge.nextCapture = frame;
    await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });

    // A snapshot has no `result.action` at all, which is why the previous
    // implementation — which stamped the advisory onto `result.action` behind
    // an `if (result.action)` guard — could never surface here.
    bridge.nextCapture = Buffer.from(frame);
    const dupSnapshot = await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });
    const snapPayload = snapshotPayload(dupSnapshot);
    expect(snapPayload['frameUnchanged']).toBe(true);
    expect(String(snapPayload['frameUnchangedNote'])).toMatch(/not repeat it/i);

    // The action payload carries it too.
    bridge.nextCapture = Buffer.from(frame);
    const dupAction = await service.act(ctx(), APP_REF, {
      type: 'click', snapshotId: 'snap-1', elementIndex: 0,
    } as ActionRequest);
    const actPayload = actionPayload(dupAction);
    expect(actPayload['frameUnchanged']).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────
// Read-path defects.
// ────────────────────────────────────────────────────────────────

describe('ComputerService readScreenshot', () => {
  it.runIf(sharpAvailable)('refuses an artifact belonging to another workspace', async () => {
    const { service, bridge, artifacts } = harness;
    bridge.nextCapture = await encodePng(640, 480, 10);
    await service.snapshot(ctx('ws-1'), APP_REF, { includeScreenshot: true });
    const row = artifacts.rows[0]!;

    // Open a second session so the lookup gets past the "is there a session"
    // guard, then ask it for the FIRST workspace's frame. Without a tenancy
    // comparison this succeeds: `findById` is keyed by id alone, and the file
    // is inside the shared root so containment passes too.
    bridge.nextCapture = await encodePng(640, 480, 90);
    await service.snapshot(ctx('ws-2'), APP_REF, { includeScreenshot: true });

    await expect(service.readScreenshot('ws-2', row.id)).resolves.toBeNull();
    await expect(service.readScreenshot('ws-1', row.id)).resolves.not.toBeNull();
  });

  it.runIf(sharpAvailable)('refuses an oversized frame from the ROW, without reading the file', async () => {
    const { service, bridge, artifacts } = harness;
    bridge.nextCapture = await encodePng(640, 480, 10);
    await service.snapshot(ctx(), APP_REF, { includeScreenshot: true });
    const row = artifacts.rows[0]!;
    // The recorded size is what the row claims; a claim over the cap has to be
    // refused before a megabyte is pulled into memory to be thrown away.
    row.fileSize = 999_999_999;
    const readSpy = vi.spyOn(fs, 'readFile');

    await expect(service.readScreenshot('ws-1', row.id)).resolves.toBeNull();
    expect(readSpy).not.toHaveBeenCalledWith(expect.stringContaining('frame-'));
    readSpy.mockRestore();
  });
});

// ────────────────────────────────────────────────────────────────
// The audit invariant, enforced generally rather than case by case.
//
// `ComputerService`'s header asserts "every action including every refusal
// produces exactly one audit record". This drives every agent-facing operation
// through every way it can end and checks the count — so a new refusal path
// added to any of them fails here without anyone remembering to add a case.
// ────────────────────────────────────────────────────────────────

describe('ComputerService audit invariant', () => {
  const CLICK: ActionRequest = { type: 'click', snapshotId: 'snap-1', elementIndex: 0 };
  const POINT: ActionRequest = {
    type: 'clickPoint',
    target: { app: { appId: APP.id, name: APP.name, pid: APP.pid }, window: { by: 'focused' } },
    x: 10,
    y: 10,
  };

  const OPERATIONS: Array<{ name: string; run: (s: ComputerService) => Promise<unknown> }> = [
    { name: 'listApps', run: (s) => s.listApps(ctx()) },
    { name: 'launchApp', run: (s) => s.launchApp(ctx(), 'Editor') },
    { name: 'listWindows', run: (s) => s.listWindows(ctx(), APP_REF) },
    { name: 'verify', run: (s) => s.verify(ctx(), APP_REF, [{ kind: 'windowExists' } as never]) },
    { name: 'bringToFront', run: (s) => s.bringToFront(ctx(), APP_REF) },
    { name: 'snapshot', run: (s) => s.snapshot(ctx(), APP_REF) },
    { name: 'act(element)', run: (s) => s.act(ctx(), APP_REF, CLICK) },
    { name: 'act(synthetic)', run: (s) => s.act(ctx(), APP_REF, POINT) },
  ];

  // Each scenario is a way the call can END, not a way it can be configured.
  const SCENARIOS: Array<{ name: string; arrange: (h: ReturnType<typeof makeService>) => void }> = [
    { name: 'success', arrange: () => {} },
    {
      name: 'feature disabled',
      arrange: (h) => { h.service.setEnabled(false); },
    },
    {
      name: 'app cannot be resolved',
      arrange: (h) => { h.bridge.listAppsRefusal = { code: 'provider_unavailable', message: 'driver down' }; },
    },
    {
      name: 'consent denied',
      arrange: (h) => { h.consent.denyEverything = true; },
    },
    {
      name: 'the driver refuses the action',
      arrange: (h) => { h.bridge.actRefusal = { code: 'target_not_focused', message: 'not focused' }; },
    },
  ];

  for (const op of OPERATIONS) {
    for (const scenario of SCENARIOS) {
      it(`writes exactly one audit row: ${op.name} — ${scenario.name}`, async () => {
        const h = makeService();
        harness.service = h.service;
        scenario.arrange(h);
        // A fence-addressed action needs a snapshot first; taking it here would
        // add its own audit row, so the count is measured from zero afterwards.
        if (op.name === 'act(element)' && scenario.name !== 'feature disabled') {
          await h.service.snapshot(ctx(), APP_REF).catch(() => undefined);
        }
        h.audit.entries.length = 0;

        await op.run(h.service);

        expect(
          h.audit.entries.map((e) => `${e.action}/${e.refusalCode ?? 'ok'}`),
        ).toHaveLength(1);
        // A "success" scenario that quietly refused would satisfy the count
        // while proving nothing — the row has to say the call went through.
        // Only these two scenarios have an outcome every operation shares:
        // consent and the driver's own refusals do not apply to `listApps`,
        // which is ungated, so those cases assert the count alone.
        if (scenario.name === 'success') {
          expect(h.audit.entries[0]?.refusalCode).toBeUndefined();
        } else if (scenario.name === 'feature disabled') {
          expect(h.audit.entries[0]?.refusalCode).toBe('provider_unavailable');
        }
      });
    }
  }

  it('names the workspace and the chat on a refusal that never resolved an app', async () => {
    const { service, audit } = harness;
    service.setEnabled(false);

    await service.snapshot(ctx(), APP_REF);

    expect(audit.entries[0]).toMatchObject({
      workspaceId: 'ws-1',
      chatId: 'chat-1',
      action: 'snapshot',
      verified: false,
      refusalCode: 'provider_unavailable',
    });
    // The ref the caller supplied is preserved, so the trail says WHAT was
    // asked for even though nothing was ever resolved.
    expect(audit.entries[0]?.appLabel).toBe('Editor');
  });
});
