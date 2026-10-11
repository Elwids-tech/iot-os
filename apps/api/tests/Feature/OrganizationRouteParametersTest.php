<?php

declare(strict_types=1);

namespace Tests\Feature;

use Illuminate\Routing\Route;
use Illuminate\Support\Facades\Route as Router;
use Tests\TestCase;

/**
 * Postgres answers a malformed uuid or bigint in a lookup with a 500 that SQLite never raises, so no request
 * in this suite can show the failure. Each organization-scoped path parameter therefore declares a pattern,
 * and a malformed id is a 404 before any middleware or query runs.
 */
final class OrganizationRouteParametersTest extends TestCase
{
    /** Parameters their controller validates instead: a malformed timeline evaluation is a 422. */
    private const VALIDATED_IN_CONTROLLER = [
        'api/v1/organizations/{organization}/workflows/{workflow}/timeline/{evaluation}' => ['evaluation'],
    ];

    public function test_every_organization_route_parameter_declares_a_pattern(): void
    {
        $unconstrained = [];
        foreach (Router::getRoutes() as $route) {
            /** @var Route $route */
            if (! preg_match('#^api/(integration/)?v1/organizations/\{organization\}#', $route->uri())) {
                continue;
            }
            $exempt = self::VALIDATED_IN_CONTROLLER[$route->uri()] ?? [];
            foreach (array_diff($route->parameterNames(), array_keys($route->wheres), $exempt) as $parameter) {
                $unconstrained[] = implode('|', $route->methods()).' '.$route->uri().' {'.$parameter.'}';
            }
        }

        $this->assertSame([], $unconstrained, 'Constrain these parameters with whereUuid, whereNumber or where.');
    }
}
