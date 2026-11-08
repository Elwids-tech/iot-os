<?php

declare(strict_types=1);

namespace App\Domain\Billing;

use App\Domain\Billing\Listeners\StripeEvents;
use App\Domain\Billing\Models\BillingAccount;
use Illuminate\Support\Facades\Event;
use Illuminate\Support\ServiceProvider;
use Laravel\Cashier\Cashier;
use Laravel\Cashier\Events\WebhookReceived;

/**
 * Card payments (spec 029 US7, ADR-037): billing accounts are Cashier's customers, and
 * Stripe's events reach `StripeEvents`. Cashier's subscription tables and routes are not
 * used; its migrations only publish, so none run.
 */
final class BillingServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        Cashier::ignoreRoutes();
    }

    public function boot(): void
    {
        Cashier::useCustomerModel(BillingAccount::class);
        Event::listen(WebhookReceived::class, StripeEvents::class);
    }
}
