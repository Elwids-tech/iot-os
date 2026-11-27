<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Services;

use App\Domain\DeviceAdapters\Models\AdapterConnection;
use App\Domain\DeviceAdapters\Models\DeviceAdapter;
use App\Domain\DeviceProfiles\Actions\CreateDeviceProfile;
use App\Domain\DeviceProfiles\Actions\PublishDeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\DeviceProfiles\Services\ProfileConfigurationValidator;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Support\Contracts\ContractMode;
use App\Support\Contracts\ContractValidator;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Illuminate\Validation\ValidationException;

/**
 * Point maps of OPC UA data sources (spec 038 US3, contracts/pointmaps/v1): their
 * validation, suggestions from what the server says about each point, the
 * organization's point limit, and a device type made from a map's readings.
 */
final class PointMaps
{
    public const SCHEMA = 'pointmaps/v1/point-map.v1.schema.json';

    /** FR-031: sampled every 10 s, a number counts as changed at 0.5% of its range. */
    public const SAMPLE_MS = 10_000;

    public const RHYTHM_SECONDS = 300;

    private const RULES = [
        'duplicate_reading_key' => 'Two readings have the same key.',
        'duplicate_source_id' => 'Two equipment items have the same path.',
        'unknown_reading' => 'This names a reading the map does not have.',
        'overridden_and_missing' => 'A reading cannot be both overridden and missing.',
        'mixed_addressing' => 'Use tag patterns for every reading or for none.',
    ];

    public function __construct(private readonly Connections $connections) {}

    /**
     * The `opcua` source of a data source: its connection in this organization and a point
     * map that conforms to the contract, keeps its rules, names only readings the profile
     * publishes and stays inside the organization's point limit.
     *
     * @return array{type: 'opcua', connection_uuid: string, point_map: array}
     */
    public function source(Organization $organization, array $source, DeviceProfileArtifact $artifact, ?DeviceAdapter $adapter = null): array
    {
        $connection = $this->connection($organization, (string) ($source['connection_uuid'] ?? ''));
        $map = $source['point_map'] ?? null;
        if (! is_array($map)) {
            throw ValidationException::withMessages(['source.point_map' => 'Choose the equipment and readings to collect.']);
        }
        $this->validate($map);
        $published = collect($artifact->definition['parameters'] ?? [])
            ->filter(fn ($p) => ($p['reports_state'] ?? true) !== false && ($p['kind'] ?? null) !== 'derived')
            ->pluck('key')->all();
        $errors = [];
        foreach ($map['readings'] as $i => $reading) {
            if (! in_array($reading['key'], $published, true)) {
                $errors["source.point_map.readings.{$i}.key"] = "The device type has no reading called {$reading['key']}.";
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
        $limit = $this->limit($organization, $map, $adapter);
        abort_if($limit['over'] > 0, 422, "This map reads {$limit['adding']} points; with the {$limit['used']} other data sources read, that is {$limit['over']} over this organization's limit of {$limit['max']}.");

        return ['type' => 'opcua', 'connection_uuid' => $connection->uuid, 'point_map' => $map];
    }

    public function connection(Organization $organization, string $uuid): AdapterConnection
    {
        $connection = Str::isUuid($uuid) ? AdapterConnection::where('organization_id', $organization->id)->where('uuid', $uuid)->first() : null;
        if (! $connection) {
            throw ValidationException::withMessages(['source.connection_uuid' => 'Choose a connection to the server.']);
        }

        return $connection;
    }

    /** Schema errors and rule problems as field errors under source.point_map. */
    public function validate(array $map): void
    {
        $errors = [];
        foreach (app(ContractValidator::class)->validate(self::SCHEMA, $map, ContractMode::Strict) as $violation) {
            $field = 'source.point_map'.str_replace('/', '.', $violation->instanceLocation);
            $errors[$field] ??= $this->where($map, $violation->instanceLocation).$this->schemaMessage($violation->keyword, $violation->missing);
        }
        if ($errors === []) {
            foreach (self::problems($map) as $problem) {
                $errors['source.point_map'.str_replace('/', '.', $problem['at'])] ??= $this->where($map, $problem['at']).self::RULES[$problem['rule']];
            }
        }
        if ($errors !== []) {
            throw ValidationException::withMessages($errors);
        }
    }

    /**
     * The rules no schema states, the same as services/adapters/lib/opcua/point-map.cjs and
     * contracts/pointmaps/v1/point-map.v1.rules.json.
     *
     * @return list<array{rule: string, at: string}>
     */
    public static function problems(array $map): array
    {
        $found = [];
        $keys = [];
        foreach ($map['readings'] as $i => $reading) {
            if (in_array($reading['key'], $keys, true)) {
                $found[] = ['rule' => 'duplicate_reading_key', 'at' => "/readings/{$i}/key"];
            }
            $keys[] = $reading['key'];
        }
        $patterned = array_map(fn ($r) => collect($r['address']['relative_path'] ?? [])->contains(fn ($s) => array_key_exists('pattern', $s)), $map['readings']);
        if (in_array(true, $patterned, true) && in_array(false, $patterned, true)) {
            $index = array_search(! $patterned[0], $patterned, true);
            $found[] = ['rule' => 'mixed_addressing', 'at' => "/readings/{$index}/address/relative_path"];
        }
        $sources = [];
        foreach ($map['equipment'] as $i => $equipment) {
            if (in_array($equipment['source_id'], $sources, true)) {
                $found[] = ['rule' => 'duplicate_source_id', 'at' => "/equipment/{$i}/source_id"];
            }
            $sources[] = $equipment['source_id'];
            $missing = $equipment['missing'] ?? [];
            foreach (array_keys($equipment['overrides'] ?? []) as $key) {
                if (! in_array($key, $keys, true)) {
                    $found[] = ['rule' => 'unknown_reading', 'at' => "/equipment/{$i}/overrides/{$key}"];
                } elseif (in_array($key, $missing, true)) {
                    $found[] = ['rule' => 'overridden_and_missing', 'at' => "/equipment/{$i}/overrides/{$key}"];
                }
            }
            foreach ($missing as $position => $key) {
                if (! in_array($key, $keys, true)) {
                    $found[] = ['rule' => 'unknown_reading', 'at' => "/equipment/{$i}/missing/{$position}"];
                }
            }
        }

        return $found;
    }

    /** Readings × equipment, less what each equipment lacks. */
    public static function pointCount(array $map): int
    {
        $readings = count($map['readings'] ?? []);

        return array_sum(array_map(fn ($e) => $readings - count($e['missing'] ?? []), $map['equipment'] ?? []));
    }

    /** At least one row a point per reporting rhythm, even when nothing changes (FR-032). */
    public static function rowsPerDay(array $map): int
    {
        return self::pointCount($map) * (int) ceil(86_400 / max(1, (int) ($map['rhythm_seconds'] ?? self::RHYTHM_SECONDS)));
    }

    /**
     * The organization's point limit (FR-037) with this map in place of the adapter's own.
     *
     * @return array{max: int, used: int, adding: int, over: int}
     */
    public function limit(Organization $organization, array $map, ?DeviceAdapter $adapter = null): array
    {
        $used = DeviceAdapter::where('organization_id', $organization->id)
            ->when($adapter, fn ($q) => $q->whereKeyNot($adapter->id))
            ->get(['id', 'source'])
            ->filter(fn ($a) => ($a->source['type'] ?? null) === 'opcua')
            ->sum(fn ($a) => self::pointCount($a->source['point_map'] ?? []));
        $max = (int) config('adapters.opcua.max_points');
        $adding = self::pointCount($map);

        return ['max' => $max, 'used' => (int) $used, 'adding' => $adding, 'over' => max(0, $used + $adding - $max)];
    }

    /** The review check of a revision's map, with the organization's limit. */
    public function check(DeviceAdapter $adapter, array $source): array
    {
        $organization = Organization::findOrFail($adapter->organization_id);
        $connection = $this->connection($organization, $source['connection_uuid']);
        $result = $this->connections->check($connection, $source['point_map']);
        $limit = $this->limit($organization, $source['point_map'], $adapter);
        $problems = $result['problems'] ?? [];
        if ($limit['over'] > 0) {
            $problems[] = ['source_id' => null, 'key' => null, 'problem' => "{$limit['over']} points over this organization's limit of {$limit['max']}."];
        }

        return [...$result, 'problems' => $problems, 'limit' => $limit, 'valid' => ($result['valid'] ?? false) && $limit['over'] === 0];
    }

    /**
     * Readings suggested from what the server says about ticked points (FR-023): a key and
     * name from the point's name, its unit, data type and range, and the reporting defaults.
     *
     * @param  list<array{name: string, display_name?: string, value?: mixed, data_type?: ?string, unit?: ?string, range?: ?array, states?: ?array, storable?: bool}>  $points
     * @return list<array<string, mixed>>
     */
    public function suggest(array $points): array
    {
        $taken = [];

        return array_values(array_map(function (array $point) use (&$taken) {
            $name = (string) ($point['display_name'] ?? $point['name']);
            // A vendor tag in capitals ("ZN-T") is lower-cased first, so it becomes zn_t, not z_n_t.
            $words = preg_replace('/[^A-Za-z0-9]+/', ' ', (string) $point['name']) ?: 'reading';
            $base = Str::snake(preg_match('/[a-z]/', $words) ? $words : Str::lower($words));
            $base = preg_match('/^[a-z]/', $base) ? $base : 'reading_'.$base;
            $key = $base;
            for ($n = 2; in_array($key, $taken, true); $n++) {
                $key = "{$base}_{$n}";
            }
            $taken[] = $key;
            $type = in_array($point['data_type'] ?? null, ['number', 'boolean', 'state', 'text'], true) ? $point['data_type'] : 'number';
            $range = is_array($point['range'] ?? null) && count($point['range']) === 2 && $point['range'][1] > $point['range'][0] ? array_map('floatval', $point['range']) : null;
            $deadband = $type === 'number' && $range ? ['kind' => 'percent', 'value' => 0.5] : ['kind' => 'none', 'value' => 0];

            return [
                'key' => $key,
                'name' => Str::limit(Str::ucfirst(str_replace('_', ' ', $name)), 120, ''),
                'data_type' => $type,
                'unit' => $type === 'number' ? ($point['unit'] ?? null) : null,
                ...($range ? ['range' => $range] : []),
                'report' => ['sample_ms' => self::SAMPLE_MS, 'deadband' => $deadband],
            ];
        }, $points));
    }

    /**
     * A new device type whose readings are the map's (FR-023): a profile with one
     * parameter per reading, published so the data source can use it at once.
     *
     * @param  list<array{key: string, name: string, data_type: string, unit?: ?string}>  $readings
     */
    public function deviceType(Organization $organization, User $actor, string $name, array $readings): DeviceProfileArtifact
    {
        abort_if($readings === [] || count($readings) > 500, 422, 'A device type needs 1 to 500 readings.');

        return DB::transaction(function () use ($organization, $actor, $name, $readings) {
            $code = Str::slug($name);
            $code = preg_match('/^[a-z0-9]/', $code) ? $code : 'device-type';
            $base = $code;
            for ($n = 2; DeviceProfile::where('organization_id', $organization->id)->where('code', $code)->exists(); $n++) {
                $code = "{$base}-{$n}";
            }
            $profile = app(CreateDeviceProfile::class)->handle($organization, $actor, ['code' => $code, 'name' => $name, 'category' => null]);
            foreach (array_values($readings) as $i => $reading) {
                $values = $this->parameter($reading, $i);
                $errors = app(ProfileConfigurationValidator::class)->errors($values);
                if ($errors !== []) {
                    throw ValidationException::withMessages(collect($errors)->mapWithKeys(fn ($m, $k) => ["readings.{$i}.{$k}" => $m])->all());
                }
                $profile->parameters()->create($values);
            }

            return app(PublishDeviceProfile::class)->handle($profile->fresh(), $actor, $profile->fresh()->draft_revision);
        });
    }

    private function parameter(array $reading, int $order): array
    {
        $key = (string) $reading['key'];
        abort_unless(preg_match('/^[a-zA-Z][a-zA-Z0-9._-]*$/', $key) === 1, 422, "{$key} cannot be a reading key.");
        [$kind, $type] = match ($reading['data_type'] ?? 'number') {
            'boolean' => ['state', 'boolean'],
            'state' => ['state', 'integer'],
            'text' => ['state', 'string'],
            default => ['measurement', 'number'],
        };

        return ['key' => $key, 'label' => Str::limit((string) ($reading['name'] ?? $key), 255, ''), 'kind' => $kind, 'data_type' => $type,
            'unit' => $type === 'number' ? ($reading['unit'] ?? null) : null, 'reports_state' => true, 'accepts_command' => false, 'sort_order' => $order];
    }

    /** "Reading 4 (occupancy): " for a pointer into the map, so the person knows which. */
    private function where(array $map, string $pointer): string
    {
        if (preg_match('#^/(readings|equipment)/(\d+)#', $pointer, $m) !== 1) {
            return '';
        }
        $item = $map[$m[1]][(int) $m[2]] ?? [];
        $name = $m[1] === 'readings' ? ($item['key'] ?? null) : ($item['display_name'] ?? null);

        return ($m[1] === 'readings' ? 'Reading ' : 'Equipment ').((int) $m[2] + 1).(is_string($name) && $name !== '' ? " ({$name})" : '').': ';
    }

    private function schemaMessage(string $keyword, array $missing): string
    {
        return match ($keyword) {
            'required' => 'Missing '.implode(', ', $missing).'.',
            'pattern' => 'This is not in the expected form.',
            'minItems' => 'Add at least one.',
            'maxItems' => 'There are too many.',
            'minimum', 'maximum' => 'This is out of range.',
            'enum', 'const' => 'This is not one of the allowed values.',
            'type' => 'This has the wrong type.',
            'additionalProperties' => 'This has a field the point map does not have.',
            default => 'This is not a valid point map.',
        };
    }
}
