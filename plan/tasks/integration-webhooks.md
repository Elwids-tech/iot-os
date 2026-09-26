# Signed application webhooks

Delivered 2026-09-25. [Contract and runtime guide](../../docs/integration-webhooks.md).

- One revision-controlled endpoint per application; encrypted signing secrets returned once.
- Exact operator host allowlist, public IPv4 validation at configuration/send, pinned DNS, TLS verification, no proxies/redirects and bounded transfer time.
- Separate database-backed delivery worker, stable logical IDs/bodies, attempt history, bounded automatic retries and audited manual recovery.
- Current application/device grants checked before every send; revocation, disabling and reconfiguration cancel pending work.
- SDK 0.3.0 verifies raw-body HMAC and timestamp skew. Receiver-side durable deduplication remains required.

Verification: API and SDK suites, rebuilt API/workers, isolated local receiver rejecting the first attempt and accepting the retry, PHP-to-Node signature compatibility, tampered-body rejection, stable identities, delivery history and disabling. The SDK verifier was also exercised from a separately installed package. Test-only endpoint allowance is removed afterward; fixture data and credentials are cleaned.

Pending: webhook management UI, configurable retention, IPv6 receivers, production egress deployment/load validation. Raw telemetry/location reads are delivered in SDK 0.5.0. Latest telemetry and chart history are now delivered in the [telemetry slice](integration-telemetry.md). Delivery can duplicate or arrive out of order; the ordered journal remains the reconciliation interface. Visual builder remains deferred.
