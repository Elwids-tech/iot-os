<?php

declare(strict_types=1);

namespace App\Domain\Automation\Http\Controllers;

use App\Domain\Automation\Http\Resources\AlertNotificationResource;
use App\Domain\Automation\Http\Resources\AlertNotificationSummaryResource;
use App\Domain\Automation\Services\AlertInbox;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;

/**
 * The signed-in person's alert notifications in one organization: the bell (spec 022).
 * Without current membership and Device.view the list is empty and nothing is marked.
 */
final class AlertNotificationController
{
    public function __construct(private readonly AlertInbox $inbox) {}

    /** Your alert notifications in this organization, newest first, 20 per page. */
    public function index(Request $request, Organization $organization): AnonymousResourceCollection
    {
        $input = $request->validate(['page' => ['sometimes', 'integer', 'min:1']]);
        $page = $this->inbox->page($request->user(), $organization, (int) ($input['page'] ?? 1));
        $summary = $this->inbox->summary($request->user(), $organization);

        return AlertNotificationResource::collection($page)->additional(['meta' => ['unread' => (int) $summary['unread']]]);
    }

    /** The unread count and the newest unread activation, polled by the bell. */
    public function summary(Request $request, Organization $organization): AlertNotificationSummaryResource
    {
        return new AlertNotificationSummaryResource($this->inbox->summary($request->user(), $organization));
    }

    /**
     * Mark read the chosen notifications, every one up to the newest shown, or every one for an alert.
     *
     * Send exactly one of `ids`, `up_to` (every notification with an id up to it, so later
     * arrivals stay unread) or `alert_uuid`. Ids that are not yours in this organization
     * are ignored, and a notification already read keeps its first read time.
     */
    public function read(Request $request, Organization $organization): AlertNotificationSummaryResource
    {
        $input = $request->validate([
            'ids' => ['required_without_all:up_to,alert_uuid', 'prohibits:up_to,alert_uuid', 'array', 'min:1', 'max:100'],
            'ids.*' => ['required', 'string', 'uuid', 'distinct'],
            'up_to' => ['required_without_all:ids,alert_uuid', 'prohibits:ids,alert_uuid', 'string', 'uuid'],
            'alert_uuid' => ['required_without_all:ids,up_to', 'prohibits:ids,up_to', 'string', 'uuid'],
        ]);
        $this->inbox->markRead($request->user(), $organization, $input);

        return new AlertNotificationSummaryResource($this->inbox->summary($request->user(), $organization));
    }
}
