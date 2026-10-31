<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Administration\Http\Requests\StoreOrganizationRequest;
use App\Domain\Administration\Http\Requests\UpdateOrganizationRequest;
use App\Domain\Administration\Services\OrganizationDefaultRoles;
use App\Domain\Audit\Services\ActivityChanges;
use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\BillingAccounts;
use App\Domain\Shared\Http\Resources\OrganizationResource;
use App\Domain\Shared\Models\Organization;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Gate;

final class PlatformOrganizationController
{
    public function __construct(
        private readonly OrganizationDefaultRoles $defaultRoles,
        private readonly BillingAccounts $billingAccounts,
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $search = trim((string) $request->query('search', ''));
        $perPage = min(max((int) $request->query('per_page', 25), 1), 100);

        $organizations = Organization::query()
            ->when($search !== '', function ($query) use ($search): void {
                $query->where(function ($query) use ($search): void {
                    $query->where('name', 'like', "%{$search}%")
                        ->orWhere('slug', 'like', "%{$search}%");
                });
            })
            ->with('billingAccount:id,uuid,name')
            ->withCount('users')
            // Devices block deletion (spec 006), so the directory shows how many each has.
            ->addSelect(['devices_count' => DB::table('devices')
                ->selectRaw('count(*)')
                ->whereColumn('devices.organization_id', 'organizations.id')])
            ->orderBy('name')
            ->paginate($perPage)
            ->withQueryString();

        return OrganizationResource::collection($organizations);
    }

    public function store(StoreOrganizationRequest $request): JsonResponse
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        // The organization and a new billing account are created together or not at all (spec 023).
        $organization = DB::transaction(function () use ($request): Organization {
            $values = $request->validated();
            $account = isset($values['billing_account_uuid'])
                ? BillingAccount::query()->where('uuid', $values['billing_account_uuid'])->firstOrFail()
                : $this->billingAccounts->create([
                    'name' => $values['new_billing_account']['name'] ?? $values['name'],
                    'contact_email' => $values['new_billing_account']['contact_email'] ?? null,
                ], $request->user());

            $organization = new Organization($request->safe()->only(['name', 'slug']));
            $organization->billing_account_id = $account->getKey();
            $organization->save();
            $this->defaultRoles->ensure($organization);
            ActivityLog::record('organization.created', $organization, $request->user(), $organization, [
                'slug' => $organization->slug,
                'billing_account' => ['uuid' => $account->uuid, 'name' => $account->name],
            ]);

            return $organization->load('billingAccount:id,uuid,name');
        });

        return OrganizationResource::make($organization)
            ->response()
            ->setStatusCode(201);
    }

    public function update(UpdateOrganizationRequest $request, Organization $organization): JsonResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        DB::transaction(function () use ($request, $organization): void {
            $organization->update($request->validated());
            $changes = ActivityChanges::saved($organization, array_keys($request->validated()));
            if ($changes !== []) {
                ActivityLog::record('organization.updated', $organization, $request->user(), $organization, [], $changes);
            }
        });

        return OrganizationResource::make($organization->fresh());
    }
}
