<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Controllers;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Billing\Http\Requests\StoreBillingAccountRequest;
use App\Domain\Billing\Http\Requests\UpdateBillingAccountRequest;
use App\Domain\Billing\Http\Resources\BillingAccountDetailResource;
use App\Domain\Billing\Http\Resources\BillingAccountResource;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\BillingAccounts;
use App\Domain\Billing\Services\Usage;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;

/**
 * Platform administrators manage billing accounts (spec 023 US2).
 */
final class PlatformBillingAccountController
{
    public function __construct(private readonly BillingAccounts $billingAccounts, private readonly Usage $usage) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);
        $request->validate([
            // Accounts that have used at least this percentage of a limited allowance this month.
            'usage_at_least' => ['nullable', 'integer', 'between:1,100'],
        ]);

        $search = trim((string) $request->query('search', ''));
        $usageAtLeast = $request->filled('usage_at_least') ? $request->integer('usage_at_least') : null;
        $plan = trim((string) $request->query('plan', ''));
        $perPage = min(max((int) $request->query('per_page', 25), 1), 100);

        $accounts = BillingAccount::query()
            ->when($search !== '', function ($query) use ($search): void {
                $query->where(function ($query) use ($search): void {
                    $query->whereLike('name', "%{$search}%")
                        ->orWhereLike('contact_email', "%{$search}%");
                });
            })
            // `plan` is a plan's uuid, or `none` for accounts on no plan (spec 028 US2).
            ->when($plan === 'none', fn ($query) => $query->whereDoesntHave('openPlanAssignment'))
            ->when($plan !== '' && $plan !== 'none', fn ($query) => $query->whereHas(
                'openPlanAssignment.plan',
                fn ($query) => $query->where('uuid', $plan),
            ))
            // Spec 028 FR-020, spec 029 FR-026; `usage_at_least=80` is the list's filter.
            ->when($usageAtLeast !== null, fn ($query) => $this->usage->whereUsageAtLeast($query, (int) $usageAtLeast, CarbonImmutable::now()))
            ->withCount('organizations')
            ->with(['owners' => fn ($query) => $query->orderBy('name'), 'openPlanAssignment.plan.allowances', 'allowanceOverrides'])
            ->orderBy('name')
            ->orderBy('id')
            ->paginate($perPage)
            ->withQueryString();

        return BillingAccountResource::collection($accounts);
    }

    public function store(StoreBillingAccountRequest $request): JsonResponse
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $account = $this->billingAccounts->create($request->validated(), $request->user());

        return $this->detail($account)->response()->setStatusCode(201);
    }

    public function show(BillingAccount $billingAccount): BillingAccountDetailResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        return $this->detail($billingAccount);
    }

    public function update(UpdateBillingAccountRequest $request, BillingAccount $billingAccount): BillingAccountDetailResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $account = $this->billingAccounts->update($billingAccount, $request->validated(), $request->user());

        return $this->detail($account);
    }

    public function destroy(Request $request, BillingAccount $billingAccount): Response
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $this->billingAccounts->delete($billingAccount, $request->user());

        return response()->noContent();
    }

    private function detail(BillingAccount $account): BillingAccountDetailResource
    {
        return BillingAccountDetailResource::for($account);
    }
}
