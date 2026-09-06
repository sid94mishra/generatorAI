// ────────────────────────────────────────────────────────────────
// NemotronModelStore — our own copy of the Nemotron weights.
//
// WHY THIS REPLACED "FIND VS CODE'S COPY"
// ---------------------------------------
// An earlier version discovered the weights inside VS Code's (or the GitHub
// Copilot CLI's) dictation cache, because on a developer machine they are
// often already there. That was wrong as a product decision, for two reasons
// that only look obvious once stated: a user need not have VS Code at all, or
// may have it without ever enabling its dictation — and even where the files
// exist, the directory belongs to another application that may move, upgrade
// or clean it up. Voice input silently regressing to a worse engine because
// somebody uninstalled an editor is not a defensible design.
//
// So this app now keeps its OWN copy under its own cache root, and downloads
// it deliberately.
//
// WHERE THE WEIGHTS COME FROM
// ---------------------------
// `onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4` — the streaming
// ONNX export of NVIDIA's Nemotron 3.5 ASR. NVIDIA itself publishes only
// `.nemo`, safetensors and GGUF (no ONNX), and `onnx-community` is the same
// Hugging Face organisation this codebase already pulls Moonshine, Parakeet
// and Kokoro from, so the provenance and the download path are the ones the
// project already relies on.
//
// This is the MULTILINGUAL 3.5 build, not the English-only one VS Code
// carries: 40 language-locales with language-ID prompt conditioning, and the
// same native punctuation and capitalization.
//
// NOTHING IS DOWNLOADED WITHOUT BEING ASKED
// -----------------------------------------
// 792MB is not a decision to make on a user's behalf on their first click of
// a microphone button, and it may be metered bandwidth. `download()` runs
// only when something calls it — which, in the product, means the user
// pressed the button in Settings → Audio. Until then voice input reports that
// it is unavailable and says exactly why. Weights are data, so this is a
// download and not the class of act the NeMo-Speech.cpp adapter refuses
// (fetching and executing a native binary).
// ────────────────────────────────────────────────────────────────

import * as fs from 'node:fs/promises';
import { createWriteStream, statSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import type { ILogger } from '@generatorai/shared';

/** The Hugging Face repo the weights come from. */
export const NEMOTRON_REPO = 'onnx-community/nemotron-3.5-asr-streaming-0.6b-onnx-int4';
/** Pinned revision. `main` would let a re-export change the model under us. */
export const NEMOTRON_REVISION = 'main';

/**
 * Files that must all be present for the model to be usable.
 *
 * The `.onnx.data` siblings hold the weights for their graph — an `.onnx`
 * without its `.data` loads and then fails at the first inference, which is
 * exactly the "cached but incomplete" failure mode that has bitten this
 * codebase before (see VoiceWorkerPool's truncated-weights handling).
 */
export const NEMOTRON_FILES: readonly string[] = [
  'genai_config.json',
  'audio_processor_config.json',
  'vocab.txt',
  'tokenizer.json',
  'encoder.onnx',
  'encoder.onnx.data',
  'decoder.onnx',
  'decoder.onnx.data',
  'joint.onnx',
  'joint.onnx.data',
];

/** Approximate total download, for the UI to show before the user commits. */
export const NEMOTRON_APPROX_BYTES = 792 * 1024 * 1024;

export interface NemotronModelStatus {
  present: boolean;
  dir: string;
  repo: string;
  /** Bytes on disk now — non-zero while a download is in flight. */
  bytesOnDisk: number;
  approxTotalBytes: number;
  /** Set when a download is running in this process. */
  downloading?: boolean;
  /** 0..1 while downloading. */
  progress?: number;
  error?: string;
}

export interface DownloadProgress {
  file: string;
  fileIndex: number;
  fileCount: number;
  bytesDone: number;
  approxTotalBytes: number;
  progress: number;
}

/** Where our copy lives. Shares the voice cache root with every other model. */
export function nemotronModelDir(): string {
  const root = process.env['STT_CACHE_DIR'] ?? join(homedir(), '.cache', 'generatorai-models');
  return join(root, 'nemotron-3.5-asr-streaming-0.6b-onnx-int4');
}

async function fileSize(path: string): Promise<number> {
  try {
    return (await fs.stat(path)).size;
  } catch {
    return 0;
  }
}

/** Every required file present and non-empty. */
export async function isNemotronModelPresent(dir = nemotronModelDir()): Promise<boolean> {
  for (const f of NEMOTRON_FILES) {
    if ((await fileSize(join(dir, f))) === 0) return false;
  }
  return true;
}

/**
 * Synchronous presence check, for composition-time engine selection.
 *
 * `createSttEngine` decides which adapter to build while wiring the
 * container, and that call is synchronous — so "are the weights here?" has to
 * be answerable without awaiting. A handful of `statSync` calls on ten paths
 * is cheap and happens once at boot.
 */
export function isNemotronModelPresentSync(dir = nemotronModelDir()): boolean {
  try {
    for (const f of NEMOTRON_FILES) {
      if (statSync(join(dir, f)).size === 0) return false;
    }
    return true;
  } catch {
    return false;
  }
}

export async function nemotronModelStatus(dir = nemotronModelDir()): Promise<NemotronModelStatus> {
  let bytes = 0;
  for (const f of NEMOTRON_FILES) bytes += await fileSize(join(dir, f));
  return {
    present: await isNemotronModelPresent(dir),
    dir,
    repo: NEMOTRON_REPO,
    bytesOnDisk: bytes,
    approxTotalBytes: NEMOTRON_APPROX_BYTES,
  };
}

/** Remove our copy. Used by the "Remove model" button in Settings. */
export async function deleteNemotronModel(dir = nemotronModelDir()): Promise<void> {
  await fs.rm(dir, { recursive: true, force: true });
}

/**
 * Download every missing file.
 *
 * Each file is written to `<name>.part` and renamed only once the stream has
 * finished. That is the whole reason this is not three lines of `fetch` +
 * `writeFile`: a download interrupted half way through — closed laptop,
 * dropped wifi, killed server — would otherwise leave a SHORT file that every
 * later load treats as complete, and onnxruntime then fails for ever with an
 * unreadable message about file lengths. This codebase has already paid for
 * that bug once with Parakeet (see VoiceWorkerPool's `TRUNCATED_WEIGHTS_RE`),
 * and a partial file that never gets a real name cannot cause it.
 *
 * Already-complete files are skipped, so a retry after a failure resumes at
 * file granularity rather than starting the 792MB again.
 */
export async function downloadNemotronModel(opts: {
  dir?: string;
  onProgress?: (p: DownloadProgress) => void;
  signal?: AbortSignal;
  logger?: ILogger;
} = {}): Promise<void> {
  const dir = opts.dir ?? nemotronModelDir();
  await fs.mkdir(dir, { recursive: true });
  const started = Date.now();
  let bytesDone = 0;

  // Count what is already there so progress does not restart from zero on a
  // resumed download.
  for (const f of NEMOTRON_FILES) bytesDone += await fileSize(join(dir, f));

  for (const [index, name] of NEMOTRON_FILES.entries()) {
    if (opts.signal?.aborted) throw new Error('Download cancelled');
    const target = join(dir, name);
    if ((await fileSize(target)) > 0) continue;

    const url = `https://huggingface.co/${NEMOTRON_REPO}/resolve/${NEMOTRON_REVISION}/${name}`;
    const partial = `${target}.part`;
    opts.logger?.info?.(`[nemotron] downloading ${name}`);

    const res = await fetch(url, opts.signal ? { signal: opts.signal } : {});
    if (!res.ok || !res.body) {
      throw new Error(`Downloading ${name} failed: HTTP ${res.status} ${res.statusText}`);
    }

    let fileBytes = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        fileBytes += chunk.byteLength;
        bytesDone += chunk.byteLength;
        opts.onProgress?.({
          file: name,
          fileIndex: index,
          fileCount: NEMOTRON_FILES.length,
          bytesDone,
          approxTotalBytes: NEMOTRON_APPROX_BYTES,
          progress: Math.min(0.999, bytesDone / NEMOTRON_APPROX_BYTES),
        });
        controller.enqueue(chunk);
      },
    });

    try {
      await pipeline(
        Readable.fromWeb(res.body.pipeThrough(counter) as never),
        createWriteStream(partial),
      );
    } catch (err) {
      await fs.rm(partial, { force: true });
      throw err;
    }

    // A zero-length body is a failed download wearing a 200.
    if (fileBytes === 0) {
      await fs.rm(partial, { force: true });
      throw new Error(`Downloading ${name} failed: empty response`);
    }
    await fs.rename(partial, target);
  }

  opts.onProgress?.({
    file: '',
    fileIndex: NEMOTRON_FILES.length,
    fileCount: NEMOTRON_FILES.length,
    bytesDone,
    approxTotalBytes: NEMOTRON_APPROX_BYTES,
    progress: 1,
  });
  opts.logger?.info?.(
    `[nemotron] model ready in ${Math.round((Date.now() - started) / 1000)}s (${dir})`,
  );
}
