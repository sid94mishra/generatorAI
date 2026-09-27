import { parseArgs } from 'node:util';

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
