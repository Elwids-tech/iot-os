<?php

declare(strict_types=1);

namespace Tests\Support\Agents;

use App\Domain\Agents\Enums\AccessLevel;
use App\Domain\Agents\Models\AgentConnection;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Support\Str;
use Laravel\Passport\Client;
use Laravel\Passport\ClientRepository;
use Laravel\Passport\Passport;

/** Builds agent clients, connections and Passport tokens the way sign-in does. */
trait AgentFixtures
{
    /** @var array{private: string, public: string}|null */
    private static ?array $passportKeys = null;

    /** Throwaway signing keys for Passport, made once per test process; nothing is written to disk. */
    protected function usePassportTestKeys(): void
    {
        if (self::$passportKeys === null) {
            $key = openssl_pkey_new(['private_key_bits' => 2048, 'private_key_type' => OPENSSL_KEYTYPE_RSA]);
            openssl_pkey_export($key, $private);
            self::$passportKeys = ['private' => $private, 'public' => openssl_pkey_get_details($key)['key']];
        }
        config(['passport.private_key' => self::$passportKeys['private'], 'passport.public_key' => self::$passportKeys['public']]);
    }

    protected function agentClient(string $name = 'Claude', string $redirect = 'https://claude.ai/api/mcp/auth_callback'): Client
    {
        return app(ClientRepository::class)->createAuthorizationCodeGrantClient($name, [$redirect], false);
    }

    protected function agentConnection(User $user, Organization $organization, AccessLevel $level = AccessLevel::READ, ?Client $client = null): AgentConnection
    {
        return AgentConnection::create([
            'user_id' => $user->id,
            'organization_id' => $organization->id,
            'oauth_client_id' => ($client ?? $this->agentClient())->id,
            'access_level' => $level,
            'expires_at' => now()->addDays((int) config('agents.connection_idle_days')),
        ]);
    }

    /** @return array{access: string, refresh: string} the stored ids of a token pair for the connection's client */
    protected function agentTokenRows(User $user, string $clientId): array
    {
        $access = Str::random(80);
        Passport::token()->forceFill(['id' => $access, 'user_id' => $user->id, 'client_id' => $clientId, 'scopes' => ['mcp:use'], 'revoked' => false, 'expires_at' => now()->addHour()])->save();
        $refresh = Str::random(80);
        Passport::refreshToken()->forceFill(['id' => $refresh, 'access_token_id' => $access, 'revoked' => false, 'expires_at' => now()->addDays(90)])->save();

        return ['access' => $access, 'refresh' => $refresh];
    }
}
