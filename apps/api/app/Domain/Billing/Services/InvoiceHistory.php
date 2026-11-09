<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Billing\Models\Invoice;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;

/**
 * An invoice's audited history for administrators (spec 029 FR-034), newest first:
 * drafting, recalculating, adjustments, issuing, its credit notes and payments (US7).
 * Credit notes are audited with the note as the subject, so they are found by their own
 * uuids.
 */
final class InvoiceHistory
{
    private const LIMIT = 100;

    private const INVOICE_EVENTS = [
        'billing_invoice.drafted',
        'billing_invoice.adjusted',
        'billing_invoice.issued',
        'billing_invoice.payment_recorded',
        'billing_invoice.payment_succeeded',
        'billing_invoice.payment_failed',
        'billing_invoice.payment_amount_mismatch',
        'billing_invoice.overpaid',
    ];

    /**
     * @return list<array{at: string, action: 'drafted'|'recalculated'|'adjustment_added'|'adjustment_removed'|'issued'|'credit_note_issued'|'payment_recorded'|'payment_succeeded'|'payment_failed'|'payment_amount_mismatch'|'overpaid', actor: array{id: int, name: string}|null, description: string|null, amount: int|null, note: string|null, number: string|null}>
     */
    public function for(Invoice $invoice): array
    {
        $notes = $invoice->creditNotes->pluck('number', 'uuid');

        $events = DB::table('activity_log')
            ->where(fn ($query) => $query
                ->where(fn ($query) => $query->where('subject_uuid', $invoice->uuid)->whereIn('event', self::INVOICE_EVENTS))
                ->orWhere(fn ($query) => $query->whereIn('subject_uuid', $notes->keys()->all())->where('event', 'billing_credit_note.issued')))
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->limit(self::LIMIT)
            ->get(['event', 'causer_id', 'subject_uuid', 'properties', 'created_at']);

        $actors = User::query()
            ->whereIn('id', $events->pluck('causer_id')->filter()->unique()->values())
            ->get(['id', 'name'])
            ->keyBy('id');

        return $events
            ->map(function (object $event) use ($actors, $notes): array {
                $details = json_decode((string) $event->properties, true) ?: [];
                $actor = $event->causer_id === null ? null : $actors->get((int) $event->causer_id);
                $action = match ($event->event) {
                    'billing_invoice.drafted' => 'drafted',
                    'billing_invoice.issued' => 'issued',
                    'billing_credit_note.issued' => 'credit_note_issued',
                    'billing_invoice.payment_recorded' => 'payment_recorded',
                    'billing_invoice.payment_succeeded' => 'payment_succeeded',
                    'billing_invoice.payment_failed' => 'payment_failed',
                    'billing_invoice.payment_amount_mismatch' => 'payment_amount_mismatch',
                    'billing_invoice.overpaid' => 'overpaid',
                    default => match ($details['change'] ?? null) {
                        'adjustment_added' => 'adjustment_added',
                        'adjustment_removed' => 'adjustment_removed',
                        default => 'recalculated',
                    },
                };

                return [
                    'at' => CarbonImmutable::parse($event->created_at)->toIso8601String(),
                    'action' => $action,
                    'actor' => $actor === null ? null : ['id' => (int) $actor->id, 'name' => (string) $actor->name],
                    'description' => isset($details['description']) ? (string) $details['description'] : null,
                    'amount' => match (true) {
                        isset($details['amount']) => (int) $details['amount'],
                        isset($details['received']) => (int) $details['received'],
                        default => null,
                    },
                    // The note says why it was drafted early, adjusted, credited or why a payment failed.
                    'note' => match (true) {
                        isset($details['note']) => (string) $details['note'],
                        isset($details['reason']) => (string) $details['reason'],
                        default => null,
                    },
                    'number' => match ($action) {
                        'issued' => isset($details['number']) ? (string) $details['number'] : null,
                        'credit_note_issued' => $notes->has($event->subject_uuid) ? (string) $notes->get($event->subject_uuid) : null,
                        default => null,
                    },
                ];
            })
            ->values()
            ->all();
    }
}
