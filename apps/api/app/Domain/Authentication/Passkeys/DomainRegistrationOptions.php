<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Passkeys;

use App\Domain\Shared\Models\User;
use Laravel\Passkeys\Actions\GenerateRegistrationOptions;
use Laravel\Passkeys\Contracts\PasskeyUser;
use ParagonIE\ConstantTime\Base64UrlSafe;
use Webauthn\PublicKeyCredentialDescriptor;

/**
 * Excludes only the passkeys made on the request's domain (spec 036, FR-026), so one
 * authenticator can hold a passkey for the platform's domain and one for a custom domain.
 */
final class DomainRegistrationOptions extends GenerateRegistrationOptions
{
    public function excludedCredentials(PasskeyUser $user): array
    {
        if (! $user instanceof User) {
            return parent::excludedCredentials($user);
        }

        return $user->passkeysHere()->get()->map(
            static fn ($passkey): PublicKeyCredentialDescriptor => PublicKeyCredentialDescriptor::create(
                PublicKeyCredentialDescriptor::CREDENTIAL_TYPE_PUBLIC_KEY,
                Base64UrlSafe::decodeNoPadding($passkey->credential_id),
            ),
        )->all();
    }
}
