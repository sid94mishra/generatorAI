import { parseArgs } from 'node:util';

/** Extra native test origins are opt-in; keep the web sandbox's default origin. */
export function sandboxCorsOrigins(webPort, env = process.env) {
  const origins = [`http://localhost:${webPort}`];
  for (const value of (env.GENERATORAI_SANDBOX_CORS_ORIGINS ?? '').split(',').filter(Boolean)) {
    const origin = value.trim();
    const url = new URL(origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== origin) {
      throw new Error('Sandbox CORS entries must be explicit HTTP(S) origins without paths or credentials');
    }
    origins.push(origin);
  }
  return [...new Set(origins)].join(',');
}

/** Resolve isolated sandbox ports without starting any services. */
export function sandboxOptions(args = process.argv.slice(2), env = process.env) {
  const { values } = parseArgs({
    args,
    options: {
      port: { type: 'string' },
      'web-port': { type: 'string' },
      help: { type: 'boolean' },
      'dry-run': { type: 'boolean' },
      clean: { type: 'boolean' },
      'real-harness': { type: 'boolean' },
    },
  });
  const port = (value, name, maximum = 65535) => {
    if (!/^\d+$/.test(String(value)) || Number(value) < 1 || Number(value) > maximum) {
      throw new Error(`${name} must be an integer from 1 to ${maximum}`);
    }
    return Number(value);
  };
  const serverPort = port(values.port ?? env.GENERATORAI_SANDBOX_PORT ?? 3197, 'sandbox port', 65534);
  const widgetPort = serverPort + 1;
  const webPort = port(values['web-port'] ?? env.GENERATORAI_SANDBOX_WEB_PORT ?? serverPort + 2000, 'sandbox web port');
  if (webPort === serverPort || webPort === widgetPort) {
    throw new Error('sandbox web port must differ from the API and widget ports');
  }
  return { serverPort, widgetPort, webPort };
}
