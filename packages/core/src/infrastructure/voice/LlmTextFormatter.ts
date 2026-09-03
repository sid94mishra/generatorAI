// ────────────────────────────────────────────────────────────────
// LlmTextFormatter — optional, BYOK LLM cleanup pass for dictated segments.
//
// Phase 2 (VOICE_MODULE_FINAL_ARCHITECTURE_PLAN.md Part E): "optional BYOK
// LLM cleanup pass, stored through the encrypted secrets vault from day
// one (not a new plaintext credential column — direct callback to the
// security review's standing P0-2 finding)." The API key is resolved via
// `SecretStore` at `SecretNamespace.voice` / `textFormatterApiKey`
// (packages/secrets/src/SecretStore.ts) — this class never receives,
// stores, or logs the raw key beyond the single request it's used for.
//
// This is deliberately NOT wired through the main agent harness
// (IAgentHarness) — that machinery is built for multi-turn tool-using
// conversations; "clean up this one transcript" is a single-shot text
// task, and a direct, minimal OpenAI-compatible chat-completions call is
// the right-sized tool. Any OpenAI-compatible endpoint works by
// construction (self-hosted, Azure, OpenRouter, etc.) via `baseUrl`.
//
// Resilience contract (matches ITextFormatter's port doc): NEVER throws.
// A missing key, a network failure, a timeout, or a malformed response all
// fall back to returning the ORIGINAL, unformatted text — an optional
// cleanup pass must never be the reason dictation breaks.
// ────────────────────────────────────────────────────────────────

import type { ILogger } from '@generatorai/shared';
import { SecretNamespace, getSecretString, type SecretStore } from '@generatorai/secrets';
import type { ITextFormatter, TextFormatterOptions } from '../../domain/ports/ITextFormatter.js';

const DEFAULT_BASE_URL = 'https://api.openai.com/v1/chat/completions';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 8_000;

const SYSTEM_PROMPT =
  'You clean up voice-dictated text for a chat message. Fix punctuation and ' +
  'capitalization, remove filler words and false starts, and correct obvious ' +
  "speech-to-text mistakes. Preserve the speaker's meaning, tone, and wording " +
  'as closely as possible — do not add new information, do not answer ' +
  'questions, do not add commentary. Return ONLY the cleaned text, nothing else.';

export interface LlmTextFormatterConfig {
  /** Any OpenAI-compatible chat-completions endpoint. Default: OpenAI's own. */
  baseUrl?: string;
  model?: string;
  /** Network timeout (ms) — must never let a slow/hung call stall dictation. Default 8000. */
  timeoutMs?: number;
  logger?: ILogger;
}

export class LlmTextFormatter implements ITextFormatter {
  readonly name: string;

  private readonly baseUrl: string;
  private readonly model: string;
  private readonly timeoutMs: number;
  private readonly logger?: ILogger;

  constructor(
    private readonly secretStore: SecretStore,
    config: LlmTextFormatterConfig = {},
  ) {
    this.baseUrl = config.baseUrl ?? DEFAULT_BASE_URL;
    this.model = config.model ?? DEFAULT_MODEL;
    this.timeoutMs = config.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.logger = config.logger;
    this.name = `llm:${this.model}`;
  }

  async format(text: string, _opts?: TextFormatterOptions): Promise<string> {
    if (!text.trim()) return text;

    try {
      const apiKey = await getSecretString(this.secretStore, SecretNamespace.voice, 'textFormatterApiKey');
      if (!apiKey) {
        this.logger?.warn?.(
          '[stt] LlmTextFormatter has no API key configured (SecretNamespace.voice / textFormatterApiKey) — passing text through unformatted.',
        );
        return text;
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), this.timeoutMs);
      try {
        const res = await fetch(this.baseUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: this.model,
            temperature: 0,
            messages: [
              { role: 'system', content: SYSTEM_PROMPT },
              { role: 'user', content: text },
            ],
          }),
          signal: controller.signal,
        });
        if (!res.ok) {
          this.logger?.warn?.(`[stt] LlmTextFormatter request failed (HTTP ${res.status}) — passing text through unformatted.`);
          return text;
        }
        const body = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const cleaned = body.choices?.[0]?.message?.content?.trim();
        return cleaned || text;
      } finally {
        clearTimeout(timer);
      }
    } catch (err) {
      const message = err instanceof Error && err.name === 'AbortError' ? 'timed out' : (err as Error).message;
      this.logger?.warn?.(`[stt] LlmTextFormatter failed (${message}) — passing text through unformatted.`);
      return text;
    }
  }
}
