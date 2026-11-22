<?php

declare(strict_types=1);

namespace App\Domain\Branding\Services;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Models\PortalAddress;
use App\Domain\Shared\Models\Organization;
use Illuminate\Mail\Mailables\Address;
use Illuminate\Notifications\Messages\MailMessage;

/**
 * The brand a mail carries (spec 036, research R11, FR-028 to FR-030): the product
 * name, a logo for the header and the support link. `name` is null when no brand is in
 * effect, and the mail is then exactly what it was before brands existed. Only the
 * sender's display name follows the brand; the sending address never changes.
 */
final readonly class MailBrand
{
    private function __construct(
        public ?string $name = null,
        public ?string $logoUrl = null,
        public ?string $supportUrl = null,
        public ?string $homeUrl = null,
    ) {}

    /** No brand: billing mail, staff mail and every account without a brand in effect. */
    public static function platform(): self
    {
        return new self;
    }

    /**
     * For mail about an organization: its account's brand, with the organization's own
     * logo when it has one. Read fresh each time: the worker that sends mail outlives
     * any change to a brand.
     */
    public static function forOrganization(?Organization $organization): self
    {
        $account = $organization?->billingAccount;
        if ($organization === null || $account === null) {
            return self::platform();
        }
        $brand = self::forAccount($account, app(PortalLinks::class)->addressOf($account));
        $own = $brand->name === null ? null : $organization->logo;

        return $own === null ? $brand : new self(
            $brand->name,
            self::image($own->publicKey(), $own->mainVariant(), app(PortalLinks::class)->addressOf($account)),
            $brand->supportUrl,
            $brand->homeUrl,
        );
    }

    /** For mail with no organization: the brand of the address kept by `PortalLinks::origin()`. */
    public static function forHost(?string $host): self
    {
        $address = $host === null ? null : app(PortalAddresses::class)->resolve($host);

        return $address === null ? self::platform() : self::forAccount($address->billingAccount, $address);
    }

    private static function forAccount(?BillingAccount $account, ?PortalAddress $address): self
    {
        $brands = app(Brands::class);
        $brand = $account === null ? null : $brands->for($account);
        if ($account === null || $brand === null || ! $brands->inEffect($account, $brand)) {
            return self::platform();
        }

        return new self(
            (string) $brand->product_name,
            self::image($brand->logo?->publicKey(), $brand->logo?->mainVariant(), $address),
            $brand->support_url,
            $address === null ? app(PortalLinks::class)->platform() : app(PortalAddresses::class)->url($address),
        );
    }

    private static function image(?string $key, ?string $variant, ?PortalAddress $address): ?string
    {
        return $key === null
            ? null
            : app(PortalLinks::class)->apiBase($address).route('api.v1.brand-assets.show', ['asset' => $key, 'variant' => $variant], false);
    }

    public function branded(): bool
    {
        return $this->name !== null;
    }

    /** The brand's name, or the words the mail used before brands existed. */
    public function or(string $platform): string
    {
        return $this->name ?? $platform;
    }

    /** The sender for a mailable, or null to keep the configured one. */
    public function sender(): ?Address
    {
        return $this->name === null ? null : new Address((string) config('mail.from.address'), $this->name);
    }

    /** Gives a notification's mail the brand's sender name, header and footer. Without a brand it is returned untouched. */
    public function apply(MailMessage $message): MailMessage
    {
        if ($this->name === null) {
            return $message;
        }
        $message->viewData['brand'] = $this;

        return $message->from((string) config('mail.from.address'), $this->name);
    }
}
