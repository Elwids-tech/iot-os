<?php

declare(strict_types=1);

namespace Tests\Support;

use CBOR\ByteStringObject;
use CBOR\MapItem;
use CBOR\MapObject;
use CBOR\NegativeIntegerObject;
use CBOR\TextStringObject;
use CBOR\UnsignedIntegerObject;
use OpenSSLAsymmetricKey;
use ParagonIE\ConstantTime\Base64UrlSafe;
use RuntimeException;

/**
 * A software passkey for feature tests (spec 034): one ES256 key that answers the
 * API's WebAuthn options the way a browser and authenticator would, with `none`
 * attestation. It builds the same JSON the browser client posts.
 */
final class VirtualAuthenticator
{
    private OpenSSLAsymmetricKey $key;

    private string $credentialId;

    private int $counter = 0;

    private ?string $userHandle = null;

    public function __construct(private readonly string $origin = 'http://localhost:5173')
    {
        $key = openssl_pkey_new(['private_key_type' => OPENSSL_KEYTYPE_EC, 'curve_name' => 'prime256v1']);
        if (! $key instanceof OpenSSLAsymmetricKey) {
            throw new RuntimeException('Could not create a P-256 key.');
        }
        $this->key = $key;
        $this->credentialId = random_bytes(32);
    }

    /**
     * Answer `GET me/passkeys/options` with a new credential.
     *
     * @param  array<string, mixed>  $options  the `options` the API sent
     * @return array<string, mixed>
     */
    public function register(array $options, ?string $origin = null): array
    {
        $this->userHandle = (string) data_get($options, 'user.id');
        $rpId = (string) data_get($options, 'rp.id');

        $details = openssl_pkey_get_details($this->key);
        $cose = MapObject::create([
            MapItem::create(UnsignedIntegerObject::create(1), UnsignedIntegerObject::create(2)),
            MapItem::create(UnsignedIntegerObject::create(3), NegativeIntegerObject::create(-7)),
            MapItem::create(NegativeIntegerObject::create(-1), UnsignedIntegerObject::create(1)),
            MapItem::create(NegativeIntegerObject::create(-2), ByteStringObject::create(str_pad((string) $details['ec']['x'], 32, "\0", STR_PAD_LEFT))),
            MapItem::create(NegativeIntegerObject::create(-3), ByteStringObject::create(str_pad((string) $details['ec']['y'], 32, "\0", STR_PAD_LEFT))),
        ]);

        $authData = hash('sha256', $rpId, true)
            .chr(0x45) // user present, user verified, attested credential data
            .pack('N', $this->counter)
            .str_repeat("\0", 16) // AAGUID
            .pack('n', strlen($this->credentialId))
            .$this->credentialId
            .(string) $cose;

        $attestation = MapObject::create([
            MapItem::create(TextStringObject::create('fmt'), TextStringObject::create('none')),
            MapItem::create(TextStringObject::create('attStmt'), MapObject::create()),
            MapItem::create(TextStringObject::create('authData'), ByteStringObject::create($authData)),
        ]);

        return [
            'id' => Base64UrlSafe::encodeUnpadded($this->credentialId),
            'rawId' => Base64UrlSafe::encodeUnpadded($this->credentialId),
            'type' => 'public-key',
            'response' => [
                'clientDataJSON' => $this->clientData('webauthn.create', $options, $origin),
                'attestationObject' => Base64UrlSafe::encodeUnpadded((string) $attestation),
                'transports' => ['internal'],
            ],
            'clientExtensionResults' => [],
        ];
    }

    /**
     * Answer `GET auth/passkeys/options` (or the confirmation options) with an assertion.
     *
     * @param  array<string, mixed>  $options  the `options` the API sent
     * @return array<string, mixed>
     */
    public function assert(array $options, ?string $origin = null, ?string $rpId = null): array
    {
        $this->counter++;
        $authData = hash('sha256', $rpId ?? (string) data_get($options, 'rpId'), true)
            .chr(0x05) // user present, user verified
            .pack('N', $this->counter);
        $clientData = $this->clientData('webauthn.get', $options, $origin);

        openssl_sign($authData.hash('sha256', Base64UrlSafe::decodeNoPadding($clientData), true), $signature, $this->key, OPENSSL_ALGO_SHA256);

        return [
            'id' => Base64UrlSafe::encodeUnpadded($this->credentialId),
            'rawId' => Base64UrlSafe::encodeUnpadded($this->credentialId),
            'type' => 'public-key',
            'response' => [
                'clientDataJSON' => $clientData,
                'authenticatorData' => Base64UrlSafe::encodeUnpadded($authData),
                'signature' => Base64UrlSafe::encodeUnpadded((string) $signature),
                'userHandle' => $this->userHandle,
            ],
            'clientExtensionResults' => [],
        ];
    }

    /** The credential id as the API stores it. */
    public function credentialId(): string
    {
        return Base64UrlSafe::encodeUnpadded($this->credentialId);
    }

    /**
     * @param  array<string, mixed>  $options
     */
    private function clientData(string $type, array $options, ?string $origin): string
    {
        return Base64UrlSafe::encodeUnpadded((string) json_encode([
            'type' => $type,
            'challenge' => (string) data_get($options, 'challenge'),
            'origin' => $origin ?? $this->origin,
            'crossOrigin' => false,
        ], JSON_UNESCAPED_SLASHES));
    }
}
