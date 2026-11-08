<?php

declare(strict_types=1);

namespace App\Domain\Billing\Mail;

use Carbon\CarbonImmutable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * A plain-text email to a billing account's owners that a billing change shortened an
 * organization's telemetry retention, sent at the change and again 7 days before older
 * history starts to be deleted (spec 029 FR-020). It carries plain values, not models.
 */
final class RetentionReducedMail extends Mailable
{
    public function __construct(
        public string $accountUuid,
        public string $accountName,
        public string $organizationName,
        public int $fromDays,
        public int $toDays,
        public string $deletionFrom,
        public bool $reminder,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: $this->reminder
            ? sprintf('Telemetry history of %s will be shortened in 7 days', $this->organizationName)
            : sprintf('Telemetry retention of %s shortened to %d days', $this->organizationName, $this->toDays));
    }

    public function content(): Content
    {
        $date = CarbonImmutable::parse($this->deletionFrom)->utc()->format('j F Y');

        return new Content(text: 'billing.retention-reduced', with: [
            'lead' => $this->reminder
                ? sprintf('On %s, telemetry history of %s older than %d days will start to be deleted.', $date, $this->organizationName, $this->toDays)
                : sprintf('A change to the billing account %s shortened telemetry retention of %s from %d to %d days.', $this->accountName, $this->organizationName, $this->fromDays, $this->toDays),
            'grace' => sprintf('History is kept for %d days until %s. From then on, measurements older than %d days are deleted, and deleted history cannot be restored.', $this->fromDays, $date, $this->toDays),
            'undo' => 'If this is not what you want, ask the platform operator to change it back before that date: nothing is deleted then.',
            'link' => rtrim((string) config('app.frontend_url'), '/').'/billing?account='.$this->accountUuid,
            'footer' => 'You receive this because you own this billing account.',
        ]);
    }
}
