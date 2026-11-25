<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services;

use Illuminate\Support\Str;

/**
 * Path names: an entity's short name for paths (spec 009, FR-002, research R11).
 * 1–64 ASCII letters, digits, `-`, `_` and `.`; compared ignoring case.
 */
final class PathNames
{
    public const PATTERN = '/^[A-Za-z0-9._-]{1,64}$/';

    public const RULE = 'Path names are 1 to 64 letters, digits, dots, dashes or underscores, without spaces.';

    public static function valid(string $pathName): bool
    {
        return preg_match(self::PATTERN, $pathName) === 1;
    }

    /**
     * A path name from a display name: ASCII-folded, split on anything that is not a
     * letter or digit, each word capitalized and joined (`Filler pump P-201` →
     * `FillerPumpP201`). Empty when nothing usable is left.
     */
    public static function suggest(string $name): string
    {
        $words = preg_split('/[^A-Za-z0-9]+/', Str::ascii($name), -1, PREG_SPLIT_NO_EMPTY) ?: [];

        return substr(implode('', array_map(static fn (string $word): string => ucfirst($word), $words)), 0, 64);
    }
}
