// createClient — Factory for CLI platform client.
// Supports HTTP mode (server), direct mode (in-process), and auto-detect.

import type { AppConfig } from '@generatorai/shared';
import { HttpPlatformClient } from './HttpPlatformClient.js';
import type { CLIPlatformClient } from './types.js';
import type { DirectClientOptions } from './DirectPlatformClient.js';

export type ClientMode = 'http' | 'direct' | 'auto';

export interface ClientOptions {
  mode: ClientMode;
  serverUrl?: string;
  config?: AppConfig;
  /** Options for in-process ('direct'/'--local') mode. */
  direct?: DirectClientOptions;
}

/**
 * Create and initialize a platform client.
 * - 'http': Connect to running server via REST + SSE
 * - 'direct': In-process (no server required). Boots the GeneratorAI SDK and
 *   serves the core run/chat/workflow/streaming surface locally; long-tail admin
 *   methods throw an actionable error directing the user to a server.
 * - 'auto': Try HTTP; if the server is unreachable, error with guidance.
 *   (Use --local for the in-process path; auto does not silently embed.)
 */
export async function createClient(options: ClientOptions): Promise<{
  client: CLIPlatformClient;
  mode: 'http' | 'direct';
}> {
  const serverUrl = options.serverUrl ?? 'http://localhost:3100';

  if (options.mode === 'direct') {
    // Lazy-import so the SDK/engine is only loaded when --local is used.
    const { createDirectClient } = await import('./DirectPlatformClient.js');
    const client = createDirectClient(options.direct ?? {});
    await client.initialize();
    return { client, mode: 'direct' };
  }

  if (options.mode === 'http') {
    const client = new HttpPlatformClient(serverUrl);
    await client.initialize();
    return { client, mode: 'http' };
  }

  // Auto mode: try HTTP first
  try {
    const client = new HttpPlatformClient(serverUrl);
    await client.initialize();
    return { client, mode: 'http' };
  } catch {
    throw new Error(
      `Cannot connect to server at ${serverUrl}.\n` +
      `  • Start the server: pnpm dev:server\n` +
      `  • Or specify URL: generatorai --server <url> <command>`,
    );
  }
}
