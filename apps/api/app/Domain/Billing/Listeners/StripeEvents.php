<?php

declare(strict_types=1);

namespace App\Domain\Billing\Listeners;

use App\Domain\Billing\Services\Payments;
use Illuminate\Support\Facades\DB;
use Laravel\Cashier\Events\WebhookReceived;

/**
 * Stripe's signed events (spec 029 US7, contracts/stripe-webhooks.md). Each event id
 * goes into `billing_provider_events` first and is acted on only when it was new, in
 * the same transaction, so a replayed or duplicated event changes nothing. Other event
 * types are ignored.
 */
final class StripeEvents
{
    private const HANDLED = ['checkout.session.completed', 'payment_intent.succeeded', 'payment_intent.payment_failed', 'payment_method.detached'];

    public function __construct(private readonly Payments $payments) {}

    public function handle(WebhookReceived $event): void
    {
        $payload = $event->payload;
        $type = (string) ($payload['type'] ?? '');

        if (! in_array($type, self::HANDLED, true) || ! is_string($payload['id'] ?? null)) {
            return;
        }

        DB::transaction(function () use ($payload, $type): void {
            $inserted = DB::table('billing_provider_events')->insertOrIgnore([
                'provider_event_id' => $payload['id'],
                'type' => $type,
                'received_at' => now(),
            ]);

            if ($inserted === 0) {
                return;
            }

            $object = (array) ($payload['data']['object'] ?? []);
            match ($type) {
                'checkout.session.completed' => $this->payments->completedCheckout($object),
                'payment_intent.succeeded', 'payment_intent.payment_failed' => $this->payments->applyIntent($object),
                'payment_method.detached' => $this->payments->detached($object, (array) ($payload['data']['previous_attributes'] ?? [])),
            };
        });
    }
}
