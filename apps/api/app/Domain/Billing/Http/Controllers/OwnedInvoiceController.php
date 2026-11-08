<?php

declare(strict_types=1);

namespace App\Domain\Billing\Http\Controllers;

use App\Domain\Billing\Http\Resources\CreditNoteResource;
use App\Domain\Billing\Http\Resources\InvoiceDetailResource;
use App\Domain\Billing\Http\Resources\InvoiceResource;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\CreditNote;
use App\Domain\Billing\Models\Invoice;
use App\Domain\Billing\Services\InvoicePdf;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * An owner's invoices and credit notes (spec 029 FR-036, SC-007): issued ones only, with
 * their PDF and CSV. An account the person does not own, a draft, or another account's
 * invoice answers 404.
 */
final class OwnedInvoiceController
{
    public function __construct(private readonly InvoicePdf $documents) {}

    public function index(Request $request, string $billingAccount): JsonResponse
    {
        $account = $this->account($request, $billingAccount);
        $invoices = $account->invoices()->where('status', Invoice::ISSUED)->with(['billingAccount', 'creditNotes.invoice'])->orderByDesc('month')->get();

        return response()->json(['data' => [
            'invoices' => InvoiceResource::collection($invoices),
            'credit_notes' => CreditNoteResource::collection($invoices->flatMap->creditNotes->sortByDesc('issued_at')->values()),
        ]]);
    }

    public function show(Request $request, string $billingAccount, string $invoice): InvoiceDetailResource
    {
        $found = $this->invoice($request, $billingAccount, $invoice);

        return (new InvoiceDetailResource($found->load(['billingAccount', 'lines', 'creditNotes.invoice'])))->forOwner();
    }

    public function pdf(Request $request, string $billingAccount, string $invoice): Response
    {
        $found = $this->invoice($request, $billingAccount, $invoice);

        return PlatformInvoiceController::download($this->documents->invoice($found), PlatformInvoiceController::filename($found).'.pdf', 'application/pdf');
    }

    public function csv(Request $request, string $billingAccount, string $invoice): Response
    {
        $found = $this->invoice($request, $billingAccount, $invoice);

        return PlatformInvoiceController::download($this->documents->csv($found), PlatformInvoiceController::filename($found).'.csv', 'text/csv; charset=utf-8');
    }

    public function creditNotePdf(Request $request, string $billingAccount, string $creditNote): Response
    {
        $account = $this->account($request, $billingAccount);
        $note = CreditNote::query()
            ->where('uuid', $creditNote)
            ->whereHas('invoice', fn ($query) => $query->where('billing_account_id', $account->getKey()))
            ->firstOrFail();

        return PlatformInvoiceController::download($this->documents->creditNote($note), $note->number.'.pdf', 'application/pdf');
    }

    private function account(Request $request, string $uuid): BillingAccount
    {
        /** @var User $user */
        $user = $request->user();
        /** @var BillingAccount|null $account */
        $account = $user->ownedBillingAccounts()->where('billing_accounts.uuid', $uuid)->first();
        abort_if($account === null, 404);

        return $account;
    }

    private function invoice(Request $request, string $billingAccount, string $invoice): Invoice
    {
        return $this->account($request, $billingAccount)->invoices()
            ->where('uuid', $invoice)
            ->where('status', Invoice::ISSUED)
            ->firstOrFail();
    }
}
