<?php

declare(strict_types=1);

namespace App\Domain\Notifications\Services;

use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;

final class Preferences
{
    public const SOURCES = ['workflow', 'service', 'watchdog'];

    public const LEVELS = ['critical', 'warning', 'info', 'recovery'];

    public static function defaults(): array
    {
        return array_fill_keys(self::SOURCES, array_fill_keys(self::LEVELS, false));
    }

    public static function view(User $user): array
    {
        $row = DB::table('notification_preferences')->where('user_id', $user->id)->first();
        $grid = self::defaults();
        // Existing workflow opt-ins continue to work until a member opts out.
        $grid['workflow'] = array_fill_keys(self::LEVELS, true);

        return [
            'revision' => $row?->revision ?? 0,
            'email_enabled' => $row ? (bool) $row->email_enabled : true,
            'grid' => $row ? json_decode($row->grid, true) : $grid,
            'operations_access' => (bool) $user->is_super_admin,
        ];
    }

    public static function allows(User $user, string $source, string $severity): bool
    {
        $prefs = self::view($user);

        return $prefs['email_enabled'] && ($prefs['grid'][$source][$severity] ?? false);
    }

    public static function operator(): ?User
    {
        $email = config('notifications.operator_email');

        return $email ? User::where('email', $email)->where('is_super_admin', true)->first() : null;
    }
}
