<?php

declare(strict_types=1);

namespace App\Domain\Notifications\Http\Controllers;

use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Notifications\Models\NotificationEvent;
use App\Domain\Notifications\Services\Preferences;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Validation\Rule;

final class NotificationCenterController
{
    public function preferences(Request $request): array
    {
        return ['data' => Preferences::view($request->user())];
    }

    public function update(Request $request): array
    {
        $rules = ['revision' => 'required|integer|min:0', 'email_enabled' => 'required|boolean', 'grid' => 'required|array:workflow,service,watchdog'];
        foreach (Preferences::SOURCES as $source) {
            $rules['grid.'.$source] = 'required|array:critical,warning,info,recovery';
            foreach (Preferences::LEVELS as $level) {
                $rules['grid.'.$source.'.'.$level] = 'required|boolean';
            }
        }
        $values = $request->validate($rules);
        $user = $request->user();
        DB::transaction(function () use ($values, $user): void {
            // Serialize initial creation and concurrent saves with a stable user lock.
            DB::table('users')->where('id', $user->id)->lockForUpdate()->first();
            $current = Preferences::view($user);
            abort_unless($current['revision'] === $values['revision'], 409, 'Preferences changed elsewhere. Refresh and try again.');
            if (! $user->is_super_admin) {
                abort_if($values['grid']['service'] !== $current['grid']['service'] || $values['grid']['watchdog'] !== $current['grid']['watchdog'], 403);
            }
            DB::table('notification_preferences')->updateOrInsert(['user_id' => $user->id], [
                'email_enabled' => $values['email_enabled'], 'grid' => json_encode($values['grid']),
                'revision' => $current['revision'] + 1, 'created_at' => now(), 'updated_at' => now(),
            ]);
        });

        return ['data' => Preferences::view($user)];
    }

    public function events(Request $request, DeviceAuthorization $authorization): array
    {
        $input = $request->validate([
            'source' => ['sometimes', Rule::in(Preferences::SOURCES)],
            'severity' => ['sometimes', Rule::in(['critical', 'warning', 'info'])],
            // "cleared" is every event that no longer needs attention; "resolved" only the clear notices.
            'status' => ['sometimes', Rule::in(['active', 'cleared', 'resolved'])],
            'organization' => 'sometimes|uuid',
            'search' => 'sometimes|string|max:100', 'page' => 'sometimes|integer|min:1',
        ]);
        $user = $request->user();
        $query = NotificationEvent::query();
        if (! $user->is_super_admin) {
            $orgs = $user->organizations()->get()->filter(fn ($org) => $authorization->capabilities($user, $org)['view'])->pluck('id');
            $query->whereIn('organization_id', $orgs);
        }
        if (isset($input['organization'])) {
            // One organization's workflow events plus the platform events the user may already see.
            $query->where(fn ($q) => $q->whereNull('organization_id')->orWhereIn('organization_id', Organization::where('uuid', $input['organization'])->select('id')));
        }
        if (isset($input['source'])) {
            $query->where('source', $input['source']);
        }
        if (isset($input['severity'])) {
            $query->where('severity', $input['severity']);
        }
        if (($input['search'] ?? '') !== '') {
            $query->where(function ($q) use ($input): void {
                $search = '%'.$input['search'].'%';
                $q->where('title', 'like', $search)->orWhere('summary', 'like', $search)->orWhere('service', 'like', $search);
            });
        }
        $summary = [
            'critical' => (clone $query)->where('active', true)->where('severity', 'critical')->count(),
            'warning' => (clone $query)->where('active', true)->where('severity', 'warning')->count(),
            'info' => (clone $query)->where('active', true)->where('severity', 'info')->count(),
            'resolved' => (clone $query)->where('status', 'resolved')->count(),
            'sources' => array_merge(array_fill_keys(Preferences::SOURCES, 0), (clone $query)->where('active', true)->groupBy('source')->selectRaw('source, count(*) as total')->pluck('total', 'source')->map(fn ($total) => (int) $total)->all()),
        ];
        if (isset($input['status'])) {
            match ($input['status']) {
                'active' => $query->where('active', true),
                'cleared' => $query->where('active', false),
                'resolved' => $query->where('status', 'resolved'),
            };
        }
        $page = $query->orderByDesc('occurred_at')->orderByDesc('id')->paginate(25);

        return ['data' => $page->items(), 'summary' => $summary, 'meta' => [
            'current_page' => $page->currentPage(), 'last_page' => $page->lastPage(), 'total' => $page->total(),
        ]];
    }
}
