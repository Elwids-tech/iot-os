<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Requests;

final class DefinitionRequestRules
{
    /** @return array<string, list<string>> */
    public static function profile(string $prefix = ''): array
    {
        return [
            $prefix.'schema' => ['required', 'in:iot.device-profile.authoring.v1'],
            $prefix.'profile' => ['required', 'array:uuid,key,name,description'],
            $prefix.'profile.uuid' => ['sometimes', 'uuid'],
            $prefix.'profile.key' => ['required', 'string', 'max:100', 'regex:/^[a-z][a-z0-9_]{0,99}$/'],
            $prefix.'profile.name' => ['required', 'string', 'max:160'],
            $prefix.'profile.description' => ['sometimes', 'nullable', 'string', 'max:4000'],
            $prefix.'version' => ['required', 'array:uuid,version,notes,components'],
            $prefix.'version.uuid' => ['sometimes', 'uuid'],
            $prefix.'version.version' => ['required', 'integer', 'min:1'],
            $prefix.'version.notes' => ['sometimes', 'nullable', 'string', 'max:4000'],
            $prefix.'version.components' => ['required', 'array', 'min:1', 'max:32'],
            $prefix.'version.components.*' => ['array'],
        ];
    }

    /** @return array<string, list<string>> */
    public static function binding(string $prefix = ''): array
    {
        return [
            $prefix.'schema' => ['required', 'in:iot.native-mqtt-binding.authoring.v1'],
            $prefix.'binding' => ['required', 'array:uuid,profile_uuid,key,name,description,transport'],
            $prefix.'binding.uuid' => ['sometimes', 'uuid'],
            $prefix.'binding.profile_uuid' => ['required', 'uuid'],
            $prefix.'binding.key' => ['required', 'string', 'max:100', 'regex:/^[a-z][a-z0-9_]{0,99}$/'],
            $prefix.'binding.name' => ['required', 'string', 'max:160'],
            $prefix.'binding.description' => ['sometimes', 'nullable', 'string', 'max:4000'],
            $prefix.'binding.transport' => ['required', 'in:native_mqtt_json'],
            $prefix.'version' => [
                'required',
                'array:uuid,profile_version_uuid,version,notes,channels,telemetry_mappings,property_mappings,event_mappings,command_mappings',
            ],
            $prefix.'version.uuid' => ['sometimes', 'uuid'],
            $prefix.'version.profile_version_uuid' => ['required', 'uuid'],
            $prefix.'version.version' => ['required', 'integer', 'min:1'],
            $prefix.'version.notes' => ['sometimes', 'nullable', 'string', 'max:4000'],
            $prefix.'version.channels' => ['required', 'array', 'min:1', 'max:64'],
            $prefix.'version.telemetry_mappings' => ['present', 'array', 'max:1024'],
            $prefix.'version.property_mappings' => ['present', 'array', 'max:1024'],
            $prefix.'version.event_mappings' => ['present', 'array', 'max:1024'],
            $prefix.'version.command_mappings' => ['present', 'array', 'max:1024'],
        ];
    }
}
