# Cross-Language Contracts

This directory is the language-neutral boundary between Laravel, Go, React,
future broker adapters, and external automation. M1a-D0 establishes executable
Device Domain contracts; it does not claim that their planned API routes or
runtime behavior are implemented.

## Sources of truth

- `definitions/common/v1/schema.json` owns the shared enum and primitive
  vocabulary.
- `definitions/device-profile/v1` owns transport-independent semantic
  capabilities.
- `definitions/native-mqtt-binding/v1` owns firmware MQTT topics, JSON paths,
  mappings, event dispatch, and Command correlation.
- `definitions/definition-preview/v1` owns deterministic compiler diagnostics
  and fixture previews.
- `definitions/definition-compile-request/v1` owns the Laravel-to-Go compiler
  request.
- `definitions/device-onboarding-proposal/v1` owns the draft-first AI/MCP
  confirmation payload.
- `openapi/device-domain.v1.yaml` describes the planned public Laravel API.
- `openapi/runtime-internal.v1.yaml` describes the implemented internal Go
  compiler API.
- `fixtures/device-onboarding/manifest.json` declares positive and negative
  schema cases.

Schema `$id` values are stable public identities. Relative `$ref` values keep
local validation and client generation offline and reproducible.

## Verification

From the workspace root:

```bash
pnpm contracts:check
pnpm contracts:generate
pnpm --filter @iot-os/api-client typecheck
```

The PHP and Go vocabulary parity tests independently read the common schema.
Generated TypeScript unions are checked exactly by
`packages/api-client/src/device-domain-vocabulary.ts`.
