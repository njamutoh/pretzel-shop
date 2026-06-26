# Runbooks

Runbooks are reusable operational checklists. They are not incident timelines.

A runbook should help the next engineer investigate a known failure class without starting from zero. It should explain the symptoms, the first checks to run, the relevant Grafana views, the PromQL and LogQL queries that worked, the mitigation steps, and the verification steps after recovery.

Incident-specific details such as exact timestamps, what happened during one drill, what was believed at each point, and follow-up action items belong in `rcas/`, not in the runbook.

## Available runbooks

- [`redis-unavailable.md`](./redis-unavailable.md) — Cart requests fail, hang, or time out because Redis is unavailable or unreachable.
- [`postgres-unavailable.md`](./postgres-unavailable.md) — Product catalog or order routes fail because PostgreSQL is unavailable or unreachable.
- [`TEMPLATE.md`](./TEMPLATE.md) — Base template for creating new runbooks.

## How to use these runbooks

1. Start with the user-visible symptom.
2. Open the matching runbook.
3. Follow the local quick checks.
4. Use the Grafana section to investigate metrics, logs, and traces.
5. Apply the mitigation steps.
6. Run the verification checks.
7. If the incident was customer-impacting or important enough to review later, create an RCA under `rcas/`.

## Creating new runbooks

For every new failure class, copy the template:

```bash
cp runbooks/TEMPLATE.md runbooks/<new-failure-class>.md
