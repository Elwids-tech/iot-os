# Reusable device controls

The device Controls tab and dashboard Controls panels use the same metadata-driven inputs and state adapter. A parameter's `data_type` defines its value contract, while `display.widget` selects a compatible control. This distinction lets two string parameters render differently: ordinary text can use `text`, while a colour uses `color` together with `format: "hex_color"`. When `display.widget` is omitted, the client chooses a safe default from the type, format, and validation metadata.

| Data type | Supported control UI components | Validation used by the control |
| --- | --- | --- |
| `boolean` | automatic, `switch` | type validation |
| `enum` | automatic, `toggle_group`, `searchable_select` | required string Allowed values |
| `string` | automatic, `text`, `color`, `toggle_group`, `searchable_select` | optional Allowed values; `hex_color` format for colours |
| `integer`, `number` | automatic, `number`, `slider`, `toggle_group`, `searchable_select` | Number range for slider bounds; Allowed values for choices |
| `timestamp`, `bytes` | automatic | no editable control yet |

Automatic choice controls use buttons for up to seven values and a searchable selector for longer lists. Explicit `toggle_group`, `searchable_select`, `text`, or `number` selections override that automatic presentation. A slider reads its minimum and maximum from the validation rule and its interaction step from `display.step`; legacy `display.min`, `display.max`, and `display.widget: "select"` remain readable for existing artifacts. Display metadata never relaxes profile validation.

Controls require an applied state parameter with `reports_state`, `accepts_command`, and an approved outbound mapping. Dashboard editors select parameters from the applied profile; command permission remains independent of dashboard management. Dashboard previews and editing never send commands.

## State and sending

Reported device state, local edits, and pending targets remain separate. Visible controls share a one-second snapshot query per device, independent of chart refresh. Active edits survive polling. Offline, stale, incompatible, and unauthorized controls cannot send. A switch or choice sends immediately; numeric and hex inputs commit on Enter or blur, and sliders on interaction completion. Native colour-picker changes commit on their change event or blur, depending on the browser.

`POST /api/v1/organizations/{organization}/devices/{device}/commands/send` accepts `configuration_uuid`, `parameter_uuid`, `value`, and `idempotency_key`, and returns the existing command resource. It prepares and confirms transactionally through the existing audited command service. The original prepare/confirm APIs remain supported.

One request per parameter can be outstanding. The existing 30-second execution deadline, configuration/session checks, fresh-state observation, and uncertain-delivery handling apply. Neither transport acknowledgement nor the UI target establishes a device result. Later local changes replace the displayed actual value; old platform targets are not automatically reasserted. Offline commands are not queued, and uncertain sends are never automatically repeated.

## Local RGB example

The optional v2 example has Power, Colour (`#RRGGBB`), Solid/Blink/Strobe, and integer brightness 0–100%. Initial state is off, red, solid, and 100%. Power is independent; changing other settings while off preserves power-off. Blink uses 500 ms on/off and Strobe 100 ms on/900 ms off. The browser preview respects reduced motion. RGB state is persisted beside the simulator's existing birth-sequence file.

The existing v1 fixture and simulator defaults are preserved. This opt-in setup creates a separate `simulator-rgb-light-v2` profile and `simulator-rgb-edge` gateway; it does not upgrade existing devices. Use the active Devices Compose overlays:

```bash
rtk docker compose --env-file .env --env-file .local/devices/devices.env \
  -f deploy/compose/compose.dev.yml -f deploy/compose/compose.app.yml \
  -f deploy/compose/compose.devices.yml exec -T api \
  php artisan devices:prepare-simulator --rgb-controls \
  --output=/tmp/rgb-v2-simulator.json --broker=ssl://localhost:8883 \
  --ca="$PWD/.local/devices/certs/ca.crt"
rtk docker cp iot-os-dev-api-1:/tmp/rgb-v2-simulator.json .local/devices/rgb-v2-simulator.json
rtk proxy .local/devices/python/bin/python tooling/simulators/sparkplug_simulator.py \
  --config .local/devices/rgb-v2-simulator.json --state-file .local/devices/rgb-v2-state \
  --rgb-v2 --control-port 8766
```

The private configuration stays on disk. Open `http://127.0.0.1:8766` to change the simulated device locally. Local changes and received MQTT commands use the same serialized update path and report immediately. The panel binds only to loopback, rejects foreign origins, and never exposes broker credentials.

Run `rtk proxy node tooling/verify-rgb-controls.mjs` in another terminal to register/map/activate the dedicated demo, exercise both directions over the running MQTT pipeline, and create its dashboard. It uses the seeded local super-admin account (override with `RGB_EMAIL`/`RGB_PASSWORD` if needed), accepts localhost URLs only, and writes nonsecret links to `.local/devices/rgb-controls-evidence.json`.

## Checks

- API: DeviceDomainTest, DashboardTest, and profile regressions use disposable SQLite.
- Portal Vitest covers control resolution, typed values, and fallback behavior.
- `e2e/controls.spec.ts` verifies pending/actual values, local changes, commit deduplication, offline/uncertain outcomes, permissions, dashboard edit isolation, unsaved edits, accessibility, and mobile layout using API fixtures.
- `rtk proxy python3 -m unittest discover -s tooling/simulators -p 'test_rgb_controls.py'` checks validation, persistence, and the local panel boundary.
- `verify-rgb-controls.mjs` verifies the actual local API/runtime/broker/simulator path. Hardware firmware and hardware verification are not included.

Rebuild affected local containers and verify the served UI after implementation changes. Shared UI or API-client changes require rebuilding both portal and administration.
