// ────────────────────────────────────────────────────────────────
// Walk a zod schema tree. Used by the "every field is described" test, the
// unknown-key hint vocabulary and the FIELDS.md generator.
// ────────────────────────────────────────────────────────────────

import { z } from 'zod';

export interface FieldVisit {
  /** Dotted path of the field, with `[]` for array elements and `{}` for record values. */
  path: string;
  name: string;
  /** The property schema as declared (wrappers included). */
  schema: z.ZodTypeAny;
  /** The object that declares the field. */
  parent: z.ZodObject<z.ZodRawShape>;
}

/** Strip optional / nullable / default / effects / lazy / pipeline / branded / readonly wrappers. */
export function unwrap(schema: z.ZodTypeAny): z.ZodTypeAny {
  let s = schema;
  for (let i = 0; i < 20; i++) {
    if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) s = s.unwrap();
    else if (s instanceof z.ZodDefault) s = s._def.innerType;
    else if (s instanceof z.ZodEffects) s = s._def.schema;
    else if (s instanceof z.ZodLazy) s = s._def.getter();
    else if (s instanceof z.ZodPipeline) s = s._def.in;
    else if (s instanceof z.ZodBranded) s = s._def.type;
    else if (s instanceof z.ZodReadonly) s = s._def.innerType;
    else break;
  }
  return s;
}

/** The description on the schema or on any wrapper around the core type. */
export function descriptionOf(schema: z.ZodTypeAny): string | undefined {
  let s: z.ZodTypeAny = schema;
  for (let i = 0; i < 20; i++) {
    if (s.description) return s.description;
    const inner = unwrapOnce(s);
    if (!inner) return undefined;
    s = inner;
  }
  return undefined;
}

function unwrapOnce(s: z.ZodTypeAny): z.ZodTypeAny | undefined {
  if (s instanceof z.ZodOptional || s instanceof z.ZodNullable) return s.unwrap();
  if (s instanceof z.ZodDefault) return s._def.innerType;
  if (s instanceof z.ZodEffects) return s._def.schema;
  if (s instanceof z.ZodLazy) return s._def.getter();
  if (s instanceof z.ZodPipeline) return s._def.in;
  if (s instanceof z.ZodBranded) return s._def.type;
  if (s instanceof z.ZodReadonly) return s._def.innerType;
  return undefined;
}

/**
 * Visit every object field reachable from `root`, depth first. A schema
 * reused in several places is visited at each path; recursion (a schema
 * inside itself) is cut at the second level.
 */
export function walkFields(root: z.ZodTypeAny, visit: (f: FieldVisit) => void, prefix = ''): void {
  const ancestors = new Set<z.ZodTypeAny>();
  const go = (schema: z.ZodTypeAny, path: string) => {
    const s = unwrap(schema);
    if (ancestors.has(s)) return;
    ancestors.add(s);
    if (s instanceof z.ZodObject) {
      for (const [name, prop] of Object.entries(s.shape as Record<string, z.ZodTypeAny>)) {
        const p = path ? `${path}.${name}` : name;
        visit({ path: p, name, schema: prop, parent: s as z.ZodObject<z.ZodRawShape> });
        go(prop, p);
      }
    } else if (s instanceof z.ZodArray) {
      go(s.element, `${path}[]`);
    } else if (s instanceof z.ZodRecord) {
      go(s.valueSchema, `${path}{}`);
    } else if (s instanceof z.ZodUnion || s instanceof z.ZodDiscriminatedUnion) {
      const options = (s instanceof z.ZodUnion ? s.options : [...s.options.values()]) as z.ZodTypeAny[];
      for (const o of options) go(o, path);
    } else if (s instanceof z.ZodIntersection) {
      go(s._def.left, path);
      go(s._def.right, path);
    }
    ancestors.delete(s);
  };
  go(root, prefix);
}

/** Every field name in the tree (for "did you mean" hints). */
export function fieldNames(root: z.ZodTypeAny): Set<string> {
  const names = new Set<string>();
  walkFields(root, (f) => names.add(f.name));
  return names;
}
