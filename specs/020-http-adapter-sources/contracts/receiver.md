# Webhook Receiver

## Ingest URL

`{IOT_WEBHOOK_PUBLIC_URL}/w/{ingest_id}[/{url token}][/{sub path}]`. In URL token mode
the segment after the identifier is always the token. Only `POST`.

| Answer | When |
| --- | --- |
| `202 {"delivery_id": "…"}` | the tenant broker acknowledged the publish, or the adapter is sampling |
| `400` | malformed request (bad encoding, invalid compressed body) |
| `401` | missing secret, wrong signature, stale timestamp (one body for all) |
| `404` | unknown or removed URL, adapters disabled |
| `405` | any method but `POST` |
| `413` | body over 1 MiB after decompression, headers over 16 KiB |
| `429` + `Retry-After` | adapter, organization or failed-authentication limit |
| `503` + `Retry-After` | paused, broker unavailable, runtime backlog full |

Bodies never name the organization, the adapter or the reason for a `401`.

## Hand-off message

MQTT 5, QoS 1, not retained, topic `iot-os/webhook/<adapter uuid>`, payload = the raw
(decompressed) body. User properties: `delivery_id`, `received_at` (ISO 8601),
`method`, `path` (sub path, token removed), `query` (JSON object), `content_type`,
`headers` (JSON object: lower-case names, ≤ 32 headers, values ≤ 1,000 characters,
excluding the authentication and signature headers, `authorization`, `cookie`,
`forwarded`, `x-forwarded-*` and `x-real-ip`).

## Routing file

`<state>/webhooks/routes.json`, written by the manager, schema
`contracts/adapters/v1/webhook-routes.v1.schema.json`:

```json
{
  "schema_version": "webhook-routes.v1",
  "generated_at": "…",
  "routes": {
    "3Hk…": {
      "adapter_uuid": "…", "tenant_uuid": "…", "state": "running",
      "broker": { "url": "mqtts://adapter-…-mqtt:8883", "ca": "-----BEGIN CERTIFICATE-----…", "username": "webhook-…", "password": "…" },
      "topic": "iot-os/webhook/…", "status_topic": "iot-os/webhook/…/status",
      "auth": { "mode": "hmac", "signature_header": "x-signature", "encoding": "hex", "prefix": "sha256=", "timestamp_header": null },
      "secrets": [{ "uuid": "…", "key": "…", "expires_at": null }, { "uuid": "…", "sha256": "…", "expires_at": "…" }]
    }
  }
}
```

## Reports

Every 10 seconds (and on shutdown) to `POST /api/internal/adapters/receiver-reports`,
schema `receiver-report.v1`:

```json
{
  "schema_version": "receiver-report.v1",
  "report_id": "…",
  "reports": [{
    "adapter_uuid": "…",
    "outcomes": { "accepted": 12, "unauthenticated": 1 },
    "secrets_used": { "<secret uuid>": "2026-10-27T09:20:00Z" },
    "rejections": [{ "at": "…", "reason": "unauthenticated", "address": "203.0.113.7", "path": "/", "size": 512, "content_type": "application/json" }],
    "samples": [{ "at": "…", "delivery_id": "…", "path": "", "query": {}, "content_type": "application/json", "headers": {}, "size": 812, "body_base64": "…" }]
  }]
}
```

At most 20 rejections and 20 samples per adapter per report; a failed report is kept
and retried with the next one, up to 1,000 queued entries.

## Metrics

`iot_webhook_deliveries_total{outcome}`, `iot_webhook_handoff_seconds` (histogram),
`iot_webhook_routes`, on the private port 9105.
