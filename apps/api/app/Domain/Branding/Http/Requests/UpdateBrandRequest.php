<?php

declare(strict_types=1);

namespace App\Domain\Branding\Http\Requests;

use Closure;
use Illuminate\Foundation\Http\FormRequest;

/**
 * A brand's name, short name and support link (spec 036 FR-001). The three are saved
 * together: one left out or empty is cleared.
 */
final class UpdateBrandRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    /**
     * @return array<string, list<string|Closure>>
     */
    public function rules(): array
    {
        return [
            'product_name' => ['present', 'nullable', 'string', 'max:40'],
            'short_name' => ['present', 'nullable', 'string', 'max:12'],
            /** An `https:` address or a `mailto:` link. */
            'support_url' => ['present', 'nullable', 'string', 'max:2048', self::supportLink(...)],
            /** The revision the editor read; 0 before anything was saved. */
            'revision' => ['required', 'integer', 'min:0'],
        ];
    }

    /**
     * @return array<string, string>
     */
    public function attributes(): array
    {
        return ['support_url' => 'support link'];
    }

    private static function supportLink(string $attribute, mixed $value, Closure $fail): void
    {
        $link = (string) $value;
        $valid = str_starts_with($link, 'mailto:')
            ? filter_var(substr($link, 7), FILTER_VALIDATE_EMAIL) !== false
            : str_starts_with($link, 'https://') && filter_var($link, FILTER_VALIDATE_URL) !== false;

        if (! $valid) {
            $fail('Enter an https:// address or a mailto: link.');
        }
    }
}
