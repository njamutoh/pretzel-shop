# Runbook: [ short title ]

## Scope

Describe the failure class this runbook covers.

Example:

This runbook covers a dependency outage or degraded dependency path in the Pretzel Shop application. It should help an engineer confirm the symptom, inspect Grafana signals, query Prometheus/Loki/Tempo, apply mitigation, and verify recovery.

This runbook does **not** replace an RCA. Incident-specific timelines, decisions, and follow-up action items belong in `rcas/`.

If this issue belongs to a more specific runbook, use that instead:

* `runbooks/redis-unavailable.md`
* `runbooks/postgres-unavailable.md`

## Symptoms

* User-visible:

  * Example: API request fails, hangs, or times out.
  * Example: frontend workflow is broken while some other routes still work.

* Metrics/logs:

  * Example: p95 latency rises.
  * Example: request traffic continues but one route behaves differently.
  * Example: Loki shows Redis, Postgres, connection, or dependency-related errors.

## Severity

* Continue alone when:

  * This is a local development drill.
  * The issue is limited to your local Docker Compose environment.
  * The mitigation is known and low-risk, such as restarting a stopped local container.

* Escalate when:

  * This is a shared, staging, or production environment.
  * Customer-facing routes are failing or timing out.
  * The root cause is unclear after the first investigation pass.
  * Restarting the dependency does not restore service.
  * There are signs of data loss, corruption, repeated crashes, or infrastructure/network failure.

## Prerequisites

* Pretzel Shop repository is available at:

```bash
/home/devopsy/pretzel-shop
```

* Observability stack is running:

```bash
cd /home/devopsy/pretzel-shop/observability
docker compose up -d
```

* App dependencies are running:

```bash
cd /home/devopsy/pretzel-shop
docker compose up -d
```

* Docker backend container is stopped if using the manually instrumented backend:

```bash
docker compose stop backend
```

* Manual backend is running with OpenTelemetry:

```bash
cd /home/devopsy/pretzel-shop/backend

OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
OTEL_SERVICE_NAME=pretzel-backend \
node -r ./instrumentation.js server.js
```

* Grafana is available locally at:

```text
http://localhost:3000
```

or from Windows browser using the current VM IP:

```text
http://<VM_IP>:3000
```

* Backend service name in traces/metrics:

```text
pretzel-backend
```

## Local quick checks

List Pretzel-related containers:

```bash
docker ps -a --filter name=pretzel
```

Check backend health:

```bash
curl -s -o /dev/null -w "health %{http_code} time=%{time_total}s\n" \
  http://localhost:3001/health
```

Check product route:

```bash
curl --max-time 10 -s -o /dev/null -w "products %{http_code} time=%{time_total}s\n" \
  http://localhost:3001/api/products
```

Check cart route:

```bash
curl --max-time 10 -s -o /dev/null -w "cart POST %{http_code} time=%{time_total}s\n" \
  -X POST http://localhost:3001/api/cart \
  -H "Content-Type: application/json" \
  -d '{"productId":1,"quantity":1}'
```

Check OpenTelemetry Collector metrics endpoint:

```bash
curl -s http://localhost:8889/metrics \
  | grep -Ei "otel_http_server_duration|pretzel|http" \
  | head -100
```

## Grafana

1. Open dashboard: **Pretzel Shop — Golden Signals**.
2. Note which Golden Signal moved first:

   * Latency
   * Traffic
   * Errors
   * Saturation
3. Move to **Explore** for deeper investigation.

## Prometheus

Use datasource: **Prometheus**.

This project’s verified HTTP server metrics use these names:

```text
otel_http_server_duration_milliseconds_count
otel_http_server_duration_milliseconds_bucket
otel_http_server_duration_milliseconds_sum
```

Useful labels observed locally:

```text
http_route
http_status_code
job
```

### Request rate by route

```promql
sum by (http_route) (rate(otel_http_server_duration_milliseconds_count[5m]))
```

### p95 latency

```promql
histogram_quantile(
  0.95,
  sum by (le) (rate(otel_http_server_duration_milliseconds_bucket[5m]))
)
```

### p95 latency by route

```promql
histogram_quantile(
  0.95,
  sum by (le, http_route) (rate(otel_http_server_duration_milliseconds_bucket[5m]))
)
```

### Status-code breakdown

```promql
sum by (http_status_code) (rate(otel_http_server_duration_milliseconds_count[5m]))
```

### Non-2xx ratio

```promql
sum(rate(otel_http_server_duration_milliseconds_count{http_status_code!~"2.."}[5m]))
/
sum(rate(otel_http_server_duration_milliseconds_count[5m]))
```

### 5xx ratio

This query is useful when the backend completes requests as HTTP 5xx:

```promql
sum(rate(otel_http_server_duration_milliseconds_count{http_status_code=~"5.."}[5m]))
/
sum(rate(otel_http_server_duration_milliseconds_count[5m]))
```

Note: In the local Redis drill, `POST /api/cart` timed out with curl status `000` instead of returning a completed HTTP 500. In that case, the 5xx ratio may not show the failure clearly. Use timeout behavior, p95 latency, route comparison, and Loki logs as stronger evidence.

## Loki

Use datasource: **Loki**.

Local labels observed in this project:

```text
container
service_name
```

Avoid broad or incorrect queries such as:

```logql
{job="docker"}
```

Start with Pretzel-related containers:

```logql
{container=~".*pretzel.*"}
```

Search for Redis-related logs:

```logql
{container=~".*pretzel.*"} |= "Redis"
```

Search for cart-related logs:

```logql
{container=~".*pretzel.*"} |= "[Cart]"
```

Search for Postgres-related logs:

```logql
{container=~".*pretzel.*"} |= "Postgres"
```

Search for general dependency or error signals:

```logql
{container=~".*pretzel.*"} |~ "(?i)redis|postgres|cart|database|ECONNREFUSED|error|failed|exception"
```

If Tempo or Grafana usage-report noise appears, exclude it when it is unrelated:

```logql
{container=~".*pretzel.*"} != "tempo-usage-report"
```

## Tempo

Use datasource: **Tempo**.

Search by service name:

```text
pretzel-backend
```

Use the outage time window, then inspect traces around slow or failed requests.

Look for:

* HTTP route or path
* Error status
* Dependency connection errors
* Slow spans
* Redis or database-related client spans, if instrumentation captured them

Do not paste LogQL into Tempo. LogQL belongs in Loki. Tempo is for traces/spans.

## Mitigation

Write ordered mitigation steps for this failure class.

Use one command per block.

Example: restart Redis:

```bash
docker start pretzel-shop-redis-1
```

Example: restart Postgres:

```bash
docker start pretzel-shop-postgres-1
```

If the container name is different, find it first:

```bash
docker ps -a --filter name=pretzel
```

## Verification

Verify the user-facing path that failed.

Example: products route should recover after Postgres is restored:

```bash
curl --max-time 10 -s -o /dev/null -w "products %{http_code} time=%{time_total}s\n" \
  http://localhost:3001/api/products
```

Example: cart route should recover after Redis is restored:

```bash
curl --max-time 10 -s -o /dev/null -w "cart POST %{http_code} time=%{time_total}s\n" \
  -X POST http://localhost:3001/api/cart \
  -H "Content-Type: application/json" \
  -d '{"productId":1,"quantity":1}'
```

Expected result:

```text
HTTP 200 or 201 for recovered routes.
Response time should return to normal.
Grafana error/latency behavior should settle after recovery.
```

## After mitigation

* [ ] Update or create an RCA under `rcas/` if this was customer-impacting, production-like, or important enough to review.
* [ ] Add missing PromQL or LogQL queries back into this runbook.
* [ ] Create follow-up tasks for code, alerting, dashboards, readiness checks, or dependency timeout handling.
* [ ] Confirm whether `/health` is shallow or dependency-aware.
* [ ] Document any gap between expected lesson behavior and actual local behavior.

## Related links

* `runbooks/redis-unavailable.md`
* `runbooks/postgres-unavailable.md`
* `rcas/`
* Grafana local default: `http://localhost:3000`
* Prometheus datasource: Grafana Explore → Prometheus
* Loki datasource: Grafana Explore → Loki
* Tempo datasource: Grafana Explore → Tempo
* LastDevOps Basics lessons 9–11

