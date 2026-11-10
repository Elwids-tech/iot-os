<?php

declare(strict_types=1);

namespace App\Domain\Firmware\Http\Controllers;

use App\Domain\Devices\Models\SparkplugGateway;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Firmware\Http\Requests\FirmwareStarterRequest;
use App\Domain\Firmware\Services\FirmwareDownloads;
use App\Domain\Firmware\Services\FirmwareSelection;
use App\Domain\Firmware\Services\StarterBuilder;
use App\Domain\Firmware\Services\StarterProfiles;
use App\Domain\Firmware\Services\TargetRegistry;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Validation\ValidationException;

/** A credential-free starter for any member who may view the profiles. Not recorded: it holds no secrets (spec 027 R5). */
final class FirmwareStarterController
{
    public function __construct(
        private readonly StarterProfiles $profiles,
        private readonly StarterBuilder $builder,
        private readonly TargetRegistry $registry,
        private readonly FirmwareDownloads $downloads,
        private readonly FirmwareSelection $selection,
        private readonly DeviceAuthorization $devices,
    ) {}

    public function store(FirmwareStarterRequest $request, Organization $organization): JsonResponse
    {
        $values = $request->validated();
        $user = $request->user();
        $gateway = null;
        if (! empty($values['gateway_uuid'])) {
            $gateway = SparkplugGateway::where('uuid', $values['gateway_uuid'])->where('organization_id', $organization->id)->firstOrFail();
            $this->devices->authorize($user, DevicePermission::CONNECTIONS, $organization, $gateway);
            if ($gateway->adapter) {
                throw ValidationException::withMessages(['gateway_uuid' => 'This gateway publishes for the device adapter "'.$gateway->adapter->name.'". It has no firmware.']);
            }
        }
        $this->profiles->authorizeView($organization, $user);
        $node = empty($values['node_artifact_uuid']) ? null : $this->profiles->artifact($values['node_artifact_uuid'], $organization, $user);
        $types = array_map(fn (string $uuid): array => $this->profiles->artifact($uuid, $organization, $user), $values['device_type_artifact_uuids'] ?? []);
        $target = $this->registry->find($values['target']);
        $starter = $this->builder->build($target, $values['role'], $node, $types);
        if ($gateway) {
            $this->selection->save($gateway, $target['id'], $node, $types, $user);
        }

        return $this->downloads->response($starter['root'].'.zip', $starter['manifest'], $this->downloads->under($starter['root'], $starter['files']));
    }
}
