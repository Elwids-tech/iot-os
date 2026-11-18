<?php

declare(strict_types=1);

namespace Tests\Support;

use App\Domain\Shared\Models\User;
use Laravel\Passkeys\Actions\GenerateRegistrationOptions;
use Laravel\Passkeys\Actions\StorePasskey;
use Laravel\Passkeys\Passkey;
use Laravel\Passkeys\Support\WebAuthn;
use Webauthn\PublicKeyCredential;

/** People with passkeys (spec 034), registered through the package's own checks. */
trait PasskeyFixtures
{
    /**
     * Register a passkey for the person, as `POST me/passkeys` would.
     *
     * @return array{0: VirtualAuthenticator, 1: Passkey}
     */
    protected function givePasskey(User $user, string $name = 'MacBook Touch ID'): array
    {
        $authenticator = new VirtualAuthenticator;
        $options = app(GenerateRegistrationOptions::class)($user);
        $credential = $authenticator->register(WebAuthn::toBrowserArray($options));

        $passkey = app(StorePasskey::class)(
            $user,
            $name,
            WebAuthn::fromJson((string) json_encode($credential), PublicKeyCredential::class),
            $options,
        );

        return [$authenticator, $passkey];
    }
}
