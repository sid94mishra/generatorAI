// ────────────────────────────────────────────────────────────────
// DataSchema — Schema definition for automation inline data
//   Users define the shape of a single row and how the rows are
//   grouped into iterations. Actual data is provided at trigger
//   time (manual/webhook) or as a default dataset (schedule).
// ────────────────────────────────────────────────────────────────

/** Supported field types in a DataSchema. */
export type DataFieldType = 'string' | 'number' | 'boolean' | 'date' | 'json';

/** One field in a DataSchema. */
export interface DataFieldDef {
  /** Field name — must match `/^[A-Za-z_][A-Za-z0-9_]*$/` so it is a
   *  valid variable name in template interpolation. */
  name: string;
  type: DataFieldType;
  /** Default: true. Rows missing a required field are rejected. */
  required?: boolean;
  /** User-facing description, shown in the UI. */
  description?: string;
  /** If set, used when a row omits the field (only sensible when
   *  `required` is false). */
  defaultValue?: unknown;
  /** Optional value constraint for `string` fields. */
  enum?: string[];
}

/** Schema declaring the shape of one iteration row. */
export interface DataSchema {
  version: 1;
  /** Format of the raw dataset text supplied at trigger time. */
  format: 'json_array' | 'csv' | 'jsonl';
  /** Ordered list of field definitions. Order affects CSV header
   *  autodetection and the order of columns in previews. */
  fields: DataFieldDef[];
  /** Optional name of the field to use as a stable identifier —
   *  populates iteration labels and can be used for dedup. */
  primaryKey?: string;
}

/** How rows should be grouped into iterations. */
export type IterationMode =
  | { kind: 'each_row' }
  | {
      kind: 'group_by';
      /** Field names whose values form the group key. */
      fields: string[];
      /** Variable name that receives the grouped row array in each
       *  iteration. Default: `'items'`. */
      groupVariable?: string;
    }
  | {
      kind: 'single';
      /** Variable name that receives the full row array in the single
       *  iteration. Default: `'items'`. */
      datasetVariable?: string;
    };

/** Raw dataset supplied at trigger time (manual/webhook) or stored
 *  as the schedule default. Server parses per `format` and validates
 *  against the automation's `DataSchema`. */
export interface AutomationDataset {
  format: 'json_array' | 'csv' | 'jsonl';
  /** Raw text as supplied by the user. Not parsed here — the server
   *  parses on ingestion so schema validation errors surface early. */
  data: string;
  /** Filled by the server after successful parse — useful for the
   *  audit snapshot on `automation_executions.dataset_snapshot`. */
  parsedRowCount?: number;
}

/** Result of planning iterations from `{schema, mode, dataset}`.
 *  Consumed by `AutomationService.runExecution`. */
export interface PlannedIterations {
  iterations: Array<{
    /** The variable bag that will be interpolated into the workflow's
     *  prompts: the row's declared fields and the group/dataset variable
     *  in `group_by` / `single` mode. The iteration index travels in the
     *  run's trigger, never as a variable. */
    variables: Record<string, unknown>;
    /** Human-readable label used in the UI ("Row 1", "priority=high"). */
    label: string;
  }>;
  /** Non-fatal issues (extra fields, coerced values, etc.). */
  warnings: string[];
  /** Total row count parsed from the dataset (before grouping). */
  parsedRowCount: number;
}

/** Preview response for the `/api/automations/preview-iterations`
 *  endpoint — same shape as `PlannedIterations` but iterations are
 *  capped at 5 for a quick UI preview. */
export interface IterationPreview {
  iterations: PlannedIterations['iterations'];
  totalIterations: number;
  parsedRowCount: number;
  warnings: string[];
}
