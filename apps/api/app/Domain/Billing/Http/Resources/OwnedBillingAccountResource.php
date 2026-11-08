<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Resources;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\Invoice;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Billing\Services\MonthlyUsage;
use App\Domain\Billing\Services\Payments;
use App\Domain\Billing\Services\ResolvedAllowance;
use App\Domain\Billing\Services\Usage;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

/**
 * A billing account as its owner sees it in the portal: its organizations, whether the
 * owner is a member of each, and the limit (spec 023 US3): the `organizations`
 * allowance, null when unlimited (ADR-035). Its plan and since when, allowances and this month's usage
 * with each organization's share (spec 028 FR-021) leave SMS out when the deployment
 * cannot send it. Owners see their own prices and latest issued invoice (spec 029 FR-030,
 * FR-036).
 *
 * @extends JsonResource<BillingAccount>
 */
final class OwnedBillingAccountResource extends JsonResource
{
    /**
     * @param  list<int>  $memberOf  ids of the organizations the owner belongs to
     */
    public function __construct(BillingAccount $resource, private readonly array $memberOf)
    {
        parent::__construct($resource);
    }

    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $sms = Usage::smsAvailable();
        $allowances = array_values(array_filter(
            app(Allowances::class)->all($this->resource),
            fn (ResolvedAllowance $allowance): bool => $sms || $allowance->kind !== AllowanceKind::Sms,
        ));
        $usage = app(Usage::class)->forAccount($this->resource, CarbonImmutable::now(), withSms: $sms);
        $latest = $this->resource->invoices()->where('status', Invoice::ISSUED)->latest('month')->first();

        return [
            'uuid' => (string) $this->resource->uuid,
            'name' => (string) $this->resource->name,
            'organization_limit' => self::limit(app(Allowances::class)->value($this->resource, AllowanceKind::Organizations)),
            'organizations_count' => (int) $this->resource->organizations->count(),
            'organizations' => $this->organizationSummaries(),
            'plan' => $this->resource->openPlanAssignment === null ? null : [
                'uuid' => (string) $this->resource->openPlanAssignment->plan->uuid,
                'name' => (string) $this->resource->openPlanAssignment->plan->name,
                'since' => $this->resource->openPlanAssignment->started_at->toIso8601String(),
            ],
            'allowances' => AllowanceResource::collection(array_map(fn (ResolvedAllowance $allowance): AllowanceResource => new AllowanceResource($allowance), $allowances)),
            'usage' => UsageResource::collection(array_map(fn (MonthlyUsage $usage): UsageResource => new UsageResource($usage), $usage)),
            /**
             * What the account pays on its plan, overrides included; null without a plan (spec 029 FR-030).
             *
             * @var array{currency: string, current: array{effective_from: string, base_price: int, alert_overage_price: int, data_point_overage_price: int, data_point_block_size: int}, next: array{effective_from: string, base_price: int, alert_overage_price: int, data_point_overage_price: int, data_point_block_size: int}|null}|null
             */
            'prices' => PriceSummary::forAccount($this->resource),
            /** The latest issued invoice; drafts are never shown to owners. */
            'latest_invoice' => $latest === null ? null : new InvoiceResource($latest),
            /** Whether cards can be saved and invoices paid online (spec 029 FR-045). */
            'payments_enabled' => Payments::enabled(),
            /**
             * The saved card: its brand, last four digits and `YYYY-MM` expiry, never more (spec 029 FR-039).
             *
             * @var array{brand: string, last_four: string|null, expires: string|null}|null
             */
            'payment_method' => $this->resource->paymentMethodSummary(),
            /** Since when an invoice has been unpaid past its due date (spec 029 FR-043). */
            'past_due_since' => $this->resource->past_due_since?->toIso8601String(),
        ];
    }

    private static function limit(?int $limit): ?int
    {
        return $limit === null ? null : (int) $limit;
    }

    /**
     * @return list<array{uuid: string, name: string, created_at: string|null, member: bool}>
     */
    private function organizationSummaries(): array
    {
        return $this->resource->organizations
            ->map(fn (Organization $organization): array => [
                'uuid' => (string) $organization->uuid,
                'name' => (string) $organization->name,
                'created_at' => $organization->created_at?->toIso8601String(),
                'member' => in_array($organization->getKey(), $this->memberOf, true),
            ])
            ->values()
            ->all();
    }
}
