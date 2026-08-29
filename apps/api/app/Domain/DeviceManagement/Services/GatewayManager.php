<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Services;

use App\Domain\DeviceManagement\Data\GatewayAuthoringData;
use App\Domain\DeviceManagement\Models\Gateway;
use App\Domain\Shared\Exceptions\DomainInvariantViolation;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;

final class GatewayManager
{
    public function create(
        Organization $organization,
        GatewayAuthoringData $data,
        ?User $actor = null,
    ): Gateway {
        $this->assertIdentityAvailable($organization, $data);

        return Gateway::query()->create([
            'organization_id' => $organization->getKey(),
            ...$data->attributes(),
            'created_by_id' => $actor?->getKey(),
            'updated_by_id' => $actor?->getKey(),
        ]);
    }

    public function replace(
        Gateway $gateway,
        GatewayAuthoringData $data,
        ?string $expectedEntityTag,
        ?User $actor = null,
    ): Gateway {
        $gateway->assertExpectedEntityTag($expectedEntityTag);

        return DB::transaction(function () use ($gateway, $data, $expectedEntityTag, $actor): Gateway {
            $locked = Gateway::query()->lockForUpdate()->findOrFail($gateway->getKey());
            $locked->assertExpectedEntityTag($expectedEntityTag);

            if ($data->uuid !== $locked->uuid) {
                throw new DomainInvariantViolation('A Gateway replacement cannot change its UUID.');
            }

            if (
                $locked->routes()->exists()
                && ($data->key !== $locked->key || $data->mqttClientId !== $locked->mqtt_client_id)
            ) {
                throw new DomainInvariantViolation('A routed Gateway key and MQTT client identity are immutable.');
            }

            $this->assertIdentityAvailable($locked->organization, $data, $locked);
            $attributes = $data->attributes();
            unset($attributes['uuid']);

            $locked->forceFill([
                ...$attributes,
                'updated_by_id' => $actor?->getKey(),
                'revision' => $locked->revision + 1,
            ])->save();

            return $locked->refresh();
        });
    }

    public function delete(Gateway $gateway, ?string $expectedEntityTag): void
    {
        $gateway->assertExpectedEntityTag($expectedEntityTag);

        DB::transaction(function () use ($gateway, $expectedEntityTag): void {
            $locked = Gateway::query()->lockForUpdate()->findOrFail($gateway->getKey());
            $locked->assertExpectedEntityTag($expectedEntityTag);

            if ($locked->routes()->exists()) {
                throw new DomainInvariantViolation('A Gateway referenced by a Gateway Route cannot be deleted.');
            }

            $locked->delete();
        });
    }

    private function assertIdentityAvailable(
        Organization $organization,
        GatewayAuthoringData $data,
        ?Gateway $except = null,
    ): void {
        $duplicate = Gateway::query()
            ->where(static function ($query) use ($organization, $data): void {
                $query->where(static function ($tenantKey) use ($organization, $data): void {
                    $tenantKey
                        ->where('organization_id', $organization->getKey())
                        ->where('key', $data->key);
                })->orWhere('mqtt_client_id', $data->mqttClientId)
                    ->orWhere('uuid', $data->uuid);
            })
            ->when($except !== null, fn ($query) => $query->whereKeyNot($except->getKey()))
            ->exists();

        if ($duplicate) {
            throw new DomainInvariantViolation('The Gateway UUID, tenant key, and MQTT client ID must be unique.');
        }
    }
}
