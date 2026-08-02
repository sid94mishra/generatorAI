// ────────────────────────────────────────────────────────────────
// OpenAPI routes (DOC-01).
//
// Serves the OpenAPI document at `/api/openapi.json` and a minimal
// Swagger UI host page at `/api/docs`. We load Swagger UI from jsdelivr
// at page render time so we don't add bundling weight to the server —
// the HTML is ~1 KB, the CDN ships everything else.
//
// The Stoplight Elements alternative mentioned in the backlog is also
// CDN-friendly; Swagger UI was chosen because it renders the spec with
// zero configuration and is the de-facto default.
//
// Both endpoints intentionally skip API-key checks (even when
// `GENERATORAI_API_KEY` is set). Rationale: the spec is public-by-
// design — it describes, not executes. Anyone behind the localhost
// trust boundary can already read the route code; serving the spec
// openly matches that baseline.
// ────────────────────────────────────────────────────────────────

import { Router } from 'express';
import { OPENAPI_SPEC } from '../openapi/spec.js';

export function createOpenApiRoutes(): Router {
  const router = Router();

  router.get('/openapi.json', (_req, res) => {
    res.type('application/json').send(JSON.stringify(OPENAPI_SPEC, null, 2));
  });

  router.get('/docs', (_req, res) => {
    res.type('text/html').send(DOCS_HTML);
  });

  return router;
}

// Swagger UI shell. Keep this inline — externalizing adds a file
// without meaningful benefit and the HTML is stable.
const DOCS_HTML = `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>GeneratorAI API Reference</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
    <style>body{margin:0;padding:0}</style>
  </head>
  <body>
    <div id="swagger-ui"></div>
    <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
    <script>
      window.addEventListener('load', function () {
        window.ui = SwaggerUIBundle({
          url: '/api/openapi.json',
          dom_id: '#swagger-ui',
          deepLinking: true,
          presets: [SwaggerUIBundle.presets.apis],
          layout: 'BaseLayout',
        });
      });
    </script>
  </body>
</html>`;
