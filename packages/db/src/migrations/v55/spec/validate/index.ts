// FROZEN COPY for migration v55 (README R-3, RV-33). Copied from
// packages/workflow-spec/src (P01 review fixes). Never edit: v55 converts
// legacy rows into exactly these shapes and validates them with this copy of
// the validator; the live spec package may move on.

export { validateWorkflow, schemaIssues, type ValidateOptions, type ValidationResult } from './validateWorkflow.js';
export {
  VALIDATION_CODES,
  ValidationIssueSchema,
  toPointer,
  pointerToken,
  type ValidationIssue,
  type ValidationCode,
  type IssueSeverity,
  type ValidationLayer,
  type CodeInfo,
} from './issues.js';
export { analyzeGraph, ancestorsOf, type GraphAnalysis, type GraphEdge } from './dag.js';
export { buildTypeEnv, stageType, stageOutputType, variableType, type ScopeContext } from './scope.js';
export { literalSecretReason } from './security.js';
export { engineIssues } from './capability.js';
export { RENAMED_FIELDS, unknownFieldHint } from './hints.js';
