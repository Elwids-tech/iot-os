# Public Device Domain OpenAPI Contract

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
