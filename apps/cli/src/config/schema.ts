import { z } from 'zod';

/** CLI-specific configuration schema (separate from the server AppConfig) */
export const CLIConfigSchema = z.object({
  server: z.object({
    url: z.string().default('http://localhost:3100'),
    apiKey: z.string().optional(),
  }).default({}),
  cli: z.object({
    defaultOutput: z.enum(['human', 'json']).default('human'),
    color: z.enum(['auto', 'always', 'never']).default('auto'),
    pager: z.boolean().default(true),
    editor: z.string().optional(),
    streamVerbosity: z.enum(['minimal', 'normal', 'verbose']).default('normal'),
    confirmDestructive: z.boolean().default(true),
    defaultModel: z.string().optional(),
  }).default({}),
  tui: z.object({
    theme: z.enum(['dark', 'light', 'auto']).default('auto'),
    showUsage: z.boolean().default(true),
    collapseTools: z.boolean().default(true),
    maxStreamHistory: z.number().default(500),
  }).default({}),
  profiles: z.record(z.object({
    server: z.object({
      url: z.string().optional(),
      apiKey: z.string().optional(),
    }).optional(),
    cli: z.object({
      defaultModel: z.string().optional(),
    }).optional(),
  })).optional(),
  activeProfile: z.string().optional(),
});

export type CLIConfig = z.infer<typeof CLIConfigSchema>;
