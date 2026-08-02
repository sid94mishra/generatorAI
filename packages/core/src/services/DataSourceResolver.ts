// ────────────────────────────────────────────────────────────────
// DataSourceResolver — Resolves dynamic data sources for automation
//   iterations. Supports script, HTTP, and file-based data sources.
// ────────────────────────────────────────────────────────────────

import { readFile } from 'node:fs/promises';
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
import { parseBatchData } from '@generatorai/shared';
import type { IScriptRunner } from '../domain/ports/IScriptRunner.js';
import type { IHttpClient } from '../domain/ports/IHttpClient.js';
import type { WorkflowScriptLoader } from './WorkflowScriptLoader.js';

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

export class DataSourceResolver {
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

    let result: ParsedBatchData;

    switch (config.type) {
      case 'script':
        result = await this.resolveScript(config);
        break;
      case 'http':
        result = await this.resolveHttp(config);
        break;
      case 'file':
        result = await this.resolveFile(config);
        break;
      case 'workflow_script':
        result = await this.resolveWorkflowScript(config);
        break;
      default:
        throw new Error(`Unknown data source type: ${(config as DataSourceConfig).type}`);
    }

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
      let result: ParsedBatchData;

      switch (config.type) {
        case 'script':
          result = await this.resolveScript(config);
          break;
        case 'http':
          result = await this.resolveHttp(config);
          break;
        case 'file':
          result = await this.resolveFile(config);
          break;
        case 'workflow_script':
          result = await this.resolveWorkflowScript(config);
          break;
        default:
          throw new Error(`Unknown data source type`);
      }

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

  // ═══════════════════════════════════════════════════════════════
  // Script Data Source
  // ═══════════════════════════════════════════════════════════════

  private async resolveScript(config: ScriptDataSourceConfig): Promise<ParsedBatchData> {
    const timeout = config.timeout ?? DEFAULT_SCRIPT_TIMEOUT;
    const cwd = config.workingDirectory ?? this.projectRoot ?? process.cwd();

    // Build sanitized env (block sensitive shell vars from leaking)
    const env: Record<string, string> = {};
    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        // Prevent env variable injection — block keys with special chars
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) {
          env[key] = String(value);
        }
      }
    }

    // Split the command string into binary and arguments
    const parts = config.command.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g) ?? [config.command];
    const binary = parts[0]!;
    const args = parts.slice(1).map(a => a.replace(/^["']|["']$/g, ''));

    this.logger.info(`[DataSourceResolver] Running script: ${binary} ${args.join(' ')} (timeout: ${timeout}ms)`);

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

    // Security: block SSRF attacks against internal services
    this.validateHttpUrl(config.url);

    this.logger.info(`[DataSourceResolver] HTTP ${method} ${config.url}`);

    const response = await this.httpClient.request({
      method,
      url: config.url,
      headers: config.headers,
      body: config.body,
      timeout,
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

  /** Block SSRF attacks by rejecting requests to private/internal URLs */
  private validateHttpUrl(url: string): void {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error(`Invalid data source URL: ${url}`);
    }

    // Only allow http/https
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      throw new Error(`Data source URL must use http or https (got ${parsed.protocol})`);
    }

    const hostname = parsed.hostname.toLowerCase();

    // Block loopback and private networks
    const blockedPatterns = [
      /^localhost$/i,
      /^127\./,
      /^0\.0\.0\.0$/,
      /^::1$/,
      /^\[::1\]$/,
      /^10\./,
      /^172\.(1[6-9]|2\d|3[01])\./,
      /^192\.168\./,
      /^169\.254\./, // AWS/cloud metadata
      /^fc00:/i,     // IPv6 private
      /^fe80:/i,     // IPv6 link-local
    ];

    if (blockedPatterns.some(p => p.test(hostname))) {
      throw new Error('Data source URL cannot target private or internal network addresses');
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // File Data Source
  // ═══════════════════════════════════════════════════════════════

  private async resolveFile(config: FileDataSourceConfig): Promise<ParsedBatchData> {
    // Security: resolve against cwd and verify final path stays within it
    const baseDir = path.resolve(process.cwd());
    const filePath = path.resolve(baseDir, config.filePath);

    if (!filePath.startsWith(baseDir + path.sep) && filePath !== baseDir) {
      throw new Error('File path escapes the allowed base directory');
    }

    this.logger.info(`[DataSourceResolver] Reading file: ${filePath}`);

    let content: string;
    try {
      content = await readFile(filePath, 'utf-8');
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
