<?php

declare(strict_types=1);

namespace App\Domain\SignUp\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * Whether sign-up is open, the free beta, the daily ceiling and how super administrators
 * are told (spec 035 FR-024, FR-025, FR-031, FR-042, research R6). One row, edited with
 * its revision so two administrators cannot overwrite each other (409).
 */
final class SignUpSettings
{
    public const FIELDS = ['open', 'free_beta', 'notify_push', 'notify_email', 'daily_limit'];

    /**
     * @return array{open: bool, free_beta: bool, notify_push: bool, notify_email: bool, daily_limit: int, revision: int, updated_at: ?string, updated_by: ?int}
     */
    public function get(): array
    {
        $row = DB::table('sign_up_settings')->where('id', 1)->first();

        return [
            'open' => (bool) ($row->open ?? false),
            'free_beta' => (bool) ($row->free_beta ?? true),
            'notify_push' => (bool) ($row->notify_push ?? true),
            'notify_email' => (bool) ($row->notify_email ?? false),
            'daily_limit' => (int) ($row->daily_limit ?? 50),
            'revision' => (int) ($row->revision ?? 0),
            'updated_at' => $row?->updated_at === null ? null : (string) $row->updated_at,
            'updated_by' => $row?->updated_by === null ? null : (int) $row->updated_by,
        ];
    }

    public function open(): bool
    {
        return $this->get()['open'];
    }

    /**
     * @param  array<string, bool|int>  $values  any of FIELDS
     */
    public function update(array $values, int $revision, User $actor): array
    {
        DB::transaction(function () use ($values, $revision, $actor): void {
            $row = DB::table('sign_up_settings')->where('id', 1)->lockForUpdate()->first();
            abort_unless($row !== null && (int) $row->revision === $revision, 409, 'Sign-up settings changed. Refresh before saving.');

            $values = array_intersect_key($values, array_flip(self::FIELDS));
            $changes = [];
            foreach ($values as $field => $value) {
                $from = $field === 'daily_limit' ? (int) $row->{$field} : (bool) $row->{$field};
                if ($from !== $value) {
                    $changes[$field] = ['from' => $from, 'to' => $value];
                }
            }

            DB::table('sign_up_settings')->where('id', 1)->update([
                ...$values,
                'revision' => $revision + 1,
                'updated_by' => $actor->getKey(),
                'updated_at' => now(),
            ]);
            ActivityLog::record('sign_up_settings.updated', null, $actor, null, ['changes' => $changes]);
        });

        return $this->get();
    }
}
