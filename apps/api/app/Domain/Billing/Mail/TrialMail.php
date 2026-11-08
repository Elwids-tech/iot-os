<?php

declare(strict_types=1);

namespace App\Domain\Billing\Mail;

use App\Domain\Billing\Enums\PlanAssignmentKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Models\PlanAssignment;
use App\Domain\Billing\Services\Payments;
use Carbon\CarbonImmutable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * A trial email to the owners (spec 029 FR-049): a `reminder` 7 days and 1 day before a
 * limited trial ends, asking for a card when none is saved, or `ended` once it has,
 * saying whether the plan is now charged. Dates are UTC days: a trial ending at 00:00 on
 * the 9th runs until the 8th. It carries plain values.
 */
final class TrialMail extends Mailable
{
    public function __construct(
        public string $kind,
        public string $accountUuid,
        public string $accountName,
        public string $planName,
        public ?string $lastDay,
        public ?string $card,
        public bool $payments,
        public bool $charged = false,
    ) {}

    public static function reminder(BillingAccount $account, PlanAssignment $trial): self
    {
        return new self('reminder', $account->uuid, $account->name, $trial->plan->name, self::lastDay($trial->trial_ends_at), self::card($account), Payments::enabled());
    }

    /**
     * @param  PlanAssignment  $trial  the trial that ended
     * @param  PlanAssignment  $next  what the account is on now: `paid` or `trial_unpaid`
     */
    public static function ended(BillingAccount $account, PlanAssignment $trial, PlanAssignment $next): self
    {
        return new self('ended', $account->uuid, $account->name, $trial->plan->name, self::lastDay($next->started_at), self::card($account), Payments::enabled(),
            $next->kind === PlanAssignmentKind::Paid);
    }

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->kind === 'ended'
            ? sprintf('Your trial of %s has ended: %s', $this->planName, $this->accountName)
            : sprintf('Your trial of %s ends on %s: %s', $this->planName, $this->lastDay, $this->accountName));
    }

    public function content(): Content
    {
        $from = $this->lastDay === null ? null : CarbonImmutable::parse($this->lastDay, 'UTC')->addDay()->format('j F Y');

        return new Content(text: 'billing.trial', with: [
            'lead' => $this->kind === 'ended'
                ? sprintf('The trial of %s on the billing account %s ended on %s.', $this->planName, $this->accountName, $this->lastDay)
                : sprintf('The trial of %s on the billing account %s runs until %s (UTC).', $this->planName, $this->accountName, $this->lastDay),
            'next' => match (true) {
                $this->kind === 'ended' && $this->charged => sprintf('The account stays on %s and is charged from %s.', $this->planName, $from),
                $this->kind === 'ended' && $this->payments => sprintf('The account stays on %s and is not charged. Add a card to keep the plan: it is charged from the day after.', $this->planName),
                $this->kind === 'ended' => sprintf('The account stays on %s and is not charged until it becomes a paid plan.', $this->planName),
                $this->card !== null => sprintf('After that, the account stays on %s and is charged to %s from %s.', $this->planName, $this->card, $from),
                $this->payments => sprintf('Add a card to keep %s after the trial. Without one, the account stays on the plan, uncharged, and is flagged for review.', $this->planName),
                default => sprintf('After that, the account stays on %s.', $this->planName),
            },
            'action' => ! $this->charged && $this->card === null && $this->payments ? 'Add a card' : 'Open the billing account',
            'link' => rtrim((string) config('app.frontend_url'), '/').'/billing?account='.$this->accountUuid,
            'footer' => 'You receive this as an owner of this billing account.',
        ]);
    }

    /** "8 December 2026": the UTC day before the instant the trial ends. */
    private static function lastDay(?CarbonImmutable $endsAt): ?string
    {
        return $endsAt?->utc()->subMicrosecond()->format('j F Y');
    }

    private static function card(BillingAccount $account): ?string
    {
        $card = $account->paymentMethodSummary();

        return $card === null ? null : ucfirst($card['brand']).($card['last_four'] === null ? '' : ' ending '.$card['last_four']);
    }
}
