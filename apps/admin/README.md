# Admin

The platform administration React app, served on http://localhost:5174:
organizations (create, edit, delete empty ones) and their permission ceilings, each
organization's roles (create, rename, delete, edit permissions), users and
invitations, super administrators (promote, remove, invite) and telemetry retention.
It requires `PlatformAdministration.access`
([access](../../docs/features/access.md#platform-administration)).

```sh
pnpm --filter @iot-os/admin dev      # hot reload; stop the admin container first
pnpm --filter @iot-os/admin lint     # tsc + design-system guardrails
pnpm --filter @iot-os/admin test     # Playwright against a Vite dev server on 4174
```
