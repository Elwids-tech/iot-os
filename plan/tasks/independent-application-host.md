# Independent application host

Delivered a standalone Node/React evidence application in `apps/vertical-demo`.
Its backend uses the integration SDK with device-scoped machine credentials;
shared components render a selected stored GPS fix and alert episode. The host
owns its selections, rejects an unrelated alert/device association, and preserves
unknown evidence and acknowledgement semantics. Build-time checks reject portal,
admin, API-client and core auth imports.

The Docker artifact bundles its runtime dependencies and CSS. Real local SDK/API
verification covers complete/incomplete GPS, active-but-acknowledged alerts,
ungranted devices, revoked tokens, browser credential isolation, strict origin
handling, mobile layout and accessibility. Core portal/admin containers were
rebuilt for the shared presentation addition.

See [sample setup and limitations](../../apps/vertical-demo/README.md).

Core regression follow-up: [chart measurement and contrast failures](dashboard-chart-measurement.md) were exposed during verification and remain unresolved.

Next: resolve that dashboard regression, then decide the pilot's required live machine-view contract (latest committed
location and current workflow state versus selected historical evidence), then
implement the smallest scoped contract needed. Multi-tenant host authentication,
production capacity/retention checks and real-tag acceptance remain pending. The
visual builder remains deferred.
