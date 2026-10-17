# API client

`@iot-os/api-client` is the hand-written TypeScript client the portal and admin use
to call the Laravel API with session cookies and CSRF. It is not generated yet: the
OpenAPI description in [`contracts/openapi`](../../contracts/openapi) is not used to
build it ([API surface](../../docs/reference/api.md#contract)). Keep its types in step
with the Laravel resources when you change an endpoint, and run
`pnpm --filter @iot-os/api-client typecheck`.

External applications use [`@iot-os/integration-sdk`](../integration-sdk/README.md)
instead.
