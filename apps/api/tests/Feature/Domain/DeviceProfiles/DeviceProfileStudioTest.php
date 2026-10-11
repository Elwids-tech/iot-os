<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceProfiles;

use App\Domain\Authorization\Models\Role;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Permissions\DeviceProfilePermission;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Database\Seeders\DeviceProfilePermissionSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class DeviceProfileStudioTest extends TestCase
{
    use RefreshDatabase;

    private string $root;

    private DeviceProfile $profile;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('email', 'shared.operator@example.test')->firstOrFail());
        $this->root = '/api/v1/organizations/'.$organization->uuid.'/device-profiles';
        $uuid = $this->postJson($this->root, ['code' => 'studio-test', 'name' => 'Studio test', 'category' => 'Energy'])->assertCreated()->json('data.uuid');
        $this->profile = DeviceProfile::where('uuid', $uuid)->firstOrFail();
    }

    private function path(string $suffix = ''): string
    {
        return $this->root.'/'.$this->profile->uuid.$suffix;
    }

    private function revision(): int
    {
        return $this->profile->fresh()->draft_revision;
    }

    private function parameter(string $key = 'voltage', string $kind = 'measurement'): string
    {
        return $this->postJson($this->path('/parameters'), ['key' => $key, 'label' => ucfirst($key), 'kind' => $kind, 'data_type' => 'number', 'draft_revision' => $this->revision()])->assertCreated()->json('data.uuid');
    }

    public function test_directory_filters_and_organization_capabilities(): void
    {
        $this->getJson($this->root.'?search=STUDIO&category=Energy&status=draft')->assertOk()->assertJsonPath('meta.total', 1)->assertJsonPath('data.0.parameters_count', 0);
        $this->getJson($this->root.'?search=absent')->assertOk()->assertJsonPath('meta.total', 0);
        $this->getJson($this->root.'?per_page=1000')->assertUnprocessable();
        $this->getJson(str_replace('/device-profiles', '/context', $this->root))->assertOk()->assertJsonPath('data.capabilities.device_profiles.update', true);
        $northstar = Organization::where('slug', 'northstar-utilities')->firstOrFail();
        $this->getJson('/api/v1/organizations/'.$northstar->uuid.'/context')->assertOk()->assertJsonPath('data.capabilities.device_profiles.update', false);
        $this->getJson('/api/v1/organizations/'.$northstar->uuid.'/device-profiles/'.$this->profile->uuid)->assertNotFound();
    }

    public function test_complete_group_crud_reordering_and_safe_ungrouping(): void
    {
        $first = $this->postJson($this->path('/parameter-groups'), ['code' => 'phase', 'label' => 'Phase', 'draft_revision' => $this->revision()])->assertCreated()->json('data.uuid');
        $second = $this->postJson($this->path('/parameter-groups'), ['code' => 'power', 'label' => 'Power', 'draft_revision' => $this->revision()])->assertCreated()->json('data.uuid');
        $uuid = $this->parameter();
        $this->patchJson($this->path('/parameters/'.$uuid), ['parameter_group_uuid' => $first, 'draft_revision' => $this->revision()])->assertOk();
        $this->patchJson($this->path('/parameter-groups/'.$first), ['label' => 'Phases', 'description' => 'Grouped values', 'draft_revision' => $this->revision()])->assertOk()->assertJsonPath('data.label', 'Phases');
        $revision = $this->revision();
        $this->putJson($this->path('/group-order'), ['group_uuids' => [$second, $first], 'draft_revision' => $revision])->assertNoContent();
        $this->putJson($this->path('/group-order'), ['group_uuids' => [$first, $second], 'draft_revision' => $revision])->assertConflict();
        $this->putJson($this->path('/group-order'), ['group_uuids' => [$first], 'draft_revision' => $this->revision()])->assertUnprocessable();
        $this->getJson($this->path())->assertJsonPath('data.parameter_groups.0.uuid', $second);
        $this->deleteJson($this->path('/parameter-groups/'.$first), ['draft_revision' => $this->revision()])->assertNoContent();
        $this->getJson($this->path())->assertJsonPath('data.parameters.0.parameter_group_uuid', null)->assertJsonCount(1, 'data.parameters');
    }

    public function test_duplicate_keys_have_field_errors_and_mutations_do_not_advance_revision_on_failure(): void
    {
        $this->postJson($this->root, ['code' => 'studio-test', 'name' => 'Duplicate'])->assertUnprocessable()->assertJsonValidationErrors('code');
        $this->parameter();
        $revision = $this->revision();
        $this->postJson($this->path('/parameters'), ['key' => 'voltage', 'label' => 'Duplicate', 'kind' => 'measurement', 'data_type' => 'number', 'draft_revision' => $revision])->assertUnprocessable()->assertJsonValidationErrors('key');
        $this->assertSame($revision, $this->revision());
        $this->postJson($this->path('/alarm-templates'), ['draft_revision' => $revision])->assertUnprocessable()->assertJsonValidationErrors(['name', 'code', 'type', 'severity', 'condition_config']);
    }

    public function test_previews_are_non_mutating_typed_and_support_all_formula_operands(): void
    {
        $source = $this->parameter();
        $revision = $this->revision();
        $this->postJson($this->path('/preview'), ['kind' => 'calculation', 'draft_revision' => $revision, 'inputs' => [['parameter_uuid' => $source, 'alias' => 'v']], 'expression' => ['+' => [['var' => 'v'], 2, 3]], 'samples' => ['v' => 1]])->assertOk()->assertJsonPath('data.result', 6)->assertJsonPath('data.draft_revision', $revision);
        $rule = ['engine' => 'json_logic', 'rule' => ['>=' => [['var' => 'value'], 0]], 'message' => 'Positive values only.', 'diagnostic_code' => 'positive'];
        $this->postJson($this->path('/preview'), ['kind' => 'validation', 'draft_revision' => $revision, 'parameter' => ['data_type' => 'number', 'validation_logic' => $rule], 'value' => -1])->assertOk()->assertJsonPath('data.valid', false)->assertJsonPath('data.diagnostics.0.code', 'positive');
        $this->postJson($this->path('/preview'), ['kind' => 'validation', 'draft_revision' => $revision, 'parameter' => ['data_type' => 'number', 'validation_logic' => $rule], 'value' => 'one'])->assertOk()->assertJsonPath('data.diagnostics.0.code', 'preview.type_mismatch');
        $this->assertSame($revision, $this->revision());
        $this->assertDatabaseCount('device_profile_artifacts', 0);
    }

    public function test_invalid_formulas_missing_calculations_and_unknown_aliases_block_publication(): void
    {
        $source = $this->parameter();
        $target = $this->parameter('average', 'derived');
        $this->postJson($this->path('/validate'))->assertJsonPath('data.valid', false);
        $this->putJson($this->path('/parameters/'.$target.'/calculation'), ['draft_revision' => $this->revision(), 'engine' => 'json_logic', 'expression' => ['+' => [['var' => 'missing'], 2]], 'inputs' => [['parameter_uuid' => $source, 'alias' => 'voltage']]])->assertUnprocessable();
        $this->postJson($this->path('/publish'), ['draft_revision' => $this->revision()])->assertUnprocessable();
        $this->postJson($this->path('/preview'), ['kind' => 'calculation', 'draft_revision' => $this->revision(), 'inputs' => [['parameter_uuid' => $source, 'alias' => 'v']], 'expression' => ['fetch' => 'https://example.test'], 'samples' => ['v' => 1]])->assertOk()->assertJsonPath('data.diagnostics.0.code', 'calculation.unsupported_operator');
        $this->postJson($this->path('/preview'), ['kind' => 'calculation', 'draft_revision' => $this->revision(), 'inputs' => [['parameter_uuid' => $source, 'alias' => 'v']], 'expression' => ['/' => [1, 0]], 'samples' => ['v' => 1]])->assertOk()->assertJsonPath('data.diagnostics.0.code', 'preview.evaluation_failed');
    }

    public function test_dependency_errors_name_references_and_deleting_own_calculation_is_safe(): void
    {
        $source = $this->parameter();
        $target = $this->parameter('average', 'derived');
        $this->putJson($this->path('/parameters/'.$target.'/calculation'), ['draft_revision' => $this->revision(), 'engine' => 'json_logic', 'expression' => ['var' => 'v'], 'inputs' => [['parameter_uuid' => $source, 'alias' => 'v']]])->assertOk();
        $this->deleteJson($this->path('/parameters/'.$source), ['draft_revision' => $this->revision()])->assertUnprocessable()->assertJsonPath('code', 'parameter.referenced')->assertJsonPath('references.0.label', 'Average');
        $this->deleteJson($this->path('/parameters/'.$target), ['draft_revision' => $this->revision()])->assertNoContent();
        $this->assertDatabaseCount('profile_calculations', 0);
        $this->deleteJson($this->path('/parameters/'.$source), ['draft_revision' => $this->revision()])->assertNoContent();
    }

    public function test_publication_history_snapshot_revisions_and_protected_profile_deletion(): void
    {
        $parameter = $this->parameter();
        $revision = $this->revision();
        $this->postJson($this->path('/validate'), ['draft_revision' => $revision])->assertJsonPath('data.draft_revision', $revision);
        $this->postJson($this->path('/compile'), ['draft_revision' => $revision])->assertJsonPath('data.draft_revision', $revision);
        $first = $this->postJson($this->path('/publish'), ['draft_revision' => $revision])->assertCreated()->json('data.definition');
        $this->patchJson($this->path('/parameters/'.$parameter), ['label' => 'Voltage updated', 'draft_revision' => $this->revision()])->assertOk();
        $this->postJson($this->path('/validate'), ['draft_revision' => $revision])->assertConflict();
        $this->postJson($this->path('/compile'), ['draft_revision' => $revision])->assertConflict();
        $this->deleteJson($this->path(), ['draft_revision' => $revision])->assertConflict();
        $this->postJson($this->path('/publish'), ['draft_revision' => $this->revision()])->assertCreated();
        $this->getJson($this->path('/artifacts'))->assertOk()->assertJsonPath('meta.total', 2)->assertJsonPath('data.0.revision', 2)->assertJsonMissingPath('data.0.definition');
        $this->assertSameJsonDocument($first, $this->getJson($this->path('/artifacts/1'))->assertOk()->json('data.definition'));
        $this->deleteJson($this->path(), ['draft_revision' => $this->revision()])->assertUnprocessable();
    }

    public function test_alarm_crud_preserves_unknown_configuration_and_blocks_referenced_parameter_deletion(): void
    {
        $parameter = $this->parameter();
        $alarm = $this->postJson($this->path('/alarm-templates'), ['code' => 'stale', 'name' => 'Stale meter', 'type' => 'staleness', 'severity' => 'warning', 'condition_config' => ['max_age_seconds' => 300, 'vendor_extra' => ['keep' => true]], 'parameter_references' => [['parameter_uuid' => $parameter, 'role' => 'subject']], 'draft_revision' => $this->revision()])->assertCreated()->json('data.uuid');
        $this->patchJson($this->path('/alarm-templates/'.$alarm), ['name' => 'Stale energy meter', 'draft_revision' => $this->revision()])->assertOk()->assertJsonPath('data.condition_config.vendor_extra.keep', true);
        $this->deleteJson($this->path('/parameters/'.$parameter), ['draft_revision' => $this->revision()])->assertUnprocessable()->assertJsonPath('references.0.label', 'Stale energy meter');
        $this->deleteJson($this->path('/alarm-templates/'.$alarm), ['draft_revision' => $this->revision()])->assertNoContent();
        $this->deleteJson($this->path('/parameters/'.$parameter), ['draft_revision' => $this->revision()])->assertNoContent();
        $this->deleteJson($this->path(), ['draft_revision' => $this->revision()])->assertNoContent();
        $this->getJson($this->path())->assertNotFound();
    }

    public function test_studio_permission_upgrade_does_not_reseed_accounts_or_remove_other_grants(): void
    {
        $user = User::where('email', 'shared.operator@example.test')->firstOrFail();
        $user->forceFill(['name' => 'Locally customized name', 'password' => 'custom-local-password'])->save();
        $password = $user->getRawOriginal('password');
        $role = Role::where('organization_id', $this->profile->organization_id)->where('name', 'organization-admin')->firstOrFail();
        $unrelated = $role->permissions->pluck('name')->filter(fn ($name) => ! str_starts_with($name, 'device-profile'))->all();
        $role->revokePermissionTo(DeviceProfilePermission::UPDATE->value);
        $this->seed(DeviceProfilePermissionSeeder::class);
        $this->seed(DeviceProfilePermissionSeeder::class);
        $this->assertSame($password, $user->fresh()->getRawOriginal('password'));
        $this->assertSame('Locally customized name', $user->fresh()->name);
        $this->assertTrue($role->fresh()->hasPermissionTo(DeviceProfilePermission::UPDATE->value));
        foreach ($unrelated as $permission) {
            $this->assertTrue($role->fresh()->hasPermissionTo($permission));
        }
    }

    public function test_conversion_is_preserved_and_capability_changes_are_rejected(): void
    {
        $conversion = ['source_unit' => 'W', 'multiplier' => 0.001, 'offset' => 0];
        $uuid = $this->postJson($this->path('/parameters'), ['key' => 'power', 'label' => 'Power', 'kind' => 'measurement', 'data_type' => 'number', 'unit' => 'kW', 'ingress_conversion' => $conversion, 'draft_revision' => $this->revision()])->assertCreated()->json('data.uuid');
        $this->patchJson($this->path('/parameters/'.$uuid), ['label' => 'Stored power', 'draft_revision' => $this->revision()])->assertOk()->assertJsonPath('data.ingress_conversion.multiplier', 0.001);
        foreach ([['kind' => 'derived'], ['accepts_command' => true], ['data_type' => 'string']] as $change) {
            $this->patchJson($this->path('/parameters/'.$uuid), $change + ['draft_revision' => $this->revision()])->assertUnprocessable();
        }
        $this->postJson($this->path('/preview'), ['kind' => 'conversion', 'draft_revision' => $this->revision(), 'parameter' => ['kind' => 'measurement', 'data_type' => 'number', 'ingress_conversion' => $conversion, 'validation_logic' => null], 'value' => 1000])->assertOk()->assertJsonPath('data.valid', true)->assertJsonPath('data.result', 1);
        $this->patchJson($this->path('/parameters/'.$uuid), ['ingress_conversion' => null, 'kind' => 'derived', 'draft_revision' => $this->revision()])->assertOk()->assertJsonPath('data.ingress_conversion', null);
    }

    public function test_new_output_and_formula_save_atomically_with_one_revision(): void
    {
        $source = $this->parameter('power');
        $revision = $this->revision();
        $payload = ['draft_revision' => $revision, 'output' => ['key' => 'power_kw', 'label' => 'Power kW', 'data_type' => 'number', 'unit' => 'kW'], 'engine' => 'json_logic', 'expression' => ['/' => [['var' => 'watts'], 1000]], 'inputs' => [['parameter_uuid' => $source, 'alias' => 'watts']]];
        $this->postJson($this->path('/calculations'), array_replace($payload, ['expression' => ['eval' => 'bad']]))->assertUnprocessable();
        $this->assertSame($revision, $this->revision());
        $this->assertSame(1, $this->profile->parameters()->count());
        $response = $this->postJson($this->path('/calculations'), $payload)->assertOk()->assertJsonPath('data.kind', 'derived')->assertJsonPath('data.calculation.inputs.0.parameter_uuid', $source);
        $this->assertSame($revision + 1, $this->revision());
        $this->postJson($this->path('/calculations'), $payload)->assertConflict();
        $payload['draft_revision'] = $this->revision();
        $this->postJson($this->path('/calculations'), $payload)->assertUnprocessable();
        $this->assertSame(2, $this->profile->parameters()->count());
        $target = $response->json('data.uuid');
        $this->putJson($this->path('/parameters/'.$target.'/calculation'), ['draft_revision' => $this->revision(), 'engine' => 'json_logic', 'expression' => ['var' => 'self'], 'inputs' => [['parameter_uuid' => $target, 'alias' => 'self']]])->assertUnprocessable();
        $this->assertSame($revision + 1, $this->revision());
    }
}
