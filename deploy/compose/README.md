# Development Compose profile

Compose files for local development. How to choose and start a stack, addresses,
ports and rebuilding one service are in [local setup](../../docs/dev/local-setup.md).

| File | Adds | Started by |
| --- | --- | --- |
| `compose.dev.yml` | TimescaleDB, Redis, NATS (JetStream), Node-RED, MinIO, Mailpit | `./taskw deps:up` |
| `compose.app.yml` | Laravel API and workers, portal, admin | `./taskw stack:up` |
| `compose.devices.yml` | Mosquitto over TLS with `broker-admin`, private NATS, the Go runtime | `./taskw devices:up` (after `./taskw devices:setup`) |
| `compose.monitoring.yml` | Prometheus, Alertmanager, Grafana, Loki, Alloy, exporters | `python3 tooling/monitoring/local.py up` ([monitoring](../../docs/ops/monitoring.md#local-monitoring)) |
| `compose.adapters.yml` | adapter-manager, adapter-worker, tenant runtime image | Manually, with a private env file ([adapters](../../docs/features/adapters.md#running-locally)) |
| `compose.webhook-verification.yml` | A local webhook sink for `tooling/verify-webhooks.mjs` | Verification only |
| `compose.devices-test.yml` | The disposable environment used by `tooling/test-devices.mjs` | `./taskw devices:test` |

Images are pinned in `.env.example`; named volumes keep data when services stop.
The PostgreSQL init scripts enable TimescaleDB on a new database. The API runs
pending migrations on start but never reseeds accounts; run demo seeders only on a
new, empty database ([simulators and fixtures](../../docs/dev/simulators-and-fixtures.md#seeders)).

## Local email

The API and workers send SMTP to `mailpit:1025` on the internal network, without
credentials or TLS; captured mail is at `http://localhost:${IOT_MAILPIT_UI_PORT}`
(default 8025; set another port in `.env` if something else holds 8025) and persists
in the `mailpit-data` volume. Do not use Mailpit's release or relay features. A
captured message proves local generation and SMTP hand-off, not real delivery.

`deps:down` and `stack:down` never delete volumes. These credentials and port
exposures are for development only.
