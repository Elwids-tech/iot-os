<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Requests;

use App\Domain\DeviceProfile\Data\DeviceProfileV2AuthoringData;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;
use InvalidArgumentException;

final class DeviceProfileV2AuthoringRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'schema' => ['required', 'in:iot.device-profile.authoring.v2'],
            'profile' => ['required', 'array:uuid,key,name,description'],
            'profile.uuid' => ['required', 'uuid'],
            'profile.key' => ['required', 'string', 'max:100', 'regex:/^[a-z][a-z0-9_]{0,99}$/'],
            'profile.name' => ['required', 'string', 'max:160'],
            'profile.description' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'version' => ['required', 'array:uuid,version,notes,parameters,derived_parameters,properties,events,commands'],
            'version.uuid' => ['required', 'uuid'],
            'version.version' => ['required', 'integer', 'min:1'],
            'version.notes' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'version.parameters' => ['present', 'array', 'max:1024'],
            'version.parameters.*' => ['array:uuid,key,label,description,value_schema,presentation'],
            'version.parameters.*.uuid' => ['required', 'uuid'],
            'version.parameters.*.key' => ['required', 'string', 'max:100', 'regex:/^[a-z][a-z0-9_]{0,99}$/'],
            'version.parameters.*.label' => ['required', 'string', 'max:160'],
            'version.parameters.*.description' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'version.parameters.*.value_schema' => ['required', 'array'],
            'version.parameters.*.presentation' => ['sometimes', 'array'],
            'version.derived_parameters' => ['present', 'array', 'max:256'],
            'version.derived_parameters.*' => ['array:uuid,key,label,description,value_schema,expression,dependencies,presentation'],
            'version.derived_parameters.*.uuid' => ['required', 'uuid'],
            'version.derived_parameters.*.key' => ['required', 'string', 'max:100', 'regex:/^[a-z][a-z0-9_]{0,99}$/'],
            'version.derived_parameters.*.label' => ['required', 'string', 'max:160'],
            'version.derived_parameters.*.value_schema' => ['required', 'array'],
            'version.derived_parameters.*.expression' => ['required', 'array:language,source'],
            'version.derived_parameters.*.expression.language' => ['required', 'in:cel'],
            'version.derived_parameters.*.expression.source' => ['required', 'string', 'max:4096'],
            'version.derived_parameters.*.dependencies' => ['required', 'array', 'min:1', 'max:64'],
            'version.derived_parameters.*.dependencies.*' => ['required', 'uuid', 'distinct'],
            'version.properties' => ['present', 'array', 'max:256'],
            'version.properties.*' => ['array'],
            'version.events' => ['present', 'array', 'max:256'],
            'version.events.*' => ['array'],
            'version.commands' => ['present', 'array', 'max:256'],
            'version.commands.*' => ['array'],
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
                DeviceProfileV2AuthoringData::fromArray($this->all());
            } catch (InvalidArgumentException $exception) {
                $validator->errors()->add('version', $exception->getMessage());
            }
        }];
    }
}
