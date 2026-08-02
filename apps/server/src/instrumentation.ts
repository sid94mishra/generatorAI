// ────────────────────────────────────────────────────────────────
// OpenTelemetry SDK Initialisation
// MUST be loaded before any other application module via --import
// ────────────────────────────────────────────────────────────────

import { NodeSDK } from '@opentelemetry/sdk-node';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-node';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { PinoInstrumentation } from '@opentelemetry/instrumentation-pino';
import { TraceIdRatioBasedSampler, AlwaysOnSampler } from '@opentelemetry/sdk-trace-node';
import { diag, DiagConsoleLogger, DiagLogLevel } from '@opentelemetry/api';

// ── Feature flag ─────────────────────────────────────────────
const otelEnabled = process.env['OTEL_ENABLED'] === 'true';

if (otelEnabled) {
  // Optional: enable OTel internal diagnostics
  if (process.env['OTEL_DEBUG'] === 'true') {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG);
  }

  const serviceName = process.env['OTEL_SERVICE_NAME'] ?? 'generatorai-server';
  const serviceVersion = process.env['npm_package_version'] ?? '0.1.0';
  const environment = process.env['NODE_ENV'] ?? 'development';
  const endpoint = process.env['OTEL_EXPORTER_OTLP_ENDPOINT'] ?? 'http://localhost:4318';
  const sampleRate = parseFloat(process.env['OTEL_SAMPLE_RATE'] ?? '1.0');
  const metricsInterval = parseInt(process.env['OTEL_METRICS_EXPORT_INTERVAL_MS'] ?? '60000', 10);

  const sampler = sampleRate < 1.0
    ? new TraceIdRatioBasedSampler(sampleRate)
    : new AlwaysOnSampler();

  const sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
      'deployment.environment': environment,
    }),
    sampler,
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${endpoint}/v1/traces` }),
      ),
    ],
    metricReader: new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
      exportIntervalMillis: metricsInterval,
    }),
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new PinoInstrumentation(),
    ],
  });

  sdk.start();

  // Ensure telemetry is flushed on process exit
  const shutdownOtel = async () => {
    try {
      await sdk.shutdown();
    } catch {
      // swallow — process is exiting
    }
  };

  process.on('SIGTERM', () => void shutdownOtel());
  process.on('SIGINT', () => void shutdownOtel());

  // eslint-disable-next-line no-console
  console.log(
    `[OTel] SDK initialised — service=${serviceName} endpoint=${endpoint} sampleRate=${sampleRate}`,
  );
}
