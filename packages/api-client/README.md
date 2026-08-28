# API Client

Administration request methods remain hand-written for the current portal.
Device Domain request/response types are generated from the committed OpenAPI
contract in `src/device-domain.generated.ts`.

Regenerate and verify from the workspace root:

```bash
pnpm contracts:generate
pnpm --filter @iot-os/api-client typecheck
```

`src/device-domain-vocabulary.ts` exports UI-safe enum values and contains exact
compile-time assertions against the generated unions.
