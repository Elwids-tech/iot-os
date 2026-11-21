<?php

declare(strict_types=1);

namespace App\Domain\Branding\Exceptions;

use Illuminate\Http\Exceptions\HttpResponseException;

/**
 * A refusal with a code clients can act on (spec 036, contracts/branding-api.md). A 422
 * also carries `errors` for the field, like any validation failure.
 */
final class BrandingRefusal extends HttpResponseException
{
    public function __construct(int $status, public readonly string $refusal, string $message, ?string $field = null)
    {
        parent::__construct(response()->json([
            'message' => $message,
            'code' => $refusal,
            ...($field === null ? [] : ['errors' => [$field => [$message]]]),
        ], $status));
    }

    public static function image(string $code, string $message): self
    {
        return new self(422, $code, $message, 'image');
    }
}
