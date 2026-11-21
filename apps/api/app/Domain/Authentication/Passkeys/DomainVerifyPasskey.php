<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Passkeys;

use Laravel\Passkeys\Actions\VerifyPasskey;
use Laravel\Passkeys\Exceptions\InvalidPasskeyException;
use Laravel\Passkeys\Passkey;
use Laravel\Passkeys\Passkeys;
use ParagonIE\ConstantTime\Base64UrlSafe;
use Webauthn\PublicKeyCredential;

/**
 * Accepts only a passkey made on the request's domain (spec 036, FR-026). An
 * authenticator never offers a passkey to another domain; this refuses one all the same.
 */
final class DomainVerifyPasskey extends VerifyPasskey
{
    public function getPasskey(PublicKeyCredential $credential, bool $lock = false): Passkey
    {
        $query = Passkeys::passkeyModel()::query()
            ->where('credential_id', Base64UrlSafe::encodeUnpadded($credential->rawId))
            ->where('relying_party_id', strtolower(Passkeys::relyingPartyId()));
        if ($lock) {
            $query->lockForUpdate();
        }

        return $query->first()
            ?? throw InvalidPasskeyException::make(__('Passkey not recognized. It may have been removed from your account.'));
    }
}
