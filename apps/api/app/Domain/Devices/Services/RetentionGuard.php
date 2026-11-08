<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services;

use App\Domain\Billing\Mail\RetentionReducedMail;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\Notices;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Support\Facades\DB;

/**
 * Wraps a billing change that can shorten organizations' telemetry retention: a plan
 * change or edit, an account override, an organization moving (spec 029 US4, FR-019,
 * FR-020, research R10). It compares each organization's effective retention before and
 * after the change, in one transaction. A shortening needs confirmation, else 409 with
 * the organizations and the date deletion starts; once confirmed, each shortened
 * organization gets a floor that keeps cleanup at its previous period for
 * `billing.retention_grace_days`, and its account's owners are emailed. Lengthening
 * applies at once. Direct changes on Settings → Retention do not come here (FR-021).
 */
final class RetentionGuard
{
    public function __construct(
        private readonly RetentionService $retention,
        private readonly Notices $notices,
    ) {}

    /**
     * @template T
     *
     * @param  list<int>  $organizationIds  the organizations the change can reach
     * @param  callable(): T  $change
     * @param  'plan_changed'|'plan_edited'|'override'|'organization_moved'|'trial'  $reason
     * @return T
     */
    public function around(array $organizationIds, callable $change, string $reason, bool $confirmed): mixed
    {
        return DB::transaction(function () use ($organizationIds, $change, $reason, $confirmed): mixed {
            $before = $this->days($organizationIds);
            $result = $change();
            $after = $this->days($organizationIds);
            $shortened = array_filter($after, fn (array $now, int $id): bool => $now['days'] < ($before[$id]['days'] ?? $now['days']), ARRAY_FILTER_USE_BOTH);

            if ($shortened === []) {
                return $result;
            }

            $until = CarbonImmutable::now()->addDays((int) config('billing.retention_grace_days'));
            $organizations = array_map(fn (int $id): array => [
                'uuid' => $after[$id]['organization']->uuid,
                'name' => $after[$id]['organization']->name,
                'from_days' => $before[$id]['days'],
                'to_days' => $after[$id]['days'],
            ], array_keys($shortened));

            if (! $confirmed) {
                throw new HttpResponseException(response()->json([
                    'message' => sprintf(
                        'This shortens telemetry retention for %d %s. History older than the new period will be deleted from %s. Confirm to apply it.',
                        count($organizations),
                        count($organizations) === 1 ? 'organization' : 'organizations',
                        $until->format('j F Y'),
                    ),
                    'retention' => ['deletion_from' => $until->toIso8601ZuluString(), 'organizations' => $organizations],
                ], 409));
            }

            $floors = [];
            foreach (array_keys($shortened) as $id) {
                $floors[$id] = (int) DB::table('telemetry_retention_floors')->insertGetId([
                    'organization_id' => $id,
                    'days' => $before[$id]['days'],
                    'until' => $until,
                    'reason' => $reason,
                    'created_at' => now(),
                ]);
            }

            DB::afterCommit(function () use ($floors, $before, $after, $until): void {
                foreach ($floors as $id => $floor) {
                    $this->warn($after[$id]['organization'], $floor, $before[$id]['days'], $after[$id]['days'], $until);
                }
            });

            return $result;
        });
    }

    /**
     * The organizations of these billing accounts now.
     *
     * @param  list<BillingAccount>  $accounts
     * @return list<int>
     */
    public static function organizationsOf(array $accounts): array
    {
        return Organization::query()
            ->whereIn('billing_account_id', array_map(fn (BillingAccount $account): int => (int) $account->getKey(), $accounts))
            ->pluck('id')
            ->map(fn ($id): int => (int) $id)
            ->all();
    }

    /**
     * @param  list<int>  $organizationIds
     * @return array<int, array{days: int, organization: Organization}>
     */
    private function days(array $organizationIds): array
    {
        $days = [];

        foreach (Organization::query()->whereIn('id', $organizationIds)->with('billingAccount')->get() as $organization) {
            $days[(int) $organization->getKey()] = ['days' => $this->retention->effective($organization)['days'], 'organization' => $organization];
        }

        return $days;
    }

    /** One email per reduction: its floor's id is the key, so a second change the same day is emailed too. */
    private function warn(Organization $organization, int $floor, int $fromDays, int $toDays, CarbonImmutable $until): void
    {
        $account = $organization->billingAccount;

        if ($account === null) {
            return;
        }

        $this->notices->send($account, 'retention_reduction', $organization->uuid.':floor:'.$floor, new RetentionReducedMail(
            (string) $account->uuid,
            (string) $account->name,
            (string) $organization->name,
            $fromDays,
            $toDays,
            $until->toIso8601ZuluString(),
            false,
        ));
    }
}
