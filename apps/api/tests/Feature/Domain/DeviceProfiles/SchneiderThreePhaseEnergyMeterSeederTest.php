<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceProfiles;

use App\Domain\DeviceProfiles\Actions\CompileDeviceProfile;
use App\Domain\DeviceProfiles\Actions\ValidateDeviceProfile;
use App\Domain\DeviceProfiles\Enums\DeviceProfileStatus;
use App\Domain\DeviceProfiles\Enums\ProfileParameterKind;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Services\RestrictedExpression;
use App\Domain\Shared\Models\Organization;
use Database\Seeders\SchneiderThreePhaseEnergyMeterSeeder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\QueryException;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use LogicException;
use Tests\TestCase;

final class SchneiderThreePhaseEnergyMeterSeederTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_creates_a_valid_compilable_tenant_draft_even_without_model_events(): void
    {
        $organization = Organization::factory()->create(['slug' => 'acme-manufacturing']);
        Organization::factory()->create();

        Model::withoutEvents(fn () => $this->seed(SchneiderThreePhaseEnergyMeterSeeder::class));

        $profile = DeviceProfile::query()->sole();
        $this->assertSame($organization->getKey(), $profile->organization_id);
        $this->assertSame(SchneiderThreePhaseEnergyMeterSeeder::PROFILE_CODE, $profile->code);
        $this->assertSame(DeviceProfileStatus::DRAFT, $profile->status);
        $this->assertSame(0, $profile->revision);
        $this->assertSame(1, $profile->draft_revision);
        $this->assertNull($profile->published_at);
        $this->assertNull($profile->definition_hash);
        $this->assertNull($profile->extensions['model']);
        $this->assertTrue($profile->extensions['starter']['requires_model_verification']);
        $this->assertCount(6, $profile->parameterGroups);
        $this->assertCount(31, $profile->parameters);
        $this->assertCount(3, $profile->calculations);
        $this->assertCount(1, $profile->alarmTemplates);
        $this->assertSame(31, $profile->parameters->pluck('key')->unique()->count());
        $this->assertSame(range(0, 30), $profile->parameters->pluck('sort_order')->sort()->values()->all());

        $uuids = collect([$profile])->concat($profile->parameters)->concat($profile->parameterGroups)
            ->concat($profile->calculations)->concat($profile->alarmTemplates)->pluck('uuid');
        $this->assertSame($uuids->count(), $uuids->unique()->count());
        $this->assertTrue($uuids->every(fn (string $uuid): bool => Str::isUuid($uuid)));

        foreach ($profile->parameters as $parameter) {
            $this->assertSame($profile->getKey(), $parameter->group->device_profile_id);
            $this->assertFalse($parameter->accepts_command);
            $this->assertSame($parameter->kind !== ProfileParameterKind::DERIVED, $parameter->reports_state);
        }
        $alarm = $profile->alarmTemplates->sole();
        $this->assertFalse($alarm->enabled_by_default);
        $this->assertSame(['max_age_seconds' => 300], $alarm->condition_config);
        $this->assertSame('power.active.total', $alarm->parameterReferences->sole()->parameter->key);
        $this->assertSame([], app(ValidateDeviceProfile::class)->diagnostics($profile->fresh()));
        $compiled = app(CompileDeviceProfile::class)->handle($profile->fresh());
        $this->assertCount(31, $compiled->definition['parameters']);
        $this->assertCount(3, $compiled->definition['calculations']);
        $this->assertDatabaseCount('device_profile_artifacts', 0);
        $this->assertDatabaseCount('device_profile_activation_outbox', 0);
        $this->assertDatabaseCount('transport_bindings', 0);
        $this->assertDatabaseCount('users', 0);
        $this->assertDatabaseCount('organizations', 2);
    }

    public function test_sample_calculations_and_validation_have_sensible_electrical_semantics(): void
    {
        Organization::factory()->create(['slug' => 'acme-manufacturing']);
        $this->seed(SchneiderThreePhaseEnergyMeterSeeder::class);
        $profile = DeviceProfile::query()->sole();
        $evaluator = app(RestrictedExpression::class);

        foreach ([
            ['voltage.average', ['l1' => 229, 'l2' => 230, 'l3' => 231], 230],
            ['current.average', ['l1' => 9, 'l2' => 10, 'l3' => 11], 10],
            ['energy.net', ['imported' => 1500, 'exported' => 250], 1250],
            ['energy.net', ['imported' => 250, 'exported' => 1500], -1250],
        ] as [$key, $samples, $expected]) {
            $calculation = $profile->parameters()->where('key', $key)->sole()->calculation;
            $this->assertEquals($expected, $evaluator->evaluate($calculation->expression, $samples));
            foreach ($calculation->inputs as $input) {
                $expectedKey = in_array($key, ['voltage.average', 'current.average'], true)
                    ? explode('.', $key)[0].'.'.$input->alias
                    : 'energy.'.$input->alias;
                $this->assertSame($expectedKey, $input->parameter->key);
                $this->assertSame($profile->getKey(), $input->parameter->device_profile_id);
            }
        }

        $factorRule = $profile->parameters()->where('key', 'power_factor.total')->sole()->validation_logic['rule'];
        $this->assertTrue($evaluator->evaluate($factorRule, ['value' => -1]));
        $this->assertTrue($evaluator->evaluate($factorRule, ['value' => 1]));
        $this->assertFalse($evaluator->evaluate($factorRule, ['value' => -1.01]));
        $this->assertFalse($evaluator->evaluate($factorRule, ['value' => 1.01]));
        foreach (['voltage.l1', 'current.l1', 'frequency', 'power.apparent.total', 'energy.imported', 'energy.exported'] as $key) {
            $rule = $profile->parameters()->where('key', $key)->sole()->validation_logic['rule'];
            $this->assertTrue($evaluator->evaluate($rule, ['value' => 0]));
            $this->assertFalse($evaluator->evaluate($rule, ['value' => -0.1]));
        }
        foreach (['power.active.total', 'power.reactive.total', 'energy.net'] as $key) {
            $this->assertNull($profile->parameters()->where('key', $key)->sole()->validation_logic);
        }
        $this->assertSame(['monotonic' => true, 'reset_behavior' => 'diagnose'], $profile->parameters()->where('key', 'energy.imported')->sole()->counter_config);
    }

    public function test_rerunning_leaves_all_author_edits_and_other_profiles_untouched(): void
    {
        $organization = Organization::factory()->create(['slug' => 'acme-manufacturing']);
        DeviceProfile::query()->create(['organization_id' => $organization->getKey(), 'code' => 'existing-meter', 'name' => 'My meter']);
        DeviceProfile::query()->create([
            'organization_id' => Organization::factory()->create()->getKey(),
            'code' => SchneiderThreePhaseEnergyMeterSeeder::PROFILE_CODE,
            'name' => 'Another tenant meter',
        ]);
        $this->seed(SchneiderThreePhaseEnergyMeterSeeder::class);
        $profile = DeviceProfile::query()->where('organization_id', $organization->getKey())
            ->where('code', SchneiderThreePhaseEnergyMeterSeeder::PROFILE_CODE)->sole();
        $profile->update(['name' => 'My customized Schneider meter', 'draft_revision' => 8]);
        $profile->parameters()->where('key', 'voltage.l1')->sole()->update([
            'label' => 'Custom voltage label',
            'display_config' => ['precision' => 2, 'custom_hint' => 'Keep this'],
        ]);
        $before = $this->snapshot();

        $this->seed(SchneiderThreePhaseEnergyMeterSeeder::class);

        $this->assertSame($before, $this->snapshot());
        $this->assertDatabaseCount('device_profiles', 3);
    }

    public function test_rerunning_does_not_restore_a_deleted_profile(): void
    {
        Organization::factory()->create(['slug' => 'acme-manufacturing']);
        $this->seed(SchneiderThreePhaseEnergyMeterSeeder::class);
        DeviceProfile::query()->sole()->delete();
        $before = $this->snapshot();

        $this->seed(SchneiderThreePhaseEnergyMeterSeeder::class);

        $this->assertSame($before, $this->snapshot());
        $this->assertSame(0, DeviceProfile::query()->count());
        $this->assertSame(1, DeviceProfile::onlyTrashed()->count());
    }

    public function test_an_explicit_organization_can_be_seeded_without_cross_tenant_uuids_or_references(): void
    {
        $acme = Organization::factory()->create(['slug' => 'acme-manufacturing']);
        $target = Organization::factory()->create(['slug' => 'another-tenant']);
        app(SchneiderThreePhaseEnergyMeterSeeder::class)->run('another-tenant');
        $this->assertSame($target->getKey(), DeviceProfile::query()->sole()->organization_id);

        $this->seed(SchneiderThreePhaseEnergyMeterSeeder::class);

        $this->assertSame(2, DeviceProfile::query()->count());
        $this->assertSame(1, DeviceProfile::query()->where('organization_id', $acme->getKey())->count());
        foreach (DeviceProfile::all() as $profile) {
            $this->assertSame([], app(ValidateDeviceProfile::class)->diagnostics($profile));
        }
        $this->assertDatabaseCount('profile_parameters', 62);
    }

    public function test_a_missing_organization_fails_without_creating_tenants_or_partial_profiles(): void
    {
        Organization::factory()->create(['slug' => 'unrelated-tenant']);
        $this->expectException(LogicException::class);
        $this->expectExceptionMessage('Organization [acme-manufacturing] does not exist');
        try {
            $this->seed(SchneiderThreePhaseEnergyMeterSeeder::class);
        } finally {
            $this->assertDatabaseCount('organizations', 1);
            $this->assertDatabaseCount('device_profiles', 0);
            $this->assertDatabaseCount('users', 0);
        }
    }

    public function test_an_insert_failure_rolls_back_the_entire_profile(): void
    {
        Organization::factory()->create(['slug' => 'acme-manufacturing']);
        // The test connection is forced to isolated SQLite; simulate a mid-seed write failure.
        DB::unprepared("CREATE TRIGGER reject_meter_parameter BEFORE INSERT ON profile_parameters WHEN NEW.key = 'current.l1' BEGIN SELECT RAISE(ABORT, 'Simulated seed failure'); END");
        $this->expectException(QueryException::class);
        try {
            $this->seed(SchneiderThreePhaseEnergyMeterSeeder::class);
        } finally {
            $this->assertDatabaseCount('device_profiles', 0);
            $this->assertDatabaseCount('profile_parameter_groups', 0);
            $this->assertDatabaseCount('profile_parameters', 0);
        }
    }

    public function test_it_refuses_production_even_when_called_directly(): void
    {
        Organization::factory()->create(['slug' => 'acme-manufacturing']);
        $environment = app()->environment();
        app()->instance('env', 'production');
        $this->expectException(LogicException::class);
        $this->expectExceptionMessage('cannot run in production');
        try {
            app(SchneiderThreePhaseEnergyMeterSeeder::class)->run();
        } finally {
            app()->instance('env', $environment);
            $this->assertDatabaseCount('device_profiles', 0);
        }
    }

    private function snapshot(): array
    {
        return collect([
            'device_profiles', 'profile_parameter_groups', 'profile_parameters', 'profile_calculations',
            'profile_calculation_inputs', 'profile_alarm_templates', 'profile_alarm_template_parameters',
            'device_profile_artifacts', 'organizations', 'users',
        ])->mapWithKeys(fn (string $table): array => [$table => DB::table($table)->orderBy('id')->get()
            ->map(fn (object $row): array => (array) $row)->all()])->all();
    }
}
