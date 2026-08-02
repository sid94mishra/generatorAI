// ────────────────────────────────────────────────────────────────
// jsonSchemaToZodShape — converts a domain tool's JSON Schema
// (`parametersSchema`) into a Zod "raw shape" (an object mapping each
// property name to a Zod schema).
//
// The Claude Agent SDK's `tool()` / `createSdkMcpServer()` require the
// tool `inputSchema` to be a Zod raw shape (or Zod object). As of
// @modelcontextprotocol/sdk v1.29 this is validated strictly and a raw
// JSON Schema object is rejected ("inputSchema must be a Zod schema or
// raw shape"). Our domain tools are provider-agnostic and describe
// parameters as JSON Schema, so we translate here at the boundary.
//
// Only the JSON Schema features our tools actually use are handled;
// anything unknown degrades gracefully to `z.any()`. The domain handler
// still performs authoritative validation, so this schema exists purely
// to inform the model of each tool's parameters.
// ────────────────────────────────────────────────────────────────

import { z, type ZodRawShape, type ZodTypeAny } from 'zod';

interface JsonSchemaNode {
  type?: string | string[];
  description?: string;
  enum?: unknown[];
  items?: JsonSchemaNode;
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean | JsonSchemaNode;
  [key: string]: unknown;
}

/** Convert a single JSON Schema node into a Zod type. */
function nodeToZod(node: JsonSchemaNode | undefined): ZodTypeAny {
  if (!node || typeof node !== 'object') return z.any();

  // enum (with or without an explicit type) → z.enum for all-string enums,
  // otherwise a union of literals.
  if (Array.isArray(node.enum) && node.enum.length > 0) {
    const values = node.enum;
    let zenum: ZodTypeAny;
    if (values.every((v) => typeof v === 'string')) {
      zenum = z.enum(values as [string, ...string[]]);
    } else {
      const literals = values.map((v) => z.literal(v as never)) as unknown as [
        ZodTypeAny,
        ZodTypeAny,
        ...ZodTypeAny[],
      ];
      zenum = literals.length === 1 ? literals[0]! : z.union(literals);
    }
    return node.description ? zenum.describe(node.description) : zenum;
  }

  // A type can be a union like ['string', 'null'].
  const type = Array.isArray(node.type) ? node.type.find((t) => t !== 'null') ?? 'any' : node.type;

  let schema: ZodTypeAny;
  switch (type) {
    case 'string':
      schema = z.string();
      break;
    case 'number':
    case 'integer':
      schema = z.number();
      break;
    case 'boolean':
      schema = z.boolean();
      break;
    case 'array':
      schema = z.array(nodeToZod(node.items));
      break;
    case 'object': {
      if (node.properties && Object.keys(node.properties).length > 0) {
        schema = z.object(objectShape(node)).passthrough();
      } else {
        schema = z.record(z.any());
      }
      break;
    }
    case 'null':
      schema = z.null();
      break;
    default:
      schema = z.any();
      break;
  }

  // Nullable when the type list included 'null'.
  if (Array.isArray(node.type) && node.type.includes('null')) {
    schema = schema.nullable();
  }
  return node.description ? schema.describe(node.description) : schema;
}

/** Build a raw shape ({ key: ZodType }) from an object-typed schema node. */
function objectShape(node: JsonSchemaNode): ZodRawShape {
  const props = node.properties ?? {};
  const required = new Set(node.required ?? []);
  const shape: ZodRawShape = {};
  for (const [key, propSchema] of Object.entries(props)) {
    const zodType = nodeToZod(propSchema);
    shape[key] = required.has(key) ? zodType : zodType.optional();
  }
  return shape;
}

/**
 * Convert a tool's `parametersSchema` (JSON Schema, typically
 * `{ type: 'object', properties, required }`) into a Zod raw shape.
 * Returns an empty shape for tools with no parameters.
 */
export function jsonSchemaToZodShape(parametersSchema: unknown): ZodRawShape {
  if (!parametersSchema || typeof parametersSchema !== 'object') return {};
  const node = parametersSchema as JsonSchemaNode;
  if (node.properties && typeof node.properties === 'object') {
    return objectShape(node);
  }
  return {};
}
