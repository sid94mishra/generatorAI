// ────────────────────────────────────────────────────────────────
// previewProducer — one poll per workspace, however many watchers.
//
// This loop used to live inside the SSE route handler, so it ran once per
// connection (P1-11: "a 250 ms filesystem poll **per connection**"). Two open
// panels read the same directory twice and produced identical bytes. It is now
// an ephemeral-scope producer: started by the first subscriber, stopped by the
// last, shared by everyone in between.
//
// Frames and cursor positions travel separately because they come from
// different places and change at wildly different rates: a window frame per
// action, a cursor sample every ~30 ms. Sending them as data rather than as
// pixels is what makes this work on a locked workstation and over a VPS link,
// where a screen video shows the lock screen and a 4K stream is unaffordable.
//
// △ The 250 ms poll itself is W17's to remove (Phase 4), by having the recorder
// push instead. What is fixed here is that it no longer multiplies by watchers.
// ────────────────────────────────────────────────────────────────

import path from 'node:path';

import type { ILogger } from '@generatorai/shared';

import { newestRun, readCursorSince, readFramesSince } from './previewStream.js';
import type { EphemeralEvent, EphemeralProducer } from '../streaming/ephemeralScopes.js';

/** Filesystem poll interval. See the note above — W17 removes the poll. */
const POLL_MS = 250;

/** Window bounds change rarely and each read is a driver round trip. */
const BOUNDS_EVERY_MS = 3_000;

/** Cursor samples forwarded per poll. The recorder samples faster than a browser paints. */
const CURSOR_SAMPLES_PER_TICK = 20;

export interface PreviewProducerDeps {
  /** Absolute path of the workspace's `computer/recordings` directory. */
  recordingsRoot(workspaceId: string): Promise<string | null>;
  previewWindow(workspaceId: string): Promise<unknown>;
  logger?: ILogger;
}

export function createPreviewProducer(deps: PreviewProducerDeps): EphemeralProducer {
  return (workspaceId, emit) => {
    let stopped = false;

    void (async () => {
      const root = await deps.recordingsRoot(workspaceId);
      if (root === null || stopped) return;

      let run = await newestRun(root);
      // Which turn directories have already been sent. Bounded by the number of
      // turn directories on disk, which `pruneScreenshots` already caps — NOT by
      // subscriber lifetime. An earlier attempt to cap it evicted names whose
      // directories still existed, so the next poll re-read and re-sent them,
      // then evicted again: a permanent duplicate-frame loop. Do not re-add one.
      const seen = new Set<string>();
      let cursorOffset = 0;
      let boundsAt = 0;

      emit(open(run));

      while (!stopped) {
        try {
          // The recorder starts a new run directory each time; following it
          // keeps a preview opened before the first recording from staying blank.
          const newest = await newestRun(root);
          if (newest && newest !== run) {
            run = newest;
            seen.clear();
            cursorOffset = 0;
            emit({
              kind: 'computer.preview.run',
              payload: { run: path.basename(run) },
              cls: 'item',
            });
          }

          if (run) {
            for (const frame of await readFramesSince(run, seen)) {
              // `latest` on purpose: this is a per-action screenshot stream, not
              // a video. When the agent goes quiet no replacement is produced,
              // so a watcher that joins between actions needs the last frame or
              // it sits blank for minutes.
              emit({ kind: 'computer.preview.frame', payload: frame, cls: 'item' });
            }

            const cursor = await readCursorSince(run, cursorOffset);
            cursorOffset = cursor.offset;
            if (cursor.samples.length > 0) {
              const step = Math.max(
                1,
                Math.floor(cursor.samples.length / CURSOR_SAMPLES_PER_TICK),
              );
              emit({
                kind: 'computer.preview.cursor',
                payload: cursor.samples.filter(
                  (_, i) => i % step === 0 || i === cursor.samples.length - 1,
                ),
                cls: 'delta',
                // A cursor position from before the watcher arrived is worse
                // than none: it draws the pointer somewhere the agent has long
                // since left, and the client holds the last spot it was given.
                latest: false,
              });
            }
          }

          // Window bounds translate the cursor's screen coordinates onto the
          // frame, so a watcher that has not seen them cannot place the pointer.
          if (Date.now() - boundsAt > BOUNDS_EVERY_MS) {
            boundsAt = Date.now();
            const bounds = await deps.previewWindow(workspaceId);
            if (bounds) {
              emit({ kind: 'computer.preview.window', payload: bounds, cls: 'item' });
            }
          }
        } catch (err) {
          // One bad poll — a directory removed mid-read, a driver hiccup — must
          // not end the feed for every watcher. The next tick retries.
          deps.logger?.debug?.(
            `[ComputerPreview] poll failed for ${workspaceId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }

        await new Promise((resolve) => setTimeout(resolve, POLL_MS));
      }
    })().catch((err: unknown) => {
      deps.logger?.warn?.(
        `[ComputerPreview] producer stopped for ${workspaceId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    });

    return () => {
      stopped = true;
    };
  };
}

function open(run: string | null): EphemeralEvent {
  return {
    kind: 'computer.preview.open',
    payload: { run: run ? path.basename(run) : null },
    cls: 'item',
  };
}
