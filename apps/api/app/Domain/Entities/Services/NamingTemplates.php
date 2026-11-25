<?php

declare(strict_types=1);

namespace App\Domain\Entities\Services;

/**
 * A type's naming rule is a template, never a tenant's regular expression (spec 009,
 * research R10): literal path-name characters plus `<number>` (digits), `<letter>`
 * (one ASCII letter), `<letters>` (one or more) and `<text>` (any path-name
 * characters), compiled to an anchored, case-sensitive pattern.
 */
final class NamingTemplates
{
    private const PLACEHOLDERS = [
        '<number>' => '[0-9]+',
        '<letter>' => '[A-Za-z]',
        '<letters>' => '[A-Za-z]+',
        '<text>' => '[A-Za-z0-9._-]+',
    ];

    public const HELP = 'Use letters, digits, dots, dashes and underscores, with <number>, <letter>, <letters> or <text> for the parts that vary.';

    /** The compiled pattern, or null when the template is not valid. */
    public static function compile(string $template): ?string
    {
        if ($template === '' || strlen($template) > 120) {
            return null;
        }
        $parts = preg_split('/(<[a-z]+>)/', $template, -1, PREG_SPLIT_DELIM_CAPTURE | PREG_SPLIT_NO_EMPTY) ?: [];
        $pattern = '';
        foreach ($parts as $part) {
            if (str_starts_with($part, '<')) {
                if (! isset(self::PLACEHOLDERS[$part])) {
                    return null;
                }
                $pattern .= self::PLACEHOLDERS[$part];

                continue;
            }
            if (preg_match('/^[A-Za-z0-9._-]+$/', $part) !== 1) {
                return null;
            }
            $pattern .= preg_quote($part, '/');
        }

        return '/^'.$pattern.'$/';
    }

    public static function matches(string $template, string $pathName): bool
    {
        $pattern = self::compile($template);

        return $pattern !== null && preg_match($pattern, $pathName) === 1;
    }
}
