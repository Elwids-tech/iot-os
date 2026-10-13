<?php

declare(strict_types=1);

// AI agent access (spec 004): people connect MCP clients such as Claude through
// Passport. Off by default; each organization also starts switched off.
return [
    'enabled' => (bool) env('IOT_AGENTS_ENABLED', false),

    // The MCP endpoint is the only OAuth resource. Tokens are for this URL alone.
    'resource' => rtrim((string) env('APP_URL', 'http://localhost'), '/').'/mcp',

    // A connection with no tool call for this many days stops working (FR-012).
    'connection_idle_days' => 90,

    // Tool-call records are kept this long (FR-034 asks for at least 90 days).
    'activity_days' => (int) env('IOT_AGENTS_ACTIVITY_DAYS', 90),

    'rate_per_minute' => 120,
    'rate_per_hour' => 2000,

    // Claude caps tool results at about 150,000 characters; stay well under it.
    'max_result_characters' => 60000,

    // Registered clients that never connect are deleted after this many hours.
    'unused_client_hours' => 24,
];
