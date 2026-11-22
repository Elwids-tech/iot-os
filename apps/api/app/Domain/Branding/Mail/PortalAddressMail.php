<?php

declare(strict_types=1);

namespace App\Domain\Branding\Mail;

use App\Domain\Branding\Services\PortalLinks;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;

/**
 * A plain-text email to a billing account's owners about one of its portal addresses
 * (spec 036, US3 scenarios 6 and 7, FR-037): a custom domain whose request lapsed or
 * whose DNS record went missing, and an address given up after 30 days without its
 * allowance. Sent as the platform, like billing mail, and it carries plain values, not
 * models.
 */
final class PortalAddressMail extends Mailable
{
    public const LAPSED = 'lapsed';

    public const UNREACHABLE = 'unreachable';

    public const RELEASED = 'released';

    /**
     * @param  self::LAPSED|self::UNREACHABLE|self::RELEASED  $event
     * @param  string|null  $record  The CNAME value the domain must point to, for a domain that is unreachable.
     */
    public function __construct(
        public string $accountUuid,
        public string $accountName,
        public string $host,
        public string $event,
        public ?string $record = null,
        public int $days = 7,
    ) {}

    public function envelope(): Envelope
    {
        return new Envelope(subject: match ($this->event) {
            self::LAPSED => sprintf('The request for %s lapsed', $this->host),
            self::UNREACHABLE => sprintf('The DNS record for %s is missing', $this->host),
            default => sprintf('%s no longer opens the portal', $this->host),
        });
    }

    public function content(): Content
    {
        [$lead, $next] = match ($this->event) {
            self::LAPSED => [
                sprintf('The DNS record for %s was not found within %d days, so the request to use it for the portal of %s lapsed.', $this->host, $this->days, $this->accountName),
                'To use the domain, add it again on the billing account. You then get a new record to add where you manage DNS.',
            ],
            self::UNREACHABLE => [
                sprintf('The DNS record that points %s to the portal of %s can no longer be found.', $this->host, $this->accountName),
                sprintf('The portal still opens there for now, and links in emails use your other address. Put the CNAME record for %s back%s to recover. Nothing else is needed: it is checked again every few minutes.', $this->host, $this->record === null ? '' : ', pointing to '.$this->record),
            ],
            default => [
                sprintf('%s was an address of the portal of %s. The plan of the billing account has not included it for %d days, so the address was given up.', $this->host, $this->accountName, $this->days),
                sprintf('It is held for %d more days, so nobody else can take it. Once it is part of your plan again you can claim it again on the billing account.', $this->days),
            ],
        };

        return new Content(text: 'branding.portal-address', with: [
            'lead' => $lead,
            'next' => $next,
            'link' => app(PortalLinks::class)->platform('billing').'?account='.$this->accountUuid,
            'footer' => 'You receive this because you own this billing account.',
        ]);
    }
}
