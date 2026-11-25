<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Entities\Models\EntityType;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\ValidationException;

/**
 * Built-in sets of types and rules (spec 009, FR-007, research R15). Applying one adds
 * the types the organization lacks and, for keys it already has, combines allowed
 * parents and member types only. Entities never change.
 */
final class EntityPresets
{
    public const VERSION = 1;

    /**
     * @return array<string, array{name: string, description: string, types: list<array{key: string, name: string, top_level?: bool, parents?: list<string>, members?: list<string>, devices?: bool, timezone?: bool, location?: bool}>}>
     */
    public static function definitions(): array
    {
        return [
            'manufacturing' => [
                'name' => 'Manufacturing (ISA-95)',
                'description' => 'Site, area, line, cell and asset. An asset may also sit directly under a line or an area.',
                'types' => [
                    ['key' => 'site', 'name' => 'Site', 'top_level' => true, 'devices' => true, 'timezone' => true, 'location' => true],
                    ['key' => 'area', 'name' => 'Area', 'parents' => ['site'], 'devices' => true],
                    ['key' => 'line', 'name' => 'Line', 'parents' => ['area'], 'devices' => true],
                    ['key' => 'cell', 'name' => 'Cell', 'parents' => ['line'], 'devices' => true],
                    ['key' => 'asset', 'name' => 'Asset', 'parents' => ['cell', 'line', 'area'], 'devices' => true],
                ],
            ],
            'buildings' => [
                'name' => 'Buildings',
                'description' => 'Site, building, floor, zone and room. A room may also sit directly under a floor.',
                'types' => [
                    ['key' => 'site', 'name' => 'Site', 'top_level' => true, 'devices' => true, 'timezone' => true, 'location' => true],
                    ['key' => 'building', 'name' => 'Building', 'parents' => ['site'], 'devices' => true, 'location' => true],
                    ['key' => 'floor', 'name' => 'Floor', 'parents' => ['building'], 'devices' => true],
                    ['key' => 'zone', 'name' => 'Zone', 'parents' => ['floor'], 'devices' => true],
                    ['key' => 'room', 'name' => 'Room', 'parents' => ['zone', 'floor'], 'devices' => true],
                ],
            ],
            'power_distribution' => [
                'name' => 'Power distribution',
                'description' => 'Region, substation and feeder, with the equipment on a feeder, meters, and divisions that group substations, feeders and transformers across the network.',
                'types' => [
                    ['key' => 'region', 'name' => 'Region', 'top_level' => true, 'timezone' => true],
                    ['key' => 'substation', 'name' => 'Substation', 'parents' => ['region'], 'devices' => true, 'location' => true],
                    ['key' => 'feeder', 'name' => 'Feeder', 'parents' => ['substation'], 'devices' => true],
                    ['key' => 'distribution_transformer', 'name' => 'Distribution transformer', 'parents' => ['feeder'], 'devices' => true, 'location' => true],
                    ['key' => 'recloser', 'name' => 'Recloser', 'parents' => ['feeder'], 'devices' => true, 'location' => true],
                    ['key' => 'ring_main_unit', 'name' => 'Ring main unit', 'parents' => ['feeder'], 'devices' => true, 'location' => true],
                    ['key' => 'switchgear', 'name' => 'Switchgear', 'parents' => ['feeder'], 'devices' => true, 'location' => true],
                    ['key' => 'capacitor_bank', 'name' => 'Capacitor bank', 'parents' => ['feeder'], 'devices' => true, 'location' => true],
                    ['key' => 'meter', 'name' => 'Meter', 'parents' => ['distribution_transformer', 'feeder'], 'devices' => true, 'location' => true],
                    ['key' => 'division', 'name' => 'Division', 'parents' => ['region'], 'members' => ['substation', 'feeder', 'distribution_transformer']],
                ],
            ],
        ];
    }

    /**
     * What applying a preset would do here: each type `add`, `merge` (its parents or
     * members would grow) or `present` (nothing to change).
     *
     * @return list<array{key: string, name: string, outcome: 'add'|'merge'|'present'}>
     */
    public function preview(Organization $organization, string $preset): array
    {
        $existing = EntityType::query()->where('organization_id', $organization->id)->get()->keyBy('key');

        return array_map(function (array $definition) use ($existing): array {
            $type = $existing->get($definition['key']);
            $outcome = match (true) {
                $type === null => 'add',
                array_diff($definition['parents'] ?? [], $type->parent_type_keys) !== [] || array_diff($definition['members'] ?? [], $type->member_type_keys) !== [] => 'merge',
                default => 'present',
            };

            return ['key' => $definition['key'], 'name' => $type?->name ?? $definition['name'], 'outcome' => $outcome];
        }, $this->definition($preset)['types']);
    }

    /**
     * @return array{added: list<string>, merged: list<string>}
     */
    public function apply(Organization $organization, string $preset, User $actor): array
    {
        $definition = $this->definition($preset);

        return DB::transaction(function () use ($organization, $preset, $definition, $actor): array {
            EntityTree::lock($organization);
            $types = app(EntityTypes::class);
            $types->ensureSite($organization);
            $existing = EntityType::query()->where('organization_id', $organization->id)->get()->keyBy('key');
            $added = $merged = [];
            foreach ($definition['types'] as $item) {
                $type = $existing->get($item['key']);
                if ($type === null) {
                    EntityType::create([
                        'organization_id' => $organization->id, 'key' => $item['key'],
                        'name' => $types->freeName($organization, $item['name'], $definition['name']),
                        'top_level' => $item['top_level'] ?? false,
                        'parent_type_keys' => $item['parents'] ?? [], 'member_type_keys' => $item['members'] ?? [],
                        'accepts_devices' => $item['devices'] ?? false, 'carries_timezone' => $item['timezone'] ?? false,
                        'carries_location' => $item['location'] ?? false, 'preset_keys' => [$preset],
                        'created_by' => $actor->id, 'updated_by' => $actor->id,
                    ]);
                    $added[] = $item['key'];

                    continue;
                }
                $parents = array_values(array_unique([...$type->parent_type_keys, ...($item['parents'] ?? [])]));
                $members = array_values(array_unique([...$type->member_type_keys, ...($item['members'] ?? [])]));
                $presets = array_values(array_unique([...$type->preset_keys, $preset]));
                $grew = $parents !== $type->parent_type_keys || $members !== $type->member_type_keys;
                if ($grew || $presets !== $type->preset_keys) {
                    $type->forceFill(['parent_type_keys' => $parents, 'member_type_keys' => $members, 'preset_keys' => $presets, 'updated_by' => $actor->id])->save();
                }
                if ($grew) {
                    $merged[] = $item['key'];
                }
            }
            if ($added !== [] || $merged !== []) {
                ActivityLog::record('entity_type.preset_applied', $organization, $actor, null, ['preset' => $preset, 'version' => self::VERSION, 'added' => $added, 'merged' => $merged]);
            }

            return ['added' => $added, 'merged' => $merged];
        });
    }

    /**
     * @return array{name: string, description: string, types: list<array<string, mixed>>}
     */
    private function definition(string $preset): array
    {
        return self::definitions()[$preset] ?? throw ValidationException::withMessages(['preset' => 'Unknown preset.']);
    }
}
