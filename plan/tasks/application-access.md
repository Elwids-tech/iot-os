# Application access and Node SDK — first P3 slice

Delivered 2026-09-25. [Contract and operations](../../docs/application-access.md).

- Separate organization-owned application identities with explicit device grants and two read abilities.
- Hashed Sanctum token storage with machine-only authentication; portal/session credentials cannot substitute.
- Expiry, revision-checked rotation, grant updates that invalidate tokens, permanent revocation and actor audit.
- Shared application request quota and bounded grants/pages.
- Versioned read-only device metadata and alert state, isolated from internal credentials, people and comments.
- Independently packaged TypeScript/Node SDK with native fetch, typed/runtime-checked responses, pagination, timeout/cancellation, no redirects or automatic replay.

Verification: 137 Laravel tests, six SDK tests, rebuilt API and worker containers; SDK tarball installed into a separate temporary Node project and exercised over real HTTP for reads, pagination, scope denial, portal separation, rotation, reduced abilities and revocation. Temporary fixture credentials/data removed. No registry publication or production deployment.

Follow-up: [durable alert polling and recovery](../../docs/integration-events.md) delivered in SDK 0.2.0.

Signed webhooks are delivered in the subsequent [webhook slice](../../docs/integration-webhooks.md).

Latest telemetry and chart history are delivered in [SDK 0.4.0](../../docs/integration-telemetry.md). Still pending in P3: integration management UI, and pilot-scale quota/load verification. Current-state lists are not an event stream. Visual builder deferred.
