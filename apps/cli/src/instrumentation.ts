// CLI OTel SDK Bootstrap — must be loaded before all other imports
// via:  tsx --import ./src/instrumentation.ts src/index.tsx
// Feature-flagged by OTEL_ENABLED=true (disabled by default).

export {}; // Ensure this is treated as a module for top-level await

const isEnabled = process.env['OTEL_ENABLED'] === 'true';

if (isEnabled) {
  const { NodeSDK } = await import('@opentelemetry/sdk-node');
  const { resourceFromAttributes } = await import('@opentelemetry/resources');
  const { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } = await import('@opentelemetry/semantic-conventions');
  const { OTLPTraceExporter } = await import('@opentelemetry/exporter-trace-otlp-proto');
  const { BatchSpanProcessor } = await import('@opentelemetry/sdk-trace-node');
  const { HttpInstrumentation } = await import('@opentelemetry/instrumentation-http');
  const { PinoInstrumentation } = await import('@opentelemetry/instrumentation-pino');
  const { TraceIdRatioBasedSampler, AlwaysOnSampler } = await import('@opentelemetry/sdk-trace-node');

  const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318';
  const serviceName = process.env['OTEL_SERVICE_NAME'] ?? 'generatorai-cli';
  const sampleRate = parseFloat(process.env['OTEL_SAMPLE_RATE'] ?? '1.0');

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: '0.1.0',
    ['deployment.environment']: process.env['NODE_ENV'] ?? 'development',
  });

  const traceExporter = new OTLPTraceExporter({
    url: `${endpoint}/v1/traces`,
  });

  const sampler = sampleRate < 1
    ? new TraceIdRatioBasedSampler(sampleRate)
    : new AlwaysOnSampler();

  const sdk = new NodeSDK({
    resource,
    spanProcessors: [new BatchSpanProcessor(traceExporter)],
    sampler,
    instrumentations: [
      new HttpInstrumentation(),
      new PinoInstrumentation(),
    ],
  });

  sdk.start();

  const shutdown = async () => {
    await sdk.shutdown();
  };

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}
