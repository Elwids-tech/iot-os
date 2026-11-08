<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Controllers;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Billing\Enums\PaymentStatus;
use App\Domain\Billing\Http\Requests\AddAdjustmentRequest;
use App\Domain\Billing\Http\Requests\DraftInvoiceRequest;
use App\Domain\Billing\Http\Requests\IssueCreditNoteRequest;
use App\Domain\Billing\Http\Resources\CreditNoteResource;
use App\Domain\Billing\Http\Resources\InvoiceDetailResource;
use App\Domain\Billing\Http\Resources\InvoiceResource;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\CreditNote;
use App\Domain\Billing\Models\Invoice;
use App\Domain\Billing\Models\InvoiceLine;
use App\Domain\Billing\Services\CreditNotes;
use App\Domain\Billing\Services\InvoiceDrafter;
use App\Domain\Billing\Services\InvoiceIssuer;
use App\Domain\Billing\Services\InvoicePdf;
use Carbon\CarbonImmutable;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * Invoices for platform administrators (spec 029 US6): drafts to review, adjust and
 * issue, issued invoices and their credit notes, the accounts still waiting for final
 * usage, and the documents.
 */
final class PlatformInvoiceController
{
    public function __construct(
        private readonly InvoiceDrafter $drafter,
        private readonly InvoiceIssuer $issuer,
        private readonly CreditNotes $creditNotes,
        private readonly InvoicePdf $documents,
    ) {}

    public function index(Request $request): AnonymousResourceCollection
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);
        $request->validate([
            'status' => ['nullable', Rule::in([Invoice::DRAFT, Invoice::ISSUED])],
            /** A UTC month as `YYYY-MM`. */
            'month' => ['nullable', 'date_format:Y-m'],
            /** A billing account's uuid. */
            'account' => ['nullable', 'uuid'],
            'payment_status' => ['nullable', Rule::enum(PaymentStatus::class)],
        ]);
        $perPage = min(max((int) $request->query('per_page', 25), 1), 100);

        $invoices = Invoice::query()
            ->when($request->filled('status'), fn ($query) => $query->where('status', $request->query('status')))
            ->when($request->filled('month'), fn ($query) => $query->whereDate('month', $request->query('month').'-01'))
            ->when($request->filled('account'), fn ($query) => $query->whereHas('billingAccount', fn ($query) => $query->where('uuid', $request->query('account'))))
            ->when($request->filled('payment_status'), fn ($query) => $query->where('status', Invoice::ISSUED)->where('payment_status', $request->query('payment_status')))
            ->with('billingAccount')
            ->orderByDesc('month')
            ->orderBy('number')
            ->orderBy('id')
            ->paginate($perPage)
            ->withQueryString();

        return InvoiceResource::collection($invoices);
    }

    /** Accounts whose invoice for an ended month waits for final usage (FR-033). */
    public function waiting(Request $request): JsonResponse
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);
        $request->validate(['month' => ['nullable', 'date_format:Y-m']]);
        $month = $request->filled('month')
            ? CarbonImmutable::createFromFormat('!Y-m', (string) $request->query('month'), 'UTC')
            : CarbonImmutable::now()->utc()->startOfMonth()->subMonthNoOverflow();

        /** @var list<array{billing_account: array{uuid: string, name: string}, month: string, waiting_since: string, overdue: bool}> $waiting */
        $waiting = array_map(fn (array $row): array => [
            'billing_account' => ['uuid' => (string) $row['account']->uuid, 'name' => (string) $row['account']->name],
            'month' => $month->toDateString(),
            'waiting_since' => $row['waiting_since']->toIso8601String(),
            // Overdue once the wait passes BILLING_INVOICE_WAIT_DAYS (FR-033).
            'overdue' => $row['waiting_since']->addDays((int) config('billing.invoice_wait_days'))->lessThanOrEqualTo(CarbonImmutable::now()),
        ], $this->drafter->waiting($month));

        return response()->json(['data' => $waiting]);
    }

    /** Drafts now, before usage is final, with a note; the draft says it may be incomplete. */
    public function store(DraftInvoiceRequest $request, BillingAccount $billingAccount): JsonResponse
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $month = CarbonImmutable::createFromFormat('!Y-m', (string) $request->validated('month'), 'UTC');
        $invoice = $this->drafter->draft($billingAccount, $month, $request->user(), (string) $request->validated('note'));

        return $this->detail($invoice)->response()->setStatusCode(201);
    }

    public function show(Invoice $invoice): InvoiceDetailResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        return $this->detail($invoice);
    }

    public function recalculate(Request $request, Invoice $invoice): InvoiceDetailResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        return $this->detail($this->drafter->recalculate($invoice, $request->user()));
    }

    public function addAdjustment(AddAdjustmentRequest $request, Invoice $invoice): InvoiceDetailResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        return $this->detail($this->drafter->addAdjustment(
            $invoice,
            (string) $request->validated('description'),
            (int) $request->validated('amount'),
            (string) $request->validated('note'),
            $request->user(),
        ));
    }

    public function removeAdjustment(Request $request, Invoice $invoice, int $line): InvoiceDetailResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $found = InvoiceLine::query()->where('invoice_id', $invoice->getKey())->whereKey($line)->firstOrFail();

        return $this->detail($this->drafter->removeAdjustment($invoice, $found, $request->user()));
    }

    /** Numbers and fixes the invoice, then emails it (FR-034, FR-036). */
    public function issue(Request $request, Invoice $invoice): InvoiceDetailResource
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        return $this->detail($this->issuer->issue($invoice, $request->user()));
    }

    public function creditNote(IssueCreditNoteRequest $request, Invoice $invoice): JsonResponse
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        $note = $this->creditNotes->issue($invoice, (int) $request->validated('amount'), (string) $request->validated('reason'), $request->user());

        return (new CreditNoteResource($note))->response()->setStatusCode(201);
    }

    public function pdf(Invoice $invoice): Response
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        return self::download($this->documents->invoice($invoice), self::filename($invoice).'.pdf', 'application/pdf');
    }

    public function csv(Invoice $invoice): Response
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        return self::download($this->documents->csv($invoice), self::filename($invoice).'.csv', 'text/csv; charset=utf-8');
    }

    public function creditNotePdf(CreditNote $creditNote): Response
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);

        return self::download($this->documents->creditNote($creditNote), $creditNote->number.'.pdf', 'application/pdf');
    }

    public static function download(string $body, string $filename, string $type): Response
    {
        return response($body, 200, [
            'Content-Type' => $type,
            'Content-Disposition' => 'attachment; filename="'.str_replace('"', '', $filename).'"',
            'Cache-Control' => 'no-store, private',
        ]);
    }

    /** "INV-0007", or "draft-2026-11-<account>" before a draft has a number. */
    public static function filename(Invoice $invoice): string
    {
        return $invoice->number ?? 'draft-'.$invoice->month->format('Y-m').'-'.$invoice->billingAccount->uuid;
    }

    private function detail(Invoice $invoice): InvoiceDetailResource
    {
        return new InvoiceDetailResource($invoice->load(['billingAccount', 'lines', 'creditNotes.invoice']));
    }
}
