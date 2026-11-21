<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Passkeys;

use Laravel\Passkeys\Actions\StorePasskey;
use Laravel\Passkeys\Contracts\PasskeyUser;
use Laravel\Passkeys\Passkey;
use Laravel\Passkeys\Passkeys;
use Webauthn\CredentialRecord;

/**
 * Records the domain a passkey is made on (spec 036, FR-026): the deployment's own, or
 * the custom domain the request came from. A passkey works only on that domain.
 */
final class DomainStorePasskey extends StorePasskey
{
    public function createPasskey(PasskeyUser $user, string $name, CredentialRecord $source): Passkey
    {
        $passkey = parent::createPasskey($user, $name, $source);
        $passkey->forceFill(['relying_party_id' => strtolower(Passkeys::relyingPartyId())])->save();

        return $passkey;
    }
}
