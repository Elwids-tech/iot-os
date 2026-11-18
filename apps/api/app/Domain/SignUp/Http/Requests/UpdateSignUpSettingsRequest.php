<?php

declare(strict_types=1);

namespace App\Domain\SignUp\Http\Requests;

use App\Domain\Shared\Models\User;
use Illuminate\Foundation\Http\FormRequest;

/** Super administrators only (spec 035 FR-026). */
final class UpdateSignUpSettingsRequest extends FormRequest
{
    public function authorize(): bool
    {
        $user = $this->user();

        return $user instanceof User && $user->is_super_admin;
    }

    /**
     * @return array<string, list<string>>
     */
    public function rules(): array
    {
        return [
            'open' => ['required', 'boolean'],
            'free_beta' => ['required', 'boolean'],
            'notify_push' => ['required', 'boolean'],
            'notify_email' => ['required', 'boolean'],
            'daily_limit' => ['required', 'integer', 'min:1', 'max:10000'],
            'revision' => ['required', 'integer', 'min:0'],
        ];
    }
}
