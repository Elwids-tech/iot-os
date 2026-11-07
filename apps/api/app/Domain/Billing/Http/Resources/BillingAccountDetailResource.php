<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Billing\Services\BillingAccountHistory;
use App\Domain\Billing\Services\BillingAccountHistoryEntry;
use App\Domain\Billing\Services\ResolvedAllowance;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;
use Illuminate\Support\Facades\DB;

/**
 * A billing account's page: details, organizations, owners and the latest 100 history
 * entries, newest first (spec 023 US2), with its plan and allowances (spec 028 US2).
 * `organization_limit` is the `organizations` allowance, null when unlimited.
 *
 * @extends JsonResource<BillingAccount>
 */
final class BillingAccountDetailResource extends JsonResource
{
    /**
     * @param  list<BillingAccountHistoryEntry>  $history
     * @param  array<string, ResolvedAllowance>  $allowances
     */
    public function __construct(BillingAccount $resource, private readonly array $history, private readonly array $allowances)
    {
        parent::__construct($resource);
    }

    public static function for(BillingAccount $account): self
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
            'openPlanAssignment.plan.allowances',
            'allowanceOverrides',
        ]);

        return new self($account, app(BillingAccountHistory::class)->for($account), app(Allowances::class)->all($account));
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        return [
            'uuid' => (string) $this->resource->uuid,
            'name' => (string) $this->resource->name,
            'contact_email' => $this->resource->contact_email === null ? null : (string) $this->resource->contact_email,
            'notes' => $this->resource->notes === null ? null : (string) $this->resource->notes,
            'organization_limit' => self::limit($this->allowances[AllowanceKind::Organizations->value]),
            'organizations_count' => (int) $this->resource->organizations->count(),
            'created_at' => $this->resource->created_at?->toIso8601String(),
            'plan_assignment' => $this->resource->openPlanAssignment === null
                ? null
                : new PlanAssignmentResource($this->resource->openPlanAssignment),
            'allowances' => AllowanceResource::collection(array_values($this->allowances)),
            'owners' => BillingAccountOwnerResource::collection($this->resource->owners),
            'organizations' => BillingAccountOrganizationResource::collection($this->resource->organizations),
            'history' => BillingAccountHistoryResource::collection($this->history),
        ];
    }

    private static function limit(ResolvedAllowance $allowance): ?int
    {
        return $allowance->value === null ? null : (int) $allowance->value;
    }
}
