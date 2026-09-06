// ────────────────────────────────────────────────────────────────
// Test Helpers — Quick SDK setup for testing
// ────────────────────────────────────────────────────────────────

import { createGeneratorAI, type GeneratorAI } from '../GeneratorAI.js';
import type { GeneratorAIConfig } from '../config.js';
import * as os from 'node:os';
import * as path from 'node:path';
import * as fs from 'node:fs';

/**
 * Create a GeneratorAI instance configured for testing.
 * Uses a temporary database and artifacts directory.
 */
export async function createTestGeneratorAI(
  overrides?: Partial<GeneratorAIConfig>,
): Promise<GeneratorAI> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'generatorai-test-'));

  return createGeneratorAI({
    harness: overrides?.harness ?? overrides?.provider ?? 'copilot',
    database: path.join(tmpDir, 'test.db'),
    artifactsDir: path.join(tmpDir, 'artifacts'),
    scriptsDir: path.join(tmpDir, 'scripts'),
    logger: false,
    projectRoot: tmpDir,
    ...overrides,
  });
}
