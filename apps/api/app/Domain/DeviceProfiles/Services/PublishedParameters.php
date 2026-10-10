<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Services;

use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Models\ProfileParameter;
use BackedEnum;
use Illuminate\Validation\ValidationException;

/**
 * Reads published parameter identity from immutable artifacts. Devices,
 * dashboards and history bind to these keys, so they must not drift.
 */
final class PublishedParameters
{
    public function __construct(private readonly UnitCatalogue $units) {}

    /**
     * Normalizes the unit, keeps a published parameter's key, kind, data type
     * and unit stable, and never hands a published key to a different parameter
     * after a deletion. Returns the attributes to save.
     *
     * @param  array<string, mixed>  $attributes
     * @return array<string, mixed>
     */
    public function guard(DeviceProfile $profile, ?ProfileParameter $parameter, array $attributes): array
    {
        if (array_key_exists('unit', $attributes)) {
            $attributes['unit'] = $this->units->canonical($attributes['unit']);
        }
        $published = $parameter ? ($this->byUuid($profile)[$parameter->uuid] ?? null) : null;
        $errors = [];
        if ($published !== null) {
            $value = function (string $field) use ($attributes, $parameter) {
                $value = array_key_exists($field, $attributes) ? $attributes[$field] : $parameter->{$field};

                return $value instanceof BackedEnum ? $value->value : $value;
            };
            if ($value('key') !== $published['key']) {
                $errors['key'] = 'Published parameters keep their key because devices, dashboards and history use it. Add a new parameter instead.';
            }
            if ($value('kind') !== $published['kind']) {
                $errors['kind'] = 'Published parameters keep their kind. Add a new parameter instead.';
            }
            if ($value('data_type') !== $published['data_type']) {
                $errors['data_type'] = 'Published parameters keep their data type. Add a new parameter instead.';
            }
            if (! $this->units->equivalent($value('unit'), $published['unit'])) {
                $errors['unit'] = 'Published parameters keep their unit. Use an incoming conversion to change what the device sends, or add a new parameter.';
            }
        } elseif (array_key_exists('key', $attributes)) {
            $owner = $this->keys($profile)[$attributes['key']] ?? null;
            if ($owner !== null && $owner !== $parameter?->uuid) {
                $errors['key'] = 'This key belonged to a published parameter. Choose a different key so existing dashboards and history are not reassigned.';
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }

        return $attributes;
    }

    /** @return array<string, array{key: string, kind: string, data_type: string, unit: ?string}> keyed by parameter UUID, newest revision wins */
    public function byUuid(DeviceProfile $profile): array
    {
        $published = [];
        foreach ($this->artifacts($profile) as $artifact) {
            foreach ($artifact->definition['parameters'] ?? [] as $parameter) {
                $published[$parameter['uuid']] = [
                    'key' => $parameter['key'], 'kind' => $parameter['kind'],
                    'data_type' => $parameter['data_type'], 'unit' => $parameter['unit'] ?? null,
                ];
            }
        }

        return $published;
    }

    /** @return array<string, string> every key a published parameter has used, mapped to that parameter's UUID */
    public function keys(DeviceProfile $profile): array
    {
        $keys = [];
        foreach ($this->artifacts($profile) as $artifact) {
            foreach ($artifact->definition['parameters'] ?? [] as $parameter) {
                $keys[$parameter['key']] = $parameter['uuid'];
            }
        }

        return $keys;
    }

    /** Publishing adds an artifact; drop the memo so later reads in this process see it. */
    public function forget(int $profileId): void
    {
        unset($this->memo[$profileId]);
    }

    /** Whether the parameter appears in any published artifact of its profile. */
    public function isPublished(ProfileParameter $parameter): bool
    {
        return isset($this->byUuidForProfileId($parameter->device_profile_id)[$parameter->uuid]);
    }

    /** @var array<int, list<DeviceProfileArtifact>> */
    private array $memo = [];

    /** @return list<DeviceProfileArtifact> oldest first */
    private function artifacts(DeviceProfile $profile): array
    {
        return $this->artifactsForProfileId($profile->getKey());
    }

    /**
     * Enforcement always reads fresh artifacts and refreshes the memo; display
     * flags reuse the memo for the rest of the request or job.
     *
     * @return list<DeviceProfileArtifact>
     */
    private function artifactsForProfileId(int $profileId, bool $fresh = true): array
    {
        if ($fresh || ! isset($this->memo[$profileId])) {
            $this->memo[$profileId] = DeviceProfileArtifact::query()
                ->where('device_profile_id', $profileId)->orderBy('revision')->get(['definition', 'revision'])->all();
        }

        return $this->memo[$profileId];
    }

    /** @return array<string, true> */
    private function byUuidForProfileId(int $profileId): array
    {
        $uuids = [];
        foreach ($this->artifactsForProfileId($profileId, fresh: false) as $artifact) {
            foreach ($artifact->definition['parameters'] ?? [] as $parameter) {
                $uuids[$parameter['uuid']] = true;
            }
        }

        return $uuids;
    }
}
