# IoT OS

IoT OS is a multi-tenant industrial IoT platform. Organizations connect devices over
Sparkplug B (or vendor MQTT through sandboxed adapters), describe them with versioned
device profiles, store and chart their telemetry, send confirmed commands, automate
on live data, raise alerts, and expose data to external applications through a scoped
API, an event feed and webhooks.

It is one repository: a React portal and admin (`apps/portal`, `apps/admin`), a
Laravel control plane (`apps/api`), a Go data plane (`services/runtime`), per-tenant
adapter runtimes (`services/adapters`), shared packages and cross-language contracts.
Laravel owns intent and the public API; Go executes activated definitions.

**Documentation: [docs/README.md](docs/README.md)** — start with the
[architecture overview](docs/architecture/overview.md).

## Quickstart (about 10 minutes)

Needs Docker with Compose, Git, `curl`, `tar`, OpenSSL and Node.js on macOS or Linux
([details](docs/dev/local-setup.md#prerequisites)).

```sh
./tooling/bootstrap        # pinned Task in .tools/bin, creates .env, runs doctor
./taskw devices:setup      # private TLS certificates and runtime secrets in .local/devices/
./taskw devices:up         # builds and starts infrastructure, API, workers, runtime, portal, admin
```

On the first run only (empty database), create the demo organizations and accounts:

```sh
docker compose --env-file .env --env-file .local/devices/devices.env \
  -f deploy/compose/compose.dev.yml -f deploy/compose/compose.app.yml \
  -f deploy/compose/compose.devices.yml \
  exec -T api php artisan db:seed --force
```

Then open:

| | |
| --- | --- |
| Portal | http://localhost:5173 — `shared.operator@example.test` / `password` |
| Admin | http://localhost:5174 — `super-admin@example.test` / `password` |
| API | http://localhost:8001 |
| Captured email | http://localhost:8025 |

To see live data, start a simulated device
([simulators](docs/dev/simulators-and-fixtures.md#sparkplug-simulators-native-path)).
These credentials are development-only.

## Everyday commands

```sh
./taskw                    # list all tasks
./taskw doctor             # check tools, configuration and ports
./taskw lint               # TypeScript (incl. design-system guardrails) and go vet
./taskw test               # TypeScript and Go tests
(cd apps/api && php artisan test --compact)   # Laravel tests
./taskw devices:test       # disposable end-to-end Devices suite
```

To stop the stack, run `docker compose … down` with the same `--env-file` and `-f`
options as above. It keeps volumes; never add `-v`.

After a change, rebuild only the affected service and check it in the running app
([local setup](docs/dev/local-setup.md#rebuild-one-service), [testing](docs/dev/testing.md)).
Deployment is covered in [release](docs/ops/release.md).
