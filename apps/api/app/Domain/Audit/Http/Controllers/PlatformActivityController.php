<?php

declare(strict_types=1);

namespace App\Domain\Audit\Http\Controllers;

use App\Domain\Audit\Http\Requests\ListActivityRequest;
use App\Domain\Audit\Http\Resources\ActivityResource;
use App\Domain\Audit\Services\ActivityFeed;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * What people did across the platform, newest first, for platform administrators who
 * manage organizations (spec 024 US1, US2). Filter by person, organization or both;
 * page with `meta.next_cursor`.
 */
final class PlatformActivityController
{
    public function __construct(private readonly ActivityFeed $feed) {}

    public function index(ListActivityRequest $request): AnonymousResourceCollection
    {
        $organization = $request->filled('organization')
            ? Organization::withTrashed()->where('uuid', $request->validated('organization'))->firstOrFail()
            : null;

        return ActivityResource::collection($this->feed->page(
            $request->filled('user_id') ? (int) $request->validated('user_id') : null,
            $organization,
        ));
    }
}
