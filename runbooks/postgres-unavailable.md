# Runbook: PostgreSQL unavailable

## Scope

PostgreSQL is down, unreachable, stopped, unhealthy, or refusing connections.

Symptoms usually affect routes that depend on the database, especially:

* `GET /api/products`
* `GET /api/products/:id`
* Order placement routes
* Any backend route using the PostgreSQL connection pool

This runbook does **not** cover:

* Slow queries
* Database connection pool exhaustion
* Disk-full issues on Postgres
* Data corruption
* Lost database volumes
* Schema migration failures

Those should become separate runbooks once they are observed.

**Important note:** The stock `/health` endpoint may still return `200` even while PostgreSQL-backed routes are broken. Treat `/health` as a shallow process check unless the application has a deeper readiness endpoint.

## Symptoms

* `GET /api/products` returns `500`, hangs, or times out.
* `GET /api/products/:id` may fail.
* Order placement may fail if it writes to PostgreSQL.
* Browser: product catalog does not load.
* Cart routes may still work if Redis is healthy and the route does not touch PostgreSQL.
* Logs may show database-related errors, Postgres connection errors, or product-fetching errors.
* Prometheus may show increased latency, route-level failures, or non-2xx status codes for database-backed routes.
* Loki may show Postgres-related logs when queried with the local `container` label.

## Severity

* **Local / dev:** Continue alone. Restore the Postgres container and verify `/api/products`.
* **Shared staging:** Notify the team if the outage blocks testing, demos, or release validation.
* **Production:** High severity. Catalog and order flows may be unavailable. Escalate if Postgres does not recover quickly, if failover is required, or if there are signs of data loss.

Escalate immediately if:

* Postgres repeatedly crashes after restart.
* `pg_isready` does not return healthy.
* Product/order routes keep failing after Postgres is running.
* Migrations fail after recovery.
* There are signs of data corruption, missing tables, lost volumes, or disk pressure.

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

* Postgres container name may be one of:

```text
pretzel-shop-postgres-1
pretzel-shop-postgres
```

Confirm the exact name before starting or stopping:

```bash
docker ps -a --filter name=postgres
```

## Local quick checks

Check Postgres container state:

```bash
docker ps -a --filter name=postgres
```

Check backend health:

```bash
curl --max-time 10 -s -o /dev/null -w "health %{http_code} time=%{time_total}s\n" \
  http://localhost:3001/health
```

Check product route:

```bash
curl --max-time 10 -s -o /dev/null -w "products %{http_code} time=%{time_total}s\n" \
  http://localhost:3001/api/products
```

Check cart route for comparison:

```bash
curl --max-time 10 -s -o /dev/null -w "cart POST %{http_code} time=%{time_total}s\n" \
  -X POST http://localhost:3001/api/cart \
  -H "Content-Type: application/json" \
  -d '{"productId":1,"quantity":1}'
```

Check PostgreSQL readiness:

```bash
docker exec pretzel-shop-postgres-1 pg_isready -U pretzel_user
```

If the container name is different, replace `pretzel-shop-postgres-1` with the name from:

```bash
docker ps -a --filter name=postgres
```

Expected during PostgreSQL outage:

```text
products 500
```

or:

```text
products 000 time=10.000s
```

depending on whether the backend fails fast or waits until the client times out.

`/health` may still return:

```text
health 200
```

That confirms the process is alive, but the database-backed route is unhealthy.

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

During a PostgreSQL outage, database-backed routes such as `/api/products` should show degraded behavior. Depending on timeout behavior, this may appear as a `5xx`, a non-2xx response, or a client timeout.

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

Use this to compare routes such as:

```text
/api/products
/api/cart
/health
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

Use this to identify whether `/api/products` is slower than other routes.

### Status-code breakdown

```promql
sum by (http_status_code) (rate(otel_http_server_duration_milliseconds_count[5m]))
```

This helps show whether the backend is producing `200`, `4xx`, or `5xx` responses.

### Non-2xx ratio

```promql
sum(rate(otel_http_server_duration_milliseconds_count{http_status_code!~"2.."}[5m]))
/
sum(rate(otel_http_server_duration_milliseconds_count[5m]))
```

### 5xx ratio

Use this when the backend completes failed requests as HTTP `5xx`:

```promql
sum(rate(otel_http_server_duration_milliseconds_count{http_status_code=~"5.."}[5m]))
/
sum(rate(otel_http_server_duration_milliseconds_count[5m]))
```

If the request hangs and curl returns status `000`, this query may not show the failure clearly because no completed HTTP `500` was returned. In that case, use timeout behavior, p95 latency, route comparison, and Loki logs as stronger evidence.

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

Postgres-related logs:

```logql
{container=~".*pretzel.*"} |= "Postgres"
```

Product-fetching errors:

```logql
{container=~".*pretzel.*"} |= "fetching products"
```

Broader database/error search:

```logql
{container=~".*pretzel.*"} |~ "(?i)postgres|database|pg|ECONNREFUSED|error|failed|exception"
```

If query volume is low, simplify to:

```logql
{container=~".*pretzel.*"} |= "Error"
```

During the local drill, the query below successfully returned Postgres-related log evidence:

```logql
{container=~".*pretzel.*"} |= "Postgres"
```

## Tempo

Use datasource: **Tempo**.

Search for service:

```text
pretzel-backend
```

Use the outage time window and inspect traces around product requests.

Look for:

* `GET /api/products`
* Slow spans
* Error status
* Database/client connection spans, if captured
* Postgres or dependency-related attributes

Do not paste LogQL into Tempo. LogQL belongs in Loki. Tempo is for traces/spans.

## Mitigation

Start Postgres.

First find the exact Postgres container name:

```bash
docker ps -a --filter name=postgres
```

Start Postgres:

```bash
docker start pretzel-shop-postgres-1
```

If your container is named differently, use the exact name:

```bash
docker start pretzel-shop-postgres
```

Wait for PostgreSQL readiness:

```bash
until docker exec pretzel-shop-postgres-1 pg_isready -U pretzel_user; do sleep 2; done
```

If the container name is different, replace `pretzel-shop-postgres-1` with the correct name.

If the container does not exist, recreate it from the repository root:

```bash
cd /home/devopsy/pretzel-shop
docker compose up -d postgres
```

If the data volume was lost, re-run migrations according to the backend project instructions.

## Verification

Verify backend health:

```bash
curl --max-time 10 -s -o /dev/null -w "health %{http_code} time=%{time_total}s\n" \
  http://localhost:3001/health
```

Verify product route recovered:

```bash
curl --max-time 10 -s -o /dev/null -w "products %{http_code} time=%{time_total}s\n" \
  http://localhost:3001/api/products
```

Expected after recovery:

```text
products 200 time=...
```

Confirm in Grafana:

* `/api/products` returns to normal.
* Latency settles.
* Error or non-2xx behavior drops.
* Postgres-related failure logs stop appearing.
* Postgres startup/readiness logs appear in Loki after restart.

## After mitigation

* [ ] If this was a real or production-like incident, create an RCA under `rcas/`.
* [ ] Add missing PromQL or LogQL queries to this runbook.
* [ ] Consider adding a readiness endpoint that verifies PostgreSQL availability for database-backed routes.
* [ ] Consider adding timeout handling around database calls so requests fail quickly instead of hanging.
* [ ] Consider adding clearer product/database error logging.
* [ ] Consider adding `postgres_exporter` or database-level metrics for connection count, query latency, and database health.
* [ ] Consider alerting on product route non-2xx ratio or p95 latency after baseline behavior is known.

## Related links

* `runbooks/README.md`
* `runbooks/TEMPLATE.md`
* `runbooks/redis-unavailable.md`
* `rcas/`
* `backend/docker-compose.yml` — Postgres service definition
* `backend/config/database.js` — database pool configuration
* Grafana local default: `http://localhost:3000`
* LastDevOps Basics: lessons 9, 10, and 11

