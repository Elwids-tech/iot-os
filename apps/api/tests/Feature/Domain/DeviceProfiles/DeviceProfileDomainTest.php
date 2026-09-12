<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceProfiles;

use App\Domain\DeviceProfiles\Actions\CompileDeviceProfile;
use App\Domain\DeviceProfiles\Actions\PublishDeviceProfile;
use App\Domain\DeviceProfiles\Actions\ValidateDeviceProfile;
use App\Domain\DeviceProfiles\Data\ProfileDiagnostic;
use App\Domain\DeviceProfiles\Enums\DeviceProfileArtifactStatus;
use App\Domain\DeviceProfiles\Enums\DeviceProfileStatus;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\ProfileParameter;
use App\Domain\DeviceProfiles\Models\TransportBinding;
use App\Domain\DeviceProfiles\Services\DeviceProfileAuthoring;
use App\Domain\DeviceProfiles\Services\ProfileArtifactCache;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Cache;
use Tests\TestCase;

final class DeviceProfileDomainTest extends TestCase
{
    use RefreshDatabase;

    public function test_rgb_light_fixture_compiles_to_its_protocol_neutral_golden_artifact(): void
    {
        $fixture = $this->fixture('rgb-light.v1.json');
        $profile = $this->profileFromFixture($fixture);

        $first = app(CompileDeviceProfile::class)->handle($profile, 1);
        $second = app(CompileDeviceProfile::class)->handle($profile->fresh(), 1);

        $expected = $fixture;
        $expected['schema_version'] = 'device-profile.v2';
        foreach ($expected['parameters'] as &$parameter) {
            $parameter['ingress_conversion'] = null;
        }
        unset($parameter);
        $this->assertEquals($expected, $first->definition);
        $this->assertSame($first->canonicalJson, $second->canonicalJson);
        $this->assertSame($first->hash, $second->hash);
        $this->assertStringNotContainsString('transport_locator', $first->canonicalJson);
        $this->assertStringNotContainsString('adapter_key', $first->canonicalJson);
    }

    public function test_invalid_json_logic_and_calculation_cycles_report_stable_diagnostics(): void
    {
        $profile = $this->profileFromFixture($this->fixture('rgb-light.v1.json'));
        $brightness = $profile->parameters()->where('key', 'brightness')->firstOrFail();
        $brightness->update(['validation_logic' => [
            'engine' => 'json_logic',
            'rule' => ['cat' => [['var' => 'value'], 'watts']],
            'diagnostic_code' => 'bad_logic',
            'message' => 'Bad logic.',
        ]]);

        $derived = $profile->parameters()->where('key', 'estimated_output')->firstOrFail();
        $calculation = $derived->calculation()->firstOrFail();
        $calculation->inputs()->create([
            'profile_parameter_id' => $derived->getKey(),
            'alias' => 'self',
        ]);

        $diagnosticCodes = array_map(
            static fn (ProfileDiagnostic $diagnostic): string => $diagnostic->code,
            app(ValidateDeviceProfile::class)->diagnostics($profile->fresh()),
        );

        $this->assertContains('validation_logic.unsupported_operator', $diagnosticCodes);
        $this->assertContains('calculation.dependency_cycle', $diagnosticCodes);
    }

    public function test_publication_is_atomic_retires_the_old_artifact_and_rebuilds_cache_from_immutable_data(): void
    {
        $fixture = $this->fixture('rgb-light.v1.json');
        $profile = $this->profileFromFixture($fixture);
        $actor = User::factory()->create();
        $publish = app(PublishDeviceProfile::class);

        $first = $publish->handle($profile, $actor, 1);

        $this->assertSame(DeviceProfileArtifactStatus::ACTIVE, $first->status);
        $this->assertSame(DeviceProfileStatus::PUBLISHED, $profile->fresh()->status);
        $this->assertDatabaseCount('device_profile_activation_outbox', 1);
        $this->assertSame(
            ['definition_hash' => $first->definition_hash, 'revision' => 1],
            Cache::get(app(ProfileArtifactCache::class)->activeKey($profile->uuid)),
        );

        app(DeviceProfileAuthoring::class)->mutate($profile->fresh(), $actor, 1, static function (DeviceProfile $locked): null {
            $locked->name = 'RGB Light revised';

            return null;
        });
        $second = $publish->handle($profile->fresh(), $actor, 2);

        $this->assertSame(2, $second->revision);
        $this->assertDatabaseHas('device_profile_artifacts', [
            'device_profile_id' => $profile->getKey(),
            'revision' => 1,
            'status' => DeviceProfileArtifactStatus::RETIRED->value,
        ]);
        $this->assertDatabaseHas('device_profile_artifacts', [
            'device_profile_id' => $profile->getKey(),
            'revision' => 2,
            'status' => DeviceProfileArtifactStatus::ACTIVE->value,
        ]);
        $this->assertDatabaseCount('device_profile_activation_outbox', 2);
    }

    public function test_same_stable_parameter_uuid_can_be_mapped_by_http_and_sparkplug_without_changing_profile_contract(): void
    {
        $profile = $this->profileFromFixture($this->fixture('three-phase-energy-meter.v1.json'));
        $parameter = $profile->parameters()->where('key', 'voltage.l1')->firstOrFail();
        $sparkplug = $this->bindingFixture('sparkplug-b-three-phase-energy-meter.json');
        $http = $this->bindingFixture('http-three-phase-energy-meter.json');

        foreach ([$sparkplug, $http] as $index => $bindingFixture) {
            $binding = $profile->transportBindings()->create([
                'adapter_key' => $bindingFixture['adapter_key'],
                'name' => $bindingFixture['adapter_key'].' binding',
            ]);
            $mapping = $bindingFixture['mappings'][0];
            $binding->parameterMappings()->create([
                'profile_parameter_id' => $parameter->getKey(),
                'direction' => $mapping['direction'],
                'transport_locator' => $mapping['transport_locator'],
            ]);
        }

        $this->assertSame(2, TransportBinding::query()->count());
        $this->assertSame(1, ProfileParameter::query()->where('uuid', $parameter->uuid)->count());
        $this->assertSame('Voltage L1', $profile->transportBindings()->where('adapter_key', 'sparkplug_b')->firstOrFail()->parameterMappings()->firstOrFail()->transport_locator['metric']);
        $this->assertSame('$.measurements.voltage_l1', $profile->transportBindings()->where('adapter_key', 'http')->firstOrFail()->parameterMappings()->firstOrFail()->transport_locator['path']);
    }

    /**
     * @return array<string, mixed>
     */
    private function fixture(string $name): array
    {
        /** @var array<string, mixed> $fixture */
        $fixture = json_decode(
            file_get_contents(dirname(base_path(), 2).'/contracts/definitions/device-profiles/'.$name),
            true,
            flags: JSON_THROW_ON_ERROR,
        );

        return $fixture;
    }

    /**
     * @return array<string, mixed>
     */
    private function bindingFixture(string $name): array
    {
        /** @var array<string, mixed> $fixture */
        $fixture = json_decode(
            file_get_contents(dirname(base_path(), 2).'/contracts/definitions/device-profiles/bindings/'.$name),
            true,
            flags: JSON_THROW_ON_ERROR,
        );

        return $fixture;
    }

    /**
     * @param  array<string, mixed>  $fixture
     */
    private function profileFromFixture(array $fixture): DeviceProfile
    {
        $organization = Organization::factory()->create();
        $profileFixture = $fixture['profile'];
        $profile = DeviceProfile::query()->create([
            'uuid' => $profileFixture['uuid'],
            'organization_id' => $organization->getKey(),
            'code' => $profileFixture['code'],
            'name' => $profileFixture['name'],
            'category' => $profileFixture['category'],
        ]);

        $parameters = [];
        foreach ($fixture['parameters'] as $sortOrder => $parameterFixture) {
            $parameters[$parameterFixture['uuid']] = $profile->parameters()->create([
                'uuid' => $parameterFixture['uuid'],
                'key' => $parameterFixture['key'],
                'label' => $parameterFixture['label'],
                'kind' => $parameterFixture['kind'],
                'data_type' => $parameterFixture['data_type'],
                'format' => $parameterFixture['format'],
                'unit' => $parameterFixture['unit'],
                'reports_state' => $parameterFixture['reports_state'],
                'accepts_command' => $parameterFixture['accepts_command'],
                'validation_logic' => $parameterFixture['validation'],
                'display_config' => $parameterFixture['display'],
                'reporting_config' => $parameterFixture['reporting'],
                'counter_config' => $parameterFixture['counter'],
                'sort_order' => $sortOrder,
            ]);
        }

        foreach ($fixture['calculations'] as $calculationFixture) {
            $calculation = $profile->calculations()->create([
                'target_profile_parameter_id' => $parameters[$calculationFixture['target_parameter_uuid']]->getKey(),
                'engine' => $calculationFixture['engine'],
                'expression' => $calculationFixture['expression'],
                'trigger' => $calculationFixture['trigger'],
                'failure_policy' => $calculationFixture['failure_policy'],
            ]);
            foreach ($calculationFixture['inputs'] as $input) {
                $calculation->inputs()->create([
                    'profile_parameter_id' => $parameters[$input['parameter_uuid']]->getKey(),
                    'alias' => $input['alias'],
                ]);
            }
        }

        foreach ($fixture['alarm_templates'] as $alarmFixture) {
            $alarm = $profile->alarmTemplates()->create([
                'uuid' => $alarmFixture['uuid'],
                'code' => $alarmFixture['code'],
                'name' => $alarmFixture['name'],
                'type' => $alarmFixture['type'],
                'severity' => $alarmFixture['severity'],
                'condition_config' => $alarmFixture['condition'],
                'enabled_by_default' => $alarmFixture['enabled_by_default'],
            ]);
            foreach ($alarmFixture['parameters'] as $reference) {
                $alarm->parameterReferences()->create([
                    'profile_parameter_id' => $parameters[$reference['parameter_uuid']]->getKey(),
                    'role' => $reference['role'],
                ]);
            }
        }

        return $profile;
    }
}
