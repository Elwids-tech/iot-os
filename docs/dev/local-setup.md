# Local setup

Everything runs in Docker Compose from source, with no bind mounts: rebuild a
service to see your change. Run commands from the repository root; this repo
prefixes shell commands with `rtk` (`rtk proxy …` for unfiltered output).

## Prerequisites

- **Required**: Docker with Compose, Git, `curl`, `tar`, a SHA-256 tool, OpenSSL,
  Node.js (for `devices:setup`), macOS or Linux.
- **For work outside containers**: the versions pinned in
  [`tooling/versions.env`](../../tooling/versions.env): Node 24 (package.json allows
  22.12–24), pnpm 11.19, PHP 8.4 with Composer 2.10, Go 1.27, plus Python 3 for
  simulators and tooling.

```sh
./tooling/bootstrap   # installs the pinned Task binary into .tools/bin, creates .env if missing, runs doctor
./taskw doctor        # checks tools, configuration and ports
```

`./taskw` always uses the repository's Task binary. `./taskw` with no arguments lists
every task ([`Taskfile.yml`](../../Taskfile.yml)). `.env` holds development-only
values; never reuse them anywhere else.

## Choose a stack

| Command | Starts | Use it for |
| --- | --- | --- |
| `./taskw deps:up` | Infrastructure only ([`compose.dev.yml`](../../deploy/compose/compose.dev.yml)): TimescaleDB, Redis, NATS, EMQX, Node-RED, MinIO, Mailpit | Running the API or runtime natively |
| `./taskw stack:up` | Infrastructure + API, workers, portal, admin ([`compose.app.yml`](../../deploy/compose/compose.app.yml)) | UI and API work without devices (no Go runtime) |
| `./taskw devices:setup` then `./taskw devices:up` | Everything above + the Go runtime and TLS on the broker ([`compose.devices.yml`](../../deploy/compose/compose.devices.yml)) | **The full platform.** This is the normal development stack |

`devices:setup` writes private files under `.local/devices/` (ignored by Git) and
keeps existing secrets on reruns: `devices.env` (runtime token, broker API key) and
`certs/` (a local CA and broker certificate valid for 365 days). The overlay enables
password-authenticated MQTT over TLS on 8883, removes NATS's host ports and puts the
runtime on private networks. `./taskw devices:config` validates the merged
configuration without starting anything.

Optional overlays: local monitoring (`python3 tooling/monitoring/local.py up`,
[monitoring](../ops/monitoring.md#local-monitoring)) and device adapters
(`compose.adapters.yml`, [adapters](../features/adapters.md#running-locally)).

The API runs pending migrations on start but never seeds. On a **new, empty
database** only, create the demo accounts once:

```sh
devices_compose() {
  docker compose --env-file .env --env-file .local/devices/devices.env \
    -f deploy/compose/compose.dev.yml -f deploy/compose/compose.app.yml \
    -f deploy/compose/compose.devices.yml "$@"
}
devices_compose exec -T api php artisan db:seed --force
```

On an existing database, run the additive seeders instead
(`--class=PermissionSeeder`, `DevicePermissionSeeder`,
`DeviceProfilePermissionSeeder`). `DatabaseSeeder` updates its demo accounts and is
not an upgrade tool. Demo accounts and example devices:
[simulators and fixtures](simulators-and-fixtures.md).

## Addresses

| Service | Address |
| --- | --- |
| Portal | http://localhost:5173 |
| Admin | http://localhost:5174 |
| API | http://localhost:8001 |
| Mailpit (captured email) | http://localhost:8025 (`IOT_MAILPIT_UI_PORT`) |
| MQTT over TLS (Devices overlay) | ssl://localhost:8883 |
| EMQX dashboard | http://127.0.0.1:18083 |
| NATS monitoring | http://127.0.0.1:8222 (not published with the Devices overlay) |
| Storybook (when running) | http://localhost:6006 |

Infrastructure ports (Postgres, Redis, NATS, MinIO, EMQX plain MQTT, WebSocket and
dashboard, Node-RED) bind to `${IOT_DEV_BIND_ADDRESS:-127.0.0.1}`; set it to
`0.0.0.0` only when you mean to expose them. Postgres and Redis default to host
ports 15432 and 16379 so they do not collide with a native Postgres or Redis, and
`./taskw doctor` fails when a configured port is held by a non-Docker process. The
device-facing MQTTS port and the portal, admin and API ports listen on all
interfaces so LAN hardware and demos work. Use one hostname (`localhost` or
`127.0.0.1`) consistently so session cookies are shared.

The stack also starts Redis, MinIO and a stock Node-RED (editor on 1880); the
application does not use them.

## Rebuild one service

After a change, rebuild only what it affects and keep the stack's existing env
files, overlays and volumes:

```sh
rtk proxy docker compose --env-file .env --env-file .local/devices/devices.env \
  -f deploy/compose/compose.dev.yml -f deploy/compose/compose.app.yml \
  -f deploy/compose/compose.devices.yml \
  up -d --build --no-deps portal admin
```

| You changed | Rebuild |
| --- | --- |
| `apps/portal` | `portal` |
| `apps/admin` | `admin` |
| `packages/ui`, `packages/charts`, `packages/api-client`, `packages/auth`, `packages/workflow-editor` | `portal admin` |
| `apps/api` | `api` and every service built from the API image in `compose.app.yml` (`automation-worker`, `alerts-worker`, `webhooks-worker`, `assistant-worker`, `scheduler`), plus `adapter-worker` with the adapter overlay |
| `services/runtime` | `runtime` (it also builds `broker-admin` in release) |
| `services/adapters` | `adapter-manager` and `adapter-runtime-image` (adapter overlay) |

Before rebuilding, check how the running stack was started (the env files and
overlays may differ from the above) and preserve them
([gotchas](gotchas.md#local-stack)). Then verify the change in the running app
([container verification skill](../../.agents/skills/local-container-verification/SKILL.md)).
Never run `docker compose down -v`, `migrate:fresh` or demo seeders to "fix" a
stack.

## Working outside containers

- **Frontend hot reload**: `pnpm install --frozen-lockfile`, stop the matching
  container, then `pnpm --filter @iot-os/portal dev` (or `@iot-os/admin`). Both use
  strict ports. The portal reads `VITE_API_URL`; admin also reads `VITE_PORTAL_URL`.
  Changing a `VITE_` value in Docker needs an image rebuild.
- **Storybook**: `pnpm --filter @iot-os/storybook storybook` (port 6006).
- **API**: configure `apps/api/.env` from `apps/api/.env.example`, including the
  `DEVICE_*` settings; the API and runtime must share `DEVICE_RUNTIME_TOKEN`.
- **Runtime**: `./taskw runtime:dev` runs `go run ./cmd/runtime` on `:8081`. It
  also needs `DEVICE_CONTROL_URL`, `DEVICE_DATABASE_URL`, `DEVICE_MQTT_CA_FILE` and
  `NATS_URL`.

Internal endpoints (runtime HTTP, NATS, broker management) belong on private
interfaces only.

## Stopping

`./taskw stack:down` and `./taskw deps:down` stop the services in their own Compose
files and keep volumes. For the Devices stack, run `docker compose … down` with the
same `--env-file` and `-f` options you started it with, so the runtime is included.
There is no reset task by design; never add `-v`.
