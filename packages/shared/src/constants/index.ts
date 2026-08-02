// Shared constants

/** Default harness model identifier */
export const DEFAULT_MODEL = 'claude-sonnet-4.6';

/** Default server port */
export const DEFAULT_PORT = 3100;

/** Default heartbeat interval for SSE in ms */
export const DEFAULT_HEARTBEAT_MS = 15_000;

/** Default timeout for harness responses in ms */
export const DEFAULT_HARNESS_TIMEOUT_MS = 120_000;

/** Default max replay events for SSE reconnection */
export const MAX_REPLAY_EVENTS = 10_000;

/** Maximum script execution timeout in ms */
export const MAX_SCRIPT_TIMEOUT_MS = 300_000;

/** Maximum output buffer size in bytes (10MB) */
export const MAX_OUTPUT_BUFFER_BYTES = 10 * 1024 * 1024;

// ── v2 Workflow / DAG Constants ──

/** Maximum stages allowed per WorkflowDefinition */
export const MAX_STAGES_PER_WORKFLOW = 50;

/** Maximum edges allowed per WorkflowDefinition */
export const MAX_EDGES_PER_WORKFLOW = 200;

/** Maximum concurrent stage sessions per WorkflowRun */
export const MAX_CONCURRENT_STAGE_SESSIONS = 10;

/** Default max concurrency for parallel stages */
export const DEFAULT_MAX_STAGE_CONCURRENCY = 5;
