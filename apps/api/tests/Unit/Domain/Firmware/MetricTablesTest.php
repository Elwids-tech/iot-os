<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Firmware;

use App\Domain\Firmware\Services\MetricTables;
use InvalidArgumentException;
use Tests\TestCase;

final class MetricTablesTest extends TestCase
{
    public function test_only_reported_parameters_become_metrics_typed_as_sparkplug(): void
    {
        $metrics = (new MetricTables)->metrics($this->fixture('direct-sensor')['revisions'][0]['definition']);

        // The derived level_alarm and the unreported calibrated_at are left out.
        $this->assertSame(['level', 'temperature'], array_column($metrics, 'key'));
        $this->assertSame(['key' => 'level', 'label' => 'Tank level', 'description' => null, 'datatype' => 'Double', 'unit' => '%', 'writable' => false,
            'enum_values' => null, 'min' => 0, 'max' => 100], $metrics[0]);
    }

    public function test_each_profile_data_type_maps_to_one_sparkplug_datatype(): void
    {
        $parameters = array_map(fn (string $type): array => ['key' => $type, 'data_type' => $type, 'kind' => 'state', 'reports_state' => true, 'accepts_command' => $type === 'boolean',
            'validation' => $type === 'enum' ? ['rule' => ['in' => [['var' => 'value'], ['on', 'off']]]] : null], array_keys(MetricTables::DATATYPES));

        $metrics = (new MetricTables)->metrics(['parameters' => $parameters]);

        $this->assertSame(['Boolean', 'Int64', 'Double', 'String', 'String', 'DateTime', 'Bytes'], array_column($metrics, 'datatype'));
        $this->assertSame([true, false, false, false, false, false, false], array_column($metrics, 'writable'));
        $this->assertSame(['on', 'off'], $metrics[3]['enum_values']);
    }

    public function test_identifiers_are_c_safe_and_never_clash(): void
    {
        $this->assertSame(['water_meter', 'water_meter_2', 'p_3_phase', 'meter_v2'], (new MetricTables)->identifiers(['water-meter', 'water.meter', '3-phase', 'meter.v2']));
        $this->assertSame(['gateway_health_2'], (new MetricTables)->identifiers(['gateway-health'], ['gateway_health']));
    }

    public function test_strings_are_escaped_for_c_and_control_characters_refused(): void
    {
        $tables = new MetricTables;
        $this->assertSame('"\\"m\\\\3\\?\\302\\260C"', $tables->string('"m\\3?°C'));
        $this->expectException(InvalidArgumentException::class);
        $tables->string("line\nbreak");
    }

    public function test_a_wide_type_with_long_names_is_flagged_before_its_birth_overflows(): void
    {
        $tables = new MetricTables;
        $short = array_fill(0, 64, ['key' => 'm01', 'datatype' => 'Double']);
        $long = array_fill(0, 64, ['key' => str_repeat('k', 40), 'datatype' => 'Double']);

        $this->assertLessThan(MetricTables::TX_BUFFER, $tables->birthBytes($short));
        $this->assertGreaterThan(MetricTables::TX_BUFFER, $tables->birthBytes($long));
    }

    private function fixture(string $code): array
    {
        return json_decode((string) file_get_contents(base_path('../../contracts/firmware/fixtures/profiles/'.$code.'.json')), true);
    }
}
