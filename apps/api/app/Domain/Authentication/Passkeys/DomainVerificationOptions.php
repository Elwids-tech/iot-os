<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Passkeys;

use App\Domain\Shared\Models\User;
use Laravel\Passkeys\Actions\GenerateVerificationOptions;
use Laravel\Passkeys\Contracts\PasskeyUser;
use ParagonIE\ConstantTime\Base64UrlSafe;
use Webauthn\PublicKeyCredentialDescriptor;

/** Offers a person only the passkeys made on the request's domain (spec 036, FR-026). */
final class DomainVerificationOptions extends GenerateVerificationOptions
{
    public function allowCredentials(?PasskeyUser $user): array
    {
        if (! $user instanceof User) {
            return parent::allowCredentials($user);
        }

        return $user->passkeysHere()->get()->map(
            static fn ($passkey): PublicKeyCredentialDescriptor => PublicKeyCredentialDescriptor::create(
                PublicKeyCredentialDescriptor::CREDENTIAL_TYPE_PUBLIC_KEY,
                Base64UrlSafe::decodeNoPadding($passkey->credential_id),
            ),
        )->all();
    }
}
