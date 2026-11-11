<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\DeviceProfiles;

use App\Domain\DeviceProfiles\Actions\PublishDeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Models\DeviceProfileCopy;
use App\Domain\DeviceProfiles\Models\ProfileParameter;
use App\Domain\DeviceProfiles\Services\ProfileCopier;
use App\Domain\DeviceProfiles\Support\CanonicalJson;
use App\Domain\Shared\Models\Organization;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\Feature\Domain\Devices\Moves\MoveTestCase;

/**
 * Profile versions are rebuilt in the target (spec 031, research R5): the copy's
 * definition is the source's with the parameter map applied, every version of one source
 * profile lands in one target profile with stable parameter UUIDs, and nothing is shared
 * across organizations.
 */
final class ProfileCopierTest extends MoveTestCase
{
    public function test_every_profile_fixture_copies_to_the_same_definition_under_the_parameter_map(): void
    {
        $fixtures = glob(base_path('../../contracts/definitions/device-profiles/*.v*.json'));
        $this->assertNotEmpty($fixtures);
        foreach ($fixtures as $file) {
            $fixture = json_decode((string) file_get_contents($file), true);
            $fixture['profile']['code'] = Str::slug(basename($file, '.json'));
            $source = $this->published($this->a, $fixture);

            $copy = DB::transaction(fn () => app(ProfileCopier::class)->copy($source, $this->b, $this->mover));

            $target = DeviceProfileArtifact::findOrFail($copy->target_artifact_id);
            $this->assertSame(array_column($source->definition['parameters'], 'uuid'), array_keys($copy->parameter_map), basename($file));
            $this->assertEmpty(array_intersect(array_keys($copy->parameter_map), array_values($copy->parameter_map)));
            $this->assertSame($this->comparable(ProfileCopier::remap($source->definition, $copy->parameter_map)), $this->comparable($target->definition), basename($file));
            $this->assertSame($this->b->id, $target->profile->organization_id);
        }
    }

    public function test_copies_are_reused_per_version_and_later_versions_keep_the_profile_and_its_parameter_uuids(): void
    {
        $fixture = json_decode((string) file_get_contents(base_path('../../contracts/definitions/device-profiles/three-phase-energy-meter.v1.json')), true);
        $first = $this->published($this->a, $fixture);
        $copier = app(ProfileCopier::class);
        $this->assertSame('three-phase-energy-meter', $copier->codeFor($first, $this->b));

        $copy = DB::transaction(fn () => $copier->copy($first, $this->b, $this->mover));
        $again = DB::transaction(fn () => $copier->copy($first, $this->b, $this->mover));
        $this->assertSame($copy->id, $again->id);
        $this->assertSame(1, DeviceProfileArtifact::where('device_profile_id', $copy->target_profile_id)->count());
        $this->assertTrue($copier->copied($first, $this->b));

        // A later version of the same source profile: one parameter relabelled, one added.
        $profile = DeviceProfile::findOrFail($first->device_profile_id);
        $profile->beginDraft($this->mover);
        $profile->save();
        ProfileParameter::where('device_profile_id', $profile->id)->where('key', 'voltage.l1')->update(['label' => 'Phase 1 voltage']);
        $profile->parameters()->create(['key' => 'frequency', 'label' => 'Frequency', 'kind' => 'measurement', 'data_type' => 'number', 'unit' => 'Hz', 'reports_state' => true, 'sort_order' => 99]);
        $second = app(PublishDeviceProfile::class)->handle($profile->fresh(), $this->mover, null);

        $later = DB::transaction(fn () => $copier->copy($second, $this->b, $this->mover));
        $this->assertSame($copy->target_profile_id, $later->target_profile_id);
        foreach ($copy->parameter_map as $source => $target) {
            $this->assertSame($target, $later->parameter_map[$source]);
        }
        $this->assertCount(count($copy->parameter_map) + 1, $later->parameter_map);
        $this->assertSame([1, 2], DeviceProfileArtifact::where('device_profile_id', $copy->target_profile_id)->orderBy('revision')->pluck('revision')->all());
        $this->assertSame('Phase 1 voltage', collect(DeviceProfileArtifact::findOrFail($later->target_artifact_id)->definition['parameters'])->firstWhere('key', 'voltage.l1')['label']);
    }

    public function test_a_code_the_target_uses_gets_a_suffix_and_another_accounts_profiles_never_take_part(): void
    {
        $fixture = json_decode((string) file_get_contents(base_path('../../contracts/definitions/device-profiles/gps-tracker.v1.json')), true);
        $source = $this->published($this->a, $fixture);
        $this->published($this->b, [...$fixture, 'profile' => [...$fixture['profile'], 'code' => $fixture['profile']['code']]]);
        $elsewhere = $this->published($this->c, $fixture);
        $copier = app(ProfileCopier::class);

        $this->assertSame($fixture['profile']['code'].'-2', $copier->codeFor($source, $this->b));
        $copy = DB::transaction(fn () => $copier->copy($source, $this->b, $this->mover));
        $this->assertSame($fixture['profile']['code'].'-2', DeviceProfile::findOrFail($copy->target_profile_id)->code);
        // C's profile with the same code doesn't clash, and C gains nothing.
        $this->assertSame($fixture['profile']['code'], $copier->codeFor($source, $this->d));
        $this->assertSame(1, DeviceProfile::where('organization_id', $this->c->id)->count());
        $this->assertSame(0, DeviceProfileCopy::where('source_artifact_id', $elsewhere->id)->count());
        $this->as($this->bOnly, fn () => $this->assertNotContains(DeviceProfile::findOrFail($elsewhere->device_profile_id)->uuid, array_column($this->getJson($this->in($this->b).'/device-profiles?per_page=100')->assertOk()->json('data'), 'uuid')));
        $this->as($this->cAdmin, fn () => $this->getJson($this->in($this->c).'/device-profiles/'.DeviceProfile::findOrFail($copy->target_profile_id)->uuid)->assertNotFound());
    }

    /** A profile of the organization built from a canonical definition, with fresh UUIDs, and published. */
    private function published(Organization $organization, array $definition): DeviceProfileArtifact
    {
        $profile = DeviceProfile::create(['organization_id' => $organization->id, 'code' => $definition['profile']['code'], 'name' => $definition['profile']['name'], 'category' => $definition['profile']['category']]);
        $ids = [];
        foreach (array_values($definition['parameters']) as $order => $parameter) {
            $ids[$parameter['uuid']] = $profile->parameters()->create([
                'key' => $parameter['key'], 'label' => $parameter['label'], 'kind' => $parameter['kind'], 'data_type' => $parameter['data_type'], 'format' => $parameter['format'],
                'unit' => $parameter['unit'], 'reports_state' => $parameter['reports_state'], 'accepts_command' => $parameter['accepts_command'], 'validation_logic' => $parameter['validation'],
                'display_config' => $parameter['display'], 'reporting_config' => $parameter['reporting'], 'counter_config' => $parameter['counter'],
                'ingress_conversion' => $parameter['ingress_conversion'] ?? null, 'sort_order' => $order,
            ])->id;
        }
        foreach ($definition['calculations'] as $calculation) {
            $created = $profile->calculations()->create(['target_profile_parameter_id' => $ids[$calculation['target_parameter_uuid']], 'engine' => $calculation['engine'],
                'expression' => $calculation['expression'], 'trigger' => $calculation['trigger'], 'failure_policy' => $calculation['failure_policy']]);
            foreach ($calculation['inputs'] as $input) {
                $created->inputs()->create(['profile_parameter_id' => $ids[$input['parameter_uuid']], 'alias' => $input['alias']]);
            }
        }
        foreach ($definition['alarm_templates'] as $alarm) {
            $template = $profile->alarmTemplates()->create(['code' => $alarm['code'], 'name' => $alarm['name'], 'type' => $alarm['type'], 'severity' => $alarm['severity'],
                'condition_config' => $alarm['condition'], 'enabled_by_default' => $alarm['enabled_by_default']]);
            foreach ($alarm['parameters'] as $reference) {
                $template->parameterReferences()->create(['profile_parameter_id' => $ids[$reference['parameter_uuid']], 'role' => $reference['role']]);
            }
        }

        return app(PublishDeviceProfile::class)->handle($profile->fresh(), $this->mover, null);
    }

    /**
     * A definition in canonical form (PostgreSQL's jsonb reorders keys) without what each
     * profile has of its own: its uuid and its alarm templates' uuids.
     */
    private function comparable(array $definition): string
    {
        unset($definition['profile']['uuid']);
        $definition['alarm_templates'] = array_map(fn (array $alarm) => array_diff_key($alarm, ['uuid' => true]), $definition['alarm_templates']);

        return app(CanonicalJson::class)->encode($definition);
    }
}
