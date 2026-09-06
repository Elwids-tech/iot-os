<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices;

use App\Domain\DeviceProfiles\Services\RestrictedExpression;
use Tests\TestCase;

final class DeviceExpressionContractTest extends TestCase
{
    public function test_php_matches_the_shared_runtime_expression_contracts(): void
    {
        $fixtures = json_decode(file_get_contents(base_path('../../contracts/devices/v1/expressions.fixture.json')), true, 512, JSON_THROW_ON_ERROR);
        foreach ($fixtures as $fixture) {
            $this->assertSame($fixture['expected'], app(RestrictedExpression::class)->evaluate($fixture['expression'], $fixture['context']), $fixture['id']);
        }
    }
}
