<?php

/*
 * Scramble generates the public API contract (contracts/openapi/openapi.json) through
 * `php artisan contract:export`. It is a dev dependency, so this file is read only where
 * it is installed; App\Support\Contract\ContractServiceProvider applies it and turns
 * off Scramble's own /docs/api routes. See docs/reference/api.md.
 */
return [
    /*
     * Paths are documented relative to /api, so they read /v1/... and /integration/v1/....
     */
    'api_path' => 'api',

    'api_domain' => null,

    /*
     * Project settings for the contract (App\Support\Contract), not read by Scramble.
     */
    'contract' => [
        // The route resolver keeps only routes under these prefixes; /api/internal/*
        // belongs to the internal contracts, not the public one.
        'route_prefixes' => ['api/v1', 'api/integration/v1'],

        // contracts/openapi; empty means config('devices.contracts_path').'/openapi'.
        'directory' => null,

        // contract:check fails when an integration operation is on the pending-schema
        // list: the integration API is fully described (spec 001 PR 3).
        'forbid_pending_integration' => true,

        // contract:coverage requires a 2xx, 401, 403 and 404 (plus 422 with input) for
        // every integration operation (tests/Feature/Contract/IntegrationContractTest).
        'require_integration_coverage' => true,
    ],

    /*
     * The export writes `servers: [{url: /api}]` itself (SupplementTransformer). Scramble
     * would pass any value here through url(), which makes it absolute and dependent on
     * APP_URL.
     */
    'servers' => null,

    'info' => [
        // Overwritten by contracts/openapi/supplements/info.yaml.
        'version' => '0.0.0',
        'description' => '',
    ],

    'ui' => [
        'title' => 'IoT OS API',
    ],

    /*
     * Off: the development tools register a /_scramble route, and the contract adds no
     * route in any environment.
     */
    'dev_tools' => [
        'enabled' => false,
    ],

    'enum_cases_description_strategy' => 'description',

    'enum_cases_names_strategy' => false,

    'flatten_deep_query_parameters' => true,

    'middleware' => [],

    'extensions' => [],

    /*
     * Security is written by App\Support\Contract\SecurityTransformer from each route's
     * middleware, not by Scramble's strategy.
     */
    'security_strategy' => null,
];
