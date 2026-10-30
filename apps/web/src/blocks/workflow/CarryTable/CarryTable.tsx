// ────────────────────────────────────────────────────────────────
// WF-18 CarryTable — a loop's carried values (WorkflowLoopBuilder board):
// Name · Expression · Init columns, one row per value, add and remove, and
// an optional JSON Schema per value ("Declare a type"). A value lives in up
// to three records (`carry`, `carryInit`, `carrySchema`); renaming or
// removing a row changes all three. Rows added here stay until removed,
// even while their expressions are empty. Presentational: the name, the
// expression editors, the schema editor and the validation messages come
// from the caller (pointers relative to the loop spec: `/carry/<name>`).
// ────────────────────────────────────────────────────────────────

import { useState, type ReactNode } from 'react';
import { cn } from '@/ui/lib/cn.js';
import { Button } from '@/ui/primitives/Button/Button.js';
import { IconButton } from '@/ui/primitives/IconButton/IconButton.js';
import { Table, TableBody, TableCell, TableHeadCell, TableHeader, TableRow } from '@/ui/primitives/Table/Table.js';

export interface CarryValues {
  carry?: Record<string, string>;
  carryInit?: Record<string, string>;
  carrySchema?: Record<string, Record<string, unknown>>;
}

export interface CarryNameSlot {
  name: string;
  /** The other rows' names (a rename to one of them is refused). */
  taken: readonly string[];
  onRename: (next: string) => void;
  ariaLabel: string;
}

export interface CarryExpressionSlot {
  name: string;
  /** `expression`: evaluated after each iteration; `init`: once when the loop starts. */
  column: 'expression' | 'init';
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder: string;
}

export interface CarrySchemaSlot {
  name: string;
  value: Record<string, unknown> | undefined;
  onChange: (schema: Record<string, unknown> | undefined) => void;
  ariaLabel: string;
}

export interface CarryTableProps {
  value: CarryValues;
  /** The three records after an edit; an emptied record is `undefined`. */
  onChange: (next: CarryValues) => void;
  renderName: (slot: CarryNameSlot) => ReactNode;
  renderExpression: (slot: CarryExpressionSlot) => ReactNode;
  /** The JSON Schema editor; without it the table has no "Declare a type". */
  renderSchema?: (slot: CarrySchemaSlot) => ReactNode;
  /** Validation messages at `pointers` (`/carry/x`); `exact`: only those pointers, not below. */
  renderIssues?: (pointers: readonly string[], exact: boolean) => ReactNode;
  addLabel?: string;
  className?: string;
}

function renameKey<V>(record: Record<string, V> | undefined, key: string, next: string): Record<string, V> | undefined {
  if (!record || !(key in record)) return record;
  return Object.fromEntries(Object.entries(record).map(([k, v]) => [k === key ? next : k, v]));
}

function withoutKey<V>(record: Record<string, V> | undefined, key: string): Record<string, V> | undefined {
  if (!record || !(key in record)) return record;
  const rest = { ...record };
  delete rest[key];
  return Object.keys(rest).length > 0 ? rest : undefined;
}

/** Every carried value's name, in record order, plus the rows not written yet. */
export function carryNames(value: CarryValues, pending: readonly string[] = []): string[] {
  return [
    ...new Set([
      ...Object.keys(value.carry ?? {}),
      ...Object.keys(value.carryInit ?? {}),
      ...Object.keys(value.carrySchema ?? {}),
      ...pending,
    ]),
  ];
}

/** The carried values of a loop as an editable table. */
export function CarryTable({
  value,
  onChange,
  renderName,
  renderExpression,
  renderSchema,
  renderIssues,
  addLabel = 'Add carried value',
  className,
}: CarryTableProps) {
  const [pending, setPending] = useState<string[]>([]);
  const [schemaOpen, setSchemaOpen] = useState<Record<string, boolean>>({});
  const names = carryNames(value, pending);

  const setExpr = (field: 'carry' | 'carryInit', name: string, text: string) => {
    const record = value[field];
    onChange({ ...value, [field]: text.trim() ? { ...(record ?? {}), [name]: text } : withoutKey(record, name) });
  };
  const rename = (name: string, next: string) => {
    setPending((p) => p.map((n) => (n === name ? next : n)));
    setSchemaOpen((s) => ({ ...s, [next]: s[name] ?? false }));
    onChange({
      carry: renameKey(value.carry, name, next),
      carryInit: renameKey(value.carryInit, name, next),
      carrySchema: renameKey(value.carrySchema, name, next),
    });
  };
  const remove = (name: string) => {
    setPending((p) => p.filter((n) => n !== name));
    onChange({
      carry: withoutKey(value.carry, name),
      carryInit: withoutKey(value.carryInit, name),
      carrySchema: withoutKey(value.carrySchema, name),
    });
  };
  const add = () => {
    let n = names.length + 1;
    while (names.includes(`value_${n}`)) n++;
    setPending((p) => [...p, `value_${n}`]);
  };

  return (
    <div className={cn('flex flex-col gap-2', className)}>
      {names.length > 0 ? (
        <Table
          label="Carried values"
          size="dense"
          inset="card"
          columns={['minmax(0,2fr)', 'minmax(0,3fr)', 'minmax(0,2fr)', 'auto']}
        >
          <TableHeader className="py-1">
            <TableHeadCell>Name</TableHeadCell>
            <TableHeadCell>Expression</TableHeadCell>
            <TableHeadCell>Init</TableHeadCell>
            <TableHeadCell>
              <span className="sr-only">Actions</span>
            </TableHeadCell>
          </TableHeader>
          <TableBody>
            {names.map((name) => {
              const hasSchema = value.carrySchema?.[name] !== undefined;
              const showSchema = renderSchema !== undefined && (hasSchema || schemaOpen[name]);
              return (
                <TableRow key={name} className="items-start gap-2 py-1.5 hover:bg-transparent">
                  <TableCell className="flex-col items-stretch">
                    {renderName({
                      name,
                      taken: names.filter((n) => n !== name),
                      onRename: (next) => rename(name, next),
                      ariaLabel: `Carried value ${name} name`,
                    })}
                  </TableCell>
                  <TableCell className="flex-col items-stretch">
                    {renderExpression({
                      name,
                      column: 'expression',
                      value: value.carry?.[name] ?? '',
                      onChange: (v) => setExpr('carry', name, v),
                      ariaLabel: `Carried value ${name} expression`,
                      placeholder: 'e.g. stages.review.output.comments',
                    })}
                  </TableCell>
                  <TableCell className="flex-col items-stretch">
                    {renderExpression({
                      name,
                      column: 'init',
                      value: value.carryInit?.[name] ?? '',
                      onChange: (v) => setExpr('carryInit', name, v),
                      ariaLabel: `Carried value ${name} initial value`,
                      placeholder: 'null',
                    })}
                  </TableCell>
                  <TableCell className="gap-0.5">
                    {renderSchema !== undefined ? (
                      <IconButton
                        icon="braces"
                        size="sm"
                        label={`Declare a type for ${name}`}
                        pressed={showSchema}
                        disabled={hasSchema}
                        onClick={() => setSchemaOpen((s) => ({ ...s, [name]: !s[name] }))}
                      />
                    ) : null}
                    <IconButton icon="trash" size="sm" label={`Remove carried value ${name}`} onClick={() => remove(name)} />
                  </TableCell>
                  {showSchema || renderIssues ? (
                    <TableCell className="col-span-full flex-col items-stretch gap-1.5 empty:hidden">
                      {showSchema
                        ? renderSchema({
                            name,
                            value: value.carrySchema?.[name],
                            onChange: (schema) =>
                              onChange({
                                ...value,
                                carrySchema: schema ? { ...(value.carrySchema ?? {}), [name]: schema } : withoutKey(value.carrySchema, name),
                              }),
                            ariaLabel: `Carried value ${name} JSON Schema`,
                          })
                        : null}
                      {renderIssues?.([`/carry/${name}`, `/carryInit/${name}`, `/carrySchema/${name}`], false)}
                    </TableCell>
                  ) : null}
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      ) : null}
      <div>
        <Button size="sm" variant="ghost" icon="plus" className="-ml-2" onClick={add}>
          {addLabel}
        </Button>
      </div>
      {renderIssues?.(['/carry', '/carryInit', '/carrySchema'], true)}
    </div>
  );
}
