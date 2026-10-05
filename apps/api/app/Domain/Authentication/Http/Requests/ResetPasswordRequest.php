<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Requests;

final class ResetPasswordRequest extends ForgotPasswordRequest
{
    public function rules(): array
    {
        return parent::rules() + [
            'token' => ['required', 'string', 'max:256'],
            'password' => ['required', 'string', 'min:12', 'max:256', 'confirmed'],
            'password_confirmation' => ['required', 'string', 'max:256'],
        ];
    }
}
