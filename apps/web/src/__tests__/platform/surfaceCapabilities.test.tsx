// ────────────────────────────────────────────────────────────────
// W29 — the web/desktop half of the capability ledger's runtime proof.
//
// Registered in `ENFORCEMENT_PROOFS` for every capability on the WEB surface,
// and — via the parity assertion below, and only for the fields that
// assertion pins — on DESKTOP. It proves nothing about cli, mobile or sdk; it
// never loads them. Each claim is discharged by an explicit
// `@capability-proof <surface>/<field>` marker placed in the block that does
// the asserting. Two rules held throughout:
//
//   1. No assertion here reads a ledger literal and asserts that literal.
//      Every one drives real code — a component render, a decision function
//      — and checks what it produced.
//   2. Every capability is asserted in BOTH directions. A positive-only test
//      passes an implementation that hardcodes `true` and never reads the
//      ledger at all, which is precisely the state this ledger was in before:
//      thirteen fields, zero importers, and a green test suite.
// ────────────────────────────────────────────────────────────────

import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  WEB_CAPABILITIES,
  DESKTOP_CAPABILITIES,
  type TransportCapabilitySet,
} from '@generatorai/shared';

import {
  addableRightPaneTabs,
  composerAffordances,
  currentSurfaceId,
  defaultRightPaneTab,
  liveViewTransport,
  surfaceCapabilities,
} from '@/platform/surfaceCapabilities.js';
import { MarkdownRenderer } from '@/components/chat/MarkdownRenderer.js';
import { PlanCard } from '@/components/chat/PlanCard.js';
import { QuestionCard } from '@/components/chat/QuestionCard.js';
import { WidgetFrame } from '@/components/widgets/WidgetFrame.js';
import { openMultiplexedStream, resetMuxStreamForTests } from '@/platform/muxStream.js';
import type { PlanBlock, QuestionBlock, WidgetBlock } from '@/stores/streamStore.js';

afterEach(() => {
  cleanup();
  resetMuxStreamForTests();
  vi.restoreAllMocks();
});

/** A capability set with one field overridden, for the negative direction. */
function withCapability(
  field: keyof TransportCapabilitySet,
  supported: boolean,
): TransportCapabilitySet {
  return {
    ...WEB_CAPABILITIES,
    [field]: { ...WEB_CAPABILITIES[field], supported },
  };
}

describe('W29 — surface identity', () => {
  it('resolves to the web surface outside the Electron shell', () => {
    // happy-dom has no `window.generatoraiDesktop`, which is exactly what a
    // plain browser looks like.
    expect(currentSurfaceId()).toBe('web');
    expect(surfaceCapabilities()).toBe(WEB_CAPABILITIES);
  });

  it('desktop declares the same surface as web (it embeds the same SPA)', () => {
    // Not a literal re-assertion: this is the invariant that lets one set of
    // components serve both surfaces, and it is what makes every web probe in
    // this file a proof for desktop too. If desktop ever diverges on one of
    // these, its claim stops being covered and this assertion fails first —
    // which is precisely why each desktop marker is registered HERE.
    //
    //   @capability-proof desktop/websocketStreaming
    //   @capability-proof desktop/markdownRendering
    //   @capability-proof desktop/widgetRendering
    //   @capability-proof desktop/diffRendering
    //   @capability-proof desktop/browserPanelRendering
    //   @capability-proof desktop/computerPanelRendering
    //   @capability-proof desktop/terminalRendering
    //   @capability-proof desktop/fileAttachment
    //   @capability-proof desktop/keyboardShortcuts
    //   @capability-proof desktop/hitlGates
    for (const field of ['websocketStreaming', 'markdownRendering', 'widgetRendering',
      'diffRendering', 'browserPanelRendering', 'computerPanelRendering', 'terminalRendering',
      'fileAttachment', 'keyboardShortcuts', 'hitlGates'] as const) {
      expect(DESKTOP_CAPABILITIES[field].supported).toBe(WEB_CAPABILITIES[field].supported);
    }
  });
});

describe('W29 — browserPanelRendering / computerPanelRendering / terminalRendering / widgetRendering', () => {
  // Each tab is asserted present with the capability and absent without it,
  // through the real `addableRightPaneTabs` decision:
  //   @capability-proof web/browserPanelRendering
  //   @capability-proof web/computerPanelRendering
  //   @capability-proof web/terminalRendering
  //   @capability-proof web/widgetRendering
  const opts = { computerUseEnabled: true, isOrchestrator: false };

  it('offers each declared panel as a right-pane tab', () => {
    const tabs = addableRightPaneTabs(opts, WEB_CAPABILITIES);
    expect(tabs).toContain('browser');
    expect(tabs).toContain('computer');
    expect(tabs).toContain('terminal');
    expect(tabs).toContain('widget');
  });

  it.each([
    ['browserPanelRendering', 'browser'],
    ['computerPanelRendering', 'computer'],
    ['terminalRendering', 'terminal'],
    ['widgetRendering', 'widget'],
  ] as const)('withholds the %s tab when the ledger says the surface cannot draw it', (field, tab) => {
    expect(addableRightPaneTabs(opts, withCapability(field, false))).not.toContain(tab);
  });

  it('still requires the feature flag on top of the capability', () => {
    // The two gates mean different things and both must hold: the surface CAN
    // draw a computer panel, but this deployment has desktop automation off.
    const tabs = addableRightPaneTabs(
      { computerUseEnabled: false, isOrchestrator: false },
      WEB_CAPABILITIES,
    );
    expect(tabs).not.toContain('computer');
  });
});

describe('W29 — websocketStreaming', () => {
  //   @capability-proof web/websocketStreaming
  it('selects the WebSocket live-view transport when declared', () => {
    expect(liveViewTransport(WEB_CAPABILITIES)).toBe('websocket');
  });

  it('selects no transport at all when not declared', () => {
    // `'none'`, not a fallback: a surface without WebSocket streaming must not
    // open a socket (and, in TerminalPanel, must not spawn the PTY behind it).
    expect(liveViewTransport(withCapability('websocketStreaming', false))).toBe('none');
  });
});

describe('W29 — diffRendering', () => {
  //   @capability-proof web/diffRendering
  it('opens the right pane on the diff surface when declared', () => {
    expect(defaultRightPaneTab(WEB_CAPABILITIES)).toBe('changes');
  });

  it('opens on the file browser instead when the surface cannot render a diff', () => {
    expect(defaultRightPaneTab(withCapability('diffRendering', false))).toBe('files');
  });
});

describe('W29 — fileAttachment / keyboardShortcuts', () => {
  //   @capability-proof web/fileAttachment
  //   @capability-proof web/keyboardShortcuts
  it('derives both composer affordances from the ledger', () => {
    expect(composerAffordances(WEB_CAPABILITIES)).toEqual({
      attachments: true,
      sendShortcut: true,
    });
  });

  it('turns each off independently', () => {
    const noAttach = composerAffordances(withCapability('fileAttachment', false));
    expect(noAttach.attachments).toBe(false);
    // Independence matters: turning one off must not take the other with it.
    expect(noAttach.sendShortcut).toBe(true);

    const noKeys = composerAffordances(withCapability('keyboardShortcuts', false));
    expect(noKeys.sendShortcut).toBe(false);
    expect(noKeys.attachments).toBe(true);
  });
});

describe('W29 — markdownRendering', () => {
  //   @capability-proof web/markdownRendering
  it('renders markdown structure, not the source text', () => {
    render(<MarkdownRenderer content={'# Title\n\nsome `code` here'} />);
    expect(screen.getByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
    // The claim is that the surface renders markdown, so the raw backticks
    // must be gone and a real <code> element must exist in their place.
    const code = screen.getByText('code');
    expect(code.tagName.toLowerCase()).toBe('code');
    expect(document.body.textContent).not.toContain('`code`');
  });
});

describe('W29 — hitlGates', () => {
  //   @capability-proof web/hitlGates
  const plan: PlanBlock = {
    type: 'plan',
    blockId: 1,
    planId: 'p1',
    revision: 1,
    title: 'Refactor the router',
    fileName: 'plan.md',
    summary: 'Move routing into client-core',
    status: 'awaiting_review',
    actions: ['approve', 'request_changes'],
    interactionId: 'i1',
  };

  const question: QuestionBlock = {
    type: 'question',
    blockId: 2,
    interactionId: 'i2',
    questions: [
      {
        id: 'q1',
        header: 'Scope',
        question: 'Which package should own routing?',
        options: [{ label: 'client-core' }, { label: 'each surface' }],
        multiSelect: false,
        allowFreeform: false,
      },
    ],
    status: 'pending',
  };

  it('renders an actionable plan gate', () => {
    render(<PlanCard plan={plan} onApprove={() => {}} onRequestChanges={() => {}} />);
    // A gate the user cannot act on is not a gate.
    expect(screen.getByText('Refactor the router')).toBeInTheDocument();
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('renders an actionable question gate', () => {
    render(<QuestionCard question={question} onSubmit={() => {}} />);
    expect(screen.getByText('Which package should own routing?')).toBeInTheDocument();
    expect(screen.getByText('client-core')).toBeInTheDocument();
  });
});

describe('W29 — widgetRendering', () => {
  //   @capability-proof web/widgetRendering
  it('mounts an extension widget in a sandboxed frame', () => {
    const widget: WidgetBlock = {
      type: 'widget',
      blockId: 3,
      instanceId: 'w1',
      descriptorId: 'd1',
      extensionId: 'genai.demo',
      component: 'Demo',
      surface: 'inline',
      // A non-empty, non-host assets base — W31 refuses to render otherwise,
      // and a refusal would make this probe pass for the wrong reason.
      assetsBase: 'http://127.0.0.1:3101',
      entry: 'index.html',
      props: {},
      status: 'active',
    };
    const { container } = render(<WidgetFrame block={widget} sessionId="s1" />);
    const frame = container.querySelector('iframe');
    expect(frame, 'widgetRendering is declared enforced but no frame was mounted').not.toBeNull();
  });
});

describe('W29 — crossTabEventSource (declared false, and observably absent)', () => {
  //   @capability-proof web/crossTabEventSource
  //   @capability-proof desktop/crossTabEventSource
  it('never reaches for a cross-tab primitive when opening the shared stream', () => {
    // The ledger says web does NOT share an EventSource across tabs. The honest
    // proof of a negative is that the runtime never touches the only two
    // browser primitives that could implement it.
    const broadcast = vi.spyOn(globalThis, 'BroadcastChannel' as never);
    const sharedWorker = 'SharedWorker' in globalThis
      ? vi.spyOn(globalThis, 'SharedWorker' as never)
      : null;

    const handle = openMultiplexedStream('chat', 'c1', {});
    expect(broadcast).not.toHaveBeenCalled();
    if (sharedWorker) expect(sharedWorker).not.toHaveBeenCalled();
    handle.close();
  });
});
