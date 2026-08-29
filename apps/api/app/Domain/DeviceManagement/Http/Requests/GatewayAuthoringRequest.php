<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Http\Requests;

use App\Domain\DeviceManagement\Data\GatewayAuthoringData;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;
use InvalidArgumentException;

final class GatewayAuthoringRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'schema' => ['required', 'in:iot.gateway.authoring.v1'],
            'gateway' => ['required', 'array:uuid,key,name,description,mqtt_client_id'],
            'gateway.uuid' => ['required', 'uuid'],
            'gateway.key' => ['required', 'string', 'max:100', 'regex:/^[a-z][a-z0-9_]{0,99}$/'],
            'gateway.name' => ['required', 'string', 'max:160'],
            'gateway.description' => ['sometimes', 'nullable', 'string', 'max:4000'],
            'gateway.mqtt_client_id' => ['required', 'string', 'max:256', 'not_regex:/[+#\x00]/'],
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
                GatewayAuthoringData::fromArray($this->all());
            } catch (InvalidArgumentException $exception) {
                $validator->errors()->add('gateway', $exception->getMessage());
            }
        }];
    }
}
