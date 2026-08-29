# Cross-Language Contracts

This directory is the language-neutral Device Domain boundary shared by Laravel, Go, React, future broker adapters, and external automation.

## Canonical contract

The Gateway-routed dynamic model is the first supported contract and therefore uses public `v1` identities. There is no parallel legacy contract.

The contract set defines:

- dynamically authored Device Profile parameters, derivations, properties, events, and Commands;
- Native MQTT channels, parameter-UUID mappings, calibration, missing/invalid policies, and Command correlation;
- authenticated Gateway identity and Gateway-to-logical-Device routes;
- deterministic compile requests, previews, artifacts, and Runtime Bundles; and
- one-value-per-parameter canonical telemetry with stable Device and parameter UUID identity.

## Sources of truth

- `definitions/common/v1/schema.json` owns shared primitives and vocabulary.
- `definitions/device-profile/v1` owns transport-independent semantics.
- `definitions/native-mqtt-binding/v1` owns MQTT wire-format behavior.
- `definitions/device/v1` and `definitions/device-definition-assignment/v1` own logical Device onboarding inputs.
- `definitions/gateway/v1` and `definitions/gateway-route/v1` own communication and routing identity.
- `definitions/definition-compile-request/v1` and `definitions/definition-preview/v1` own the Laravel-to-Go compiler boundary.
- `definitions/runtime-bundle/v1` owns immutable route-aware runtime configuration.
- `definitions/canonical-telemetry/v1` owns normalized telemetry values.
- `openapi/device-domain.v1.yaml` describes the public Laravel control-plane surface.
- `openapi/runtime-internal.v1.yaml` describes the authenticated Go compiler surface.
- `fixtures/device-onboarding/manifest.json` declares positive and negative schema/semantic cases.

Schema `$id` values are stable wire identities. Repository-relative `$ref` values keep validation and client generation offline and reproducible.

## Verification

From the workspace root:

```bash
pnpm contracts:check
pnpm contracts:generate
pnpm --filter @iot-os/api-client typecheck
```

The committed TypeScript client is generated only from `device-domain.v1.yaml`. PHP and Go vocabulary checks independently read the canonical common schema.

Passing these checks proves static contract consistency only. It does not prove compiler runtime, broker ingestion, time-series writes, command delivery, deployment, or physical-device behavior.
