const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');

const otlpBase =
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://127.0.0.1:4318';

const traceExporter = new OTLPTraceExporter({ url: `${otlpBase}/v1/traces` });
const metricExporter = new OTLPMetricExporter({ url: `${otlpBase}/v1/metrics` });

const sdk = new NodeSDK({
  serviceName: process.env.OTEL_SERVICE_NAME || 'pretzel-backend',
  traceExporter,
  metricReader: new PeriodicExportingMetricReader({
    exporter: metricExporter,
    exportIntervalMillis: 15000,
  }),
  instrumentations: [getNodeAutoInstrumentations()],
});

sdk.start();

process.on('SIGTERM', () => {
  sdk
    .shutdown()
    .finally(() => process.exit(0));
});
