# Independent field application sample

A server-rendered React application using the Node.js integration SDK and shared
UI components. It has no portal, API-client, auth-package, database or broker
imports. The build rejects core frontend imports, bundles runtime dependencies,
and runs from its own Docker image. No browser JavaScript or platform token is
sent to the client.

This is a local, single-organization integration example, not a deployable
multi-tenant cattle product. It demonstrates application-owned device/evidence
associations and a backend adapter. A real host must add its own user login,
per-user tenant authorization, storage, sessions, operating limits and deployment
configuration. Do not expose this demonstration directly to customers.

## Evidence semantics

The host explicitly chooses one device, event, approved binding version and alert.
The SDK resolves the selected stored GPS event at server time. The shared
`StoredLocation` component renders paired coordinates or unknown evidence. It
never calls this the latest location, infers geofence membership, or manufactures
workflow execution state. Missing accuracy remains unknown. A new shared component
is intentional: the portal's `LocationOverview` needs live execution/geometry
contracts that the machine SDK does not currently expose.

The existing shared `AlertOverview` renders **only the selected episode**. Its
counts are labelled as that subset; no paginated list is mistaken for complete
workflow totals. An acknowledged active episode stays active. The adapter refuses
to associate an alert from another device with the selected device. Location and
alert failures are independent, render unavailable, and do not retain old data.

The page is a point-in-time server render. **Refresh evidence** performs new SDK
reads, reevaluating permissions and stored-fix freshness. There is no background
polling, live telemetry feed or stateful browser cache. App-owned selections stay
on the server; URL parameters cannot replace device/event/tenant identities.

## Run locally

Use Node 22.12+ and the workspace pnpm version:

```sh
rtk pnpm install --frozen-lockfile
rtk pnpm --filter @iot-os/integration-sdk build
rtk pnpm --filter @iot-os/vertical-demo build
rtk pnpm --filter @iot-os/vertical-demo start
```

Set these server environment variables before starting. Never put the credential
in a `VITE_` variable, browser source, command argument, or committed file:

| Variable | Value |
| --- | --- |
| `IOT_API_ORIGIN` | HTTPS platform API origin |
| `IOT_ORGANIZATION_UUID` | Organization owning the application |
| `IOT_APPLICATION_TOKEN` | Application token with `telemetry:read` and `alerts:read`, granted the selected device |
| `IOT_DEVICE_UUID` | Selected device |
| `IOT_EVENT_UUID` | Explicit committed telemetry event UUID |
| `IOT_VERSION_UUID` | Approved immutable location-binding deployment UUID |
| `IOT_ALERT_UUID` | Selected alert episode UUID for the same device |
| `PORT` | Optional; defaults to 5180 |
| `PUBLIC_ORIGIN` | Optional; defaults to `http://localhost:5180` with the selected port |
| `IOT_BIND_ADDRESS` | Optional; defaults to `127.0.0.1` |
| `IOT_ALLOW_LOCAL_HTTP` | `1` only for an explicitly local loopback API |

Open `http://localhost:5180`. The expected Host is checked, responses are no-store,
only reads are exposed, and at most four page reads run concurrently. The SDK
request timeout is eight seconds. `/health` confirms the process is serving; it
does not assert that the selected evidence or credentials are valid.

## Standalone image

```sh
rtk docker build -t iot-os-vertical-demo -f deploy/docker/vertical-demo/Dockerfile .
rtk docker run --rm -p 127.0.0.1:5180:5180 --env-file /private/path/vertical-demo.env iot-os-vertical-demo
```

The image contains the bundled application and CSS only; it does not include
portal/admin source or credentials. Use a reachable HTTPS core origin from Docker.
The live verifier uses a temporary loopback TCP relay on the development Docker
network solely to test against the local HTTP API. The relay is not shipped in
the image and does not expand SDK HTTP-origin permissions.

## Verification

`pnpm --filter @iot-os/vertical-demo test` checks adaptation, independent failures
and device association. Typecheck and build verify the portable boundary.

For the live browser check, run `tooling/verify-integration-sdk.php` inside the API
container with `IOT_VERIFY_TELEMETRY=1`, copy its private fixture JSON to the host,
and run `node tooling/verify-vertical-demo.mjs` while it waits. Build the image
first. The verifier issues a temporary scoped token, starts its own container on
port 5180, checks valid and incomplete evidence, acknowledgement, denied device
access, revocation, origin restrictions, mobile layout and accessibility, then
removes the container and private files. Release the PHP fixture by touching
`/tmp/iot-sdk-release` inside the API container, and remove the host fixture JSON.
Human credentials are used only by the verifier to provision/revoke the scoped
application; the sample receives only the machine token.

No package publication, production deployment, real GPS hardware validation,
complete workflow overview, or multi-tenant host implementation is implied.
