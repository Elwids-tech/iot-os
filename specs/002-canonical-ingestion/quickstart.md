# Quickstart: Internal Message and Envelope Contracts

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Layout**: [contracts/README.md](contracts/README.md)

Two parts: how to add or change an internal message once this feature is built, and
how to validate the feature end to end. Commands run from the repository root and use
the `rtk` prefix ([AGENTS.md](../../AGENTS.md)). File names introduced by this feature
are the ones in [plan.md](plan.md#project-structure).

## Prerequisites

- The contract checker's Python environment: `.local/devices/python/bin/python`
  (created by `./taskw devices:setup`) with `jsonschema==4.26.0`.
- Go 1.27 for `services/runtime`, PHP 8.4 with Composer for `apps/api`, and the
  PostgreSQL/TimescaleDB test databases described in [docs/dev/testing.md](../../docs/dev/testing.md).
- For end-to-end checks: the local Devices stack (`./taskw devices:up`) and the
  Sparkplug and vendor simulators ([docs/dev/simulators-and-fixtures.md](../../docs/dev/simulators-and-fixtures.md)).

## A. Add a new internal message type

Example: a new runtime event `device.example.v1`.

1. **Write the contract** in `contracts/internal/events/device.example.v1.schema.json`
   following [contracts/README.md](contracts/README.md#schema-rules): closed objects,
   `$id`, a description naming producer, consumer, deduplication key and fences.
2. **Add examples**: `device.example.v1.fixture.json` (one realistic valid instance) and
   `device.example.v1.cases.json` (at least one more valid case and one invalid case
   with its expected `keyword` and `instance_location`).
3. **Register it** in `contracts/internal/catalogue.json` with producer, consumer,
   dedup, fences, `reading: "tolerant"`, live-check location and the two test files.
4. **Run the checker**:
   `rtk .local/devices/python/bin/python tooling/verify-devices-contracts.py`
   → expect `PASS …` and the new id in the count. It fails if a catalogue field, a test
   file or an invalid case is missing.
5. **Producer side** (here the runtime): add the type to the event type constants, emit
   it, and add a strict assertion in the producer test named in the catalogue
   (`contracts.AssertProduced(t, "device.example.v1", event)`).
6. **Consumer side** (here the control plane): add the type to the accepted event list
   and the handler, and extend the consumer test to feed every valid case through
   `POST /api/internal/devices/events` and assert that every invalid case raises the
   `contract_violations` count by one while the response is unchanged.
7. **Run both suites**:
   `cd services/runtime && rtk go test ./...` and
   `cd apps/api && rtk php artisan test --compact`.
   The coverage tests fail if a type exists in code but not in the catalogue, or the
   reverse.

## B. Change an existing internal message

- **Additive (new optional field)**: add the property to the schema, add a case that
  uses it, update the producer and its test in the same pull request. Tolerant
  consumers ignore it until they use it.
- **Breaking (remove or rename a field, add a required field, change a type or enum)**:
  create a new id (`device.example.v2`) with its own files, keep consuming `v1` until
  the queues that can hold it are empty (at least one release and seven days), then
  remove `v1` in a later pull request.
- **Check compatibility**:
  `rtk .local/devices/python/bin/python tooling/contracts/compat.py --base origin/main`
  → fails on a breaking change under the same id, and on a schema change whose fixture
  and cases did not change.

For the canonical envelope family the rules are the same except that readers are
strict: ship reader support for a new optional field before any producer sends it.

## C. Validate the feature

1. **Contracts and examples**:
   `rtk .local/devices/python/bin/python tooling/verify-devices-contracts.py`
   → `PASS` with counts for devices, events, location, rules, ingestion and internal
   contracts.
2. **Reference reader** (envelope family):
   `cd services/runtime && rtk go test ./internal/ingestion/envelope/...`
   → every valid example accepted, every invalid example refused with its documented
   code, `message_id` recomputed for the Sparkplug, vendor and HTTP JSON examples.
3. **Conformance on both sides**:
   `cd services/runtime && rtk go test -count=1 -p 1 ./...` (with
   `DEVICE_TEST_DATABASE_URL` and `DEVICE_TEST_NATS_URL` set as in CI) and
   `cd apps/api && rtk php artisan test --compact --filter=Contract`
   → producer, consumer and coverage tests pass.
4. **Seeded faults (SC-003)**: run
   `rtk .local/devices/python/bin/python tooling/contracts/seeded_faults.py`
   → each of the at least ten mutations (schema, example and producer) is reported as
   caught; record the output in the pull request.
5. **Live checks in the rebuilt stack (SC-009)**: rebuild the affected services with the
   stack's env files and overlays
   (`rtk proxy docker compose --env-file .env --env-file .local/devices/devices.env -f deploy/compose/compose.dev.yml -f deploy/compose/compose.app.yml -f deploy/compose/compose.devices.yml up -d --build --no-deps api runtime`,
   adding the adapter overlay and env file when adapters are enabled), then:
   - run the Sparkplug simulator and the vendor water-meter simulator through an
     adapter; activate a device, send a command, deploy an automation and deactivate a
     device;
   - `rtk proxy docker compose … exec api php artisan devices:contract-violations`
     → zero violations on both sides;
   - post one malformed runtime event with the runtime token: a
     `runtime.heartbeat.v1` whose payload is `{}` (missing `at`; its handler reads no
     payload fields, so it changes nothing beyond what a heartbeat does) → the
     control-plane count for `runtime.heartbeat.v1` rises by exactly one and the
     response is `{"ok": true}` as before this feature;
   - confirm telemetry from both simulators is stored and shown in the portal as before
     (SC-005).
6. **Overhead (SC-010)**: compare consumer handling time with the live checks enabled
   and disabled (`IOT_CONTRACT_CHECKS=off` on both sides) while the simulators run;
   the difference must be at most 5%.
