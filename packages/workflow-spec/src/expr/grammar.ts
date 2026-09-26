// ────────────────────────────────────────────────────────────────
// The Expression v2 grammar as data: the generated docs (FIELDS.md), the
// authoring skill and the builder's expression help all render this table,
// so they cannot drift from the parser. Functions and filters come from
// their registries.
// ────────────────────────────────────────────────────────────────

import { listFunctions } from './functions.js';
import { listFilters } from './filters.js';

export interface GrammarRow {
  syntax: string;
  meaning: string;
}

export const EXPRESSION_GRAMMAR = {
  literals: [
    { syntax: "'text' or \"text\"", meaning: 'String; escapes \\n \\t \\r \\uXXXX \\\\ \\\' \\"' },
    { syntax: '12, 3.5, -1, 1e3', meaning: 'Number (only literals can be negative)' },
    { syntax: 'true, false', meaning: 'Boolean' },
    { syntax: 'null', meaning: 'Null' },
    { syntax: "[a, b, 'c']", meaning: 'List' },
  ] satisfies GrammarRow[],
  access: [
    { syntax: 'a.b.c', meaning: 'Field access; a missing field or a null value yields null' },
    { syntax: 'list[0], list[-1]', meaning: 'List index, negative from the end; out of range yields null' },
    { syntax: "obj['key']", meaning: 'Field access by name' },
    { syntax: 'name(args)', meaning: 'Function call; see the function table' },
    { syntax: 'x => condition', meaning: 'Lambda, only as a function argument; x is each element of the list argument' },
  ] satisfies GrammarRow[],
  operators: [
    { syntax: 'or, ||', meaning: 'Logical or (lowest precedence)' },
    { syntax: 'and, &&', meaning: 'Logical and' },
    { syntax: 'not, !', meaning: 'Logical not' },
    { syntax: '== !=', meaning: 'Strict equality by JSON type, deep for lists and objects' },
    { syntax: '< <= > >=', meaning: 'Order of two numbers or two strings' },
    { syntax: 'x in list, s in text', meaning: 'List membership or substring' },
    { syntax: '( … )', meaning: 'Grouping' },
  ] satisfies GrammarRow[],
  semantics: [
    { syntax: 'missing path', meaning: 'A path through a missing or null value yields null' },
    { syntax: 'comparison with null', meaning: 'Always false (== and != alike); test presence with exists(x)' },
    { syntax: 'not null', meaning: 'null, which counts as false' },
    { syntax: 'condition', meaning: 'Holds only when it evaluates to exactly true' },
    { syntax: 'equality', meaning: "Strict: '3' == 3 is false (and a type error at save time)" },
    { syntax: 'arithmetic', meaning: 'None; use functions' },
    { syntax: 'keywords', meaning: 'Lower case: and, or, not, in, true, false, null' },
    { syntax: 'bounds', meaning: 'Lists of at most 10,000 elements; values of at most 1 MB; 1,000,000 work units per expression (steps, produced elements, compared values)' },
  ] satisfies GrammarRow[],
  roots: [
    { syntax: 'variables.<name>', meaning: 'Workflow input variables (typed by their declaration)' },
    {
      syntax: 'stages.<key>.{status, output, summary, attempts, usage}',
      meaning: 'Upstream stages only; output is typed from the stage output schema',
    },
    { syntax: 'run.{id, name, codebases.<alias>.{path, branch, baseRef}}', meaning: 'The run; codebase paths are read-only' },
    { syntax: 'parent.status', meaning: 'The source stage status; edge `when` expressions only' },
    {
      syntax: 'loop.{iteration, number, maxIterations, remaining, carry, priorCarry, operatorInput, usage}',
      meaning: 'Inside a loop body and in the loop fields: the current iteration (0-based), its number (1-based), the granted maximum, the carried state, the carry before it, an operator message, the cumulative usage',
    },
    {
      syntax: 'loop.{last, previous}.{stages.<key>.{output, status, summary}, signals, failures}',
      meaning: 'The latest finished iteration and the one before it; null before they exist (see the loop context table)',
    },
    {
      syntax: 'loop.last.signals.{toolCalls, workspaceChanged, stages.<key>.{toolCalls, outputHash, status}}',
      meaning: 'Progress signals of an iteration; a signal that could not be computed is null, never false',
    },
    { syntax: 'loop.history[i].{k, exitValues, signals, usage, score, durationMs}', meaning: 'Every finished iteration, oldest first' },
    { syntax: 'loops.<loopKey>.*', meaning: 'The same fields of an enclosing loop (nested loops)' },
    { syntax: 'item, map, maps, child', meaning: 'Reserved for map and sub-workflow stages' },
  ] satisfies GrammarRow[],
  templates: [
    { syntax: '{{ expression }}', meaning: 'Insert a value: text as is, null as empty, lists and objects as JSON' },
    { syntax: '{{ name }}', meaning: 'Sugar for {{ variables.name }}; name must be a declared variable' },
    { syntax: '{{ expression | filter }}', meaning: 'Apply a filter (chainable)' },
    { syntax: '{{#if expression}} … {{else}} … {{/if}}', meaning: "Conditional block; null, false, '', 0 and [] are false" },
    { syntax: '\\{{', meaning: 'A literal {{' },
    {
      syntax: 'command fields',
      meaning: 'Commands and arguments are literals; templated values reach commands only through env',
    },
  ] satisfies GrammarRow[],
};

export function grammarFunctions(): GrammarRow[] {
  return listFunctions().map((f) => ({ syntax: f.signature, meaning: f.description }));
}

export function grammarFilters(): GrammarRow[] {
  return listFilters().map((f) => ({ syntax: `| ${f.name}`, meaning: f.description }));
}
