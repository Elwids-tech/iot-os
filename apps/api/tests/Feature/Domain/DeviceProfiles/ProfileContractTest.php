<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceProfiles;

use App\Domain\DeviceProfiles\Services\UnitCatalogue;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

final class ProfileContractTest extends TestCase
{
    use RefreshDatabase;

    private string $root;

    private string $profile;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $organization = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $this->actingAs(User::where('email', 'shared.operator@example.test')->firstOrFail());
        $this->root = '/api/v1/organizations/'.$organization->uuid.'/device-profiles';
        $this->profile = $this->postJson($this->root, ['code' => 'contract-meter', 'name' => 'Contract meter'])->assertCreated()->json('data.uuid');
    }

    public function test_units_resolve_to_canonical_symbols_with_quantities(): void
    {
        $units = app(UnitCatalogue::class);
        $this->assertSame('kWh', $units->canonical(' kwh '));
        $this->assertSame('energy', $units->quantity('kWh'));
        $this->assertSame('m³/h', $units->canonical('m3/h'));
        // Case alone cannot choose between milliwatt and megawatt.
        $this->assertSame('mw', $units->canonical('mw'));
        $this->assertNull($units->quantity('mw'));
        $this->assertSame('MW', $units->canonical('MW'));
        $this->assertSame('widgets', $units->canonical('widgets'));
        $this->assertTrue($units->equivalent('kw', 'kW'));
        $this->assertFalse($units->equivalent('kW', 'W'));

        $this->getJson('/api/v1/units')->assertOk()->assertJsonPath('data.quantities.energy.base', 'Wh');
        $parameter = $this->create(['key' => 'energy', 'label' => 'Energy', 'kind' => 'counter', 'data_type' => 'number', 'unit' => 'kwh']);
        $this->assertSame('kWh', $parameter['unit']);
        $this->assertSame('energy', $parameter['unit_quantity']);
        $this->assertFalse($parameter['published']);
    }

    public function test_published_parameters_keep_their_identity_and_keys_are_never_reused(): void
    {
        $power = $this->create(['key' => 'power', 'label' => 'Power', 'kind' => 'measurement', 'data_type' => 'number', 'unit' => 'kW']);
        $spare = $this->create(['key' => 'spare', 'label' => 'Spare', 'kind' => 'measurement', 'data_type' => 'number', 'unit' => 'V']);
        // Before publishing, everything can change.
        $this->update($spare['uuid'], ['key' => 'spare.voltage'])->assertOk();
        $this->postJson($this->path('/publish'), ['draft_revision' => $this->revision()])->assertCreated();

        $this->getJson($this->path(''))->assertOk()->assertJsonPath('data.parameters.0.published', true);
        $this->update($power['uuid'], ['key' => 'active_power'])->assertUnprocessable()->assertJsonValidationErrors('key');
        $this->update($power['uuid'], ['kind' => 'counter'])->assertUnprocessable()->assertJsonValidationErrors('kind');
        $this->update($power['uuid'], ['data_type' => 'integer'])->assertUnprocessable()->assertJsonValidationErrors('data_type');
        $this->update($power['uuid'], ['unit' => 'W'])->assertUnprocessable()->assertJsonValidationErrors('unit');
        // Labels and equivalent spellings remain editable.
        $this->update($power['uuid'], ['label' => 'Active power', 'unit' => 'kw'])->assertOk()->assertJsonPath('data.unit', 'kW');

        $this->deleteJson($this->path('/parameters/'.$spare['uuid']), ['draft_revision' => $this->revision()])->assertNoContent();
        $this->postJson($this->path('/parameters'), ['key' => 'spare.voltage', 'label' => 'Other', 'kind' => 'measurement', 'data_type' => 'number', 'draft_revision' => $this->revision()])
            ->assertUnprocessable()->assertJsonValidationErrors('key');
    }

    public function test_display_metadata_is_typed(): void
    {
        $enum = ['engine' => 'json_logic', 'rule' => ['in' => [['var' => 'value'], ['running', 'stopped']]]];
        $mode = ['key' => 'mode', 'label' => 'Mode', 'kind' => 'state', 'data_type' => 'enum', 'validation_logic' => $enum];
        $this->postJson($this->path('/parameters'), $mode + ['display_config' => ['states' => [['value' => 'running', 'label' => 'Running', 'tone' => 'good'], ['value' => 'stopped', 'label' => 'Stopped']], 'visualization' => 'state_timeline'], 'draft_revision' => $this->revision()])
            ->assertCreated()->assertJsonPath('data.display_config.states.0.tone', 'good');
        $this->postJson($this->path('/parameters'), [...$mode, 'key' => 'mode2', 'display_config' => ['states' => [['value' => 'paused', 'label' => 'Paused']]], 'draft_revision' => $this->revision()])
            ->assertUnprocessable()->assertJsonValidationErrors('display_config.states.0.value');
        $this->postJson($this->path('/parameters'), ['key' => 'flow', 'label' => 'Flow', 'kind' => 'measurement', 'data_type' => 'number', 'display_config' => ['aggregation' => 'increase'], 'draft_revision' => $this->revision()])
            ->assertUnprocessable()->assertJsonValidationErrors('display_config.aggregation');
        $this->postJson($this->path('/parameters'), ['key' => 'flow', 'label' => 'Flow', 'kind' => 'measurement', 'data_type' => 'number', 'display_config' => ['states' => [['value' => 1, 'label' => 'One']]], 'draft_revision' => $this->revision()])
            ->assertUnprocessable()->assertJsonValidationErrors('display_config.states');
        $this->postJson($this->path('/parameters'), ['key' => 'volume', 'label' => 'Volume', 'kind' => 'counter', 'data_type' => 'number', 'display_config' => ['aggregation' => 'increase', 'min' => 0, 'max' => 100, 'visualization' => 'consumption'], 'draft_revision' => $this->revision()])
            ->assertCreated();
        $this->postJson($this->path('/parameters'), ['key' => 'level', 'label' => 'Level', 'kind' => 'measurement', 'data_type' => 'number', 'display_config' => ['max' => 100], 'draft_revision' => $this->revision()])
            ->assertCreated();
        $this->postJson($this->path('/parameters'), ['key' => 'level2', 'label' => 'Level', 'kind' => 'measurement', 'data_type' => 'number', 'display_config' => ['min' => 10, 'max' => 10], 'draft_revision' => $this->revision()])
            ->assertUnprocessable()->assertJsonValidationErrors('display_config.max');
    }

    private function create(array $values): array
    {
        return $this->postJson($this->path('/parameters'), [...$values, 'draft_revision' => $this->revision()])->assertCreated()->json('data');
    }

    private function update(string $uuid, array $values)
    {
        return $this->patchJson($this->path('/parameters/'.$uuid), [...$values, 'draft_revision' => $this->revision()]);
    }

    private function path(string $suffix): string
    {
        return $this->root.'/'.$this->profile.$suffix;
    }

    private function revision(): int
    {
        return $this->getJson($this->path(''))->assertOk()->json('data.draft_revision');
    }
}
