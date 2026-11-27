<?php

declare(strict_types=1);

namespace App\Domain\DeviceAdapters\Models;

use App\Domain\Devices\Models\DeviceModel;

/**
 * One saved link to one OPC UA server (spec 038, ADR-052), shared by the data sources
 * that read through it. `secrets` (the password, the user certificate and key, the
 * platform certificate's key) are encrypted and never leave the API.
 *
 * @property array $secrets
 * @property array|null $server_certificate
 * @property array|null $pending_server_certificate
 * @property array|null $status
 */
final class AdapterConnection extends DeviceModel
{
    public const POLICIES = ['None', 'Basic256Sha256', 'Aes128_Sha256_RsaOaep', 'Aes256_Sha256_RsaPss'];

    public const MODES = ['None', 'Sign', 'SignAndEncrypt'];

    public const IDENTITIES = ['anonymous', 'username', 'certificate'];

    public const STATES = ['draft', 'awaiting_trust', 'connected', 'unreachable', 'stopped', 'paused'];

    protected $table = 'adapter_connections';

    protected $hidden = ['secrets'];

    protected function casts(): array
    {
        return [
            'secrets' => 'encrypted:array',
            'server_certificate' => 'array',
            'pending_server_certificate' => 'array',
            'status' => 'array',
            'refused_points' => 'array',
            'client_certificate_expires_at' => 'datetime',
        ];
    }

    public function encrypted(): bool
    {
        return $this->security_policy !== 'None';
    }

    /** What the portal sees: never a secret, never a private key. */
    public function view(): array
    {
        $secrets = $this->secrets ?? [];

        return [
            'uuid' => $this->uuid,
            'name' => $this->name,
            'protocol' => $this->protocol,
            'endpoint_url' => $this->endpoint_url,
            'runs_at' => $this->runs_at,
            'security_policy' => $this->security_policy,
            'security_mode' => $this->security_mode,
            'security_label' => $this->encrypted() ? ($this->security_mode === 'Sign' ? 'Signed' : 'Encrypted')." ({$this->security_policy})" : 'Not encrypted',
            'unencrypted_confirmed_by' => $this->unencrypted_confirmed_by,
            'identity' => $this->identity,
            'username' => $secrets['username'] ?? null,
            'has_password' => filled($secrets['password'] ?? null),
            'has_user_certificate' => filled($secrets['user_certificate'] ?? null),
            'client_certificate' => [
                'fingerprint' => self::fingerprint($this->client_certificate),
                'expires_at' => $this->client_certificate_expires_at?->toIso8601String(),
            ],
            'server_certificate' => self::certificateView($this->server_certificate),
            'pending_server_certificate' => self::certificateView($this->pending_server_certificate),
            'state' => $this->state,
            'status' => $this->status,
            'refused_points' => $this->refused_points ?? [],
            'created_at' => $this->created_at?->toIso8601String(),
            'updated_at' => $this->updated_at?->toIso8601String(),
        ];
    }

    private static function certificateView(?array $certificate): ?array
    {
        if (! $certificate) {
            return null;
        }
        unset($certificate['der']);

        return $certificate;
    }

    public static function fingerprint(?string $pem): ?string
    {
        return $pem ? (openssl_x509_fingerprint($pem, 'sha256') ?: null) : null;
    }
}
