// init command — scaffold a project-level .generatorai/ config directory

import type { Command } from 'commander';
import chalk from 'chalk';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import type { CLIPlatformClient } from '../platform/types.js';

/** Default project-level config (repo-scoped) */
const PROJECT_CONFIG_TEMPLATE = {
  server: { url: 'http://localhost:3100' },
  cli: { defaultOutput: 'human', color: true },
  defaults: {
    permissionMode: 'bypassPermissions',
    sessionMode: 'auto',
  },
};

/** Default user-level config (~/.generatorai/) */
const USER_CONFIG_TEMPLATE = {
  server: { url: 'http://localhost:3100' },
  cli: { defaultOutput: 'human', color: true },
};

const GITIGNORE_CONTENT = `# GeneratorAI local config
secrets/
*.local.json
run-profiles/*.local.json
`;

/**
 * Bootstrap the user-level ~/.generatorai/ directory.
 * Called automatically when the CLI starts (before any command).
 * Creates the directory structure only if it doesn't exist.
 */
export async function bootstrapUserDir(): Promise<void> {
  const userDir = path.join(os.homedir(), '.generatorai');
  const configFile = path.join(userDir, 'config.json');

  try {
    await fs.access(userDir);
  } catch {
    // First time — create the user directory structure
    await fs.mkdir(userDir, { recursive: true });
    await fs.mkdir(path.join(userDir, 'profiles'), { recursive: true });
    await fs.mkdir(path.join(userDir, 'cache'), { recursive: true });
    await fs.mkdir(path.join(userDir, 'history'), { recursive: true });
  }

  // Ensure config.json exists
  try {
    await fs.access(configFile);
  } catch {
    await fs.writeFile(configFile, JSON.stringify(USER_CONFIG_TEMPLATE, null, 2) + '\n', 'utf-8');
  }
}

export function registerInitCommand(
  program: Command,
  _getClient: () => Promise<CLIPlatformClient>,
): void {
  program
    .command('init')
    .description('Initialize GeneratorAI project in current directory')
    .option('--force', 'Overwrite existing configuration')
    .action(async (cmdOpts: { force?: boolean }) => {
      const cwd = process.cwd();
      const configDir = path.join(cwd, '.generatorai');
      const configFile = path.join(configDir, 'config.json');

      // Check if already initialized
      try {
        await fs.access(configDir);
        if (!cmdOpts.force) {
          process.stderr.write(chalk.yellow(`\n  ⚠ .generatorai/ already exists in ${cwd}\n`));
          process.stderr.write(chalk.dim('  Use --force to reinitialize.\n\n'));
          return;
        }
      } catch { /* does not exist, proceed */ }

      // Create directory structure
      await fs.mkdir(configDir, { recursive: true });
      await fs.mkdir(path.join(configDir, 'workflows'), { recursive: true });
      await fs.mkdir(path.join(configDir, 'templates'), { recursive: true });
      await fs.mkdir(path.join(configDir, 'run-profiles'), { recursive: true });

      // Write config.json
      await fs.writeFile(configFile, JSON.stringify(PROJECT_CONFIG_TEMPLATE, null, 2) + '\n', 'utf-8');

      // Write .gitignore inside .generatorai/
      const gitignorePath = path.join(configDir, '.gitignore');
      try {
        await fs.access(gitignorePath);
      } catch {
        await fs.writeFile(gitignorePath, GITIGNORE_CONTENT, 'utf-8');
      }

      process.stderr.write(chalk.green(`\n  ✓ Initialized GeneratorAI project\n`));
      process.stderr.write(chalk.dim(`    ${configDir}/\n`));
      process.stderr.write(chalk.dim(`    ├── config.json       (project settings)\n`));
      process.stderr.write(chalk.dim(`    ├── workflows/        (workflow definitions)\n`));
      process.stderr.write(chalk.dim(`    ├── templates/        (workflow templates)\n`));
      process.stderr.write(chalk.dim(`    ├── run-profiles/     (reusable run profiles)\n`));
      process.stderr.write(chalk.dim(`    └── .gitignore\n\n`));
      process.stderr.write(chalk.dim(`  Next steps:\n`));
      process.stderr.write(chalk.dim(`    • Place templates in .generatorai/templates/\n`));
      process.stderr.write(chalk.dim(`    • Create run profiles: generatorai run profile generate <workflowId>\n`));
      process.stderr.write(chalk.dim(`    • Run workflows: generatorai run start <workflowId> --profile <path>\n\n`));
    });
}
