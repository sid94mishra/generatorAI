// ────────────────────────────────────────────────────────────────
// DataSourceResolver — Resolves dynamic data sources for automation
//   iterations. Supports script, HTTP, and file-based data sources.
//
// Every value a resolver returns becomes variables inside an agent's
// prompt, so the three resolvers are hardened accordingly:
//   * HTTP — requests go through the SSRF-safe transport
//     (`network: 'public-only'`): DNS is resolved first, private /
//     loopback / link-local / metadata targets are refused, the socket is
//     pinned to the vetted address and every redirect hop is re-vetted.
//   * File — paths resolve against the automation's PROJECT ROOT (never
//     `process.cwd()`), through `realpath`, must stay inside it, and
//     hidden files (`.env`, `.git/…`) are refused unless opted in.
//   * Script — argv is produced by a real word splitter that rejects
//     shell operators instead of silently mis-tokenising them.
// Credential-bearing headers / env values are stored as vault references
// (`${secret:…}`) and materialised here, at execution time only.
// ────────────────────────────────────────────────────────────────

import { readFile, realpath } from 'node:fs/promises';
import * as path from 'node:path';
import type {
  Automation,
  DataSourceConfig,
  ScriptDataSourceConfig,
  HttpDataSourceConfig,
  FileDataSourceConfig,
  WorkflowScriptDataSourceConfig,
  ParsedBatchData,
  DataSourceTestResult,
  DataSourceSchema,
  ILogger,
} from '@generatorai/shared';
import { parseBatchData, isSecretRef, parseSecretRefValue, SECRET_MASK } from '@generatorai/shared';
import { redactUrl } from '@generatorai/secrets';
import type { IScriptRunner } from '../domain/ports/IScriptRunner.js';
import type { IHttpClient } from '../domain/ports/IHttpClient.js';
import type { WorkflowScriptLoader } from './WorkflowScriptLoader.js';
import { splitShellWords } from './shellWords.js';

/** Maximum number of items a data source can return */
const MAX_DATA_SOURCE_ITEMS = 10_000;

/** Default timeout for scripts (60s) */
const DEFAULT_SCRIPT_TIMEOUT = 60_000;

/** Default timeout for HTTP requests (30s) */
const DEFAULT_HTTP_TIMEOUT = 30_000;

/** Maximum stdout size from script (5MB) */
const MAX_STDOUT_SIZE = 5 * 1024 * 1024;

/** Reserved property names blocked from data source output */
const RESERVED_NAMES = new Set([
  '__proto__', 'constructor', 'prototype', 'toString', 'valueOf',
  'hasOwnProperty', 'isPrototypeOf', 'propertyIsEnumerable',
]);

/**
 * Resolves a `${secret:<namespace>/<name>}` reference to its value, or
 * null when the vault has no such entry. Wired by the composition root.
 */
export type SecretResolver = (ref: { namespace: string; name: string }) => Promise<string | null>;

export class DataSourceResolver {
  private secretResolver: SecretResolver | null = null;

  constructor(
    private scriptRunner: IScriptRunner,
    private httpClient: IHttpClient,
    private logger: ILogger,
    private projectRoot?: string,
    private scriptLoader?: WorkflowScriptLoader,
  ) {}

  /** Late-bind the script loader (needed when script loader is created after DataSourceResolver) */
  setScriptLoader(loader: WorkflowScriptLoader): void {
    this.scriptLoader = loader;
  }

  /** Late-bind the vault lookup used to materialise `${secret:…}` references. */
  setSecretResolver(resolver: SecretResolver): void {
    this.secretResolver = resolver;
  }

  /**
   * Resolve iteration data for an automation at execution time.
   * Returns null if no dynamic data source is configured (use static data instead).
   */
  async resolve(automation: Automation): Promise<ParsedBatchData | null> {
    const config = automation.dataSourceConfig;
    if (!config || config.type === 'static') {
      return null; // No dynamic data source — use existing static behavior
    }

    this.logger.info(`[DataSourceResolver] Resolving ${config.type} data source for automation ${automation.id}`);
    const startTime = Date.now();

    const result = await this.resolveConfig(config);

    const durationMs = Date.now() - startTime;
    this.logger.info(`[DataSourceResolver] Resolved ${result.rowCount} items in ${durationMs}ms`);

    return result;
  }

  /**
   * Test a data source configuration without running a full execution.
   * Returns a preview of the first 5 rows plus metadata.
   */
  async testDataSource(config: DataSourceConfig): Promise<DataSourceTestResult> {
    if (config.type === 'static') {
      return { success: true, totalCount: 0, durationMs: 0 };
    }

    const startTime = Date.now();
    try {
      const result = await this.resolveConfig(config);
      const durationMs = Date.now() - startTime;
      return {
        success: true,
        preview: {
          columns: result.columns,
          rows: result.rows.slice(0, 5),
          rowCount: Math.min(5, result.rowCount),
        },
        totalCount: result.rowCount,
        durationMs,
      };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - startTime,
      };
    }
  }

  private async resolveConfig(config: Exclude<DataSourceConfig, { type: 'static' }>): Promise<ParsedBatchData> {
    switch (config.type) {
      case 'script':
        return this.resolveScript(config);
      case 'http':
        return this.resolveHttp(config);
      case 'file':
        return this.resolveFile(config);
      case 'workflow_script':
        return this.resolveWorkflowScript(config);
      default:
        throw new Error(`Unknown data source type: ${(config as DataSourceConfig).type}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Secret references
  // ═══════════════════════════════════════════════════════════════

  /**
   * Replace `${secret:…}` references in a header / env bag with the vault
   * value. A masked placeholder (`••••`) means the caller round-tripped a
   * redacted API response instead of the stored reference — refuse loudly
   * rather than hand the literal bullets to a script.
   */
  private async materializeSecrets(
    bag: Record<string, string> | undefined,
    what: string,
  ): Promise<Record<string, string> | undefined> {
    if (!bag) return bag;
    const out: Record<string, string> = {};
    for (const [key, value] of Object.entries(bag)) {
      if (value === SECRET_MASK) {
        throw new Error(
          `${what} "${key}" is a masked placeholder — supply the real value (or the stored secret reference) before running`,
        );
      }
      if (isSecretRef(value)) {
        const ref = parseSecretRefValue(value);
        if (!ref) throw new Error(`${what} "${key}" has a malformed secret reference`);
        if (!this.secretResolver) {
          throw new Error(`${what} "${key}" references the secrets vault but no vault is configured`);
        }
        const resolved = await this.secretResolver(ref);
        if (resolved === null) {
          throw new Error(`${what} "${key}" references secret ${ref.namespace}/${ref.name}, which is not in the vault`);
        }
        out[key] = resolved;
        continue;
      }
      out[key] = value;
    }
    return out;
  }

  // ═══════════════════════════════════════════════════════════════
  // Script Data Source
  // ═══════════════════════════════════════════════════════════════

  private async resolveScript(config: ScriptDataSourceConfig): Promise<ParsedBatchData> {
    const timeout = config.timeout ?? DEFAULT_SCRIPT_TIMEOUT;
    const cwd = config.workingDirectory ?? this.projectRoot ?? process.cwd();

    // Build sanitized env (block sensitive shell vars from leaking)
    const env: Record<string, string> = {};
    const materialized = await this.materializeSecrets(config.env, 'Environment variable');
    if (materialized) {
      for (const [key, value] of Object.entries(materialized)) {
        // Prevent env variable injection — block keys with special chars
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
          env[key] = String(value);
        }
      }
    }

    // Real word splitting: quotes and escapes behave like a shell's, and
    // anything that would NEED a shell (pipes, `$VAR`, redirects) is refused
    // with an explanation instead of becoming a literal argument.
    let parts: string[];
    try {
      parts = splitShellWords(config.command);
    } catch (err) {
      throw new Error(`Invalid data source command: ${err instanceof Error ? err.message : String(err)}`);
    }
    const binary = parts[0]!;
    const args = parts.slice(1);

    this.logger.info(`[DataSourceResolver] Running script: ${binary} (${args.length} args, timeout: ${timeout}ms)`);

    const result = await this.scriptRunner.run(binary, args, {
      cwd,
      env,
      timeout,
    });

    if (result.exitCode !== 0) {
      const stderr = result.stderr.slice(0, 2000);
      throw new Error(
        `Data source script exited with code ${result.exitCode}: ${stderr}`,
      );
    }

    const stdout = result.stdout;
    if (!stdout.trim()) {
      throw new Error('Data source script produced no output on stdout');
    }

    if (stdout.length > MAX_STDOUT_SIZE) {
      throw new Error(
        `Data source script output exceeds maximum size of ${MAX_STDOUT_SIZE} bytes (got ${stdout.length})`,
      );
    }

    return this.parseOutput(stdout, config.outputFormat ?? 'json_array', config.schema);
  }

  // ═══════════════════════════════════════════════════════════════
  // HTTP Data Source
  // ═══════════════════════════════════════════════════════════════

  private async resolveHttp(config: HttpDataSourceConfig): Promise<ParsedBatchData> {
    const timeout = config.timeout ?? DEFAULT_HTTP_TIMEOUT;
    const method = config.method ?? 'GET';

    // Cheap, network-free sanity check so a malformed URL fails with a
    // clear message. The real SSRF defence (DNS-first vetting, pinning,
    // per-hop redirect checks) lives in the transport and is FORCED on via
    // `network: 'public-only'` regardless of how the client was configured.
    let parsed: URL;
    try {
      parsed = new URL(config.url);
    } catch {
      throw new Error(`Invalid data source URL: ${config.url}`);
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Data source URL must use http or https (got ${parsed.protocol})`);
    }

    const headers = await this.materializeSecrets(config.headers, 'Header');

    this.logger.info(`[DataSourceResolver] HTTP ${method} ${redactUrl(config.url)}`);

    const response = await this.httpClient.request({
      method,
      url: config.url,
      headers,
      body: config.body,
      timeout,
      network: 'public-only',
    });

    if (response.status >= 400) {
      throw new Error(
        `Data source HTTP request failed with status ${response.status}: ${response.body.slice(0, 500)}`,
      );
    }

    // Guard against oversized responses
    if (response.body.length > MAX_STDOUT_SIZE) {
      throw new Error(
        `HTTP response exceeds maximum size of ${MAX_STDOUT_SIZE} bytes (got ${response.body.length})`,
      );
    }

    let data = response.body;

    // Extract array from nested response using resultPath
    if (config.resultPath) {
      data = this.extractByPath(response.body, config.resultPath);
    }

    return this.parseOutput(data, 'json_array', config.schema);
  }

  // ═══════════════════════════════════════════════════════════════
  // File Data Source
  // ═══════════════════════════════════════════════════════════════

  private async resolveFile(config: FileDataSourceConfig): Promise<ParsedBatchData> {
    // The boundary is the injected project root — NEVER the server's
    // working directory, which is wherever the process was launched from
    // (in dev, `apps/server`, next to `.env`).
    if (!this.projectRoot) {
      throw new Error('File data sources require a project root; none is configured for this deployment');
    }
    if (path.isAbsolute(config.filePath)) {
      throw new Error('File path must be relative to the project root');
    }

    let realBase: string;
    try {
      realBase = await realpath(this.projectRoot);
    } catch (err) {
      throw new Error(
        `Project root is not accessible: ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const candidate = path.resolve(realBase, config.filePath);
    let realTarget: string;
    try {
      // realpath follows symlinks, so a link inside the root pointing at
      // /etc/passwd resolves to its true location and fails containment.
      realTarget = await realpath(candidate);
    } catch (err) {
      throw new Error(
        `Failed to read data source file "${config.filePath}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    const rel = path.relative(realBase, realTarget);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error('File path escapes the project root');
    }

    // Hidden files and directories are where credentials live (.env,
    // .git/config, .npmrc). Refuse unless the automation says otherwise.
    const hiddenSegment = rel.split(/[\\/]/).find((seg) => seg.startsWith('.') && seg !== '.' && seg !== '..');
    if (hiddenSegment && config.allowHidden !== true) {
      throw new Error(
        `File path contains a hidden segment ("${hiddenSegment}"); set allowHidden to read dotfiles deliberately`,
      );
    }

    this.logger.info(`[DataSourceResolver] Reading file: ${rel}`);

    let content: string;
    try {
      content = await readFile(realTarget, 'utf-8');
    } catch (err) {
      throw new Error(
        `Failed to read data source file "${config.filePath}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    if (content.length > MAX_STDOUT_SIZE) {
      throw new Error(
        `Data source file exceeds maximum size of ${MAX_STDOUT_SIZE} bytes`,
      );
    }

    return this.parseOutput(content, config.format ?? 'json_array', config.schema);
  }

  // ═══════════════════════════════════════════════════════════════
  // Shared Parsing & Validation
  // ═══════════════════════════════════════════════════════════════

  /**
   * Parse raw output string into ParsedBatchData.
   * Reuses the existing parseBatchData for csv/jsonl, handles json_array directly.
   */
  private parseOutput(
    raw: string,
    format: string,
    schema?: DataSourceSchema,
  ): ParsedBatchData {
    let result: ParsedBatchData;

    switch (format) {
      case 'json_array':
        result = this.parseJsonArray(raw.trim());
        break;
      case 'csv':
        result = parseBatchData('csv', raw);
        break;
      case 'jsonl':
        result = parseBatchData('jsonl', raw);
        break;
      default:
        throw new Error(`Unsupported data source output format: ${format}`);
    }

    // Enforce item limit
    if (result.rowCount > MAX_DATA_SOURCE_ITEMS) {
      throw new Error(
        `Data source returned ${result.rowCount} items, exceeding maximum of ${MAX_DATA_SOURCE_ITEMS}`,
      );
    }

    if (result.rowCount === 0) {
      throw new Error('Data source returned no items');
    }

    // Validate column names for safety (reuse same rules as batch parser)
    for (const col of result.columns) {
      if (RESERVED_NAMES.has(col)) {
        throw new Error(`Data source output contains reserved column name "${col}"`);
      }
    }

    // Apply schema validation if specified
    if (schema) {
      this.validateSchema(result, schema);
    }

    return result;
  }

  /**
   * Parse a JSON array string into ParsedBatchData.
   * Handles: [{"a": 1}, {"a": 2}] or ["item1", "item2"] (auto-wraps primitives)
   */
  private parseJsonArray(text: string): ParsedBatchData {
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      throw new Error(
        'Data source output is not valid JSON. Expected a JSON array.',
      );
    }

    if (!Array.isArray(parsed)) {
      throw new Error(
        `Data source output must be a JSON array, got ${typeof parsed}`,
      );
    }

    if (parsed.length === 0) {
      return { columns: [], rows: [], rowCount: 0 };
    }

    // Normalize: wrap primitives as { value: item, _index: N }
    const rows: Record<string, unknown>[] = parsed.map((item, idx) => {
      if (item !== null && typeof item === 'object' && !Array.isArray(item)) {
        return item as Record<string, unknown>;
      }
      return { value: item, _index: idx };
    });

    // Detect columns from the union of all keys
    const columnSet = new Set<string>();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        columnSet.add(key);
      }
    }
    const columns = Array.from(columnSet);

    return { columns, rows, rowCount: rows.length };
  }

  /**
   * Extract a nested array from a JSON response using a dot-separated path.
   * e.g. ".issues" extracts parsed.issues, ".data.items" extracts parsed.data.items
   */
  private extractByPath(body: string, resultPath: string): string {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body);
    } catch {
      throw new Error('HTTP response is not valid JSON');
    }

    // Normalize path: remove leading dot
    const parts = resultPath.replace(/^\./, '').split('.');
    let current: unknown = parsed;

    for (const part of parts) {
      if (current === null || current === undefined || typeof current !== 'object') {
        throw new Error(
          `Cannot navigate path "${resultPath}": "${part}" not found in response`,
        );
      }
      // Prevent prototype pollution via path traversal
      if (RESERVED_NAMES.has(part)) {
        throw new Error(`Result path "${resultPath}" contains reserved property "${part}"`);
      }
      current = (current as Record<string, unknown>)[part];
    }

    if (!Array.isArray(current)) {
      throw new Error(
        `Result path "${resultPath}" did not resolve to an array`,
      );
    }

    return JSON.stringify(current);
  }

  /**
   * Validate parsed data against a DataSourceSchema.
   */
  private validateSchema(data: ParsedBatchData, schema: DataSourceSchema): void {
    if (schema.maxItems && data.rowCount > schema.maxItems) {
      throw new Error(
        `Data source returned ${data.rowCount} items, exceeding configured maximum of ${schema.maxItems}`,
      );
    }

    if (schema.requiredFields && schema.requiredFields.length > 0) {
      for (let i = 0; i < Math.min(data.rowCount, 5); i++) {
        const row = data.rows[i]!;
        for (const field of schema.requiredFields) {
          if (!(field in row) || row[field] === null || row[field] === undefined) {
            throw new Error(
              `Row ${i + 1} is missing required field "${field}"`,
            );
          }
        }
      }
      // Spot-check last row too if there are many rows
      if (data.rowCount > 5) {
        const lastRow = data.rows[data.rowCount - 1]!;
        for (const field of schema.requiredFields) {
          if (!(field in lastRow) || lastRow[field] === null || lastRow[field] === undefined) {
            throw new Error(
              `Row ${data.rowCount} is missing required field "${field}"`,
            );
          }
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Workflow Script Data Source
  // ═══════════════════════════════════════════════════════════════

  private async resolveWorkflowScript(config: WorkflowScriptDataSourceConfig): Promise<ParsedBatchData> {
    if (!this.scriptLoader) {
      throw new Error('WorkflowScriptLoader not available — cannot resolve workflow_script data source');
    }

    const script = this.scriptLoader.getScript(config.scriptId);
    if (!script) {
      throw new Error(`Workflow script not found: ${config.scriptId}`);
    }

    // Get profiles from the script
    const profiles = script.profiles ?? [];
    if (profiles.length === 0) {
      // No profiles — return the script's definition variables as a single iteration row
      const vars = script.output.definition.variables?.reduce((acc: Record<string, unknown>, v) => {
        if (v.defaultValue !== undefined) {
          acc[v.name] = v.defaultValue;
        }
        return acc;
      }, {} as Record<string, unknown>) ?? {};

      return {
        columns: Object.keys(vars),
        rows: [vars],
        rowCount: 1,
      };
    }

    // If a specific profile is requested, return its variables as a single row
    if (config.profileName) {
      const profile = profiles.find((p) => p.name === config.profileName);
      if (!profile) {
        throw new Error(`Profile "${config.profileName}" not found in script ${config.scriptId}`);
      }
      const vars = profile.variables ?? {};

      // If iterationVariable is set, treat that variable's value as an array to iterate
      if (config.iterationVariable && vars[config.iterationVariable]) {
        const iterValues = Array.isArray(vars[config.iterationVariable])
          ? vars[config.iterationVariable] as unknown[]
          : [vars[config.iterationVariable]];

        const rows = iterValues.map((val, idx) => ({
          ...vars,
          [config.iterationVariable!]: val,
          _index: idx,
        }));
        const columns = [...new Set(rows.flatMap(r => Object.keys(r)))];
        return { columns, rows, rowCount: rows.length };
      }

      return {
        columns: Object.keys(vars),
        rows: [vars],
        rowCount: 1,
      };
    }

    // No specific profile — each profile becomes an iteration row
    const rows = profiles.map((p, idx) => ({
      _profileName: p.name,
      _index: idx,
      ...(p.variables ?? {}),
    }));
    const columns = [...new Set(rows.flatMap((r: Record<string, unknown>) => Object.keys(r)))];
    return { columns, rows, rowCount: rows.length };
  }
}
