// ────────────────────────────────────────────────────────────────
// Launching the TUI.
//
// Everything that must happen before the first frame lives here: connect,
// authenticate, restore the previous layout, wire the stream reconciler, and
// arrange for the terminal to be handed back intact however the process ends.
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import React from 'react';
import { render } from 'ink';
import {
  CliContext,
  createCliClient,
  getTuiStateFilePath,
  Keymap,
  toCliError,
  type CommandRegistry,
} from '@generatorai/cli-core';
import { enterAlternateScreen, ThemeProvider } from '@generatorai/tui-kit';
import { App } from './App.js';
import { createKeyPump } from './keyPump.js';
import { rehydrateRestoredPanes } from './open.js';
import {
  createTuiStore,
  deserialiseWorkbench,
  serialiseWorkbench,
  setStore,
  StreamReconciler,
  useTui,
  type SerialisedWorkbenchFile,
} from './storeTypes.js';
import { createLogger } from '../logger.js';
import type { GlobalFlags, Session } from '../session.js';

export interface LaunchOptions {
  session: Session;
  flags: GlobalFlags;
  registry: CommandRegistry;
  restore: boolean;
  signal: AbortSignal;
  /**
   * Streams the workbench renders into. Defaults to the process streams;
   * tests inject a pair backed by a terminal emulator so assertions run
   * against the painted screen rather than the escape sequences.
   */
  stdout?: NodeJS.WriteStream;
  stdin?: NodeJS.ReadStream;
}

export async function launchTui(options: LaunchOptions): Promise<void> {
  const { session, flags, registry, signal } = options;
  const stdout = options.stdout ?? process.stdout;
  const source = options.stdin ?? process.stdin;

  if (!session.capabilities.isTTY) {
    throw toCliError(
      new Error(
        'The interactive UI needs a terminal. Use `generatorai <command>` in a pipe or in CI.',
      ),
    );
  }
  if (session.capabilities.columns < 60 || session.capabilities.rows < 12) {
    throw toCliError(
      new Error(
        `The terminal is too small (${session.capabilities.columns}x${session.capabilities.rows}). ` +
          'The workbench needs at least 60x12.',
      ),
    );
  }

  // Logging must stop mirroring to stderr: any stray write tears the frame.
  const logger = createLogger({
    verbose: session.config.cli.verbose,
    capabilities: session.capabilities,
    silentStderr: true,
  });

  const pump = createKeyPump(source);
  const stdin = pump.stream;

  const keymap = new Keymap(session.config.keymap);

  const restored = options.restore ? await readLayout() : null;
  const store = createTuiStore({
    ...(restored?.workbench ? { workbench: deserialiseWorkbench(restored.workbench) } : {}),
    ...(restored?.history ? { history: restored.history } : {}),
    theme: session.config.tui.theme,
  });
  setStore(store);

  const client = await createCliClient({
    config: session.config,
    ...(flags.server ? { serverUrl: flags.server } : {}),
    ...(flags.connection ? { connectionRef: flags.connection } : {}),
    signal,
  });

  // The auth state is what the status bar reports; a TUI that says
  // "connected" while every request 401s is worse than one that says why.
  const authState = await client.runtime.initialize().catch((error) => ({
    status: 'error' as const,
    message: error instanceof Error ? error.message : String(error),
  }));

  store.getState().setConnection({
    label: client.connection?.label ?? new URL(client.baseUrl).host,
    endpoint: client.baseUrl,
    state: authState.status,
    ...('deviceId' in authState && authState.deviceId ? { deviceId: authState.deviceId } : {}),
  });

  if (authState.status !== 'authenticated') {
    store
      .getState()
      .toast(
        authState.status === 'unpaired'
          ? 'Not paired — run `generatorai device pair <code>` in another shell.'
          : `Auth: ${authState.status}`,
        'warning',
      );
  }

  const reconciler = new StreamReconciler(store, client.stream);
  const stopReconciler = reconciler.start();

  // Restoring rebuilds the panes but not their contents.
  if (restored?.workbench) {
    void rehydrateRestoredPanes(client.api, store.getState());
  }

  const makeContext = async (): Promise<CliContext> =>
    new CliContext({
      api: client.api,
      config: session.config,
      connection: client.connection
        ? { ...client.connection, resolvedEndpoint: client.baseUrl }
        : null,
      capabilities: session.capabilities,
      logger,
      // The TUI collects answers through modals, so the port is wired to the
      // store rather than to stdin — reading stdin directly would fight Ink
      // for the same bytes.
      prompt: {
        confirm: (message, defaultValue) =>
          new Promise((resolve) =>
            store.getState().showOverlay({
              kind: 'confirm',
              message,
              danger: !defaultValue,
              onAnswer: resolve,
            }),
          ),
        text: (message, defaultValue) =>
          new Promise((resolve) =>
            store.getState().showOverlay({
              kind: 'input',
              message,
              initial: defaultValue ?? '',
              onSubmit: resolve,
            }),
          ),
        select: <T extends string>(message: string, choices: readonly T[]) =>
          new Promise<T>((resolve) =>
            store.getState().showOverlay({
              kind: 'select',
              message,
              options: choices.map((value) => ({ value, label: value })),
              onSelect: (value) => resolve(value as T),
            }),
          ),
        password: () =>
          Promise.reject(
            new Error('Secrets are never collected in the TUI. Use the shell command instead.'),
          ),
      },
      stream: client.stream,
      // Command output inside the TUI surfaces as toasts and pane updates;
      // writing to stdout here would punch a hole in the frame.
      emit: (event) => {
        if (event.type === 'log' && event.level === 'error') {
          store.getState().toast(event.message, 'error');
        }
      },
      signal,
      interactive: true,
      assumeYes: false,
      verbose: session.config.cli.verbose,
      timeoutMs: session.config.server.timeoutMs,
      fetch: client.fetch,
      baseUrl: client.baseUrl,
    });

  // Before the first paint, not from an effect: an effect runs after Ink has
  // already written frame one to the main buffer.
  const leaveAlternateScreen = enterAlternateScreen(stdout);

  const instance = render(
    <ThemedWorkbench
      capabilities={session.capabilities}
      {...(session.config.tui.appearance !== 'auto'
        ? { appearance: session.config.tui.appearance }
        : {})}
      accent={session.config.tui.accent}
    >
      <App
        registry={registry}
        keymap={keymap}
        api={client.api}
        makeContext={makeContext}
        refreshMs={session.config.tui.refreshMs}
      />
    </ThemedWorkbench>,
    {
      stdout,
      stdin,
      maxFps: session.config.tui.maxFps,
      incrementalRendering: session.config.tui.incrementalRendering,
      // Ctrl+C is bound in the keymap so the app can confirm before quitting
      // with live streams attached; letting Ink handle it would bypass that.
      exitOnCtrlC: false,
      // Console output would otherwise be interleaved into the frame.
      patchConsole: true,
      ...(session.capabilities.kittyKeyboard
        ? { kittyKeyboard: { mode: 'auto' as const } }
        : {}),
      isScreenReaderEnabled: session.capabilities.screenReader,
    },
  );

  const onAbort = () => instance.unmount();
  signal.addEventListener('abort', onAbort, { once: true });

  try {
    await instance.waitUntilExit();
  } finally {
    signal.removeEventListener('abort', onAbort);
    pump.stop();
    stopReconciler();
    client.dispose();
    leaveAlternateScreen();
    await saveLayout(store.getState());
  }
}

// ── Theme ─────────────────────────────────────────────────────────

/**
 * Reads the theme id from the store so `app.theme` can change it live.
 *
 * `ThemeProvider` takes the id as a prop, and the provider is mounted above
 * everything that could hold state, so a restart would otherwise be the only
 * way to see a different theme.
 */
function ThemedWorkbench({
  capabilities,
  appearance,
  accent,
  children,
}: {
  capabilities: Session['capabilities'];
  appearance?: 'light' | 'dark';
  accent?: 'blue' | 'violet' | 'green' | 'orange' | 'rose' | 'teal';
  children: React.ReactNode;
}): React.JSX.Element {
  const theme = useTui((s) => s.theme);
  return (
    <ThemeProvider
      capabilities={capabilities}
      theme={theme}
      {...(appearance ? { appearance } : {})}
      {...(accent ? { accent } : {})}
    >
      {children}
    </ThemeProvider>
  );
}

// ── Layout persistence ────────────────────────────────────────────

async function readLayout(): Promise<SerialisedWorkbenchFile | null> {
  try {
    const raw = await fs.readFile(getTuiStateFilePath(), 'utf8');
    return JSON.parse(raw) as SerialisedWorkbenchFile;
  } catch {
    // No saved layout, or one this version cannot read. Starting fresh is
    // always safe; refusing to launch would not be.
    return null;
  }
}

async function saveLayout(state: {
  workbench: Parameters<typeof serialiseWorkbench>[0];
  history: string[];
}): Promise<void> {
  try {
    const payload: SerialisedWorkbenchFile = {
      workbench: serialiseWorkbench(state.workbench),
      history: state.history.slice(-100),
      savedAt: Date.now(),
    };
    await fs.writeFile(getTuiStateFilePath(), `${JSON.stringify(payload, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
  } catch {
    // A read-only home directory must not turn a clean exit into a crash.
  }
}
