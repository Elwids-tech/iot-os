# Telemetry viewer

Implement the approved three-view design using the existing portal shell and actual runtime evidence.

- Timed, organization-scoped gateway captures (optional source-device filter), 60–600 seconds.
- Capture received binary payloads, decoded Sparkplug values, protocol errors, mapping, conversion, validation/calculation outputs and persistence outcomes. Raw means platform ingress, not pre-gateway sensor data.
- Reuse the runtime conversion/validation engine. Correlate durable handoff and persistence; never label handoff as storage.
- Bounded volatile capture storage: at most 32 sessions globally, 4 per organization, 200 messages per session, 64 KiB per message. Retain stopped captures for 30 minutes; runtime restart clears captures and releases suspensions.
- Explicit, authorized single-device suspension only, with automatic expiry/resume. Capture does not suspend by default. Suspended readings are inspected but not handed to production storage or latest-value state.
- Live stream, stage comparison and capture-grounded AI diagnosis. AI has no broker access or write tools. Suggestions are reviewed through existing configuration editing and activation controls.
- Verify authorization, limits, expiry, trace fidelity, persistence correlation, UI controls, and rebuilt local services.
