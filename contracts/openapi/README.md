# Device Domain OpenAPI Contracts

Two OpenAPI 3.1 documents describe the canonical boundary:

- `device-domain.v1.yaml` — tenant-scoped Laravel APIs for dynamic Profiles, Native MQTT Bindings, logical Devices, exact definition assignments, Gateways, and Gateway Routes.
- `runtime-internal.v1.yaml` — planned authenticated Laravel-to-Go compiler API.

Both use repository-relative `$ref` values. `openapi-typescript` generates the single committed file `packages/api-client/src/device-domain.generated.ts`.

The public contract establishes authenticated Organization context, idempotency keys for create/transition operations, ETags and `If-Match` for mutable drafts, and RFC 9457 Problem Details.

Validate and regenerate from the workspace root:

```bash
pnpm --filter @iot-os/contracts lint:openapi
pnpm contracts:generate
pnpm --filter @iot-os/api-client typecheck
```

The Laravel Profile, Binding, Device, definition-assignment, Gateway, and Route APIs are implemented in M1a-D4R2. The Go compile endpoint remains disabled until the canonical M1a-D4R3 compiler passes its contract and determinism suites.
