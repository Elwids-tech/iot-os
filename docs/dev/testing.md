# Testing

Run the checks for the code you touched, then rebuild the affected containers and
verify the change in the running app
([local container verification](../../.agents/skills/local-container-verification/SKILL.md)).
Passing tests and typechecks do not update what Docker serves.

## Everyday commands

| What | Command | Notes |
| --- | --- | --- |
| TypeScript + Go static checks | `./taskw lint` | `pnpm lint` (turbo: `tsc` everywhere, plus the design-system guardrails in portal and admin) and `go vet ./...` |
| TypeScript + Go tests | `./taskw test` | `pnpm test` (turbo: Vitest in portal, ui, charts; admin Playwright with a Vite dev server; integration-sdk and vertical-demo node tests) and `go test ./...` |
| Laravel tests | `cd apps/api && php artisan test --compact` | Not part of `./taskw test`. Use `--filter=DashboardTest` etc. for one area |
| Go only | `./taskw runtime:test` | |
| Portal/admin only | `pnpm --filter @iot-os/portal lint`, `pnpm --filter @iot-os/portal test` | Same for `@iot-os/admin` |
| Help articles | `cd apps/api && php artisan help:validate` | Also runs in API image builds |
| Contract fixtures | `.local/devices/python/bin/python tooling/verify-devices-contracts.py` | JSON Schema validation of every contract fixture |
| Release tooling | `python3 -m unittest discover -s tooling/release -p 'test_*.py'` | Needs PyYAML |
| Adapters | `npm test --prefix services/adapters` | Decoder sandbox and flow generation |

There is no pull-request CI. [`.github/workflows/release.yml`](../../.github/workflows/release.yml)
runs on `v*` tags and manual dispatch: PHP tests, api-client typecheck,
portal/admin lint, release-tooling tests, Go tests, the adapter sandbox and live
protocol test, and the Mosquitto acceptance check, then builds the release
images. Run the relevant subset locally before you push.

## Laravel

[`phpunit.xml`](../../apps/api/phpunit.xml) forces SQLite `:memory:`, and
`tests/TestCase.php` refuses any other database, so tests never touch the
development database. SQLite hides Postgres-only failures such as invalid-UUID
casts ([gotchas](gotchas.md#data-and-api-contracts)). AI providers are faked; no
test spends provider credit.

## Go runtime

`go test ./...` runs unit and contract tests. Database and broker integration
tests skip unless `DEVICE_TEST_DATABASE_URL` and `DEVICE_TEST_NATS_URL` point at
disposable services (the devices harness below sets them). Use `-race` for
concurrency-sensitive packages.

## Browser tests

Portal specs live in [`apps/portal/e2e`](../../apps/portal/e2e) and mock the API
with Playwright routes, except `studio.spec.ts`, which needs a live API (see
below). Run them against a built or served portal:

```sh
STUDIO_BASE_URL=http://localhost:5173 pnpm --filter @iot-os/portal exec playwright test e2e/dashboards.spec.ts
```

Install Chromium once with `pnpm --filter @iot-os/portal exec playwright install chromium`.
Accessibility checks use axe; wait for animations to finish before scanning.

## Disposable Devices environment

```sh
./taskw devices:test     # run everything, then tear down
./taskw devices:serve    # keep it running for manual review (Ctrl-C to stop)
node tooling/test-devices.mjs --automation-only   # DAG automation path only
```

[`tooling/test-devices.mjs`](../../tooling/test-devices.mjs) creates its own
Compose project and database, provisions TLS and broker ACLs, starts the Sparkplug
simulators and the runtime, and runs contract, storage, API, browser and
interruption checks (broker, NATS and database outages, uncertain dispatch,
upgrade and rollback). It never touches the normal development stack. Logs and
screenshots stay in the printed temporary directory. Its environment files
contain credentials: do not publish them.

| Surface | Address |
| --- | --- |
| Portal | http://127.0.0.1:4176 |
| Admin | http://127.0.0.1:4177 |
| API | http://127.0.0.1:8016 |
| MQTT over TLS | ssl://localhost:18885 |

Test accounts there are `shared.operator@example.test` and
`super-admin@example.test` with password `password`. It needs Docker, Go, Python
3, OpenSSL and Playwright Chromium.

## Profile Studio browser suite

```sh
node tooling/test-profile-studio.mjs
```

Creates a disposable SQLite database with isolated accounts, invitations and a
500-parameter profile, starts an API on `127.0.0.1:8013` and a portal on
`127.0.0.1:4173`, and runs the Studio Playwright suite. It refuses occupied
ports and non-loopback hosts.

## Verification scripts

`tooling/verify-*.mjs` and `verify-*.php` drive real flows against a running
stack. Each refuses non-local targets and cleans up its own fixtures.

| Script | Checks |
| --- | --- |
| `verify-devices.mjs`, `verify-devices-browser.mjs`, `verify-devices-recovery.mjs`, `verify-device-lifecycle.mjs`, `verify-telemetry.mjs`, `verify-automation.mjs` | Run by the disposable devices harness |
| `verify-rgb-controls.mjs` | Two-way RGB controls on the local stack |
| `verify-integration-sdk.php` + `verify-integration-sdk.mjs`, `verify-telemetry-sdk.mjs`, `verify-vertical-demo.mjs`, `verify-workflow-dashboard.mjs`, `verify-integration-ui.mjs` | Application access, SDK and dashboard panels. The PHP script runs in the API container, writes a private fixture to `/tmp/iot-sdk-fixture.json`, waits, and cleans up when you `touch /tmp/iot-sdk-release` in the container. `IOT_VERIFY_TELEMETRY=1` and `IOT_VERIFY_DASHBOARD=1` add fixtures |
| `verify-webhooks.mjs` | Webhook retries and signatures, with the `compose.webhook-verification.yml` sink |
| `verify-workflow-execution.php` | Geofence workflow activation, alerts and email into Mailpit |
| `verify-integration-event-order.php` | Alert-event journal ordering under real Postgres concurrency |
| `verify-workflow-components.mjs` | The data-injected workflow overview components render in a standalone host |

Ops checks: `tooling/monitoring/verify.py` ([monitoring](../ops/monitoring.md))
and `tooling/release/verify_local.py` / `verify_mosquitto.py`
([release](../ops/release.md)).
