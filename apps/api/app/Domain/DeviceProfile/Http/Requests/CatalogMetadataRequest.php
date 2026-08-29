<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class CatalogMetadataRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'name' => ['required_without:description', 'string', 'max:160'],
            'description' => ['required_without:name', 'nullable', 'string', 'max:4000'],
        ];
    }
}
