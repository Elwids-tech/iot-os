<?php

declare(strict_types=1);

namespace App\Domain\Audit\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;

final class ListActivityRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, mixed>
     */
    public function rules(): array
    {
        return [
            // The person who acted (integer user id, ADR-013).
            // `bail` keeps a malformed value away from the query: PostgreSQL rejects it with a 500.
            'user_id' => ['sometimes', 'bail', 'integer', 'exists:users,id'],
            // The organization whose data changed.
            'organization' => ['sometimes', 'bail', 'uuid', 'exists:organizations,uuid'],
            // `meta.next_cursor` of the previous page.
            'cursor' => ['sometimes', 'string', 'max:512'],
        ];
    }
}
