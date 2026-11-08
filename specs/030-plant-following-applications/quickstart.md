# Quickstart: Validating Applications That Follow a Plant

The runs that prove [spec 030](spec.md) works. Contracts:
[platform API](contracts/platform-api.md), [the stream](contracts/telemetry-stream.md).
Each delivery pull request names the runs it is verified by ([plan](plan.md), Delivery).

## Prerequisites

- The local stack is running with the devices overlay, and api, workers, portal and
  runtime have been rebuilt from the branch under test
  ([local setup](../../docs/dev/local-setup.md#rebuild-one-service)). The api container
  runs with `PHP_CLI_SERVER_WORKERS=8` (research R6); without it one open stream blocks
  every other request to the development server.
- An organization with one site holding at least three devices that report through the
  Sparkplug simulator ([simulators](../../docs/dev/simulators-and-fixtures.md)), one
  device with no site, and a second organization with a device of its own.
- An application in the first organization with `devices:read`, `telemetry:read`,
  `telemetry:stream` and `entities:read`, and a token with the same abilities
  (**Connect → Integrations**). Export `ORG`, `TOKEN`, `API` (the api origin on
  `localhost`) and the device UUIDs as shell variables for the `curl` runs.
- For run 4's lifetime check, `IOT_STREAM_LIFETIME_SECONDS=60` on the api container
  (default 3600).

## 1. Tests (API, runtime, SDK)

```bash
cd apps/api && php artisan test --compact --filter=Integrations
```

```bash
cd services/runtime && go test -count=1 ./internal/app/... ./internal/storage/...
```

```bash
pnpm --filter @iot-os/integration-sdk test
```

**Expect**: every suite green, including the foreign-organization cases of
`GrantScopeTest`, `LatestBatchTest`, `DeviceParametersTest`, `SitesReadTest` and
`TelemetryStreamTest`; the Go broadcaster, handler and catch-up tests (the database
tests need `DEVICE_TEST_DATABASE_URL`); the SDK stream iterator tests.

## 2. Grant a site (US3)

1. In the portal, **Connect → Integrations**, open the application, choose **Grant by
   site**, pick the site, and save past the confirmation.
2. Issue a new token (the save invalidated the old one) and export it.
3. `curl -H "Authorization: Bearer $TOKEN" $API/api/integration/v1/organizations/$ORG/devices`

**Expect**: the three site devices are listed and the site-less device is not. Register
a fourth device at the site and list again: it appears with no change to the
application. Move one device to another site in its device page and read it:
`404`. Delete a second, empty site that was also in the scope: the application's
`grant_revision` bumps, the token stops working, and the activity log shows
`application.grants_updated` with reason `site_deleted`.

## 3. The snapshot (US1)

```bash
curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d "{\"device_uuids\":[\"$D1\",\"$D2\",\"$D3\"]}" \
  $API/api/integration/v1/organizations/$ORG/telemetry/latest/query
```

**Expect**: one `telemetry-latest-batch.v1` answer with three entries in request order,
each with readings, `presence` and `last_seen_at`; a device that never reported has
`readings: []` and `configuration_uuid: null`. Repeat with the second organization's
device UUID added: `404` for the whole request. Repeat with 101 UUIDs: `422` naming the
limit. With the simulator running 100 devices, send one request naming all 100 under
`time`: the answer arrives in under 2 s (SC-001).

## 4. The stream (US2)

```bash
curl -N -H "Authorization: Bearer $TOKEN" -H "Accept: text/event-stream" \
  "$API/api/integration/v1/organizations/$ORG/telemetry/stream?devices[]=$D1&devices[]=$D2"
```

**Expect**: an `open` event with a position and `devices: 2`, then `reading` events for
the two devices within 2 s of each simulator report and none for the third device; a
`: keepalive` line after 60 s of silence (stop the simulator to see one). Note the last
`id`, stop `curl`, and reconnect with `-H "Last-Event-ID: <id>"`: every reading stored
in between arrives first, in order, then live ones; no duplicate `event_id`. Reconnect
with `-H "Last-Event-ID: 1"`: a `reset` event with the head position, then the stream
closes. With `IOT_STREAM_LIFETIME_SECONDS=60`: a `closed` event with reason `lifetime`
and the last position about a minute after `open`. While a stream is open, save the
application's grants in the portal: within 30 s a `closed` event with reason
`grant_changed`. Open a stream naming the second organization's device: `404`, no
events.

## 5. Parameters and sites (US4)

```bash
curl -s -H "Authorization: Bearer $TOKEN" $API/api/integration/v1/organizations/$ORG/devices/$D1
```

```bash
curl -s -H "Authorization: Bearer $TOKEN" $API/api/integration/v1/organizations/$ORG/sites
```

**Expect**: the device read carries `profile`, `site` and `parameters` matching the
profile page (key, name, unit, type, decimals, command and state flags); the site list
carries every site with `granted_devices_count` equal to run 2's listing. A token
without `entities:read` gets `403` on sites.

## 6. Limits and capacity (US6)

1. Open three streams for the application: the third is `429` with `Retry-After` and
   the limit in the body; the first two keep flowing. Close one; a new one opens.
2. With a second application, open streams until the organization holds ten: the
   eleventh is `429`.
3. Run the simulator with 100 devices reporting every 10 s on one stream for 10
   minutes; log `received_at` against the local receive time.
4. Read `/internal/ops/metrics` and the admin app's organization page.
5. For SC-003: keep one stream open for the whole run and, beside it, a second stream
   for the same devices that you interrupt 20 times (kill `curl`, reconnect with the
   last `Last-Event-ID`), appending every `event_id` each receives to a file.

**Expect**: 95 % of readings within 2 s (SC-002); the interrupted stream's `event_id`
set equals the uninterrupted stream's, with no duplicates (SC-003); no `runtime_unavailable` closes; the
metrics show `integration_streams_open` and the admin page lists each open stream with
its application, opened time, device count and last position. Record the api
container's memory at ten open streams in the pull request; it sizes the release pool
(research R6).

## 7. The SDK (US5)

```bash
IOT_API_ORIGIN=$API IOT_ORGANIZATION=$ORG IOT_APPLICATION_TOKEN=$TOKEN node packages/integration-sdk/examples/stream.mjs
```

**Expect**: the example prints `open`, then readings; pause the api container for 20 s
and resume it: the iterator reconnects and prints the readings stored meanwhile once
each, then continues; after the lifetime close it reconnects without printing an
error. `examples/read.mjs` from 0.5 runs unchanged.

## 8. The runtime side

```bash
curl -s -H "Authorization: Bearer $DEVICE_RUNTIME_TOKEN" http://localhost:8081/internal/status
```

(from inside the stack network, or through `docker compose exec`). **Expect**:
`streams.open` equals the number of streams open in run 6, and returns to 0 after they
close. Stop the runtime container while a stream is open: the client receives `closed`
with `runtime_unavailable`; after the container is back, a reconnect with the last
position receives everything stored in between.

## 9. The twin's exit test (SC-007, external)

With a Twin Studio project switched to the IoT OS connector against this stack, the
canvas shows every bound value at load with its age, and a click on an asset draws 24 h
of history, with no platform credential in the browser. Recorded in that repository's
verification report.
