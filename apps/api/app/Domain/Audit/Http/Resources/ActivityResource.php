<?php

declare(strict_types=1);

namespace App\Domain\Audit\Http\Resources;

use App\Domain\Audit\Services\ActivityEntry;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * One event of the activity feed (spec 024). `summary` reads between the actor's name
 * and the subject's; `actor.name` and `actor.email` are null when the user was deleted.
 *
 * @extends JsonResource<ActivityEntry>
 */
final class ActivityResource extends JsonResource
{
    public function __construct(ActivityEntry $resource)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        /** @var ActivityEntry $entry */
        $entry = $this->resource;

        return [
            'id' => $entry->id,
            'action' => $entry->action,
            'summary' => $entry->summary,
            'at' => $entry->at->toIso8601String(),
            'actor' => [
                'id' => $entry->actorId,
                'name' => $entry->actorName,
                'email' => $entry->actorEmail,
            ],
            'organization' => $entry->organizationUuid === null ? null : [
                'uuid' => $entry->organizationUuid,
                'name' => (string) $entry->organizationName,
            ],
            'subject' => $entry->subjectType === null && $entry->subjectUuid === null && $entry->subjectName === null ? null : [
                'type' => $entry->subjectType,
                'uuid' => $entry->subjectUuid,
                'name' => $entry->subjectName,
            ],
            'changes' => ActivityChangeResource::collection($entry->changes),
            // What the action recorded besides its changes, as text; keys vary by action.
            'details' => collect($entry->details)->map(fn (string $value, string $key): array => ['key' => $key, 'value' => $value])->values()->all(),
        ];
    }
}
