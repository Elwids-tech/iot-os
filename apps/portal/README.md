# Portal

The tenant React app (Vite, React Router, TanStack Query), served on
http://localhost:5173. It talks only to the Laravel API through
`@iot-os/api-client` and is built from the `@iot-os/ui` design system.

```sh
pnpm --filter @iot-os/portal dev     # hot reload; stop the portal container first
pnpm --filter @iot-os/portal lint    # tsc + design-system guardrails
pnpm --filter @iot-os/portal test    # Vitest
STUDIO_BASE_URL=http://localhost:5173 pnpm --filter @iot-os/portal exec playwright test
```

Feature code is grouped by area under `src/` (devices, profiles, dashboards,
automation, alerts, integrations, …). See [docs](../../docs/README.md),
[design system](../../docs/dev/design-system.md) and
[testing](../../docs/dev/testing.md).
