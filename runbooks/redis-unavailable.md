# Runbook: Redis unavailable (cart failures)

## Scope

Redis is down, unreachable, stopped, or refusing connections.

Symptoms concentrate on cart routes such as:

* `POST /api/cart`
* `GET /api/cart`

Product catalog routes such as `/api/products` may still work because they depend on PostgreSQL, not Redis.

This runbook does **not** cover:

* Application bugs in cart logic
* Redis memory eviction tuning
* Redis persistence/data-loss analysis
* Full application process failure

**Important note:** The stock `/health` endpoint does not verify Redis availability. It can return `200` while cart functionality is broken.

## Symptoms

* `POST /api/cart` hangs, times out, or returns an error.
* `GET /api/cart` may hang, time out, or fail.
* Browser: cart does not load or add-to-cart fails.
* Product pages may still load normally.
* `GET /api/products` may continue returning `200`.
* Loki may show Redis-related logs, cart-related logs, or connection errors such as `ECONNREFUSED`.
* Prometheus may show increased latency or route-level differences between cart and product routes.

In the local drill, Redis outage behavior was:

```text
POST /api/cart -> curl status 000 after 10 seconds
GET /api/products -> 200 in ~0.05s
```

This means the cart request timed out instead of returning a completed HTTP `500`.

## Severity

* **Local / dev:** Continue alone. Restore the Redis container and verify cart recovery.
* **Shared staging:** Notify the team if the failure blocks testing or release validation.
* **Production:** Treat as customer-impacting for cart/checkout workflows. Escalate if mitigation does not restore cart within the SLO window, or if root cause is unclear.

Escalate immediately if:

* Redis repeatedly crashes after restart.
* Redis cannot be reached after container/network recovery.
* Cart failures continue after Redis is healthy.
* There are signs of data loss, connection exhaustion, or network partition.

## Prerequisites

* Pretzel Shop repository path:

```bash
/home/devopsy/pretzel-shop
```

* Observability stack running:

```bash
cd /home/devopsy/pretzel-shop/observability
docker compose up -d
```

* App dependencies running:

```bash
cd /home/devopsy/pretzel-shop
docker compose up -d
```

* Docker backend container stopped if using the manually instrumented backend:

```bash
docker compose stop backend
```

* Manual backend running with OpenTelemetry:

```bash
cd /home/devopsy/pretzel-shop/backend

OTEL_EXPORTER_OTLP_ENDPOINT=http://127.0.0.1:4318 \
OTEL_SERVICE_NAME=pretzel-backend \
node -r ./instrumentation.js server.js
```

* Grafana local default:

```text
http://localhost:3000
```

* From Windows browser, use the current VM IP:

```text
http://<VM_IP>:3000
```

* Backend service name:

```text
pretzel-backend
```

* Redis container name may be one of:

```text
pretzel-shop-redis-1
pretzel-shop-redis
```

Confirm the exact name before starting or stopping:

```bash
docker ps -a --filter name=redis
```

## Local quick checks

Check Redis container state:

```bash
docker ps -a --filter name=redis
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

Expected during Redis outage in this local setup:

```text
products 200 time=...
cart POST 000 time=10.000s
```

The `000` means curl timed out before receiving an HTTP response.

## Grafana

### Dashboard

Open:

```text
Pretzel Shop — Golden Signals
```

Look for movement in:

* Latency
* Traffic
* Errors
* Saturation

During the Redis drill, the strongest signal may be latency or timeout behavior rather than a completed `5xx` response.

## Prometheus

Use datasource: **Prometheus**.

This project’s verified HTTP server metrics are:

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

Use this only when the backend completes failed requests as HTTP `5xx`:

```promql
sum(rate(otel_http_server_duration_milliseconds_count{http_status_code=~"5.."}[5m]))
/
sum(rate(otel_http_server_duration_milliseconds_count[5m]))
```

In the local Redis drill, the cart request timed out with curl status `000` instead of returning a completed HTTP `500`. Because of that, the 5xx ratio query may not show the Redis failure clearly.

## Loki

Use datasource: **Loki**.

Local labels observed in this project:

```text
container
service_name
```

Do not use broad or unavailable labels such as:

```logql
{job="docker"}
```

Start with Pretzel-related logs:

```logql
{container=~".*pretzel.*"}
```

Redis-related logs:

```logql
{container=~".*pretzel.*"} |= "Redis"
```

Cart-related logs:

```logql
{container=~".*pretzel.*"} |= "[Cart]"
```

Broader dependency/error search:

```logql
{container=~".*pretzel.*"} |~ "(?i)redis|cart|ECONNREFUSED|error|failed|exception"
```

Useful observed evidence during the Redis drill:

```text
connect ECONNREFUSED 127.0.0.1:6379
```

After Redis restart, Loki may show Redis startup/readiness messages such as Redis starting and ready to accept connections.

If unrelated Tempo or Grafana usage-report logs appear, ignore them for this runbook unless they affect local observability.

## Tempo

Use datasource: **Tempo**.

Search for service:

```text
pretzel-backend
```

Use the outage time window and inspect traces around cart requests.

Look for:

* `POST /api/cart`
* Slow spans
* Error status
* Redis/client connection spans, if captured
* `ECONNREFUSED` or dependency-related attributes

Do not paste LogQL into Tempo. LogQL belongs in Loki. Tempo is for traces/spans.

## Mitigation

Start Redis.

First find the exact Redis container name:

```bash
docker ps -a --filter name=redis
```

Start Redis:

```bash
docker start pretzel-shop-redis-1
```

If your container is named differently, use the exact name:

```bash
docker start pretzel-shop-redis
```

Wait for Redis to be healthy or running:

```bash
docker ps --filter name=redis
```

If healthcheck exists:

```bash
docker inspect --format '{{.State.Health.Status}}' pretzel-shop-redis-1
```

If the container does not exist, recreate the stack from the repository root:

```bash
cd /home/devopsy/pretzel-shop
docker compose up -d redis
```

## Verification

Verify products still work:

```bash
curl --max-time 10 -s -o /dev/null -w "products %{http_code} time=%{time_total}s\n" \
  http://localhost:3001/api/products
```

Verify cart recovered:

```bash
curl --max-time 10 -s -o /dev/null -w "cart POST %{http_code} time=%{time_total}s\n" \
  -X POST http://localhost:3001/api/cart \
  -H "Content-Type: application/json" \
  -d '{"productId":1,"quantity":1}'
```

Expected after recovery:

```text
products 200 time=...
cart POST 200 time=...
```

or:

```text
cart POST 201 time=...
```

Confirm in Grafana:

* Latency settles.
* Cart requests stop timing out.
* Redis-related error logs stop appearing.
* Redis startup/readiness logs appear in Loki after restart.

## After mitigation

* [ ] If this was a real or production-like incident, create an RCA under `rcas/`.
* [ ] Add missing PromQL or LogQL queries to this runbook.
* [ ] Consider adding a readiness endpoint that verifies Redis availability for cart-dependent workloads.
* [ ] Consider adding timeout handling around Redis calls so cart requests fail quickly instead of hanging.
* [ ] Consider adding better cart error logging if backend logs do not clearly show the dependency failure.
* [ ] Consider alerting on cart timeout/error ratio after baseline behavior is known.

## Related links

* `runbooks/README.md`
* `runbooks/TEMPLATE.md`
* `runbooks/postgres-unavailable.md`
* `rcas/`
* `backend/docker-compose.yml` — Redis service definition
* Grafana local default: `http://localhost:3000`
* LastDevOps Basics: lessons 9, 10, and 11

