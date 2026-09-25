// FROZEN COPY for migration v55 (README R-3, RV-33). Copied from
// packages/workflow-spec/src (P01 review fixes). Never edit: v55 converts
// legacy rows into exactly these shapes and validates them with this copy of
// the validator; the live spec package may move on.

export type { ExprNode, ExprDiagnostic, Span, ComparisonOp, LiteralValue } from './ast.js';
export { pathOf, walkExpr } from './ast.js';
export { parseExpression, parseExpressionOrThrow, type ParseResult } from './parse.js';
export { typecheckExpression, checkExpression, type TypeEnv, type TypeCheckResult } from './typecheck.js';
export {
  evaluate,
  evaluateSource,
  conditionHolds,
  DEFAULT_STEP_BUDGET,
  MAX_LIST_LENGTH,
  type EvalScope,
  type EvalOptions,
  type EvalResult,
  type EvalError,
} from './evaluate.js';
export {
  parseTemplate,
  checkTemplate,
  renderTemplate,
  templateVariableNames,
  hasPlaceholder,
  type TemplateNode,
  type ParsedTemplate,
  type RenderResult,
  type TemplateCheckOptions,
} from './template.js';
export { getFunction, listFunctions, type ExprFunction, type LambdaValue } from './functions.js';
export { getFilter, listFilters, renderValue, type TemplateFilter } from './filters.js';
export {
  T,
  nullable,
  union,
  members,
  withoutNull,
  isNullable,
  isBooleanish,
  typeToString,
  typeFromJsonSchema,
  typeOfValue,
  type ExprType,
} from './types.js';
export { toValue, deepEqual, getField, canonicalJson, type Value } from './values.js';
export { EXPRESSION_GRAMMAR, grammarFunctions, grammarFilters, type GrammarRow } from './grammar.js';
