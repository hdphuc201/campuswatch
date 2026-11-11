# Runbook: observability and alerts

## Signals

- **Logs:** JSON lines on stdout/stderr from `campuswatch-api` and `campuswatch-worker`.
  They are redacted at the source; still, restrict log access to operators.
  Useful messages: `http_request` (status, route, duration), `unhandled_http_error`,
  `Retention removed …`, `Telegram dispatch every …`.
- **Metrics:** `GET /ops/metrics` with `Authorization: Bearer $OPS_METRICS_TOKEN`
  (Prometheus text). Scrape every 60 s from inside the deployment network.
- **Health:** `GET /health` (liveness) and `GET /health/ready` (database).

## Suggested alerts

| Alert             | Condition                                                                           | First response                                                                     |
| ----------------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| API down          | `/health/ready` not 200 for 2 min                                                   | Check database connectivity and API logs.                                          |
| Selector drift    | `increase(campuswatch_source_errors_24h{code="ADAPTER_NEEDS_UPDATE"}[1h]) > 0`      | Follow `citd-adapter.md` → "Responding to ADAPTER_NEEDS_UPDATE".                   |
| Portal outage     | `campuswatch_source_errors_24h{code="PORTAL_UNAVAILABLE"}` rising across many users | Usually CITD-side; no action beyond monitoring. Extensions back off automatically. |
| Login wave        | `campuswatch_connections{status="LOGIN_REQUIRED"}` jumps                            | Often a Portal session reset. Users see "Log in to the CITD Portal".               |
| Delivery backlog  | `campuswatch_oldest_due_delivery_seconds{channel="telegram"} > 900`                 | Worker or Redis down, or Telegram failing; check `last_error_code`.                |
| Failed deliveries | `campuswatch_deliveries{status="failed"}` increasing                                | Inspect error codes; see `telegram.md`.                                            |
| Error rate        | share of `http_request` logs with `status >= 500` above 1 % for 10 min              | Check `unhandled_http_error` logs by `requestId`.                                  |

## Investigating a user report

1. Ask the student for the request id shown in an error (or the time it happened). Never ask
   for passwords, Portal cookies, or screenshots containing grades.
2. Search logs by `requestId` and time window. Logs contain no personal data, so correlate
   by time and route only.
3. Do not read a student's entities or change history unless they ask you to and consent;
   use aggregate metrics instead (plan section 8, "Admin operations").
