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
            // Support ticket emails (spec 015): on until the person switches them off.
            'ticket_email' => $row ? (bool) $row->ticket_email : true,
            'operations_access' => (bool) $user->is_super_admin,
        ];
    }

    public static function ticketEmail(User $user): bool
    {
        $prefs = self::view($user);

        return $prefs['email_enabled'] && $prefs['ticket_email'];
    }

    public static function allows(User $user, string $source, string $severity): bool
    {
        $prefs = self::view($user);

        return $prefs['email_enabled'] && ($prefs['grid'][$source][$severity] ?? false);
    }

    /** Turning push on for the first time switches on every activation level, not Cleared (spec 033, FR-019). */
    public static function pushDefaults(): array
    {
        return ['critical' => true, 'warning' => true, 'info' => true, 'recovery' => false];
    }

    /** @return array{enabled: bool, levels: array<string, bool>|null, revision: int} */
    public static function push(User $user): array
    {
        $row = DB::table('notification_preferences')->where('user_id', $user->id)->first(['push_enabled', 'push_levels', 'push_revision']);

        return [
            'enabled' => (bool) ($row->push_enabled ?? false),
            // jsonb reorders keys; answer in the levels' own order.
            'levels' => isset($row->push_levels) ? self::orderedLevels(json_decode($row->push_levels, true)) : null,
            'revision' => (int) ($row->push_revision ?? 0),
        ];
    }

    /** @return array<string, bool> */
    private static function orderedLevels(array $levels): array
    {
        return collect(self::LEVELS)->mapWithKeys(fn (string $level): array => [$level => (bool) ($levels[$level] ?? false)])->all();
    }

    /**
     * The person's preferences row, locked for this transaction. A person without one gets
     * it now, holding the defaults `view()` already reports, so nothing they see changes.
     */
    public static function row(User $user): object
    {
        $view = self::view($user);
        DB::table('notification_preferences')->insertOrIgnore([
            'user_id' => $user->id,
            'email_enabled' => $view['email_enabled'],
            'grid' => json_encode($view['grid']),
            'ticket_email' => $view['ticket_email'],
            'revision' => 0,
            'created_at' => now(),
            'updated_at' => now(),
        ]);

        return DB::table('notification_preferences')->where('user_id', $user->id)->lockForUpdate()->first();
    }

    /**
     * A device was registered. The first time, push turns on with the default levels.
     * After that the person's own choices stand: a rotated subscription or another device
     * never undoes Turn off push everywhere (FR-019, contracts/push-api.md).
     */
    public static function enablePushDefaults(User $user): void
    {
        $row = self::row($user);
        if ($row->push_levels !== null) {
            return;
        }
        DB::table('notification_preferences')->where('user_id', $user->id)->update([
            'push_enabled' => true,
            'push_levels' => $row->push_levels ?? json_encode(self::pushDefaults()),
            'push_revision' => $row->push_revision + 1,
            'updated_at' => now(),
        ]);
    }

    /** Push on, this level on, and the organization not switched off (FR-019, FR-025). */
    public static function pushAllows(User $user, int $organizationId, string $level): bool
    {
        $push = self::push($user);
        if (! $push['enabled'] || ! ($push['levels'][$level] ?? false)) {
            return false;
        }

        return ! DB::table('push_organization_mutes')->where('user_id', $user->id)->where('organization_id', $organizationId)->exists();
    }

    public static function operator(): ?User
    {
        $email = config('notifications.operator_email');

        return $email ? User::where('email', $email)->where('is_super_admin', true)->first() : null;
    }
}
