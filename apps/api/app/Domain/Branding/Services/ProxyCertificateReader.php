<?php

declare(strict_types=1);

namespace App\Domain\Branding\Services;

use App\Domain\Branding\Contracts\CertificateReader;
use Carbon\CarbonImmutable;

/**
 * Asks the deployment's own proxy, inside its network, for the certificate it serves
 * under a host's name. The handshake never leaves the deployment, so it does not depend
 * on the domain's DNS or on the route back in from outside, and it is also what makes
 * the proxy obtain or renew a certificate nobody has visited lately.
 */
final class ProxyCertificateReader implements CertificateReader
{
    public function enabled(): bool
    {
        return $this->proxy() !== '';
    }

    public function expiresAt(string $host): ?CarbonImmutable
    {
        if (! $this->enabled()) {
            return null;
        }
        // The certificate is read, not trusted: the expiry is all that is taken from it.
        $context = stream_context_create(['ssl' => [
            'peer_name' => $host,
            'SNI_enabled' => true,
            'capture_peer_cert' => true,
            'verify_peer' => false,
            'verify_peer_name' => false,
        ]]);
        $seconds = (float) config('branding.certificate_probe_seconds');
        $connection = @stream_socket_client('ssl://'.$this->proxy(), $code, $message, $seconds, STREAM_CLIENT_CONNECT, $context);
        if ($connection === false) {
            return null;
        }
        $certificate = stream_context_get_params($connection)['options']['ssl']['peer_certificate'] ?? null;
        fclose($connection);
        $parsed = $certificate === null ? false : openssl_x509_parse($certificate);
        $until = is_array($parsed) ? ($parsed['validTo_time_t'] ?? null) : null;

        return is_int($until) ? CarbonImmutable::createFromTimestampUTC($until) : null;
    }

    private function proxy(): string
    {
        return trim((string) config('branding.certificate_probe'));
    }
}
