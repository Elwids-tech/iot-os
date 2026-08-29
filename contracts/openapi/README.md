# Public Device Domain OpenAPI Contract

`device-domain.v2.yaml` and `runtime-internal.v2.yaml` are the executable rectification contracts for dynamic Profile v2 authoring, Gateways, Gateway Routes, route-aware preview, and Runtime Bundles. They are planned surfaces until D4R2 and D4R3 respectively; linting and generated TypeScript do not claim endpoint implementation.

Both v1 and v2 API descriptions use repository-relative `$ref` values and are linted before TypeScript generation. The generated v2 surface is committed as `packages/api-client/src/device-domain-v2.generated.ts`.

`device-domain.v1.yaml` is the canonical planned Laravel API contract for M1a
definition authoring and single-Device registration. Routes become implemented
only when their corresponding milestone is completed.

The contract establishes:

- Sanctum cookie or bearer authentication;
- required `X-Organization-UUID` selection while authenticated membership
  remains authoritative;
- idempotency keys for create and transition operations;
- ETags and `If-Match` for mutable Version drafts;
- RFC 9457 Problem Details; and
- exact Profile, Binding, preview, proposal, Device, and assignment shapes.

Validate and regenerate from the workspace root:

```bash
pnpm --filter @iot-os/contracts lint:openapi
pnpm contracts:generate
pnpm --filter @iot-os/api-client typecheck
```

The generated file is committed. CI should regenerate it and reject a diff.
