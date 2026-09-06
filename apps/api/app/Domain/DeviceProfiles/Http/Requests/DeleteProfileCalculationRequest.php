<?php

declare(strict_types=1);

namespace App\Domain\DeviceProfiles\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class DeleteProfileCalculationRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return ['draft_revision' => ['required', 'integer', 'min:1']];
    }
}
