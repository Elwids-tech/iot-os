<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Requests;

use App\Domain\DeviceManagement\Data\GatewayAuthoringData;
use App\Domain\DeviceManagement\Data\GatewayRouteAuthoringData;
use App\Domain\DeviceProfile\Data\DeviceProfileAuthoringData;
use App\Domain\DeviceProfile\Data\NativeMqttBindingAuthoringData;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;
use InvalidArgumentException;

final class DefinitionCompilationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'schema' => ['required', 'in:iot.definition-compile-request.v1'],
            'organization_uuid' => ['required', 'uuid'],
            'profile' => ['required', 'array'],
            'binding' => ['required', 'array'],
            'gateway' => ['required', 'array'],
            'route' => ['required', 'array'],
            'fixtures' => ['required', 'array', 'min:1', 'max:256'],
            'fixtures.*' => ['array:name,kind,channel,topic,payload,command_input,expected_parameter_values'],
            'fixtures.*.name' => ['required', 'string', 'max:160'],
            'fixtures.*.kind' => ['required', 'in:telemetry,event,property,command_request,command_response'],
            'fixtures.*.channel' => ['required', 'string', 'max:100', 'regex:/^[a-z][a-z0-9_]{0,99}$/'],
            'fixtures.*.topic' => ['required', 'string', 'max:512'],
            'fixtures.*.payload' => ['present'],
            'fixtures.*.command_input' => ['sometimes', 'array'],
            'fixtures.*.expected_parameter_values' => ['sometimes', 'array', 'max:1024'],
            'fixtures.*.expected_parameter_values.*' => ['array:parameter_uuid,value'],
            'fixtures.*.expected_parameter_values.*.parameter_uuid' => ['required', 'uuid'],
            'fixtures.*.expected_parameter_values.*.value' => ['present'],
        ];
    }

    /** @return list<callable(Validator): void> */
    public function after(): array
    {
        return [function (Validator $validator): void {
            if ($validator->errors()->isNotEmpty()) {
                return;
            }

            try {
                $this->profileData();
                $this->bindingData();
                $this->gatewayData();
                $this->routeData();
            } catch (InvalidArgumentException $exception) {
                $validator->errors()->add('definition', $exception->getMessage());
            }
        }];
    }

    public function profileData(): DeviceProfileAuthoringData
    {
        return DeviceProfileAuthoringData::fromArray($this->input('profile'));
    }

    public function bindingData(): NativeMqttBindingAuthoringData
    {
        return NativeMqttBindingAuthoringData::fromArray($this->input('binding'));
    }

    public function gatewayData(): GatewayAuthoringData
    {
        return GatewayAuthoringData::fromArray($this->input('gateway'));
    }

    public function routeData(): GatewayRouteAuthoringData
    {
        return GatewayRouteAuthoringData::fromArray($this->input('route'));
    }

    /** @return list<array<string, mixed>> */
    public function fixtures(): array
    {
        /** @var list<array<string, mixed>> $fixtures */
        $fixtures = $this->validated('fixtures');

        return $fixtures;
    }
}
