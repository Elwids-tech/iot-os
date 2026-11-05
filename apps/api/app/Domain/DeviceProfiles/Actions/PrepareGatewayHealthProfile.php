<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Actions;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\DeviceProfiles\Models\DeviceProfile;
use App\Domain\DeviceProfiles\Models\DeviceProfileArtifact;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * The organization's gateway health profile (spec 026 US6, research R17): the metrics the
 * embedded SDK fills for a gateway's own source (firmware/sdk/include/iotos/iotos_health.h).
 * It is created and published once per organization; later calls return the existing
 * profile, edited or not, unchanged.
 */
final class PrepareGatewayHealthProfile
{
    public const CODE = 'gateway-health';

    /** Three default health intervals (IOTOS_HEALTH_INTERVAL_S). */
    private const STALE_AFTER_SECONDS = 180;

    private const CONNECTION_TYPES = ['ethernet', 'wifi', 'cellular', 'other'];

    /** @var list<array{0: string, 1: string, 2: string, 3: string, 4: string|null, 5: string}> key, label, data type, kind, unit, description */
    private const PARAMETERS = [
        ['uptime', 'Uptime', 'integer', 'counter', 's', 'Seconds since the gateway started; a reboot starts a new segment.'],
        ['connection_type', 'Connection', 'enum', 'state', null, 'How the gateway reaches the broker.'],
        ['signal_strength', 'Signal strength', 'number', 'measurement', 'dBm', 'Unknown when the network does not report it, as on Ethernet.'],
        ['firmware_version', 'Firmware version', 'string', 'state', null, 'The version the gateway firmware reports.'],
        ['sdk_version', 'SDK version', 'string', 'state', null, 'The embedded SDK version the firmware was built with.'],
        ['devices_configured', 'Devices configured', 'integer', 'measurement', null, 'Downstream devices the gateway has added.'],
        ['devices_online', 'Devices online', 'integer', 'measurement', null, 'Downstream devices not marked offline.'],
        ['reconnects', 'Reconnects', 'integer', 'counter', null, 'Broker reconnections since the gateway started.'],
    ];

    public function __construct(private readonly PublishDeviceProfile $publish) {}

    /** @return array{profile: DeviceProfile, artifact: DeviceProfileArtifact|null, created: bool} */
    public function handle(Organization $organization, User $actor): array
    {
        return DB::transaction(function () use ($organization, $actor): array {
            Organization::whereKey($organization->id)->lockForUpdate()->firstOrFail();
            $existing = DeviceProfile::withTrashed()->where('organization_id', $organization->id)->where('code', self::CODE)->first();
            if ($existing && ! $existing->trashed()) {
                return ['profile' => $existing, 'artifact' => $this->latest($existing), 'created' => false];
            }
            // A deleted profile is always an unpublished draft (DeviceProfile::deleting), but it still holds the code.
            $existing?->forceDelete();

            $profile = DeviceProfile::create([
                'organization_id' => $organization->id, 'code' => self::CODE, 'name' => 'Gateway health', 'category' => 'gateways',
                'description' => 'What a gateway built with the embedded SDK reports about itself: uptime, connection, signal strength, versions and device counts.',
                'created_by' => $actor->id, 'updated_by' => $actor->id,
            ]);
            foreach (self::PARAMETERS as $order => [$key, $label, $type, $kind, $unit, $description]) {
                $profile->parameters()->create([
                    'key' => $key, 'label' => $label, 'description' => $description, 'kind' => $kind, 'data_type' => $type, 'unit' => $unit,
                    'reports_state' => true, 'accepts_command' => false,
                    'validation_logic' => $type === 'enum' ? [
                        'engine' => 'json_logic', 'rule' => ['in' => [['var' => 'value'], self::CONNECTION_TYPES]],
                        'diagnostic_code' => 'unknown_connection_type', 'message' => 'The connection is ethernet, wifi, cellular or other.',
                    ] : null,
                    'reporting_config' => ['stale_after_seconds' => self::STALE_AFTER_SECONDS],
                    'counter_config' => $kind === 'counter' ? ['monotonic' => true, 'reset_behavior' => 'new_segment'] : null,
                    'sort_order' => $order,
                ]);
            }
            $artifact = $this->publish->handle($profile->fresh(), $actor, 1);
            ActivityLog::record('device_profile.gateway_health.created', $organization, $actor, $profile, ['revision' => $artifact->revision]);

            return ['profile' => $profile->fresh(), 'artifact' => $artifact, 'created' => true];
        });
    }

    /** @return list<string> the parameter keys, in profile order */
    public static function keys(): array
    {
        return array_column(self::PARAMETERS, 0);
    }

    private function latest(DeviceProfile $profile): ?DeviceProfileArtifact
    {
        return $profile->artifacts()->orderByDesc('revision')->first();
    }
}
