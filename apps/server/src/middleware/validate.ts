// ────────────────────────────────────────────────────────────────
// Zod Validation Middleware — validates body, query, params
// ────────────────────────────────────────────────────────────────

import type { Request, Response, NextFunction } from 'express';
import type { ZodSchema, ZodError } from 'zod';

/**
 * Formats Zod errors into a field-level error map.
 */
function formatZodErrors(error: ZodError): Record<string, string[]> {
  const fields: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const path = issue.path.join('.') || '_root';
    if (!fields[path]) {
      fields[path] = [];
    }
    fields[path]!.push(issue.message);
  }
  return fields;
}

/**
 * Validates `req.body` against the given Zod schema.
 * On success, replaces `req.body` with the parsed (stripped) output.
 * On failure, returns 400 with `{ error: { code, message, fields } }`.
 */
export function validate(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (result.success) {
      req.body = result.data;
      next();
    } else {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Request body validation failed',
          fields: formatZodErrors(result.error),
        },
      });
    }
  };
}

/**
 * Validates `req.query` against the given Zod schema.
 */
export function validateQuery(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.query);
    if (result.success) {
      req.validatedQuery = result.data;
      next();
    } else {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Query parameter validation failed',
          fields: formatZodErrors(result.error),
        },
      });
    }
  };
}

/**
 * Validates `req.params` against the given Zod schema.
 */
export function validateParams(schema: ZodSchema) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.params);
    if (result.success) {
      req.validatedParams = result.data;
      next();
    } else {
      res.status(400).json({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Path parameter validation failed',
          fields: formatZodErrors(result.error),
        },
      });
    }
  };
}
