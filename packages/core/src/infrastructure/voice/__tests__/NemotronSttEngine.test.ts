// ────────────────────────────────────────────────────────────────
// NemotronSttEngine — the out-of-process ASR adapter.
//
// Everything here runs against a stand-in HTTP server rather than the real
// NeMo-Speech.cpp binary, so the suite is meaningful on a machine (and in CI)
// where that native runtime is not installed. What it pins is the part this
// repo owns: the audio adapter (Float32 -> WAV), the request shape, and the
// refusal to go anywhere near a native binary it was not explicitly given.
//
// The real binary is exercised separately, end-to-end through the app.
// ────────────────────────────────────────────────────────────────

import { describe, it, expect, afterEach } from 'vitest';
import { createServer, type Server } from 'node:http';
import { NemotronSttEngine } from '../NemotronSttEngine.js';

interface Captured {
  path: string;
  contentType: string;
  fields: Record<string, string>;
  wav: Buffer | null;
}

/** A minimal OpenAI-compatible transcription endpoint that records what it got. */
async function fakeServer(reply: unknown, captured: Captured[]): Promise<{ url: string; server: Server }> {
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks);
      if (req.url === '/health') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end('{"status":"ok"}');
        return;
      }
      // Crude multipart scrape — enough to assert the field names and to pull
      // the WAV back out for header checks.
      const text = body.toString('latin1');
      const fields: Record<string, string> = {};
      for (const m of text.matchAll(/name="([^"]+)"(?:; filename="[^"]*")?\r\n(?:Content-Type:[^\r\n]*\r\n)?\r\n([\s\S]*?)\r\n--/g)) {
        fields[m[1]!] = m[2]!;
      }
      const riff = body.indexOf('RIFF');
      const wav = riff >= 0 ? body.subarray(riff) : null;
      captured.push({
        path: req.url ?? '',
        contentType: String(req.headers['content-type'] ?? ''),
        fields,
        wav,
      });
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify(reply));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const addr = server.address();
  const port = typeof addr === 'object' && addr ? addr.port : 0;
  return { url: `http://127.0.0.1:${port}`, server };
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise<void>((r) => s.close(() => r()))));
});

/** 0.5s of a 440Hz tone — real enough to check the WAV framing. */
function tone(samples = 8_000): Float32Array {
  const pcm = new Float32Array(samples);
  for (let i = 0; i < samples; i += 1) pcm[i] = Math.sin((2 * Math.PI * 440 * i) / 16_000) * 0.3;
  return pcm;
}

describe('NemotronSttEngine — provenance and safety', () => {
  it('refuses to run without an explicitly configured binary, and says how to get one', async () => {
    // The whole point: model weights are data and get downloaded, but a native
    // executable is not something this app fetches and runs on its own. The
    // failure has to be actionable, because CascadingSttEngine turns it into a
    // silent fallback to Whisper.
    const engine = new NemotronSttEngine({ binPath: undefined, baseUrl: undefined });
    await expect(engine.load()).rejects.toThrow(/NeMo-Speech\.cpp/);
    await expect(engine.load()).rejects.toThrow(/GENERATORAI_NEMO_SPEECH_BIN/);
  });

  it('defaults to the official NVIDIA repository, not a mirror or a short alias', () => {
    // Named in full so provenance is visible in logs and telemetry.
    expect(new NemotronSttEngine({ binPath: '/nonexistent' }).name).toBe(
      'nemotron:nvidia/nemotron-3.5-asr-streaming-0.6b',
    );
  });

  it('spawns nothing at all when pointed at an already-running server', async () => {
    const captured: Captured[] = [];
    const { url, server } = await fakeServer({ text: 'no spawn needed' }, captured);
    servers.push(server);
    // No binPath — if this tried to spawn, `load()` would reject as above.
    const engine = new NemotronSttEngine({ baseUrl: url });
    await engine.load();
    await expect(engine.transcribe(tone())).resolves.toEqual({ text: 'no spawn needed' });
    await engine.dispose();
  });
});

describe('NemotronSttEngine — the audio/HTTP adapter', () => {
  it('posts a well-formed 16kHz mono 16-bit WAV to the OpenAI-compatible route', async () => {
    const captured: Captured[] = [];
    const { url, server } = await fakeServer({ text: 'ok' }, captured);
    servers.push(server);

    const engine = new NemotronSttEngine({ baseUrl: url, modelId: 'nvidia/nemotron-3.5-asr-streaming-0.6b' });
    await engine.transcribe(tone(), { language: 'en' });
    await engine.dispose();

    expect(captured).toHaveLength(1);
    const req = captured[0]!;
    expect(req.path).toBe('/v1/audio/transcriptions');
    expect(req.contentType).toMatch(/multipart\/form-data/);
    expect(req.fields['model']).toBe('nvidia/nemotron-3.5-asr-streaming-0.6b');
    expect(req.fields['language']).toBe('en');

    const wav = req.wav!;
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.subarray(8, 12).toString()).toBe('WAVE');
    expect(wav.readUInt16LE(20)).toBe(1); // PCM
    expect(wav.readUInt16LE(22)).toBe(1); // mono — the port's contract
    expect(wav.readUInt32LE(24)).toBe(16_000); // 16 kHz — likewise
    expect(wav.readUInt16LE(34)).toBe(16); // 16-bit
    // The declared data size must agree with what was actually sent. A
    // mismatch here is the classic way a decoder reads garbage off the end of
    // the buffer. (`wav` still has multipart's closing boundary after it —
    // hence >=, not ==.)
    const declared = wav.readUInt32LE(40);
    expect(declared).toBe(8_000 * 2);
    expect(wav.readUInt32LE(4)).toBe(36 + declared); // RIFF chunk size
    expect(wav.length).toBeGreaterThanOrEqual(44 + declared);
  });

  it('omits the language field entirely when no hint was given', async () => {
    const captured: Captured[] = [];
    const { url, server } = await fakeServer({ text: 'ok' }, captured);
    servers.push(server);
    const engine = new NemotronSttEngine({ baseUrl: url });
    await engine.transcribe(tone());
    await engine.dispose();
    expect(captured[0]!.fields['language']).toBeUndefined();
  });

  it('never calls the server for empty audio', async () => {
    const captured: Captured[] = [];
    const { url, server } = await fakeServer({ text: 'should not happen' }, captured);
    servers.push(server);
    const engine = new NemotronSttEngine({ baseUrl: url });
    await expect(engine.transcribe(new Float32Array(0))).resolves.toEqual({ text: '' });
    expect(captured).toHaveLength(0);
    await engine.dispose();
  });

  it('normalizes whitespace so the composer never receives ragged transcripts', async () => {
    const captured: Captured[] = [];
    const { url, server } = await fakeServer({ text: '  Hello,   how are\nyou?  ' }, captured);
    servers.push(server);
    const engine = new NemotronSttEngine({ baseUrl: url });
    await expect(engine.transcribe(tone())).resolves.toEqual({ text: 'Hello, how are you?' });
    await engine.dispose();
  });

  it('surfaces a server error rather than silently returning empty text', async () => {
    // An empty string is indistinguishable from silence to SttSessionRunner,
    // which would drop the utterance without telling anyone. A throw reaches
    // the session's onError and the user sees it.
    const server = createServer((_req, res) => {
      res.writeHead(500, { 'content-type': 'text/plain' });
      res.end('model not loaded');
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    servers.push(server);
    const addr = server.address();
    const port = typeof addr === 'object' && addr ? addr.port : 0;

    const engine = new NemotronSttEngine({ baseUrl: `http://127.0.0.1:${port}` });
    // `load()` polls /health, which this server answers 500 to — so the
    // readiness wait is what fails, and it must say so.
    await expect(engine.load()).rejects.toThrow(/did not become ready|HTTP 500/);
    await engine.dispose();
    // The readiness poll deliberately keeps retrying for 10s before giving up,
    // so this case needs more than vitest's 5s default to reach its verdict.
  }, 20_000);
});
