<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

/**
 * The second step of sign-in (spec 034): exactly one of a six-digit code from the
 * authenticator app or an unused recovery code.
 */
final class TwoStepChallengeRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, array<int, string>>
     */
    public function rules(): array
    {
        return [
            'code' => ['nullable', 'required_without:recovery_code', 'prohibits:recovery_code', 'string', 'digits:6'],
            'recovery_code' => ['nullable', 'required_without:code', 'string', 'max:64'],
        ];
    }
}
