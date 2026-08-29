<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfile\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class CoordinatedDefinitionDraftRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /** @return array<string, list<string>> */
    public function rules(): array
    {
        return [
            'profile' => ['required', 'array'],
            'binding' => ['required', 'array'],
            ...DefinitionRequestRules::profile('profile.'),
            ...DefinitionRequestRules::binding('binding.'),
        ];
    }
}
