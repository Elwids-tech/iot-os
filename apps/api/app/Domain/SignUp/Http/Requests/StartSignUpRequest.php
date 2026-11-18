<?php

declare(strict_types=1);

namespace App\Domain\SignUp\Http\Requests;

use App\Domain\SignUp\Services\SignUpSettings;
use Closure;
use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Validation\Rules\Password;

final class StartSignUpRequest extends FormRequest
{
    /** Names reach staff notifications and the admin app, so they carry no links or markup (FR-043). */
    public static function plainText(): Closure
    {
        return static function (string $attribute, mixed $value, Closure $fail): void {
            if (is_string($value) && preg_match('~[<>]|://|www\.~i', $value) === 1) {
                $fail('Use letters, numbers and punctuation only, without links.');
            }
        };
    }

    /** A closed sign-up refuses before anything is checked (FR-025). */
    public function authorize(): bool
    {
        return app(SignUpSettings::class)->open();
    }

    protected function failedAuthorization(): void
    {
        throw new HttpResponseException(response()->json([
            'code' => 'sign_up_closed',
            'message' => 'Sign-up is closed.',
        ], 403));
    }

    /**
     * @return array<string, list<mixed>>
     */
    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'min:1', 'max:120', self::plainText()],
            'email' => ['required', 'string', 'email', 'max:255'],
            'password' => ['required', 'string', Password::defaults(), 'confirmed'],
            'organization_name' => ['required', 'string', 'min:2', 'max:80', self::plainText()],
            'form_token' => ['nullable', 'string', 'max:1000'],
            // The hidden field people never see; anything in it marks a bot (FR-041).
            'website' => ['nullable', 'string', 'max:1000'],
        ];
    }

    protected function prepareForValidation(): void
    {
        foreach (['name', 'email', 'organization_name'] as $field) {
            if (is_string($this->input($field))) {
                $this->merge([$field => trim((string) $this->input($field))]);
            }
        }
    }
}
