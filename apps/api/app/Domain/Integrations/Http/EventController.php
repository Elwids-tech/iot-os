<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Http;

use App\Domain\Devices\Models\Device;
use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Shared\Models\Organization;
use Illuminate\Contracts\Encryption\DecryptException;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\Crypt;
use Illuminate\Support\Facades\DB;

final class EventController
{
    public function checkpoint(Request $request, Organization $organization): array
    {
        $app = $request->attributes->get('integration_application');

        return ['cursor' => $this->cursor($app, $this->head($organization))];
    }

    public function index(Request $request, Organization $organization): array
    {
        $input = $request->validate(['cursor' => 'sometimes|nullable|string|max:4096', 'limit' => 'sometimes|integer|min:1|max:100']);
        $app = $request->attributes->get('integration_application');
        $head = $this->head($organization);
        $after = isset($input['cursor']) ? $this->position($app, $input['cursor']) : 0;
        abort_if($after > $head, 409, 'Event history changed. Rebuild the projection from a fresh checkpoint.');
        $limit = (int) ($input['limit'] ?? 100);
        $devices = Device::where('organization_id', $organization->id)->whereIn('uuid', $app->device_uuids)->pluck('uuid');
        $rows = DB::table('integration_events')->where('organization_id', $organization->id)->whereIn('device_uuid', $devices)->where('sequence', '>', $after)->where('sequence', '<=', $head)->orderBy('sequence')->limit($limit + 1)->get();
        $more = $rows->count() > $limit;
        $rows = $rows->take($limit);
        // Advance over unauthorized events too; a grant change invalidates this cursor.
        $next = $more ? (int) $rows->last()->sequence : $head;

        return ['data' => $rows->map(fn ($event) => ['id' => $event->uuid, 'schema_version' => 'integration-event.v1', 'type' => $event->type, 'occurred_at' => Carbon::parse($event->occurred_at)->toIso8601String(), 'recorded_at' => Carbon::parse($event->recorded_at)->toIso8601String(), 'data' => json_decode($event->snapshot, true, 512, JSON_THROW_ON_ERROR)])->values(), 'next_cursor' => $this->cursor($app, $next), 'has_more' => $more];
    }

    private function head(Organization $organization): int
    {
        return (int) (DB::table('integration_streams')->where('organization_id', $organization->id)->value('sequence') ?? 0);
    }

    private function cursor(IntegrationApplication $app, int $after): string
    {
        return Crypt::encryptString(json_encode(['version' => 1, 'application' => $app->uuid, 'organization' => $app->organization_id, 'grant_revision' => $app->grant_revision, 'after' => $after], JSON_THROW_ON_ERROR));
    }

    private function position(IntegrationApplication $app, string $cursor): int
    {
        try {
            $value = json_decode(Crypt::decryptString($cursor), true, 512, JSON_THROW_ON_ERROR);
        } catch (DecryptException|\JsonException) {
            abort(422, 'Invalid event cursor.');
        }
        abort_unless(is_array($value) && ($value['version'] ?? null) === 1 && is_int($value['after'] ?? null) && $value['after'] >= 0, 422, 'Invalid event cursor.');
        abort_unless(($value['application'] ?? null) === $app->uuid && ($value['organization'] ?? null) === $app->organization_id, 422, 'Cursor belongs to a different application.');
        abort_unless(($value['grant_revision'] ?? null) === $app->grant_revision, 409, 'Application grants changed. Rebuild the projection from a fresh checkpoint.');

        return $value['after'];
    }
}
