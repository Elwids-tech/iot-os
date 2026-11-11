<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Services;

use App\Domain\DeviceProfiles\Actions\PublishDeviceProfile;
use App\Domain\DeviceProfiles\Enums\DeviceProfileStatus;
use App\Domain\DeviceProfiles\Models\BindingParameterMapping;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Models\DeviceProfileCopy;
use App\Domain\DeviceProfiles\Models\ProfileAlarmTemplate;
use App\Domain\DeviceProfiles\Models\ProfileAlarmTemplateParameter;
use App\Domain\DeviceProfiles\Models\ProfileCalculation;
use App\Domain\DeviceProfiles\Models\ProfileParameter;
use App\Domain\DeviceProfiles\Models\ProfileParameterGroup;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Collection;
use Illuminate\Support\Facades\DB;

/**
 * Copies a published profile version into another organization (spec 031, research R5).
 * Profiles are never shared across organizations, and parameter UUIDs are unique across
 * every profile, so the copy is a profile of the target's own, rebuilt from the version's
 * canonical definition and published there, with the map from the source's parameter
 * UUIDs to the copy's. Every version of one source profile copies into the same target
 * profile, which keeps one parameter row, and so one UUID, per key.
 */
final class ProfileCopier
{
    public function __construct(private readonly PublishDeviceProfile $publish) {}

    /** The code the copy has, or will have, in the target; writes nothing. */
    public function codeFor(DeviceProfileArtifact $source, Organization $target): string
    {
        $copy = DeviceProfileCopy::where('source_artifact_id', $source->id)->where('target_organization_id', $target->id)->first();

        return ($copy ? DeviceProfile::withTrashed()->find($copy->target_profile_id) : $this->targetProfile($source, $target))?->code
            ?? $this->freeCode($source->definition['profile']['code'] ?? $source->profile->code, $target);
    }

    /** Whether this version already has a copy in the target. */
    public function copied(DeviceProfileArtifact $source, Organization $target): bool
    {
        return DeviceProfileCopy::where('source_artifact_id', $source->id)->where('target_organization_id', $target->id)->exists();
    }

    /** Runs inside the caller's transaction, which holds the target organization's lock. */
    public function copy(DeviceProfileArtifact $source, Organization $target, User $actor): DeviceProfileCopy
    {
        return DB::transaction(function () use ($source, $target, $actor): DeviceProfileCopy {
            $existing = DeviceProfileCopy::where('source_artifact_id', $source->id)->where('target_organization_id', $target->id)->first();
            if ($existing) {
                return $existing;
            }
            $definition = $source->definition;
            $origin = DeviceProfile::withTrashed()->findOrFail($source->device_profile_id);
            $profile = $this->targetProfile($source, $target);
            if ($profile) {
                $profile = DeviceProfile::whereKey($profile->id)->lockForUpdate()->firstOrFail();
                if ($profile->status === DeviceProfileStatus::PUBLISHED) {
                    $profile->beginDraft($actor);
                }
                $profile->forceFill(['name' => $definition['profile']['name'], 'category' => $definition['profile']['category'], 'updated_by' => $actor->id])->save();
            } else {
                $profile = DeviceProfile::create([
                    'organization_id' => $target->id, 'code' => $this->freeCode($definition['profile']['code'], $target),
                    'name' => $definition['profile']['name'], 'category' => $definition['profile']['category'],
                    'description' => $origin->description, 'extensions' => $origin->extensions,
                    'created_by' => $actor->id, 'updated_by' => $actor->id,
                ]);
            }
            $map = $this->rebuild($profile, $origin, $definition);
            $artifact = $this->publish->handle($profile->fresh(), $actor, null);

            return DeviceProfileCopy::create([
                'source_profile_id' => $origin->id, 'source_artifact_id' => $source->id, 'target_organization_id' => $target->id,
                'target_profile_id' => $profile->id, 'target_artifact_id' => $artifact->id, 'parameter_map' => $map,
            ]);
        });
    }

    /**
     * Applies a parameter map to any value: every string that is a mapped UUID becomes the
     * copy's. Parameter UUIDs are unique, so nothing else can match.
     *
     * @param  array<string, string>  $map
     */
    public static function remap(mixed $value, array $map): mixed
    {
        if (is_string($value)) {
            return $map[$value] ?? $value;
        }
        if (is_array($value)) {
            return array_map(fn (mixed $item): mixed => self::remap($item, $map), $value);
        }

        return $value;
    }

    /**
     * The target profile earlier versions of the same source profile were copied into,
     * unless it was archived or deleted since.
     */
    private function targetProfile(DeviceProfileArtifact $source, Organization $target): ?DeviceProfile
    {
        $id = DeviceProfileCopy::where('source_profile_id', $source->device_profile_id)->where('target_organization_id', $target->id)->latest('id')->value('target_profile_id');
        $profile = $id ? DeviceProfile::find($id) : null;

        return $profile && $profile->status !== DeviceProfileStatus::ARCHIVED ? $profile : null;
    }

    /** The source's code, or `<code>-2`, `-3`… when the target uses it (deleted profiles still hold their code). */
    private function freeCode(string $code, Organization $target): string
    {
        $candidate = $code;
        for ($suffix = 2; DeviceProfile::withTrashed()->where('organization_id', $target->id)->where('code', $candidate)->exists(); $suffix++) {
            $candidate = $code.'-'.$suffix;
        }

        return $candidate;
    }

    /**
     * Rebuilds the profile's draft from a canonical definition: parameters by key,
     * calculations and alarm templates. Groups and descriptions are not in the definition,
     * so they come from the source profile as it is now.
     *
     * @return array<string, string> source parameter UUID => copy's parameter UUID
     */
    private function rebuild(DeviceProfile $profile, DeviceProfile $origin, array $definition): array
    {
        ProfileCalculation::where('device_profile_id', $profile->id)->delete();
        ProfileAlarmTemplateParameter::whereIn('profile_alarm_template_id', ProfileAlarmTemplate::where('device_profile_id', $profile->id)->select('id'))->delete();

        $sources = ProfileParameter::whereIn('uuid', array_column($definition['parameters'], 'uuid'))->with('group')->get()->keyBy('uuid');
        $groups = $this->groups($profile, $origin);
        $existing = ProfileParameter::where('device_profile_id', $profile->id)->get()->keyBy('key');
        $map = [];
        $kept = [];
        foreach (array_values($definition['parameters']) as $order => $parameter) {
            $source = $sources->get($parameter['uuid']);
            $row = $existing->get($parameter['key']) ?? new ProfileParameter(['device_profile_id' => $profile->id, 'key' => $parameter['key']]);
            $row->fill([
                'label' => $parameter['label'], 'description' => $source?->description, 'kind' => $parameter['kind'], 'data_type' => $parameter['data_type'],
                'format' => $parameter['format'], 'unit' => $parameter['unit'], 'reports_state' => $parameter['reports_state'], 'accepts_command' => $parameter['accepts_command'],
                'validation_logic' => $parameter['validation'], 'display_config' => $parameter['display'], 'reporting_config' => $parameter['reporting'],
                'counter_config' => $parameter['counter'], 'ingress_conversion' => $parameter['ingress_conversion'] ?? null,
                'parameter_group_id' => $source?->group ? $groups->get($source->group->code)?->id : null, 'sort_order' => $order,
            ])->save();
            $map[$parameter['uuid']] = $row->uuid;
            $kept[] = $row->id;
        }
        $stale = ProfileParameter::where('device_profile_id', $profile->id)->whereNotIn('id', $kept)->pluck('id');
        BindingParameterMapping::whereIn('profile_parameter_id', $stale)->delete();
        ProfileParameter::whereIn('id', $stale)->delete();

        $ids = ProfileParameter::where('device_profile_id', $profile->id)->pluck('id', 'uuid');
        foreach ($definition['calculations'] as $calculation) {
            $created = ProfileCalculation::create([
                'device_profile_id' => $profile->id, 'target_profile_parameter_id' => $ids[$map[$calculation['target_parameter_uuid']]],
                'engine' => $calculation['engine'], 'expression' => self::remap($calculation['expression'], $map),
                'trigger' => $calculation['trigger'], 'failure_policy' => $calculation['failure_policy'],
            ]);
            foreach ($calculation['inputs'] as $input) {
                $created->inputs()->create(['profile_parameter_id' => $ids[$map[$input['parameter_uuid']]], 'alias' => $input['alias']]);
            }
        }

        $templates = ProfileAlarmTemplate::where('device_profile_id', $profile->id)->get()->keyBy('code');
        foreach ($definition['alarm_templates'] as $alarm) {
            $template = $templates->get($alarm['code']) ?? new ProfileAlarmTemplate(['device_profile_id' => $profile->id, 'code' => $alarm['code']]);
            $template->fill([
                'name' => $alarm['name'], 'type' => $alarm['type'], 'severity' => $alarm['severity'],
                'condition_config' => self::remap($alarm['condition'], $map), 'enabled_by_default' => $alarm['enabled_by_default'],
            ])->save();
            foreach ($alarm['parameters'] as $reference) {
                $template->parameterReferences()->create(['profile_parameter_id' => $ids[$map[$reference['parameter_uuid']]], 'role' => $reference['role']]);
            }
        }
        ProfileAlarmTemplate::where('device_profile_id', $profile->id)->whereNotIn('code', array_column($definition['alarm_templates'], 'code'))->delete();

        return $map;
    }

    /**
     * The source profile's groups in the copy, matched by code.
     *
     * @return Collection<string, ProfileParameterGroup>
     */
    private function groups(DeviceProfile $profile, DeviceProfile $origin): Collection
    {
        $existing = ProfileParameterGroup::where('device_profile_id', $profile->id)->get()->keyBy('code');
        foreach (ProfileParameterGroup::where('device_profile_id', $origin->id)->get() as $group) {
            $row = $existing->get($group->code) ?? new ProfileParameterGroup(['device_profile_id' => $profile->id, 'code' => $group->code]);
            $row->fill(['label' => $group->label, 'description' => $group->description, 'sort_order' => $group->sort_order])->save();
            $existing->put($group->code, $row);
        }

        return $existing;
    }
}
