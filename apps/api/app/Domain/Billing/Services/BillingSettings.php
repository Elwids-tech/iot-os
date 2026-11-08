<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Facades\DB;

/**
 * The operator's billing details and number prefixes (spec 029 FR-029): one row, edited
 * with its revision so two administrators cannot overwrite each other (409). The
 * currency is config and read-only here; an invoice snapshots these details when issued.
 */
final class BillingSettings
{
    public const FIELDS = ['legal_name', 'address', 'tax_registration_number', 'invoice_footer', 'invoice_prefix', 'credit_note_prefix'];

    /**
     * @return array{legal_name: ?string, address: ?string, tax_registration_number: ?string, invoice_footer: ?string, invoice_prefix: string, credit_note_prefix: string, revision: int, currency: string, updated_at: ?string}
     */
    public function get(): array
    {
        $row = DB::table('billing_settings')->where('id', 1)->first();

        return [
            'legal_name' => $row?->legal_name,
            'address' => $row?->address,
            'tax_registration_number' => $row?->tax_registration_number,
            'invoice_footer' => $row?->invoice_footer,
            'invoice_prefix' => (string) ($row->invoice_prefix ?? 'INV-'),
            'credit_note_prefix' => (string) ($row->credit_note_prefix ?? 'CN-'),
            'revision' => (int) ($row->revision ?? 0),
            'currency' => (string) config('billing.currency'),
            'updated_at' => $row?->updated_at === null ? null : (string) $row->updated_at,
        ];
    }

    /**
     * @param  array<string, string|null>  $values  any of FIELDS
     */
    public function update(array $values, int $revision, User $actor): array
    {
        DB::transaction(function () use ($values, $revision, $actor): void {
            $row = DB::table('billing_settings')->where('id', 1)->lockForUpdate()->first();
            abort_unless($row !== null && (int) $row->revision === $revision, 409, 'Billing settings changed. Refresh before saving.');

            $changes = [];
            foreach (array_intersect_key($values, array_flip(self::FIELDS)) as $field => $value) {
                if ((string) $row->{$field} !== (string) $value) {
                    $changes[$field] = ['from' => $row->{$field}, 'to' => $value];
                }
            }

            DB::table('billing_settings')->where('id', 1)->update([
                ...array_intersect_key($values, array_flip(self::FIELDS)),
                'revision' => $revision + 1,
                'updated_by' => $actor->getKey(),
                'updated_at' => now(),
            ]);
            ActivityLog::record('billing_settings.updated', null, $actor, null, ['changes' => $changes]);
        });

        return $this->get();
    }
}
