// ────────────────────────────────────────────────────────────────
// BrowserConfigSchema — Zod validator for the workspace/workflow/stage
// `browserConfig` block. Stages read the run workspace's resolved block
// through `BrowserService.resolveConfig`.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';

export const BrowserConfigSchema = z
  .object({
    enabled: z.boolean().optional(),
    mode: z.enum(['auto', 'native', 'screencast']).optional(),
    /**
     * User-facing visibility control. Default `'headless'` (safe). See
     * `BrowserConfig.visibility` in `types/BrowserSession.ts` for the
     * full precedence rules relative to the low-level `headless` field.
     */
    visibility: z.enum(['visible', 'headless', 'off']).optional(),
    headless: z.boolean().optional(),
    viewport: z
      .object({
        width: z.number().int().min(320).max(3840),
        height: z.number().int().min(240).max(2160),
      })
      .optional(),
    allowedHosts: z.array(z.string().min(1).max(200)).max(100).optional(),
    persistProfile: z.boolean().optional(),
    screencastFps: z.number().int().min(1).max(15).optional(),
    screencastQuality: z.number().int().min(20).max(95).optional(),
    idlePauseMinutes: z.number().int().min(1).max(120).optional(),
    evalAllowed: z.boolean().optional(),
    dialogPolicy: z.enum(['dismiss', 'accept', 'ask']).optional(),
    permissions: z.array(z.string().min(1).max(50)).max(20).optional(),
    piiRedaction: z.boolean().optional(),
    injectionDefense: z.enum(['off', 'classifier']).optional(),
    recordVideo: z.boolean().optional(),
    /**
     * Trust self-signed/invalid TLS certs — for a dev server at
     * `https://localhost:PORT`. Off by default. While on, top-level
     * `https://` navigation is restricted to loopback hosts so the
     * exemption cannot silently cover a public origin — see
     * `BrowserConfig.allowLocalhostSelfSigned` in types/BrowserSession.ts.
     */
    allowLocalhostSelfSigned: z.boolean().optional(),
  })
  .strict();

export type BrowserConfigInput = z.input<typeof BrowserConfigSchema>;
