<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Requests;

use App\Domain\Shared\Models\Organization;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Rule;

/** Deleting is permanent, so the caller repeats the organization's slug. */
final class DeleteOrganizationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, list<string|object>>
     */
    public function rules(): array
    {
        /** @var Organization $organization */
        $organization = $this->route('organization');

        return [
            'slug' => ['required', 'string', Rule::in([$organization->slug])],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'slug.in' => 'Type the organization\'s slug exactly to confirm.',
        ];
    }
}
