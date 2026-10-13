<?php

declare(strict_types=1);

// laravel/mcp (spec 004). Only the server side is used: agents connect to /mcp.
return [
    // Return addresses agents may register, as URL prefixes ("https://claude.ai",
    // "http://localhost" for command-line agents), or "*" for any. Comma-separated in
    // IOT_AGENTS_REDIRECT_DOMAINS.
    'redirect_domains' => array_values(array_filter(array_map('trim', explode(',', (string) env('IOT_AGENTS_REDIRECT_DOMAINS', '*'))))),

    'custom_schemes' => [],

    // Passport on this application is the authorization server.
    'authorization_server' => null,

    'tool_search' => [
        'max_tool_calls' => 10,
        'max_output_bytes' => 65_536,
    ],

    'clients' => [],
];
