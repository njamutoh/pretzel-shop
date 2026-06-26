# RCA: Local drill — Redis unavailable, cart API timeout

* **Date:** 2026-06-26
* **Environment:** Local developer machine, RHEL VM, Docker Compose
* **Type:** Scheduled learning drill, not production
* **Runbook:** `runbooks/redis-unavailable.md`
* **Related service:** `pretzel-backend`
* **Related dependency:** Redis

## Executive summary

During a local outage simulation, the Redis container was intentionally stopped while the Pretzel Shop backend remained running. Product catalog requests continued to return successfully because `/api/products` depends on PostgreSQL, not Redis. Cart requests failed differently than the lesson’s default expectation: instead of returning a completed HTTP `500`, `POST /api/cart` hung until the client-side curl timeout was reached, returning curl status `000` after 10 seconds.

Grafana/Prometheus confirmed that backend HTTP metrics were still being collected. Loki confirmed Redis-related evidence using the local `container` label, including Redis startup/recovery logs and Redis/cart-related search results. The failure showed a partial dependency outage: the backend process was alive, but the Redis-backed cart path was unavailable.

Mitigation was to restart the Redis container and verify that cart requests returned successfully again. Follow-up work should focus on Redis readiness, dependency timeout handling, clearer cart error logging, and keeping the Redis runbook updated with the exact PromQL and LogQL queries that worked locally.

## Impact

* **Users simulated:** Cart write/read path unavailable or timing out.
* **Affected workflow:** Add-to-cart / cart API behavior.
* **Unaffected workflow:** Product catalog continued to respond successfully.
* **Duration:** Controlled local drill; several minutes.
* **Revenue / SLA impact:** N/A, local training environment.
* **Customer impact:** None, simulated only.

## Timeline

Times are recorded as relative drill steps.

* **T+0** — Baseline environment running: observability stack, frontend, PostgreSQL, Redis, and manually instrumented backend.
* **T+1m** — Baseline product request confirmed working with `GET /api/products`.
* **T+2m** — Redis container intentionally stopped.
* **T+3m** — Product route tested during outage: `GET /api/products` returned `200` in about `0.05s`.
* **T+4m** — Cart route tested during outage: `POST /api/cart` hung until curl timeout and returned status `000` after 10 seconds.
* **T+6m** — Grafana Explore used to inspect Prometheus HTTP server metrics.
* **T+8m** — Loki queried with Redis/cart-specific LogQL using the local `container` label.
* **T+10m** — Redis container restarted.
* **T+11m** — Cart route retested and returned successful `200` or `201` response.
* **T+12m** — Loki showed Redis startup/readiness logs after recovery.

## Detection

Detection was synthetic and manual.

The failure was detected by running curl checks against product and cart endpoints after stopping Redis.

Product route check:

```bash
curl --max-time 10 -s -o /dev/null -w "products %{http_code} time=%{time_total}s\n" \
  http://localhost:3001/api/products
```

Observed during Redis outage:

```text
products 200 time=0.051540s
```

Cart route check:

```bash
curl --max-time 10 -s -o /dev/null -w "cart POST %{http_code} time=%{time_total}s\n" \
  -X POST http://localhost:3001/api/cart \
  -H "Content-Type: application/json" \
  -d '{"productId":1,"quantity":1}'
```

Observed during Redis outage:

```text
cart POST 000 time=10.000411s
```

Grafana dashboard:

```text
http://localhost:3000/
```

Dashboard used:

```text
Pretzel Shop — Golden Signals
```

Grafana Explore:

```text
http://localhost:3000/explore
```

## Investigation

### Golden signals dashboard

The golden-signals dashboard was used as the first visual check.

Observed behavior:

* **Traffic:** Backend traffic continued; this was not a full API process outage.
* **Latency:** Cart path showed timeout behavior from the client perspective.
* **Errors:** The expected 5xx query was not the clearest signal because the cart request timed out before receiving a completed HTTP response.
* **Saturation:** No primary saturation root cause was confirmed during this drill.

Key interpretation:

```text
Redis failure caused a partial dependency outage. The backend process stayed alive, but the cart path blocked or timed out when Redis was unavailable.
```

### Prometheus investigation

Datasource:

```text
Prometheus
```

This project’s actual HTTP server metric names are:

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

Verified product metric example:

```text
otel_http_server_duration_milliseconds_count{http_flavor="1.1",http_method="GET",http_route="/api/products",http_scheme="http",http_status_code="200",job="pretzel-backend",net_host_name="localhost",net_host_port="3001",otel_scope_name="@opentelemetry/instrumentation-http",otel_scope_version="0.219.0"} 142
```

Request rate by route:

```promql
sum by (http_route) (rate(otel_http_server_duration_milliseconds_count[5m]))
```

p95 latency:

```promql
histogram_quantile(
  0.95,
  sum by (le) (rate(otel_http_server_duration_milliseconds_bucket[5m]))
)
```

p95 latency by route:

```promql
histogram_quantile(
  0.95,
  sum by (le, http_route) (rate(otel_http_server_duration_milliseconds_bucket[5m]))
)
```

Status-code breakdown:

```promql
sum by (http_status_code) (rate(otel_http_server_duration_milliseconds_count[5m]))
```

Non-2xx ratio:

```promql
sum(rate(otel_http_server_duration_milliseconds_count{http_status_code!~"2.."}[5m]))
/
sum(rate(otel_http_server_duration_milliseconds_count[5m]))
```

5xx ratio starting point:

```promql
sum(rate(otel_http_server_duration_milliseconds_count{http_status_code=~"5.."}[5m]))
/
sum(rate(otel_http_server_duration_milliseconds_count[5m]))
```

Important note:

The 5xx ratio query did not provide the clearest Redis outage signal in this drill because `POST /api/cart` did not complete as an HTTP `500`. It timed out from the client side with curl status `000`. The stronger evidence was the contrast between `/api/products` returning `200` quickly and `/api/cart` timing out after 10 seconds.

### Loki investigation

Datasource:

```text
Loki
```

Local Loki labels observed:

```text
container
service_name
```

Useful Redis query:

```logql
{container=~".*pretzel.*"} |= "Redis"
```

Cart-specific query:

```logql
{container=~".*pretzel.*"} |= "[Cart]"
```

Broader dependency/error query:

```logql
{container=~".*pretzel.*"} |~ "(?i)redis|cart|ECONNREFUSED|error|failed|exception"
```

Useful observed Redis failure evidence:

```text
connect ECONNREFUSED 127.0.0.1:6379
```

Recovery evidence from Loki:

```text
Redis is starting
Ready to accept connections
```

Interpretation:

Loki confirmed Redis-related evidence using the local `container` label. After recovery, Redis startup/readiness logs confirmed the dependency was available again.

### Tempo investigation

Datasource:

```text
Tempo
```

Service searched:

```text
pretzel-backend
```

Investigation method:

* Search the outage time window.
* Inspect traces around `POST /api/cart`.
* Look for slow spans, failed spans, Redis/client spans, or dependency errors.
* Do not use LogQL in Tempo; LogQL belongs in Loki.

Observation:

Tempo was available as part of the observability stack, but Loki and Prometheus provided the clearest evidence for this drill.

## Root cause

The Redis container was intentionally stopped as part of the local outage simulation.

Redis is required for cart behavior. When Redis was unavailable, the backend process remained up, but the Redis-backed cart route could not complete normally. `POST /api/cart` blocked until the client-side timeout was reached.

The `/health` endpoint did not detect the Redis dependency failure, so a shallow health-only check could have reported the backend as healthy while cart functionality was broken.

## Resolution

Redis was restarted.

First, identify the Redis container:

```bash
docker ps -a --filter name=redis
```

Then start Redis:

```bash
docker start pretzel-shop-redis-1
```

If the local container name differs:

```bash
docker start pretzel-shop-redis
```

Verify Redis is running:

```bash
docker ps --filter name=redis
```

Verify product route:

```bash
curl --max-time 10 -s -o /dev/null -w "products %{http_code} time=%{time_total}s\n" \
  http://localhost:3001/api/products
```

Verify cart route:

```bash
curl --max-time 10 -s -o /dev/null -w "cart POST %{http_code} time=%{time_total}s\n" \
  -X POST http://localhost:3001/api/cart \
  -H "Content-Type: application/json" \
  -d '{"productId":1,"quantity":1}'
```

Expected recovery result:

```text
products 200 time=...
cart POST 200 time=...
```

or:

```text
cart POST 201 time=...
```

## What went well

* The outage was safely simulated locally.
* Product/cart behavior clearly showed partial dependency failure.
* `/api/products` stayed healthy, which helped narrow the issue to Redis/cart rather than the entire backend.
* Loki queries using the `container` label worked.
* Prometheus queries were updated to match the actual `otel_...` metric names.
* Redis recovery was verified with curl and Loki startup/readiness logs.

## What could be improved

* Cart requests timed out instead of failing quickly.
* The 5xx ratio query did not clearly capture this failure mode because the request did not complete as a backend `500`.
* `/health` did not verify Redis dependency availability.
* Redis/cart error logging could be clearer.
* The runbook needed to be adjusted away from the lesson’s sample metric names to the actual local OpenTelemetry metric names.

## Action items

* [ ] Add or extend a readiness endpoint that can verify Redis availability for cart-dependent workflows.
* [ ] Add timeout handling around Redis operations so cart requests fail quickly instead of hanging until the client times out.
* [ ] Add clearer cart error logging for Redis connection failures.
* [ ] Add or refine Grafana panels for route-level p95 latency and status-code breakdown.
* [ ] Keep `runbooks/redis-unavailable.md` updated with the verified local metric names and Loki labels.
* [ ] Re-test the 5xx ratio query during a failure mode that returns completed HTTP `500` responses.
* [ ] Consider alerting on cart timeout behavior, route-level latency, or non-2xx ratio after baseline behavior is known.
* [ ] Repeat the Redis drill after readiness and timeout improvements are implemented.

## References

* `runbooks/redis-unavailable.md`
* `runbooks/postgres-unavailable.md`
* `runbooks/README.md`
* `rcas/README.md`
* Grafana local default: `http://localhost:3000`
* Grafana Explore: `http://localhost:3000/explore`
* Related dashboard: `Pretzel Shop — Golden Signals`
* Related service: `pretzel-backend`
* Related dependency: Redis

