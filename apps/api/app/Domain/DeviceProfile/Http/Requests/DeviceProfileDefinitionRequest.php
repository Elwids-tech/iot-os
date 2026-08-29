<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class DeviceProfileDefinitionRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return DefinitionRequestRules::profile();
    }
}
