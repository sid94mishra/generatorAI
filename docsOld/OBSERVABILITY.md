# OpenTelemetry Observability Guide

GeneratorAI ships with full OpenTelemetry (OTel) integration for traces, metrics, and logs. All backend components are 100% free and open-source.

## Quick Start

### 1. Start the Observability Stack

```bash
cd docker/observability
docker compose up -d
```

This launches:

| Service          | URL                        | Purpose            |
|------------------|----------------------------|--------------------|
| OTel Collector   | `localhost:4318` (HTTP)    | Receives telemetry |
| Jaeger           | http://localhost:16686     | Distributed traces |
| Prometheus       | http://localhost:9090      | Metrics            |
| Loki             | http://localhost:3101      | Log aggregation    |
| Grafana          | http://localhost:3000      | Dashboards         |

### 2. Enable OTel in the Server

```bash
OTEL_ENABLED=true pnpm --filter @generatorai/server dev
```

Or set environment variables:

```env
OTEL_ENABLED=true
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318
OTEL_SERVICE_NAME=generatorai-server
OTEL_SAMPLE_RATE=1.0
OTEL_METRICS_EXPORT_INTERVAL_MS=60000
```

### 3. Enable OTel in the CLI

```bash
OTEL_ENABLED=true pnpm --filter @generatorai/cli cli chat start
```

## Architecture

```
┌─────────────────┐    OTLP/HTTP     ┌──────────────────┐
│ GeneratorAI      │ ───────────────► │  OTel Collector   │
│ (Server / CLI)   │                  │                   │
└─────────────────┘                  └─────┬──────┬──────┘
                                           │      │      │
                                    ┌──────┘      │      └──────┐
                                    ▼             ▼              ▼
                              ┌──────────┐ ┌───────────┐ ┌──────────┐
                              │  Jaeger   │ │Prometheus │ │   Loki   │
                              │ (traces)  │ │ (metrics) │ │  (logs)  │
                              └─────┬─────┘ └─────┬─────┘ └─────┬───┘
                                    │             │              │
                                    └──────┬──────┘──────────────┘
                                           ▼
                                    ┌──────────────┐
                                    │   Grafana     │
                                    │ (dashboards)  │
                                    └──────────────┘
```

## Instrumented Components

### Traces (Spans)

| Span Name                       | Package            | Description                          |
|---------------------------------|--------------------|--------------------------------------|
| `copilot.initialize`            | copilot-bridge     | Copilot SDK client startup           |
| `copilot.stop`                  | copilot-bridge     | Copilot SDK client shutdown          |
| `copilot.createConversation`    | copilot-bridge     | Create a new Copilot session         |
| `copilot.sendPrompt`            | copilot-bridge     | Send a prompt (fire-and-forget)      |
| `copilot.sendPromptAndWait`     | copilot-bridge     | Send prompt and wait for response    |
| `workflow.createRun`            | core               | Create a new workflow run            |
| `workflow.startRun`             | core               | Start DAG execution                  |
| `workflow.cancelRun`            | core               | Cancel a running workflow             |
| `workflow.stage.execute`        | core               | Execute a single stage               |
| HTTP auto-instrumentation       | server             | All Express routes (automatic)       |

### Metrics

| Metric Name                        | Type         | Package        | Description                        |
|------------------------------------|--------------|----------------|------------------------------------|
| `http.server.request.duration`     | Histogram    | server         | HTTP request duration (ms)         |
| `http.server.request.total`        | Counter      | server         | Total HTTP requests                |
| `http.server.active_requests`      | UpDownCounter| server         | In-flight HTTP requests            |
| `copilot.prompts.total`            | Counter      | copilot-bridge | Total prompts sent                 |
| `copilot.prompt.duration_ms`       | Histogram    | copilot-bridge | Prompt round-trip time (ms)        |
| `copilot.active_sessions`          | UpDownCounter| copilot-bridge | Active Copilot sessions            |
| `workflow.runs.total`              | Counter      | core           | Workflow runs created              |
| `workflow.run.duration_ms`         | Histogram    | core           | Workflow run duration (ms)         |
| `workflow.active_runs`             | UpDownCounter| core           | Currently running workflows        |
| `workflow.stages.total`            | Counter      | core           | Stage executions started           |
| `workflow.stage.duration_ms`       | Histogram    | core           | Stage execution duration (ms)      |
| `eventbus.events.emitted`         | Counter      | core           | Events emitted through EventBus    |
| `eventbus.subscriber.errors`      | Counter      | core           | Subscriber errors caught           |
| `sse.active_connections`           | UpDownCounter| streaming      | Active SSE connections             |
| `sse.events.pushed`               | Counter      | streaming      | Events pushed via SSE              |
| `db.queries.total`                | Counter      | db             | Total DB queries executed          |
| `db.query.duration_ms`            | Histogram    | db             | DB query duration (ms)             |

### Logs

All Pino log records are automatically enriched with trace context:

```json
{
  "level": 30,
  "msg": "Request completed",
  "trace_id": "abc123...",
  "span_id": "def456...",
  "trace_flags": "01"
}
```

When `pino-opentelemetry-transport` is configured, logs are shipped to the OTel Collector and forwarded to Loki.

## Configuration Reference

### Environment Variables

| Variable                         | Default                    | Description                       |
|----------------------------------|----------------------------|-----------------------------------|
| `OTEL_ENABLED`                   | `false`                    | Enable OTel SDK                   |
| `OTEL_EXPORTER_OTLP_ENDPOINT`   | `http://localhost:4318`    | OTLP HTTP endpoint                |
| `OTEL_SERVICE_NAME`             | `generatorai-server`       | Service name in traces            |
| `OTEL_SAMPLE_RATE`             | `1.0`                      | Trace sampling rate (0.0–1.0)     |
| `OTEL_METRICS_EXPORT_INTERVAL_MS`| `60000`                   | Metrics export interval (ms)      |

### AppConfig (`otel` section)

```typescript
otel: {
  enabled: boolean;      // default: false
  endpoint: string;      // default: 'http://localhost:4318'
  serviceName: string;   // default: 'generatorai-server'
  sampleRate: number;    // default: 1.0 (0.0 to 1.0)
  metricsExportIntervalMs: number; // default: 60000
}
```

## Grafana Access

Default credentials: `admin` / `admin`

Pre-configured data sources:
- **Jaeger** — for trace search and visualization
- **Prometheus** — for metric queries and charts
- **Loki** — for log search correlated with traces

## Local Setup Guide (Step-by-Step)

This guide walks through setting up the full observability stack on a local Windows/macOS/Linux machine from scratch.

### Prerequisites

| Requirement   | Minimum Version | Verify With            |
|---------------|-----------------|------------------------|
| Node.js       | 20+             | `node --version`       |
| pnpm          | 9+              | `pnpm --version`       |
| Docker Desktop| 24+             | `docker --version`     |
| Docker Compose| v2+             | `docker compose version`|

### Step 1 — Clone & Install Dependencies

```bash
git clone <repo-url> GeneratorAI
cd GeneratorAI
pnpm install
```

### Step 2 — Start the Observability Stack

```bash
cd docker/observability
docker compose up -d
```

Verify all 5 containers are running:

```bash
docker compose ps
```

Expected output — all services should show `running`:

| Service        | Ports                                            |
|----------------|--------------------------------------------------|
| otel-collector | 0.0.0.0:4317→4317, 0.0.0.0:4318→4318, 8888→8888|
| jaeger         | 0.0.0.0:16686→16686                              |
| prometheus     | 0.0.0.0:9090→9090                                |
| loki           | 0.0.0.0:3101→3100                                |
| grafana        | 0.0.0.0:3000→3000                                |

> **Note:** Loki is mapped to host port **3101** (not 3100) to avoid conflicts with the GeneratorAI server which uses port 3100.

### Step 3 — Start the Server with OTel Enabled

**Linux / macOS:**

```bash
cd ../../   # back to repo root
OTEL_ENABLED=true pnpm --filter @generatorai/server dev
```

**Windows PowerShell:**

```powershell
cd ..\..\   # back to repo root
$env:OTEL_ENABLED="true"
$env:OTEL_EXPORTER_OTLP_ENDPOINT="http://localhost:4318"
$env:OTEL_SERVICE_NAME="generatorai-server"
pnpm --filter @generatorai/server dev
```

You should see in the terminal:

```
[OTel] SDK initialised — service=generatorai-server endpoint=http://localhost:4318 sampleRate=1
```

### Step 4 — Start the Web Frontend

In a separate terminal:

```bash
pnpm --filter @generatorai/web dev
```

The frontend starts at http://localhost:5173 and proxies API calls to the server on port 3100.

### Step 5 — Generate Traffic

Open http://localhost:5173 in your browser and navigate through the app:
- Click **Dashboard** to see stats
- Click **Workflows** to load workflow templates
- Start a chat session or workflow run

Each interaction generates traces and metrics that flow through the OTel pipeline.

### Step 6 — Verify the Pipeline

#### 6a. Server Logs — Trace Context

Check server terminal output. Every log entry should include `trace_id`, `span_id`, and `trace_flags`:

```json
{"level":30,"time":1713...,"msg":"Request completed","trace_id":"abc123...","span_id":"def456...","trace_flags":"01"}
```

#### 6b. Jaeger — Distributed Traces

1. Open http://localhost:16686
2. Select **Service** → `generatorai-server`
3. Click **Find Traces** — you should see a scatter plot of recent traces
4. Click any trace to see the span waterfall with attributes:
   - `http.method`, `http.target`, `http.status_code`
   - `http.request_id` (unique per request)
   - `deployment.environment`, `service.version`

#### 6c. Prometheus — Metrics

1. Open http://localhost:9090
2. Click the *metrics explorer* icon (globe) next to the expression field
3. Look for metrics prefixed with `generatorai_`:
   - `generatorai_http_server_request_total`
   - `generatorai_http_server_request_duration_milliseconds_*`
   - `generatorai_http_server_active_requests`
   - `generatorai_db_queries_total`
   - `generatorai_db_query_duration_ms_milliseconds_*`
4. Type a metric name in the expression box and click **Execute** to see data

#### 6d. Grafana — Dashboards & Explore

1. Open http://localhost:3000 (no login needed — anonymous admin access)
2. Go to **Connections → Data sources** — verify Jaeger, Prometheus, and Loki are listed
3. Go to **Explore** and select **Prometheus** as the datasource
4. Type `generatorai_http_server_request_total` and click **Run query**
5. You should see a graph of HTTP request counts over time

### Step 7 — (Optional) Enable OTel in CLI

```bash
OTEL_ENABLED=true pnpm --filter @generatorai/cli cli chat start
```

### Stopping the Stack

```bash
cd docker/observability
docker compose down          # stop and remove containers
docker compose down -v       # also remove data volumes
```

### Troubleshooting

| Issue                               | Solution                                                        |
|-------------------------------------|-----------------------------------------------------------------|
| Port 3000 already in use            | Another Grafana/service on 3000; change Grafana port in compose |
| Port 3100 conflict (Loki)           | Already mapped to 3101; ensure no other service on 3101         |
| Server logs show no trace context   | Check `OTEL_ENABLED=true` is set before starting the server     |
| Jaeger shows no services            | Ensure OTel Collector container is running and server is sending |
| Prometheus shows empty metrics      | Wait 30–60s for first scrape; check targets at `/targets`       |
| Docker containers won't start       | Run `docker compose logs <service>` to diagnose                 |
| `OTEL_EXPORTER_OTLP_ENDPOINT` error| Ensure OTel Collector is running on port 4318                   |

## Production Recommendations

1. **Sampling**: Set `OTEL_SAMPLE_RATE=0.1` (10%) in production to reduce volume
2. **Batch export**: Already configured via `BatchSpanProcessor`
3. **Resource limits**: Set memory limits on OTel Collector in Docker
4. **Retention**: Adjust Prometheus `--storage.tsdb.retention.time` (default: 7 days)
5. **Alerts**: Configure Grafana alerting rules for key metrics

## Disabling Telemetry

Simply omit `OTEL_ENABLED=true` or set it to `false`. All OTel APIs are safe no-ops when the SDK is not initialized — zero overhead.
