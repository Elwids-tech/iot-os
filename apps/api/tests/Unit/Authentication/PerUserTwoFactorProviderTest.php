<?php

declare(strict_types=1);

namespace Tests\Unit\Authentication;

use App\Domain\Authentication\Services\PerUserTwoFactorProvider;
use Illuminate\Cache\ArrayStore;
use Illuminate\Cache\Repository;
use Laravel\Fortify\Contracts\TwoFactorAuthenticationProvider;
use PragmaRX\Google2FA\Google2FA;
use Tests\TestCase;

/** Replays are refused per person, not across everyone (spec 034, research R6). */
final class PerUserTwoFactorProviderTest extends TestCase
{
    public function test_a_code_works_once_for_one_secret_and_still_works_for_another(): void
    {
        $engine = new Google2FA;
        $provider = new PerUserTwoFactorProvider($engine, new Repository(new ArrayStore));
        $first = $engine->generateSecretKey();
        $second = $engine->generateSecretKey();

        $this->assertTrue($provider->verify($first, $engine->getCurrentOtp($first)));
        $this->assertFalse($provider->verify($first, $engine->getCurrentOtp($first)));
        $this->assertTrue($provider->verify($second, $engine->getCurrentOtp($second)));
    }

    public function test_the_application_binds_it_in_place_of_fortifys_provider(): void
    {
        $this->assertInstanceOf(PerUserTwoFactorProvider::class, $this->app->make(TwoFactorAuthenticationProvider::class));
    }
}
