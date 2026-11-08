<?php

declare(strict_types=1);

namespace App\Domain\Billing\Services;

use App\Domain\Billing\Enums\InvoiceLineKind;
use App\Domain\Billing\Models\CreditNote;
use App\Domain\Billing\Models\Invoice;
use App\Domain\Billing\Support\Money;
use Dompdf\Dompdf;
use Dompdf\Options;
use Illuminate\Support\Facades\DB;

/**
 * Invoice and credit note documents (spec 029 FR-032, FR-036, research R13): a PDF
 * rendered on request with dompdf from one Blade view, which has no browser to need, and
 * a CSV of the lines, totals and each organization's usage. A draft renders as a draft;
 * issued documents use only the details they were issued with.
 */
final class InvoicePdf
{
    public function __construct(private readonly BillingSettings $settings) {}

    public function invoice(Invoice $invoice): string
    {
        return $this->render(['invoice' => $invoice, 'creditNote' => null]);
    }

    public function creditNote(CreditNote $note): string
    {
        return $this->render(['invoice' => $note->invoice, 'creditNote' => $note]);
    }

    /** One CSV: a header, the lines, the totals, then each organization's usage. */
    public function csv(Invoice $invoice): string
    {
        $out = fopen('php://temp', 'r+');
        $row = static fn (array $values) => fputcsv($out, $values, ',', '"', '');
        $decimal = static fn (?int $amount): string => $amount === null ? '' : number_format($amount / 100, 2, '.', '');

        $row(['invoice', $invoice->number ?? 'draft', 'month', $invoice->month->format('Y-m'), 'currency', $invoice->currency]);
        $row([]);
        $row(['position', 'kind', 'description', 'quantity', 'unit_price', 'amount', 'note']);
        foreach ($invoice->lines as $line) {
            // An adjustment's note is for administrators; the description is what the customer reads.
            $note = $line->kind === InvoiceLineKind::Adjustment ? null : $line->note;
            $row([$line->position, $line->kind->value, $line->description, rtrim(rtrim((string) $line->quantity, '0'), '.'), $decimal($line->unit_price), $decimal($line->amount), $note]);
        }
        $row([]);
        $row(['subtotal', $decimal($invoice->subtotal)]);
        $row(['tax', $decimal($invoice->tax), $invoice->tax_rate_name, $invoice->tax_basis_points]);
        $row(['total', $decimal($invoice->total)]);
        $row(['credit_applied', $decimal($invoice->credit_applied)]);
        $row(['amount_due', $decimal($invoice->amount_due)]);
        $row([]);
        $row(['organization_uuid', 'organization', 'kind', 'count']);
        foreach ($this->usage($invoice) as $usage) {
            $row([$usage->organization_uuid, $usage->organization_name, $usage->kind, $usage->count]);
        }
        rewind($out);

        return (string) stream_get_contents($out);
    }

    /**
     * @return list<object{organization_uuid: string, organization_name: string, kind: string, count: int}>
     */
    public function usage(Invoice $invoice): array
    {
        return DB::table('billing_invoice_usage')
            ->where('invoice_id', $invoice->getKey())
            ->orderBy('organization_name')
            ->orderBy('kind')
            ->get()
            ->all();
    }

    /**
     * @param  array{invoice: Invoice, creditNote: ?CreditNote}  $data
     */
    private function render(array $data): string
    {
        $invoice = $data['invoice'];
        $settings = $this->settings->get();
        $html = view('billing.invoice', [
            ...$data,
            'lines' => $invoice->lines,
            'usage' => $this->usage($invoice),
            // A draft shows today's details; an issued document only its snapshot.
            'operator' => $invoice->operator_details ?? $settings,
            'account' => $invoice->account_details ?? [
                'name' => $invoice->billingAccount->name,
                'contact_email' => $invoice->billingAccount->contact_email,
                'billing_address' => $invoice->billingAccount->billing_address,
                'tax_number' => $invoice->billingAccount->tax_number,
            ],
            'money' => static fn (?int $amount): string => $amount === null ? '' : Money::format($amount),
        ])->render();

        $options = new Options;
        $options->set('isRemoteEnabled', false);
        $options->set('defaultFont', 'DejaVu Sans');
        $pdf = new Dompdf($options);
        $pdf->loadHtml($html);
        $pdf->setPaper('A4');
        $pdf->render();

        return (string) $pdf->output();
    }
}
