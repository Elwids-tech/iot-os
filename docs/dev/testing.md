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
| Laravel tests | `cd apps/api && php artisan test --compact` | Not part of `./taskw test`. Use `--filter=DashboardTest` etc. for one area. Responses are checked against the API contract ([below](#api-contract-checks)) |
| API contract coverage | `cd apps/api && php artisan contract:coverage` | After a full `php artisan test`; reads the record the suite wrote |
| Go only | `./taskw runtime:test` | |
| Portal/admin only | `pnpm --filter @iot-os/portal lint`, `pnpm --filter @iot-os/portal test` | Same for `@iot-os/admin` |
| Help articles | `cd apps/api && php artisan help:validate` | Also runs in API image builds |
| Contracts | `.local/devices/python/bin/python tooling/verify-devices-contracts.py` | Schemas, fixtures, cases and catalogues ([contract checker](#contract-checker)) |
| Contract checker tests | `python3 -m unittest discover -s tooling/contracts -p 'test_*.py'` | Needs `jsonschema==4.26.0` |
| Release tooling | `python3 -m unittest discover -s tooling/release -p 'test_*.py'` | Needs PyYAML |
| Adapters | `npm test --prefix services/adapters` | Decoder sandbox and flow generation |

[CI](../../.github/workflows/ci.yml) runs on every pull request and on pushes to
`main`: the API job (Pint, help articles, the API contract gates and the PHP suite
on PostgreSQL with TimescaleDB), Go tests against TimescaleDB and NATS, the
TypeScript typechecks, lint, unit tests and builds, the portal specs that mock the
API, the adapter sandbox, and the Python tooling tests and contract checker.
[`.github/workflows/release.yml`](../../.github/workflows/release.yml) runs on `v*`
tags and manual dispatch: it runs CI, then the live adapter protocol test and the
Mosquitto acceptance check, then builds the release images. Run the relevant
subset locally before you push.

## Contract checker

[`tooling/verify-devices-contracts.py`](../../tooling/verify-devices-contracts.py)
checks [`contracts/`](../../contracts/README.md) and prints counts per directory.
It finds every `*.schema.json` under a `v<N>/` directory or `contracts/internal/`
and validates only files that have a schema beside them: `<stem>.fixture.json` and
`<stem>.cases.json`. Fixtures without a schema (`expressions.fixture.json`,
`conversions.fixture.json`, `simulation.expected.json`) are checked by the Go and
PHP tests instead. For each schema it checks that:

- the schema is Draft 2020-12, its `$id` is its path, and every `$ref` resolves;
- the fixture validates against the closed schema; a schema with only `$defs` needs
  none;
- each case validates as labelled. A valid case passes the closed schema. An
  invalid case fails only on the `keyword` and `instance_location` it names, and in
  tolerant mode as well; a `tolerant_valid` case fails closed and passes once
  unknown-field errors are dropped; a reader-code case (envelope family) is valid
  against the schema;
- `oneOf` branches are told apart by a required `const` or by disjoint types;
- values of properties marked `"$comment": "secret"` start with `placeholder-`.

Each catalogue entry (`contracts/internal/catalogue.json`,
`contracts/ingestion/v1/catalogue.json`) needs its schema, a fixture, a cases file
with at least one valid and one invalid case, and producer and consumer test files
that exist and mention its id. The repository-specific checks still run: the
committed-telemetry negative cases, the configuration profile hash, the command
expiry and the pinned Sparkplug proto hash. The formats are in
[contracts/README.md](../../contracts/README.md#cases-files); `--root` points the
checker at another checkout. Its unit tests are in
[`tooling/contracts`](../../tooling/contracts) and run in CI.

## Contract assertions

The Go and PHP suites validate messages with the services' contract registries
([contracts/README.md](../../contracts/README.md#validators-in-the-services)),
always against the repository's `contracts/` directory. A contract is named by its
catalogue id (`device.applied.v1`), its schema path (`devices/v1/command.schema.json`)
or its `$id`.

| Need | Go (`internal/contracts/contractstest`) | PHP (`use Tests\Support\AssertsContracts;`) |
| --- | --- | --- |
| What a producer sends conforms to the closed schema | `contractstest.AssertProduced(t, id, value)` | `$this->assertProduced($id, $value)`, or `assertProducedJson($id, $body)` for a raw body |
| Every example with its expected verdict | `contractstest.Cases(t, id)`: the fixture, then each case; `c.Accepted(contracts.Strict)` / `contracts.Tolerant` | `self::contractCases($id)`, keyed by name for a data provider; `$case->accepted(ContractMode::Strict)` |
| Validate directly | `contractstest.Registry(t).Validate(id, value, mode)` | `(new ContractValidator)->validate($id, $value, $mode)` |

A failed producer assertion names the contract and each failing keyword and
location, for example `required at /payload (missing generation)`. PHP values are
judged by their JSON encoding, where an empty array is `[]`; assert a raw body when
an empty object matters. A reader-code case (envelope family) counts as accepted by
the schema: the envelope reader, not the schema, refuses it.
[`registry_test.go`](../../services/runtime/internal/contracts/registry_test.go) and
[`ContractValidatorTest`](../../apps/api/tests/Unit/Support/ContractValidatorTest.php)
check every fixture and case in both modes on each side.

## Laravel

[`phpunit.xml`](../../apps/api/phpunit.xml) defaults to in-memory SQLite; the
process environment can select PostgreSQL instead, as CI does. `tests/TestCase.php`
refuses any database except SQLite `:memory:` or a PostgreSQL database whose name
ends in `_test`, so tests never touch the development database. CI runs the suite
on PostgreSQL with TimescaleDB and is authoritative: SQLite hides Postgres-only
failures such as invalid-UUID casts ([gotchas](gotchas.md#data-and-api-contracts)).
To run it the same way locally, start a throwaway database and point the suite at
it:

```sh
docker run -d --rm --name api-test-pg --tmpfs /var/lib/postgresql/data \
  -e POSTGRES_DB=iot_os_test -e POSTGRES_USER=iot_os_test -e POSTGRES_PASSWORD=iot_os_test \
  -p 127.0.0.1:55432:5432 timescale/timescaledb:2.29.2-pg17
cd apps/api && DB_CONNECTION=pgsql DB_HOST=127.0.0.1 DB_PORT=55432 DB_DATABASE=iot_os_test \
  DB_USERNAME=iot_os_test DB_PASSWORD=iot_os_test php artisan test --compact
docker rm -f api-test-pg
```

AI providers are faked; no test spends provider credit.

### API contract checks

Every response the suite receives from an `/api/v1` or `/api/integration/v1` route
is checked against [`contracts/openapi/openapi.json`](../reference/api.md#contract)
(gate G4 in the
[spec 001 CI gates](../../specs/001-openapi-contract/contracts/ci-gate.md)).
`tests/TestCase.php` listens for `RequestHandled` and finds the operation from the
route Laravel matched, so there is nothing to call in a test:

- the status must be one the operation documents;
- for an operation not on `contracts/openapi/pending-schemas.json`, documented
  required headers (such as `Retry-After` on 429) must be present and the body must
  match the documented content type and JSON schema (opis/json-schema, JSON Schema
  2020-12; `../` references resolve into `contracts/`). Pending operations get the
  status check only.

A mismatch fails the test that made the request, naming the operation, status and
JSON pointer:

```text
contract G4: GET /v1/organizations/{organization}/things/{thing} 200: /data/created_by: expected integer, got string
  fix: correct the response in contracts/openapi/supplements/<domain>.yaml and run php artisan contract:export; ...
```

The platform's behaviour is the truth: fix the contract (a supplement, then
`php artisan contract:export`) and add a row to the
[drift log](../../specs/001-openapi-contract/drift-log.md); a platform bug is
recorded for a separate change. A test that produces an undocumented response on
purpose opts out with `#[WithoutContractCheck('reason')]`
(`Tests\Support\Contract\WithoutContractCheck`) on the test method. The checks read
the committed contract and never export it, so run `php artisan contract:export`
first when you change a route or supplement. `Event::fake()` with no event list
swallows `RequestHandled` and silently turns the checks off for that test; fake only
the events the test asserts on.

The suite also records each (operation, status) pair it checked, and each opt-out,
in `apps/api/storage/framework/testing/contract-coverage.json` (git-ignored, emptied
at the start of every run). `php artisan contract:coverage` then fails when a
required pair was never checked: a 2xx for every fully described `api/v1`
operation, and a 2xx, 401, 403 and 404 (plus 422 with input) for every integration
operation once `scramble.contract.require_integration_coverage` is on. It prints the
opt-outs with their reasons. Run it after the full suite; a filtered run records
only what it ran.

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
