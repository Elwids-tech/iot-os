<?php

declare(strict_types=1);

namespace App\Domain\Assistant\Enums;

/** Which assistant a conversation belongs to. */
enum AssistantScope: string
{
    case Profile = 'profile';
    case Automation = 'automation';
    case Onboarding = 'onboarding';
    case Help = 'help';

    /** Request values, including `adapter`, which became `onboarding` in spec 020. */
    public static function fromRequest(?string $value): self
    {
        return $value === 'adapter' ? self::Onboarding : (self::tryFrom((string) $value) ?? self::Profile);
    }

    public static function rule(): string
    {
        return 'sometimes|in:profile,automation,help,adapter,onboarding';
    }
}
