<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\TaxRate;
use App\Domain\Shared\Models\User;
use Illuminate\Validation\ValidationException;

/**
 * A billing account's details for its invoices (spec 029 FR-029): billing address,
 * optional tax number, and a tax rate or none. An archived rate can be kept but not
 * newly chosen. Issued invoices keep the details they were issued with.
 */
final class BillingDetails
{
    public function update(BillingAccount $account, ?string $address, ?string $taxNumber, ?TaxRate $rate, User $actor): BillingAccount
    {
        if ($rate !== null && $rate->archived_at !== null && $rate->getKey() !== $account->billing_tax_rate_id) {
            throw ValidationException::withMessages(['tax_rate_uuid' => 'This tax rate is archived. Choose another.']);
        }

        $before = $this->details($account);
        $account->forceFill([
            'billing_address' => $address,
            'tax_number' => $taxNumber,
            'billing_tax_rate_id' => $rate?->getKey(),
        ])->save();
        $account->unsetRelation('taxRate');
        $after = $this->details($account);

        $changes = [];
        foreach ($after as $field => $value) {
            if ($before[$field] !== $value) {
                $changes[$field] = ['from' => $before[$field], 'to' => $value];
            }
        }
        if ($changes !== []) {
            ActivityLog::record('billing_account.billing_details_updated', null, $actor, $account, ['changes' => $changes]);
        }

        return $account;
    }

    /**
     * @return array{billing_address: ?string, tax_number: ?string, tax_rate: ?string}
     */
    private function details(BillingAccount $account): array
    {
        return [
            'billing_address' => $account->billing_address,
            'tax_number' => $account->tax_number,
            'tax_rate' => $account->taxRate?->name,
        ];
    }
}
