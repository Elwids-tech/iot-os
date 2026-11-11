<?php

declare(strict_types=1);

namespace App\Domain\Devices\Services\Moves;

use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Devices\Services\DeviceAuthorization;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;

/**
 * Where a person may move an organization's devices (spec 031, research R9): the other
 * organizations of its billing account where they hold `Device.move`, and nothing else of
 * the account. An owner of the account with room under its organization limit may also
 * create a new one there (`OwnerOrganizations`).
 */
final class MoveTargets
{
    public function __construct(private readonly DeviceAuthorization $authorization, private readonly Allowances $allowances) {}

    /** @return array{data: list<array{uuid: string, name: string}>, new_organization?: array{billing_account_uuid: string}} */
    public function for(Organization $source, User $user): array
    {
        $account = BillingAccount::find($source->billing_account_id);
        if (! $account) {
            return ['data' => []];
        }
        $others = Organization::where('billing_account_id', $account->id)->whereKeyNot($source->id)->orderBy('name')->orderBy('id')->get();
        $data = $others->filter(fn (Organization $organization): bool => $this->authorization->capabilities($user, $organization)['move'])
            ->map(fn (Organization $organization): array => ['uuid' => $organization->uuid, 'name' => $organization->name])->values()->all();
        $result = ['data' => $data];
        if ($account->owners()->whereKey($user->id)->exists()) {
            $limit = $this->allowances->value($account, AllowanceKind::Organizations);
            if ($limit === null || $account->organizations()->count() < $limit) {
                $result['new_organization'] = ['billing_account_uuid' => $account->uuid];
            }
        }

        return $result;
    }
}
