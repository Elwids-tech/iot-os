<?php

declare(strict_types=1);

namespace App\Domain\Devices\Http\Controllers;

use App\Domain\Devices\Models\DeviceMove;
use App\Domain\Devices\Permissions\DevicePermission;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Devices\Services\Moves\MovePreview;
use App\Domain\Devices\Services\Moves\MoveRequests;
use App\Domain\Devices\Services\Moves\MoveTargets;
use App\Domain\Devices\Services\Moves\MoveView;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * Moving devices to another organization of the same billing account (spec 031,
 * contract § Targets, Review, Confirm, Move). Every route needs `Device.move` in the
 * route's organization, the source; the review and the confirmation also need it in
 * the target.
 */
final class DeviceMoveController
{
    public function __construct(private readonly DeviceAuthorization $authorization) {}

    /** Organizations of the billing account the person may move devices into. */
    public function targets(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MOVE, $organization);

        return app(MoveTargets::class)->for($organization, $request->user());
    }

    /** What a move would do. It changes nothing. */
    public function preview(Request $request, Organization $organization): array
    {
        $this->authorization->authorize($request->user(), DevicePermission::MOVE, $organization);
        $input = $request->validate(MovePreview::rules(), MovePreview::messages());
        $preview = app(MovePreview::class);
        $target = $preview->target($organization, $request->user(), $input['target_organization_uuid']);

        return $preview->review($organization, $target, $request->user(), $input);
    }

    /** Confirms a move: 202 with the move, or 200 with the same move for a repeated request. */
    public function store(Request $request, Organization $organization): JsonResponse
    {
        $this->authorization->authorize($request->user(), DevicePermission::MOVE, $organization);
        $input = $request->validate(MoveRequests::rules(), MovePreview::messages());
        [$move, $created] = app(MoveRequests::class)->confirm($organization, $request->user(), $input);

        return response()->json(['data' => MoveView::for($move, $request->user())], $created ? 202 : 200);
    }

    /** A move of this organization, for its mover or a member holding `Device.move`. */
    public function show(Request $request, Organization $organization, DeviceMove $move): array
    {
        abort_unless(in_array($organization->id, [$move->source_organization_id, $move->target_organization_id], true), 404);
        if ($move->mover_id !== $request->user()->id) {
            $this->authorization->authorize($request->user(), DevicePermission::MOVE, $organization);
        }

        return ['data' => MoveView::for($move, $request->user())];
    }
}
