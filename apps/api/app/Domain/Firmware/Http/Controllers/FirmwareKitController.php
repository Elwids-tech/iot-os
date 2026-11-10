<?php

declare(strict_types=1);

namespace App\Domain\Firmware\Http\Controllers;

use App\Domain\Devices\Models\Device;
use App\Domain\Devices\Models\DeviceOnboarding;
use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAudit;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Firmware\Services\ConnectionSettings;
use App\Domain\Firmware\Services\FirmwareDownloads;
use App\Domain\Firmware\Services\FirmwareSelection;
use App\Domain\Firmware\Services\MetricTables;
use App\Domain\Firmware\Services\StarterBuilder;
use App\Domain\Firmware\Services\StarterProfiles;
use App\Domain\Firmware\Services\TargetRegistry;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Validation\Rule;
use Illuminate\Validation\ValidationException;

/** A full kit: the starter with the device's or gateway's settings in its config/ (spec 027 US3). */
final class FirmwareKitController
{
    public function __construct(
        private readonly DeviceAuthorization $authorization,
        private readonly StarterProfiles $profiles,
        private readonly StarterBuilder $builder,
        private readonly TargetRegistry $registry,
        private readonly ConnectionSettings $settings,
        private readonly FirmwareDownloads $downloads,
        private readonly FirmwareSelection $selection,
    ) {}

    public function device(Request $request, Organization $organization, Device $device): JsonResponse
    {
        $this->authorization->authorize($request->user(), DevicePermission::CONNECTIONS, $organization, $device);
        $values = $request->validate(['target' => ['required', 'string', Rule::in($this->targets())]]);
        $setup = DeviceOnboarding::where('device_id', $device->id)->with('artifact.profile')->first();
        abort_unless($setup?->mode === 'direct', 422, 'Only a device that connects directly has a firmware kit. A device behind a gateway is part of its gateway\'s.');
        $artifact = $device->appliedConfiguration?->artifact ?? $setup->artifact;
        abort_unless($artifact?->profile?->organization_id === $organization->id, 422, 'This device has no published profile revision.');
        $starter = $this->builder->build($this->registry->find($values['target']), 'direct', $this->profiles->load($artifact), []);
        $settings = $this->settings->device($device);
        $files = $this->downloads->under($starter['root'], [...$starter['files'], ...$settings]);
        $this->record('device.firmware-kit.downloaded', $organization, $request, $device->uuid, $starter['manifest']);

        return $this->downloads->response($device->code.'-'.$values['target'].'-firmware-kit.zip', $starter['manifest'], $files);
    }

    public function gateway(Request $request, Organization $organization, SparkplugGateway $gateway): JsonResponse
    {
        $user = $request->user();
        $this->authorization->authorize($user, DevicePermission::CONNECTIONS, $organization, $gateway);
        abort_if($gateway->adapter !== null, 422, 'This gateway publishes for the device adapter "'.$gateway->adapter?->name.'". It has no firmware, and its credentials stay with the adapter.');
        $values = $request->validate([
            'target' => ['sometimes', 'string', Rule::in($this->targets())],
            'node_artifact_uuid' => ['sometimes', 'nullable', 'uuid'],
            'device_type_artifact_uuids' => ['sometimes', 'array', 'min:1', 'max:'.MetricTables::MAX_TYPES],
            'device_type_artifact_uuids.*' => ['uuid', 'distinct'],
        ], [
            'device_type_artifact_uuids.max' => 'A gateway kit holds at most '.MetricTables::MAX_TYPES.' device types (IOTOS_MAX_DEVICE_TYPES).',
        ]);
        // Missing fields default to the gateway's saved selection, with each profile's newest revision.
        $saved = is_array($gateway->firmware_selection) ? $gateway->firmware_selection : [];
        $targetId = $values['target'] ?? $saved['target'] ?? null;
        $target = is_string($targetId) ? $this->registry->find($targetId) : null;
        if (! $target) {
            throw ValidationException::withMessages(['target' => 'Choose a firmware target.']);
        }
        $this->profiles->authorizeView($organization, $user);
        if (array_key_exists('node_artifact_uuid', $values)) {
            $node = $values['node_artifact_uuid'] === null ? null : $this->profiles->artifact($values['node_artifact_uuid'], $organization, $user);
        } else {
            $node = isset($saved['node_profile_uuid']) ? $this->profiles->latest($saved['node_profile_uuid'], $organization, $user) : null;
        }
        $types = array_key_exists('device_type_artifact_uuids', $values)
            ? array_map(fn (string $uuid): array => $this->profiles->artifact($uuid, $organization, $user), $values['device_type_artifact_uuids'])
            : array_values(array_filter(array_map(fn (string $uuid): ?array => $this->profiles->latest($uuid, $organization, $user), $saved['device_profile_uuids'] ?? [])));
        $starter = $this->builder->build($target, 'gateway', $node, $types);
        $settings = $this->settings->gateway($gateway);
        $this->selection->save($gateway, $target['id'], $node, $types, $user);
        $this->record('gateway.firmware-kit.downloaded', $organization, $request, $gateway->uuid, $starter['manifest']);

        return $this->downloads->response($gateway->edge_node_id.'-'.$target['id'].'-firmware-kit.zip', $starter['manifest'],
            $this->downloads->under($starter['root'], [...$starter['files'], ...$settings]));
    }

    /** @return list<string> */
    private function targets(): array
    {
        return array_column($this->registry->available(), 'id');
    }

    /** Records the download with what it was built from, never with settings. */
    private function record(string $event, Organization $organization, Request $request, string $subject, array $manifest): void
    {
        $profiles = array_merge(
            ($manifest['node']['default_health'] ?? true) ? [] : [['code' => $manifest['node']['code'], 'revision' => $manifest['node']['revision']]],
            array_map(fn (array $type): array => ['code' => $type['code'], 'revision' => $type['revision']], $manifest['device_types']),
        );
        DeviceAudit::record($event, $organization->id, $request->user()->id, $subject, [
            'target' => $manifest['target']['id'], 'sdk_version' => $manifest['sdk_version'], 'profiles' => $profiles,
        ]);
    }
}
