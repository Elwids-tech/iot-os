<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Requests;

use App\Domain\DeviceProfile\Data\NativeMqttBindingAuthoringData;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;
use InvalidArgumentException;

final class NativeMqttBindingAuthoringRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'schema' => ['required', 'in:iot.native-mqtt-binding.authoring.v1'],
            'binding' => ['required', 'array:uuid,profile_uuid,key,name,description,transport'],
            'binding.uuid' => ['required', 'uuid'],
            'binding.profile_uuid' => ['required', 'uuid'],
            'binding.key' => ['required', 'string', 'max:100', 'regex:/^[a-z][a-z0-9_]{0,99}$/'],
            'binding.name' => ['required', 'string', 'max:160'],
            'binding.description' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'binding.transport' => ['required', 'in:native_mqtt_json'],
            'version' => [
                'required',
                'array:uuid,profile_version_uuid,version,notes,channels,parameter_mappings,property_mappings,event_mappings,command_mappings',
            ],
            'version.uuid' => ['required', 'uuid'],
            'version.profile_version_uuid' => ['required', 'uuid'],
            'version.version' => ['required', 'integer', 'min:1'],
            'version.notes' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'version.channels' => ['required', 'array', 'min:1', 'max:32'],
            'version.channels.*' => ['array'],
            'version.parameter_mappings' => ['present', 'array', 'max:1024'],
            'version.parameter_mappings.*' => ['array'],
            'version.property_mappings' => ['present', 'array', 'max:1024'],
            'version.property_mappings.*' => ['array'],
            'version.event_mappings' => ['present', 'array', 'max:256'],
            'version.event_mappings.*' => ['array'],
            'version.command_mappings' => ['present', 'array', 'max:256'],
            'version.command_mappings.*' => ['array'],
        ];
    }

    /** @return list<callable> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            try {
                NativeMqttBindingAuthoringData::fromArray($this->all());
            } catch (InvalidArgumentException $exception) {
                $validator->errors()->add('version', $exception->getMessage());
            }
        }];
    }
}
