<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Services\OrganizationAdministrationAuthorization;
use App\Domain\Audit\Services\ActivityChanges;
use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Authentication\Http\Middleware\RequireTwoStep;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use App\Domain\Shared\Permissions\OrganizationPermission;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/**
 * An organization's sign-in security (spec 034, FR-021): whether every member must use
 * two-step sign-in. Only people who may update the organization see or change it, and
 * only someone with their own second step set up can turn it on or off.
 */
final class OrganizationSecurityController
{
    public function __construct(private readonly OrganizationAdministrationAuthorization $authorization) {}

    public function show(Request $request, Organization $organization): JsonResponse
    {
        $this->authorize($request, $organization);

        return $this->settings($request, $organization);
    }

    public function update(Request $request, Organization $organization): JsonResponse
    {
        $actor = $this->authorize($request, $organization);
        $required = (bool) $request->validate(['two_step_required' => ['required', 'boolean']])['two_step_required'];

        if (! $actor->twoStepSatisfied()) {
            return response()->json([
                'code' => RequireTwoStep::CODE,
                'message' => 'Set up two-step sign-in for your own account first.',
            ], 409);
        }

        $before = (bool) $organization->two_step_required;
        if ($before !== $required) {
            DB::transaction(function () use ($organization, $actor, $before, $required): void {
                $organization->forceFill(['two_step_required' => $required])->save();
                ActivityLog::record(
                    'organization.two_step_required_changed',
                    $organization,
                    $actor,
                    $organization,
                    ['required' => $required],
                    ActivityChanges::between(['two_step_required' => $before], ['two_step_required' => $required]),
                );
            });
        }

        return $this->settings($request, $organization->refresh());
    }

    private function settings(Request $request, Organization $organization): JsonResponse
    {
        /** @var User $actor */
        $actor = $request->user();

        return response()->json(['data' => [
            'two_step_required' => (bool) $organization->two_step_required,
            'members_without_two_step' => $organization->users()
                ->where(fn (Builder $query) => $query->whereNull('two_factor_confirmed_at')->orWhereNull('two_factor_secret'))
                ->count(),
            // Whether the viewer may change it: their own second step is set up.
            'can_change' => $actor->twoStepSatisfied(),
        ]]);
    }

    /**
     * Someone outside the organization learns nothing about it (`404`); a member without
     * the permission gets `403`.
     */
    private function authorize(Request $request, Organization $organization): User
    {
        /** @var User $actor */
        $actor = $request->user();
        $allowed = $this->authorization->allows($actor, $organization, OrganizationPermission::UPDATE->value);
        abort_unless($allowed || $actor->organizations()->whereKey($organization->getKey())->exists(), 404);
        abort_unless($allowed, 403);

        return $actor;
    }
}
