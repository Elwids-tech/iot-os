<?php

declare(strict_types=1);

namespace App\Domain\Automation\Services;

use App\Domain\Automation\Models\Alert;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Contracts\Pagination\LengthAwarePaginator;
use Illuminate\Database\Eloquent\Relations\MorphMany;
use Illuminate\Notifications\DatabaseNotification;

/**
 * A person's alert notifications in one organization, for the bell (spec 022). Only
 * the signed-in person's own rows are ever read or changed. Someone who is not a
 * current member with Device.view there (a super administrator browsing, a member who
 * lost view) sees nothing and marks nothing.
 */
final class AlertInbox
{
    public const PER_PAGE = 20;

    public function __construct(private readonly DeviceAuthorization $authorization) {}

    public function allowed(User $user, Organization $organization): bool
    {
        return $user->organizations()->whereKey($organization->id)->exists() && $this->authorization->capabilities($user, $organization)['view'];
    }

    /** Newest first, with each alert's condition now. */
    public function page(User $user, Organization $organization, int $page): LengthAwarePaginator
    {
        $query = $this->query($user, $organization)->orderByDesc('id');
        if (! $this->allowed($user, $organization)) {
            $query->whereRaw('1 = 0');
        }
        $notifications = $query->paginate(self::PER_PAGE, ['*'], 'page', $page);
        $conditions = Alert::where('organization_id', $organization->id)
            ->whereIn('uuid', $notifications->getCollection()->map(fn (DatabaseNotification $n) => $n->data['alert_uuid'])->unique()->values())
            ->get(['uuid', 'cleared_at'])->mapWithKeys(fn (Alert $alert) => [$alert->uuid => $alert->cleared_at ? 'cleared' : 'active']);
        // Alerts go only with their organization, which takes its notifications along.
        $notifications->getCollection()->each(fn (DatabaseNotification $n) => $n->setAttribute('condition', $conditions[$n->data['alert_uuid']] ?? 'cleared'));

        return $notifications;
    }

    /**
     * @return array{unread: int, newest_unread_activation_id: ?string}
     */
    public function summary(User $user, Organization $organization): array
    {
        if (! $this->allowed($user, $organization)) {
            return ['unread' => 0, 'newest_unread_activation_id' => null];
        }
        $newest = $this->query($user, $organization)->whereNull('read_at')->where('data->transition', 'activated')->orderByDesc('id')->value('id');

        return [
            'unread' => $this->query($user, $organization)->whereNull('read_at')->count(),
            'newest_unread_activation_id' => $newest === null ? null : (string) $newest,
        ];
    }

    /**
     * Marks unread notifications read; one already read keeps its first read time.
     *
     * @param  array{ids?: list<string>, up_to?: string, alert_uuid?: string}  $input
     */
    public function markRead(User $user, Organization $organization, array $input): void
    {
        if (! $this->allowed($user, $organization)) {
            return;
        }
        $query = $this->query($user, $organization)->whereNull('read_at');
        match (true) {
            isset($input['ids']) => $query->whereIn('id', $input['ids']),
            // Mark all read: up to the newest one shown, so later arrivals stay unread.
            isset($input['up_to']) => $query->where('id', '<=', $input['up_to']),
            default => $query->where('data->alert_uuid', $input['alert_uuid']),
        };
        $query->update(['read_at' => now()]);
    }

    private function query(User $user, Organization $organization): MorphMany
    {
        return $user->notifications()->reorder()->where('type', 'alert')->where('data->organization_uuid', $organization->uuid);
    }
}
