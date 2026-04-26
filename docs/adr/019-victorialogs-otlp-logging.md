# ADR-019: VictoriaLogs OTLP Logging

- Status: Accepted
- Date: 2026-04-26

## Context

SmartScraper exports runtime logs to VictoriaLogs so scrape
failures can be diagnosed outside the local process.

VictoriaLogs accepts OpenTelemetry logs on
`/insert/opentelemetry/v1/logs`, but this deployment rejects
OTLP JSON on that endpoint. A manual probe returned HTTP 400
with:

```text
json encoding isn't supported for opentelemetry format. Use protobuf encoding
```

Earlier logger code used the default
`@opentelemetry/exporter-logs-otlp-http` logs exporter,
which sends JSON. It also treated local OpenTelemetry
queueing as delivery success. Export errors were routed
through OpenTelemetry diagnostics and were not visible in
SmartScraper logs.

All timestamps used for VictoriaLogs writes, queries, and
reports must be UTC. LogsQL queries must use RFC3339
timestamps ending in `Z`.

## Decision

SmartScraper sends VictoriaLogs logs as OTLP protobuf over
HTTP.

Implementation rules:

- Use the OTLP HTTP path `/insert/opentelemetry/v1/logs`.
- Use `Content-Type: application/x-protobuf`.
- Use the OpenTelemetry protobuf logs serializer.
- Do not use OTLP JSON for VictoriaLogs.
- Configure OpenTelemetry diagnostics so exporter failures
  are written through the local SmartScraper logger.
- Redact secrets before logging diagnostic context.
- Treat export success as unproven until VictoriaLogs can
  return the record by query.

Verification rules:

- Generate a unique marker that includes a UTC timestamp.
- Send one log record through the same logger path used by
  the app.
- Query VictoriaLogs through MCP over a UTC RFC3339 window
  that covers the write.
- The verification passes only when MCP returns the exact
  marker.
- Report `_time` from VictoriaLogs in UTC.

Example verification fields:

```text
marker: codex-vl-now-YYYYMMDDTHHMMSSZ-<pid>
start:  YYYY-MM-DDTHH:MM:SSZ
end:    YYYY-MM-DDTHH:MM:SSZ
query:  <marker>
```

## Consequences

VictoriaLogs ingestion now matches the deployed endpoint
requirements.

Exporter failures are locally visible as
`[LOGGER] OTLP export error:` or
`[LOGGER] OTLP export warning:` messages instead of
disappearing inside OpenTelemetry internals.

Manual and automated diagnostics must distinguish between:

- local log emission,
- OpenTelemetry queueing,
- HTTP export,
- VictoriaLogs ingestion,
- VictoriaLogs query visibility.

Only the last step proves that the record reached the
VictoriaLogs instance queried by MCP.
