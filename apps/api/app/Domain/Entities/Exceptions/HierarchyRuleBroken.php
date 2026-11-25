<?php

declare(strict_types=1);

namespace App\Domain\Entities\Exceptions;

use Illuminate\Validation\ValidationException;

/**
 * A hierarchy rule refused a change (spec 009, FR-004). It is an ordinary validation
 * error to the portal (a 422 naming the field) and carries a rule code for other
 * features that check batches (contracts/hierarchy-operations.md).
 */
final class HierarchyRuleBroken extends ValidationException
{
    public string $rule = 'invalid';

    public string $field = '';

    public static function rule(string $rule, string $field, string $message): self
    {
        $exception = self::withMessages([$field => $message]);
        $exception->rule = $rule;
        $exception->field = $field;

        return $exception;
    }

    public function message(): string
    {
        return (string) collect($this->errors())->flatten()->first();
    }
}
