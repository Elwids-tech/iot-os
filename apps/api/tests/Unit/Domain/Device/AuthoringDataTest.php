<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Device;

use App\Domain\DeviceManagement\Data\DeviceDraftData;
use App\Domain\DeviceProfile\Data\DeviceProfileAuthoringData;
use App\Domain\DeviceProfile\Data\NativeMqttBindingAuthoringData;
use InvalidArgumentException;
use JsonException;
use PHPUnit\Framework\TestCase;

final class AuthoringDataTest extends TestCase
{
    /**
     * @throws JsonException
     */
    public function test_contract_fixtures_round_trip_through_php_authoring_data(): void
    {
        $profilePayload = $this->fixture('profile.json');
        $bindingPayload = $this->fixture('binding.json');

        self::assertSame($profilePayload, DeviceProfileAuthoringData::fromArray($profilePayload)->toArray());
        self::assertSame($bindingPayload, NativeMqttBindingAuthoringData::fromArray($bindingPayload)->toArray());
        self::assertSame(
            ['name' => 'Sensor 1', 'external_id' => 'sensor-001', 'description' => null],
            DeviceDraftData::fromArray(['name' => 'Sensor 1', 'external_id' => 'sensor-001'])->toArray(),
        );
    }

    public function test_unknown_contract_versions_are_rejected(): void
    {
        $this->expectException(InvalidArgumentException::class);

        DeviceProfileAuthoringData::fromArray(['schema' => 'iot.device-profile.authoring.v2']);
    }

    /**
     * @return array<string, mixed>
     *
     * @throws JsonException
     */
    private function fixture(string $name): array
    {
        $path = dirname(__DIR__, 6)."/contracts/fixtures/device-onboarding/valid/temperature-humidity-thermostat/{$name}";
        $contents = file_get_contents($path);

        self::assertNotFalse($contents);

        return json_decode($contents, true, flags: JSON_THROW_ON_ERROR);
    }
}
