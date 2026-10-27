# Adapter Manager API (private)

Bearer `IOT_ADAPTER_MANAGER_TOKEN`, JSON, per-tenant serialization as today.

## `POST /deploy` (changed)

`source` for the new types:

- `webhook`: `{type: "webhook"}`. The manager provisions `adapter-<uuid>` with
  subscribe and receive on `iot-os/webhook/<uuid>` and publish on
  `iot-os/webhook/<uuid>/status`, and gives the flow the internal broker URL and CA.
- `poll`: the settings plus `api_key`, `token`, `username`, `password`,
  `ca_certificate` from the revision's secrets, and
  `cursor: {generation, value?, start_at?, fallback?}`.

## `POST /webhook` (new)

```json
{
  "tenant": { "uuid": "…", "listen_port": 19001, "runtime_token": "…", "ingress_admin_password": "…" },
  "adapter_uuid": "…",
  "ingest_id": "3Hk…",
  "state": "sampling | running | paused | removed",
  "auth": { "mode": "hmac", "signature_header": "x-signature", "encoding": "hex", "prefix": "sha256=", "timestamp_header": "x-timestamp" },
  "secrets": [{ "uuid": "…", "value": "…", "expires_at": null }]
}
```

Creates or updates `webhook-<adapter uuid>` (random password kept in the routing
file), rewrites `<state>/webhooks/routes.json` atomically and answers
`{configured: true}`. `removed` disables the client and deletes the route.

## `POST /poll-test` (new)

Body: the polling `source` and secrets, plus `cursor` (the committed value or the
start). Answer: the [Fetch now result](api.md#polling). Never moves a
cursor or publishes. At most 4 at once across tenants.

## `POST /test` (changed)

Fixtures may carry `source`, `received_at`, `http` and `poll`; results may be lists:
each fixture result carries `outputs` (validated results) and `failures`.
