<?php

declare(strict_types=1);

namespace App\Domain\Integrations\Services;

class WebhookDestination
{
    public function target(string $url): array
    {
        if (app()->environment('local', 'testing') && config('webhooks.local_sink_enabled') && $url === 'http://webhook-sink:8080/events') {
            return ['host' => 'webhook-sink', 'port' => 8080, 'ip' => null, 'local' => true];
        }
        $parts = parse_url($url);
        $host = strtolower($parts['host'] ?? '');
        $valid = is_array($parts) && ($parts['scheme'] ?? '') === 'https' && ($parts['port'] ?? 443) === 443 && ! isset($parts['user'], $parts['pass']) && ! isset($parts['user']) && ! isset($parts['pass']) && ! isset($parts['query']) && ! isset($parts['fragment']) && preg_match('/^(?=.{1,253}$)[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/D', $host) && str_contains($host, '.') && ! filter_var($host, FILTER_VALIDATE_IP) && ! preg_match('/[\x00-\x20\\\\]/', $url);
        if (! $valid || ! in_array($host, config('webhooks.allowed_hosts', []), true)) {
            throw new \InvalidArgumentException('Webhook requires an operator-approved HTTPS host on port 443 without credentials, query or fragment.');
        }
        $ips = $this->resolve($host);
        if (! $ips || count($ips) > 32) {
            throw new \InvalidArgumentException('Webhook destination did not resolve to permitted IPv4 addresses.');
        }
        foreach ($ips as $ip) {
            if (! $this->publicIpv4($ip)) {
                throw new \InvalidArgumentException('Webhook destination resolves to a non-public address.');
            }
        }

        return ['host' => $host, 'port' => 443, 'ip' => $ips[0], 'local' => false];
    }

    protected function resolve(string $host): array
    {
        return gethostbynamel($host) ?: [];
    }

    private function publicIpv4(string $ip): bool
    {
        if (! filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_IPV4 | FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            return false;
        }
        $value = (int) sprintf('%u', ip2long($ip));
        foreach (['0.0.0.0/8', '100.64.0.0/10', '192.0.0.0/24', '192.0.2.0/24', '198.18.0.0/15', '198.51.100.0/24', '203.0.113.0/24', '224.0.0.0/4', '240.0.0.0/4'] as $range) {
            [$network,$bits] = explode('/', $range);
            $mask = (0xFFFFFFFF << (32 - (int) $bits)) & 0xFFFFFFFF;
            if (($value & $mask) === (ip2long($network) & $mask)) {
                return false;
            }
        }

        return true;
    }
}
