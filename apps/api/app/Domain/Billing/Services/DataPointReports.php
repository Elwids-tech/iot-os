<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Validator;

/**
 * Applies the runtime's usage.data_points.v1 reports (spec 029 US3, ADR-036,
 * contracts/internal/events). Counts are cumulative per organization and UTC hour, so
 * only an increase over the highest count seen is counted, through `Usage::add`, for the
 * billing account the organization belonged to at that hour. Replays and reports out of
 * order change nothing. Runs inside the runtime batch's savepoint (ADR-031).
 */
final class DataPointReports
{
    public const SOURCE = 'runtime';

    public function __construct(private readonly Usage $usage) {}

    /**
     * @param  array<string, mixed>  $payload
     */
    public function apply(array $payload): void
    {
        // A version this code does not know can never be processed: 422 dead-letters it.
        abort_unless(($payload['schema_version'] ?? null) === 1, 422, 'Unsupported usage.data_points.v1 schema version.');
        $validator = Validator::make($payload, [
            'generated_at' => ['required', 'date'],
            'final_through' => ['required', 'date'],
            'buckets' => ['present', 'list', 'max:500'],
            'buckets.*.organization_uuid' => ['required', 'uuid'],
            'buckets.*.hour' => ['required', 'date'],
            'buckets.*.count' => ['required', 'integer', 'min:0'],
            'buckets.*.final' => ['required', 'boolean'],
        ]);
        abort_if($validator->fails(), 422, 'The usage.data_points.v1 payload is malformed: '.$validator->errors()->first());

        foreach ($payload['buckets'] as $bucket) {
            $this->bucket((string) $bucket['organization_uuid'], CarbonImmutable::parse((string) $bucket['hour'])->utc(), (int) $bucket['count']);
        }

        $this->watermark(CarbonImmutable::parse((string) $payload['final_through'])->utc(), CarbonImmutable::parse((string) $payload['generated_at'])->utc());
    }

    private function bucket(string $organizationUuid, CarbonImmutable $hour, int $reported): void
    {
        $key = ['organization_uuid' => $organizationUuid, 'hour' => $hour];
        $row = DB::table('billing_data_point_buckets')->where($key)->lockForUpdate()->first();

        if ($row === null) {
            DB::table('billing_data_point_buckets')->insertOrIgnore([
                ...$key,
                'count' => 0,
                'billing_account_id' => $this->accountAt($organizationUuid, $hour),
                'updated_at' => now(),
            ]);
            $row = DB::table('billing_data_point_buckets')->where($key)->lockForUpdate()->first();
        }

        $increase = $reported - (int) $row->count;

        if ($increase <= 0) {
            return;
        }

        DB::table('billing_data_point_buckets')->where($key)->update(['count' => $reported, 'updated_at' => now()]);
        $account = $row->billing_account_id === null ? null : BillingAccount::withTrashed()->find($row->billing_account_id);

        // Readings of an organization nobody ever assigned are recorded and not counted. One
        // deleted since still counts for its account, and in its share under its last name.
        if ($account !== null) {
            $this->usage->add($account, $this->organization($organizationUuid), AllowanceKind::DataPoints, $hour, $increase);
        }
    }

    /**
     * The organization, or one rebuilt from its assignments once it is deleted, so its
     * share still adds up to the account's total (FR-017).
     */
    private function organization(string $uuid): ?Organization
    {
        $organization = Organization::withTrashed()->where('uuid', $uuid)->first();
        if ($organization !== null) {
            return $organization;
        }
        $name = DB::table('billing_account_assignments')->where('organization_uuid', $uuid)->orderByDesc('started_at')->value('organization_name');

        return $name === null ? null : (new Organization)->forceFill(['uuid' => $uuid, 'name' => $name]);
    }

    /**
     * The account whose assignment covered the hour (spec 023's history), else the
     * organization's account now; null when the organization is unknown.
     */
    private function accountAt(string $organizationUuid, CarbonImmutable $hour): ?int
    {
        $assigned = DB::table('billing_account_assignments')
            ->where('organization_uuid', $organizationUuid)
            ->where('started_at', '<=', $hour)
            ->where(fn ($query) => $query->whereNull('ended_at')->orWhere('ended_at', '>', $hour))
            ->orderByDesc('started_at')
            ->value('billing_account_id');

        if ($assigned !== null) {
            return (int) $assigned;
        }

        $current = Organization::withTrashed()->where('uuid', $organizationUuid)->value('billing_account_id');

        return $current === null ? null : (int) $current;
    }

    /**
     * Moves the watermark forward and records when the runtime last reported: when it
     * built the report, not when it arrived, so a backlog of events reads as late
     * (FR-014, SC-005). Both only move forward, and a report is never newer than now.
     */
    private function watermark(CarbonImmutable $finalThrough, CarbonImmutable $generatedAt): void
    {
        $reportedAt = $generatedAt->min(CarbonImmutable::now());
        DB::table('billing_usage_watermarks')->insertOrIgnore(['source' => self::SOURCE, 'final_through' => $finalThrough, 'reported_at' => $reportedAt]);
        $stored = DB::table('billing_usage_watermarks')->where('source', self::SOURCE)->lockForUpdate()->first();
        $forward = CarbonImmutable::parse((string) $stored->final_through)->lessThan($finalThrough);

        DB::table('billing_usage_watermarks')->where('source', self::SOURCE)->update([
            'final_through' => $forward ? $finalThrough : $stored->final_through,
            'reported_at' => $reportedAt->max(CarbonImmutable::parse((string) $stored->reported_at)),
        ]);
    }
}
