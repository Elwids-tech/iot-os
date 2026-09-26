# Integration management UI

Delivered: organization-scoped application directory and grants editor, searchable
device selection, token issuance/rotation with one-time secrets, webhook
configuration/disable/history/retry and permanent revocation. Existing server
permissions, revisions and destination restrictions remain authoritative.

Also corrected the three-ability validation cap to support all four existing
abilities, and added safe credential expiry/ability and device-label metadata.

Verification: 152 API tests, portal unit tests, portal/admin typechecks, browser
lifecycle/conflict/mobile/permission/secret-expiry checks with accessibility scans,
and a real local portal → API → webhook receiver run. Rebuilt API, workers, portal
and administration. Temporary records and receiver were removed; normal webhook
configuration restored. No production deployment or package publication.

See [user behavior and verification](../../docs/integration-management.md).

Next: P4 generic location/alert presentation. P3 pilot quotas/load, retention and
production egress checks remain pending; the visual workflow builder is deferred.
