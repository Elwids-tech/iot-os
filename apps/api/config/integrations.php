<?php

// The application telemetry stream (spec 030, ADR-032). A stream occupies one PHP
// worker for up to its lifetime, so the open-stream limits size the serving pool:
// docs/ops/release.md explains the arithmetic behind the defaults.
return [
    // Seconds after `open` at which a stream is closed with reason `lifetime`; the
    // client resumes from its last position.
    'stream_lifetime_seconds' => (int) env('IOT_STREAM_LIFETIME_SECONDS', 3600),
    // Open streams allowed across the deployment, per application and per organization.
    'streams_max_open' => (int) env('IOT_STREAMS_MAX_OPEN', 10),
    'streams_per_application' => (int) env('IOT_STREAMS_PER_APPLICATION', 2),
    'streams_per_organization' => (int) env('IOT_STREAMS_PER_ORGANIZATION', 10),
    // Seconds between the relay's re-checks of the grant, the credentials and (for a
    // site scope) the resolved device set; also how often the session row is touched.
    'stream_recheck_seconds' => 30,
    // Seconds of silence after which the relay writes a `: keepalive` comment of its own.
    'stream_keepalive_seconds' => 60,
];
