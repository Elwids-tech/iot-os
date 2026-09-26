# IoT OS integration SDK

Server-side TypeScript/Node.js client for scoped application access. Node 22.12+
with native fetch; no browser session, React, Laravel, database or broker dependency.
This package is available from the workspace or a local tarball; it has not been
published to a registry.

```sh
pnpm --filter @iot-os/integration-sdk build
pnpm --filter @iot-os/integration-sdk pack --pack-destination /tmp
# In an independent application:
npm install /tmp/iot-os-integration-sdk-0.2.0.tgz
```

```ts
import { IotClient, IotApiError } from '@iot-os/integration-sdk'
const client = new IotClient({
  baseUrl: 'https://api.example.com',
  organization: process.env.IOT_ORGANIZATION!,
  token: process.env.IOT_APPLICATION_TOKEN!,
})
for await (const device of client.allDevices({ perPage: 25 })) {
  console.log(device.uuid, device.name, device.presence)
}
const alerts = await client.alerts({ condition: 'active' })
const episode = await client.alert(alerts.data[0].uuid)
```

Keep tokens on your backend, never in frontend bundles. Use the management APIs
in `docs/application-access.md` to create grants and issue a short-lived token.
Each method also accepts an AbortSignal (inside options for list methods).
`devices`, `alerts` return a page; `device`, `alert` read one authorized resource;
`allDevices`, `allAlerts` iterate bounded pages. Unknown timestamps stay `null`.
List results are current state, not a snapshot, durable event feed or checkpoint.

HTTPS is required. For local loopback only, set `allowInsecureLocalhost: true`.
The default timeout is 15 seconds (configurable up to 120 seconds). Credentials
are omitted and redirects rejected to prevent forwarding the bearer token.
No automatic retry is performed. `IotApiError` provides `status` and numeric
`retryAfterSeconds`; `IotTransportError` represents network failure/cancellation;
`IotContractError` represents an unsupported response. Error messages exclude
server response bodies and transport causes that might contain credentials.

A custom `fetch` implementation may be injected for tests or server observability;
it must honor AbortSignal and redirect handling, and must not log Authorization.
Runtime validators enforce the documented v1 field types and allow additive
fields. Tests cover pagination, malformed responses, timeout, safe URLs and
non-replay of HTTP failures. `examples/read.mjs` is a minimal external consumer.

## Durable alert events (0.2.0)

Grant both `events:read` and `alerts:read` to the application and token. Use
`eventCheckpoint()` before reading current alert state, then `events({cursor,
limit})` to reconcile and resume. Each page returns `data`, `next_cursor` and
`has_more`. Store the next cursor atomically with your processed snapshots, even
for empty pages. Do not advance it after a failed request. Rotation preserves a
cursor; grant changes return 409 and require rebuilding your projection.

The packed `examples/project.mjs` demonstrates bootstrap, single-writer locking,
atomic file replacement and restart across separate Node processes. Run it with
an output path and the same environment variables as `examples/read.mjs`; pass
`--rebuild` to replace old state after a grant change. After a crashed process,
confirm it is stopped before removing a stale `.lock`. For production, use a
transactional database and deduplicate business side effects by event ID.

The journal begins at deployment with no historical transition backfill. Existing
alerts are reconciled through the current-state API. Events are retained
indefinitely for now; configurable retention and signed webhooks remain pending.
See the repository's `docs/integration-events.md` for the contract and limits.
