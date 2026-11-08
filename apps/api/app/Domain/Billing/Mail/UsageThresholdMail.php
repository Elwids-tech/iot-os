<?php

declare(strict_types=1);

namespace App\Domain\Billing\Mail;

use App\Domain\Billing\Enums\AllowanceKind;
use Carbon\CarbonImmutable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * A plain-text warning to a billing account's owners that an allowance passed 80% or is
 * used up this month (spec 028 FR-023, spec 029 FR-025). It carries plain values, not
 * models, so the queued job serializes nothing that can go stale.
 */
final class UsageThresholdMail extends Mailable
{
    public function __construct(
        public string $accountUuid,
        public string $accountName,
        public string $kind,
        public string $month,
        public int $percent,
        public int $count,
        public int $allowance,
    ) {}

    public function envelope(): Envelope
    {
        $allowance = ucfirst(AllowanceKind::from($this->kind)->label());

        return new Envelope(subject: $this->usedUp()
            ? sprintf('%s used up: %s', $allowance, $this->accountName)
            : sprintf('%s %d%% used: %s', $allowance, $this->percent, $this->accountName));
    }

    public function content(): Content
    {
        $kind = AllowanceKind::from($this->kind);
        $month = CarbonImmutable::parse($this->month, 'UTC')->format('F Y');

        return new Content(text: 'billing.usage-threshold', with: [
            'lead' => $this->usedUp()
                ? sprintf('The billing account %s has used up its %s for %s.', $this->accountName, $kind->label(), $month)
                : sprintf('The billing account %s has used %d%% of its %s for %s.', $this->accountName, $this->percent, $kind->label(), $month),
            'used' => number_format($this->count),
            'allowance' => number_format($this->allowance),
            'left' => number_format(max(0, $this->allowance - $this->count)),
            'consequence' => match ($kind) {
                AllowanceKind::Alerts => 'Alerts past the allowance are still recorded and sent on every channel, and are counted as overage.',
                AllowanceKind::DataPoints => 'Readings past the allowance are still stored and shown in history, and are counted as overage.',
                AllowanceKind::Sms => $this->usedUp()
                    ? 'Further SMS are cancelled until next month. Email and the other channels are unaffected.'
                    : 'Once it is used up, SMS are cancelled until next month. Email and the other channels are unaffected.',
                default => null,
            },
            'link' => rtrim((string) config('app.frontend_url'), '/').'/billing?account='.$this->accountUuid,
            'footer' => 'You receive this because you own this billing account. Allowances reset on the first day of each month (UTC).',
        ]);
    }

    private function usedUp(): bool
    {
        return $this->percent >= 100;
    }
}
