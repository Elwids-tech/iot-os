<?php

declare(strict_types=1);

namespace App\Domain\Audit\Services;

use BackedEnum;
use DateTimeInterface;
use Illuminate\Database\Eloquent\Model;

/**
 * What an edit changed, in the activity log's `attribute_changes` shape:
 * `['attributes' => new values, 'old' => old values]` for the fields that differ
 * (ADR-028). Secret-looking fields are never kept.
 */
final class ActivityChanges
{
    /** Fields whose values are never recorded, wherever they appear. */
    private const SECRET = '/^(.*_)?(password|secret|token|api_key|private_key|client_secret|credentials?)$/i';

    /**
     * Compares two sets of values, keeping only the listed fields when given.
     *
     * @param  array<string, mixed>  $old
     * @param  array<string, mixed>  $new
     * @param  list<string>|null  $fields
     * @return array{attributes?: array<string, mixed>, old?: array<string, mixed>}
     */
    public static function between(array $old, array $new, ?array $fields = null): array
    {
        $attributes = [];
        $previous = [];

        foreach ($fields ?? array_keys($new) as $field) {
            if (! array_key_exists($field, $new) || self::secret($field)) {
                continue;
            }

            $before = self::value($old[$field] ?? null);
            $after = self::value($new[$field]);
            if ($before !== $after) {
                $attributes[$field] = $after;
                $previous[$field] = $before;
            }
        }

        return $attributes === [] ? [] : ['attributes' => $attributes, 'old' => $previous];
    }

    /**
     * What the model's last save changed among the listed fields.
     *
     * @param  list<string>  $fields
     * @return array{attributes?: array<string, mixed>, old?: array<string, mixed>}
     */
    public static function saved(Model $model, array $fields): array
    {
        $changed = array_intersect_key($model->getChanges(), array_flip($fields));

        return self::between(array_intersect_key($model->getPrevious(), $changed), $changed);
    }

    /**
     * Drops secret-looking keys at any depth.
     *
     * @param  array<array-key, mixed>  $values
     * @return array<array-key, mixed>
     */
    public static function scrub(array $values): array
    {
        $kept = [];
        foreach ($values as $key => $value) {
            if (is_string($key) && self::secret($key)) {
                continue;
            }
            $kept[$key] = is_array($value) ? self::scrub($value) : $value;
        }

        return $kept;
    }

    private static function secret(string $field): bool
    {
        return preg_match(self::SECRET, $field) === 1;
    }

    private static function value(mixed $value): mixed
    {
        return match (true) {
            $value instanceof BackedEnum => $value->value,
            $value instanceof DateTimeInterface => $value->format(DATE_ATOM),
            default => $value,
        };
    }
}
