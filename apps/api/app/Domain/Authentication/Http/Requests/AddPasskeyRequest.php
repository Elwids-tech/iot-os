<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Requests;

use Laravel\Passkeys\Http\Requests\PasskeyRegistrationRequest;

/**
 * A new passkey (spec 034, FR-016): the name the person chose and the browser's
 * attestation, checked against the options kept in the session.
 */
final class AddPasskeyRequest extends PasskeyRegistrationRequest
{
    /**
     * @return array<string, array<int, string>>
     */
    public function rules(): array
    {
        return [
            ...parent::rules(),
            'name' => ['required', 'string', 'min:1', 'max:60'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function messages(): array
    {
        return [
            'name.required' => 'Give the passkey a name of 1 to 60 characters.',
            'name.max' => 'Give the passkey a name of 1 to 60 characters.',
        ];
    }
}
