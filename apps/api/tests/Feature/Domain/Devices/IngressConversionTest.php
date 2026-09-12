<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Devices;

use App\Domain\DeviceProfiles\Services\IngressConversion;
use Illuminate\Validation\ValidationException;
use Tests\TestCase;

final class IngressConversionTest extends TestCase
{
    public function test_shared_conversion_fixtures_match_the_runtime(): void
    {
        $fixtures = json_decode(file_get_contents(base_path('../../contracts/devices/v2/conversions.fixture.json')), true, 512, JSON_THROW_ON_ERROR);
        foreach ($fixtures as $fixture) {
            try {
                $result = app(IngressConversion::class)->apply(['kind' => 'measurement', 'data_type' => $fixture['type'] ?? 'number', 'reports_state' => true, 'ingress_conversion' => $fixture['conversion']], $fixture['value']);
                $this->assertFalse($fixture['error'] ?? false, $fixture['name']);
                $this->assertEqualsWithDelta($fixture['expected'], $result, 1e-10, $fixture['name']);
            } catch (ValidationException $exception) {
                $this->assertTrue($fixture['error'] ?? false, $fixture['name'].': '.$exception->getMessage());
            }
        }
    }

    public function test_ineligible_parameters_and_monotonic_counters_are_rejected(): void
    {
        $conversion = ['source_unit' => 'W', 'multiplier' => 0.001, 'offset' => 0];
        foreach ([['kind' => 'derived'], ['data_type' => 'string'], ['accepts_command' => true], ['reports_state' => false]] as $change) {
            try {
                app(IngressConversion::class)->validate(array_replace(['kind' => 'measurement', 'data_type' => 'number', 'reports_state' => true], $change), $conversion);
                $this->fail('Ineligible conversion was accepted');
            } catch (ValidationException) {
                $this->addToAssertionCount(1);
            }
        }
        $this->expectException(ValidationException::class);
        app(IngressConversion::class)->validate(['kind' => 'counter', 'data_type' => 'number', 'counter_config' => ['monotonic' => true]], array_replace($conversion, ['multiplier' => -1]));
    }
}
