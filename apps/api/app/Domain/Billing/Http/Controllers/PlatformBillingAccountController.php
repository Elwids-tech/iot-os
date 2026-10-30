<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Controllers;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Billing\Http\Requests\StoreBillingAccountRequest;
use App\Domain\Billing\Http\Requests\UpdateBillingAccountRequest;
use App\Domain\Billing\Http\Resources\BillingAccountDetailResource;
use App\Domain\Billing\Http\Resources\BillingAccountResource;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\BillingAccountHistory;
use App\Domain\Billing\Services\BillingAccounts;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

/**
 * Platform administrators manage billing accounts (spec 023 US2).
 */
final class PlatformBillingAccountController
{
    public function __construct(
        private readonly BillingAccounts $billingAccounts,
        private readonly BillingAccountHistory $history,
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $search = trim((string) $request->query('search', ''));
        $perPage = min(max((int) $request->query('per_page', 25), 1), 100);

        $accounts = BillingAccount::query()
            ->when($search !== '', function ($query) use ($search): void {
                $query->where(function ($query) use ($search): void {
                    $query->whereLike('name', "%{$search}%")
                        ->orWhereLike('contact_email', "%{$search}%");
                });
            })
            ->withCount('organizations')
            ->with(['owners' => fn ($query) => $query->orderBy('name')])
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
        $account->load([
            'owners' => fn ($query) => $query->orderBy('name'),
            'organizations' => fn ($query) => $query
                ->withCount('users')
                ->addSelect(['devices_count' => DB::table('devices')
                    ->selectRaw('count(*)')
                    ->whereColumn('devices.organization_id', 'organizations.id')])
                ->addSelect(['assigned_at' => DB::table('billing_account_assignments')
                    ->select('started_at')
                    ->whereColumn('billing_account_assignments.organization_id', 'organizations.id')
                    ->whereNull('ended_at')
                    ->limit(1)])
                ->orderBy('name'),
        ]);

        return new BillingAccountDetailResource($account, $this->history->for($account));
    }
}
