# RCAs

This directory contains Root Cause Analysis documents for Pretzel Shop incidents and local outage drills.

An RCA is a historical record of a specific incident or drill. It explains what happened, what was observed, what was believed during investigation, what the actual cause was, how service was restored, and what follow-up work should reduce recurrence or improve detection.

Runbooks are reusable checklists. RCAs are incident-specific records.

## Naming convention

Use this format for RCA files:

```text
YYYY-MM-DD-short-slug.md
```

Examples:

```text
2026-06-26-local-drill-redis-cart-timeout.md
2026-06-26-local-drill-postgres-products-outage.md
2026-07-03-api-cart-redis-timeout.md
```

Use the incident or drill date in UTC when possible. Keep the slug short, lowercase, and descriptive.

## Blameless tone

RCAs should be blameless.

Focus on systems, signals, gaps, safeguards, and process improvements. Do not write the RCA as a fault-finding exercise against a person.

Use language like:

```text
The system allowed...
The runbook did not yet include...
The health check did not verify...
The dashboard query did not expose...
The dependency timeout behavior caused...
```

Avoid language like:

```text
The engineer failed to...
Someone forgot to...
The mistake was caused by...
```

The goal is to make the system easier to operate next time.

## No secrets

Do not include secrets in RCA files.

Never commit:

* Passwords
* API keys
* Tokens
* Private certificates
* Cloud credentials
* Database connection strings with passwords
* Personal information
* Customer data
* Internal URLs that should not be public

Use safe placeholders instead:

```text
<REDACTED>
<GRAFANA_BASE_URL>
<INTERNAL_TICKET_URL>
```

## Required RCA content

Each RCA should include:

* Title
* Metadata

  * Date
  * Environment
  * Type: drill, incident, outage, degradation, etc.
  * Related runbook
* Executive summary
* Impact
* Timeline
* Detection
* Investigation
* Root cause
* Resolution
* Action items
* References

## Query requirements

Full PromQL and LogQL queries must be included directly in the RCA.

Do not rely only on Grafana dashboard links, Explore links, or browser bookmarks. Links can break when dashboards move, folders change, datasource IDs change, or Grafana URLs differ between environments.

The query text is the source of truth.

Good:

```promql
sum by (http_route) (rate(otel_http_server_duration_milliseconds_count[5m]))
```

Good:

```logql
{container=~".*pretzel.*"} |= "Redis"
```

Avoid writing only:

```text
See Grafana link here.
```

A link can be included, but it should be optional. The RCA must still be useful if the link breaks.

## Local drill URLs

For local drills, it is acceptable to reference the local Grafana default:

```text
http://localhost:3000
```

or the VM IP used during the drill:

```text
http://<VM_IP>:3000
```

For production RCAs, teams often omit direct URLs and keep only the dashboard name, datasource name, and query text.

Example:

```text
Grafana dashboard: Pretzel Shop — Golden Signals
Datasource: Prometheus
Query:
```

```promql
sum by (http_status_code) (rate(otel_http_server_duration_milliseconds_count[5m]))
```

## RCA action items

Every RCA should end with action items.

Action items should be specific and trackable:

```text
- [ ] Add Redis readiness check for cart-dependent workflows.
- [ ] Add timeout handling around Redis calls.
- [ ] Add dashboard panel for route-level p95 latency.
- [ ] Update runbook with verified Loki query.
```

Avoid vague action items:

```text
- [ ] Improve monitoring.
- [ ] Be more careful.
- [ ] Investigate later.
```

## When to write an RCA

Create an RCA when:

* A local drill is part of the training/project deliverable.
* A production or staging issue affects users or testers.
* The incident revealed a missing runbook, alert, dashboard, or readiness check.
* The failure mode is likely to happen again.
* The troubleshooting path was unclear enough that future engineers would benefit from a record.

For small local experiments, an RCA can be brief. For customer-impacting production incidents, the RCA should be more detailed.

## Relationship to runbooks

If an RCA reveals a repeatable failure mode, update or create a runbook in `runbooks/`.

The usual flow is:

```text
Incident or drill happens
→ RCA captures what happened
→ Action items identify gaps
→ Runbook is updated with reusable steps
→ Dashboard/query/alert changes are committed
```

Runbooks should not contain incident timelines. RCAs should not replace runbooks.

## Local Pretzel Shop query notes

Current Prometheus HTTP metrics observed in this project include:

```text
otel_http_server_duration_milliseconds_count
otel_http_server_duration_milliseconds_bucket
otel_http_server_duration_milliseconds_sum
```

Useful Prometheus labels include:

```text
http_route
http_status_code
job
```

Current Loki labels observed locally include:

```text
container
service_name
```

Prefer narrow Loki queries such as:

```logql
{container=~".*pretzel.*"} |= "Redis"
```

```logql
{container=~".*pretzel.*"} |= "Postgres"
```

Avoid broad queries such as:

```logql
{job="docker"}
```

unless that label actually exists in the environment.

## RCA maintenance

Update RCA references if:

* A linked runbook is renamed.
* A metric name changes after an OpenTelemetry upgrade.
* A dashboard is renamed.
* A datasource changes.
* A follow-up action is completed and should be marked.

RCAs are not just paperwork. They are evidence that the team learned something and changed the system.

