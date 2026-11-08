{{-- An invoice or credit note for dompdf (spec 029 FR-032). Inline styles only: dompdf reads no external CSS. --}}
@php
    $title = $creditNote ? 'Credit note' : ($invoice->isIssued() ? 'Invoice' : 'Draft invoice');
    $number = $creditNote ? $creditNote->number : ($invoice->number ?? 'Draft');
    $kinds = ['alerts' => 'Alerts', 'sms' => 'SMS', 'data_points' => 'Data points', 'devices' => 'Devices'];
@endphp
<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>{{ $title }} {{ $number }}</title>
<style>
    body { font-family: "DejaVu Sans", sans-serif; font-size: 10px; color: #1a1a1a; }
    h1 { font-size: 18px; margin: 0 0 4px; }
    h2 { font-size: 11px; margin: 18px 0 6px; text-transform: uppercase; letter-spacing: 0.04em; color: #555; }
    table { width: 100%; border-collapse: collapse; }
    th { text-align: left; font-weight: bold; border-bottom: 1px solid #999; padding: 4px 6px; }
    td { padding: 4px 6px; border-bottom: 1px solid #e3e3e3; vertical-align: top; }
    .end { text-align: right; white-space: nowrap; }
    .muted { color: #666; }
    .parties td { border: 0; padding: 0 12px 0 0; width: 50%; }
    .totals td { border: 0; }
    .totals .strong td { font-weight: bold; border-top: 1px solid #999; }
    .draft { color: #b45309; font-weight: bold; }
    .pre { white-space: pre-line; }
</style>
</head>
<body>
<h1>{{ $title }} {{ $number }}</h1>
<p class="muted">
    {{ $invoice->month->format('F Y') }}
    @if ($creditNote)
        · on invoice {{ $invoice->number }} · issued {{ $creditNote->issued_at->format('j F Y') }}
    @elseif ($invoice->isIssued())
        · issued {{ $invoice->issued_at->format('j F Y') }} · due {{ $invoice->due_at?->format('j F Y') }}
    @else
        · <span class="draft">Not issued{{ $invoice->usage_incomplete ? ', usage possibly incomplete' : '' }}</span>
    @endif
</p>

<table class="parties">
    <tr>
        <td>
            <h2>From</h2>
            <div>{{ $operator['legal_name'] ?? '' }}</div>
            <div class="pre">{{ $operator['address'] ?? '' }}</div>
            @if (! empty($operator['tax_registration_number']))
                <div>Tax number {{ $operator['tax_registration_number'] }}</div>
            @endif
        </td>
        <td>
            <h2>Billed to</h2>
            <div>{{ $account['name'] ?? '' }}</div>
            <div class="pre">{{ $account['billing_address'] ?? '' }}</div>
            @if (! empty($account['tax_number']))
                <div>Tax number {{ $account['tax_number'] }}</div>
            @endif
            @if (! empty($account['contact_email']))
                <div>{{ $account['contact_email'] }}</div>
            @endif
        </td>
    </tr>
</table>

@if ($creditNote)
    <h2>Credit</h2>
    <table>
        <tr><th>Reason</th><th class="end">Amount ({{ $invoice->currency }})</th></tr>
        <tr><td>{{ $creditNote->reason }}</td><td class="end">{{ $money($creditNote->amount) }}</td></tr>
    </table>
    <table class="totals">
        <tr><td class="end">Taken off invoice {{ $invoice->number }}</td><td class="end">{{ $money($creditNote->applied) }}</td></tr>
        <tr><td class="end">Credit for the next invoice</td><td class="end">{{ $money($creditNote->amount - $creditNote->applied) }}</td></tr>
    </table>
@else
    <h2>Charges</h2>
    <table>
        <tr><th>Description</th><th class="end">Quantity</th><th class="end">Unit price</th><th class="end">Amount ({{ $invoice->currency }})</th></tr>
        @foreach ($lines as $line)
            <tr>
                {{-- An adjustment's note is the administrator's own; the description is what the customer reads. --}}
                <td>{{ $line->description }}@if ($line->note && $line->kind !== \App\Domain\Billing\Enums\InvoiceLineKind::Adjustment)<div class="muted">{{ $line->note }}</div>@endif</td>
                <td class="end">{{ rtrim(rtrim((string) $line->quantity, '0'), '.') }}</td>
                <td class="end">{{ $money($line->unit_price) }}</td>
                <td class="end">{{ $money($line->amount) }}</td>
            </tr>
        @endforeach
    </table>
    <table class="totals">
        <tr><td class="end">Subtotal</td><td class="end" style="width: 25%">{{ $money($invoice->subtotal) }}</td></tr>
        <tr>
            <td class="end">Tax{{ $invoice->tax_rate_name ? ' · '.$invoice->tax_rate_name.' '.rtrim(rtrim(number_format($invoice->tax_basis_points / 100, 2), '0'), '.').'%' : '' }}</td>
            <td class="end">{{ $money($invoice->tax) }}</td>
        </tr>
        <tr class="strong"><td class="end">Total</td><td class="end">{{ $money($invoice->total) }}</td></tr>
        @if ($invoice->credit_applied > 0)
            <tr><td class="end">Credit applied</td><td class="end">-{{ $money($invoice->credit_applied) }}</td></tr>
        @endif
        <tr class="strong"><td class="end">Amount due</td><td class="end">{{ $money($invoice->amount_due) }}</td></tr>
    </table>
@endif

@if (! $creditNote && count($usage) > 0)
    <h2>Usage by organization</h2>
    <table>
        <tr><th>Organization</th><th>Usage</th><th class="end">Count</th></tr>
        @foreach ($usage as $row)
            <tr><td>{{ $row->organization_name }}</td><td>{{ $kinds[$row->kind] ?? $row->kind }}</td><td class="end">{{ number_format($row->count) }}</td></tr>
        @endforeach
    </table>
@endif

@if (! empty($operator['invoice_footer']))
    <p class="muted pre" style="margin-top: 24px">{{ $operator['invoice_footer'] }}</p>
@endif
</body>
</html>
