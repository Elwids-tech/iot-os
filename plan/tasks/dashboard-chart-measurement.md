# Dashboard regression follow-up

During independent application host verification, the existing core dashboard
browser scenario intermittently failed. The sample's standalone image and live
SDK checks passed; no core chart implementation was changed in that slice.

Reproduction against the served local portal:

```sh
rtk proxy env STUDIO_BASE_URL=http://localhost:5173 pnpm --filter @iot-os/portal exec playwright test e2e/dashboards.spec.ts --grep 'workflow panels'
```

Observed two failures in separate runs:

- The mobile editor accessibility scan reported `color-contrast` on primary
  buttons. The final failure screenshot showed the normal editor; animation or
  transient state may matter, but this has not been established.
- After save/reload and a full-page screenshot, React reported maximum update
  depth (`#185`) from the Recharts bounding-box callback in
  `chart-tBxupoXf.js:1:47073`. The callback compares measured dimensions/position
  and calls setState. The test then waited for the missing refresh button because
  the route displayed its error boundary. Root cause is not yet established.

The focused location-expiry test passed, as did all 34 portal unit tests, shared UI
and sample typechecks, and the independently containerized sample's real SDK/API
and browser checks. Do not describe the core dashboard browser regression run as
passing. Diagnose the measurement loop and the contrast failure before extending
live dashboard behavior; avoid hiding failures by removing assertions.
