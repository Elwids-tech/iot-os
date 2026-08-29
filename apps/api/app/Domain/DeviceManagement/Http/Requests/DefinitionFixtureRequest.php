<?php

declare(strict_types=1);

namespace App\Domain\DeviceManagement\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class DefinitionFixtureRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, mixed> */
    public function rules(): array
    {
        return [
            'schema' => ['required', 'in:iot.definition-fixtures.v1'],
            'expected_input_hash' => ['sometimes', 'nullable', 'string', 'regex:/^[a-f0-9]{64}$/'],
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

    /** @return list<array<string, mixed>> */
    public function fixtures(): array
    {
        /** @var list<array<string, mixed>> $fixtures */
        $fixtures = $this->validated('fixtures');

        return $fixtures;
    }

    public function expectedInputHash(): ?string
    {
        $value = $this->validated('expected_input_hash');

        return is_string($value) ? $value : null;
    }
}
