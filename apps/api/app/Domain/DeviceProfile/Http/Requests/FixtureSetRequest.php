<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class FixtureSetRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'fixtures' => ['required', 'array', 'min:1', 'max:256'],
            'fixtures.*' => ['required', 'array:name,kind,input,expected'],
            'fixtures.*.name' => ['required', 'string', 'max:160'],
            'fixtures.*.kind' => ['required', 'in:telemetry,reported_property,desired_property,event,command_request,command_response'],
            'fixtures.*.input' => ['present'],
            'fixtures.*.expected' => ['sometimes'],
        ];
    }
}
