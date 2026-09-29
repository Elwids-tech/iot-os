# Telemetry viewer

Open **Telemetry viewer** from the organization sidebar. Device view and manage permissions are required because raw gateway captures can include unassigned sources. Start with a gateway, optionally choose an onboarded device, and capture for 1, 5, or 10 minutes.

## Inspecting data

- **Live stream:** filter topics, metrics, values or message types; select a packet; inspect resolved Sparkplug metrics and original binary bytes. Pause view freezes the message list while capture and session-status polling continue. Follow newest selects the latest packet.
- **Processing stages:** compare received metric values, parameter mappings, actual scale/offset output, validation quality and diagnostics, derived readings, and persistence results for the same sample and configuration.
- **AI troubleshoot:** select a sample and ask a question. The configured AI receives only that sample's decoded values and processing evidence, excluding original wire bytes. Evidence links open the cited sample while it remains in the buffer. Suggestions open a review dialog and the existing device configuration editor. Saving, validation and activation remain explicit manual operations. The assistant cannot access brokers, run commands or edit configuration.

Raw means data received by the platform, after any gateway-side processing. Earlier sensor values cannot be reconstructed. Birth context is the runtime's resolved Sparkplug session; a birth packet need not fall inside the capture window. Packet decoding is distinct from production persistence. `pending` means durable handoff is in progress, `storage_retry` means storage failed and will retry, `discarded` means storage did not accept the batch, and `stored` means the reading/diagnostic transaction committed. Invalid readings are persisted as diagnostics rather than valid observations.

## Temporary suspension

Normal ingestion continues during capture. Users with device activation permission can separately confirm suspension for one active onboarded device. New packets still pass through protocol decoding and diagnostic processing, but do not update production latest values or enter production storage. Already queued samples may finish storing. Suspended samples are not replayed later. Commands and lifecycle operations are not changed by this feature.

Resume explicitly, stop/delete the capture, or let it expire. Expiry is enforced by the runtime even with no browser open. A runtime restart also releases suspensions. Another capture cannot suspend a device already suspended by an existing capture. Capturing all gateway sources never allows gateway-wide suspension.

## Limits and retention

Captures are volatile runtime memory, not a historical archive: 32 sessions globally, 4 per organization, 200 messages per session, at most 64 KiB per full sample. Wire payloads over 32 KiB are omitted with a diagnostic. Oldest messages are evicted; oversized traces are dropped and counted. Sessions expire after at most 10 minutes; their retained evidence is deleted 30 minutes after scheduled expiry. Runtime restart clears all captures. Export JSON to retain a snapshot. Export may contain device data and should be handled accordingly.

This implementation uses one-second authenticated polling against the existing single runtime. It does not add another MQTT subscriber. A clustered runtime would need capture routing or a shared bounded store before horizontal deployment.

## AI configuration

Uses the existing `IOT_ASSISTANT_ENABLED`, `IOT_ASSISTANT_MODEL`, provider credentials and shared daily allowance. Disabled or failed AI does not affect capture or stage inspection. Requests have a 25-second provider timeout, a 24,000-byte evidence limit, and rate limiting. Unknown provider usage after failure is charged at the reserved allowance. Only selected samples are sent; captures are not continuously streamed to the model. There are no AI write tools.

Capture start, stop, deletion, suspension, resume and diagnosis requests are audited with organization, integer actor ID and capture ID. Binary payloads are not copied into audit records.

## Verification

- `go test -race ./services/runtime/internal/telemetry ./services/runtime/internal/devices`
- API: `php artisan test --filter=TelemetryCaptureTest` from `apps/api`.
- UI: `STUDIO_BASE_URL=http://localhost:5173 pnpm --filter @iot-os/portal exec playwright test e2e/telemetry.spec.ts` against a built portal. The test uses mocked API responses and verifies controls, AI review, export, accessibility and mobile layout.
- Real transport/storage: start the disposable `tooling/test-devices.mjs --serve` harness, run `tooling/verify-devices.mjs <environment.json>`, then `tooling/verify-telemetry.mjs <environment.json>`. The telemetry verifier changes only the disposable meter's calibration and proves binary capture, conversion fidelity, tenant isolation, suspension, resume and automatic expiry.
