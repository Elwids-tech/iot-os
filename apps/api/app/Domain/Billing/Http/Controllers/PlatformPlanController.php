<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Controllers;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Billing\Http\Requests\StorePlanRequest;
use App\Domain\Billing\Http\Requests\UpdatePlanRequest;
use App\Domain\Billing\Http\Resources\PlanDetailResource;
use App\Domain\Billing\Http\Resources\PlanResource;
use App\Domain\Billing\Models\BillingPlan;
use App\Domain\Billing\Models\PlanAssignment;
use App\Domain\Billing\Services\PlanHistory;
use App\Domain\Billing\Services\Plans;
use Illuminate\Database\Eloquent\Builder;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * Platform administrators define plans (spec 028 US1).
 */
final class PlatformPlanController
{
    public function __construct(
        private readonly Plans $plans,
        private readonly PlanHistory $history,
    ) {}

    /**
     * `archived=0` leaves archived plans out, `archived=1` lists only them; without it,
     * every plan is listed.
     */
    public function index(Request $request): AnonymousResourceCollection
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $search = trim((string) $request->query('search', ''));
        $archived = $request->query('archived');
        $perPage = min(max((int) $request->query('per_page', 25), 1), 100);

        $plans = $this->withCounts(BillingPlan::query())
            ->when($search !== '', fn (Builder $query) => $query->whereLike('name', "%{$search}%"))
            ->when($archived === '0', fn (Builder $query) => $query->whereNull('archived_at'))
            ->when($archived === '1', fn (Builder $query) => $query->whereNotNull('archived_at'))
            ->with('allowances')
            ->orderBy('name')
            ->orderBy('id')
            ->paginate($perPage)
            ->withQueryString();

        return PlanResource::collection($plans);
    }

    public function store(StorePlanRequest $request): JsonResponse
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $plan = $this->plans->create($request->validated(), $request->user());

        return $this->detail($plan)->response()->setStatusCode(201);
    }

    public function show(BillingPlan $billingPlan): PlanDetailResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        return $this->detail($billingPlan);
    }

    public function update(UpdatePlanRequest $request, BillingPlan $billingPlan): PlanDetailResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $values = $request->safe()->except(['confirm_affected', 'confirm_retention']);
        $confirm = $request->validated('confirm_affected');
        $plan = $this->plans->update($billingPlan, $values, $request->user(), $confirm === null ? null : (int) $confirm, $request->boolean('confirm_retention'));

        return $this->detail($plan);
    }

    public function archive(Request $request, BillingPlan $billingPlan): PlanDetailResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        return $this->detail($this->plans->archive($billingPlan, $request->user()));
    }

    public function restore(Request $request, BillingPlan $billingPlan): PlanDetailResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        return $this->detail($this->plans->restore($billingPlan, $request->user()));
    }

    public function destroy(Request $request, BillingPlan $billingPlan): Response
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $this->plans->delete($billingPlan, $request->user());

        return response()->noContent();
    }

    /**
     * @param  Builder<BillingPlan>  $query
     * @return Builder<BillingPlan>
     */
    private function withCounts(Builder $query): Builder
    {
        return $query
            ->withCount(['assignments as accounts_count' => fn (Builder $query) => $query->whereNull('ended_at')])
            ->withExists('assignments as ever_assigned');
    }

    private function detail(BillingPlan $plan): PlanDetailResource
    {
        $plan = $this->withCounts(BillingPlan::query())->with('allowances')->whereKey($plan->getKey())->firstOrFail();
        $assignments = PlanAssignment::query()
            ->where('billing_plan_id', $plan->getKey())
            ->whereNull('ended_at')
            ->with('billingAccount')
            ->orderBy('started_at')
            ->limit(100)
            ->get();

        return new PlanDetailResource($plan, $assignments, $this->history->for($plan));
    }
}
