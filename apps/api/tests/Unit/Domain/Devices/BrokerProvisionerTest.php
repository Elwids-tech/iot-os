<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Devices;

use App\Domain\Devices\Services\BrokerProvisioner;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use ReflectionMethod;
use Tests\TestCase;

final class BrokerProvisionerTest extends TestCase
{
    public function test_existing_credentials_and_rules_are_updated_idempotently(): void
    {
        config(['devices.emqx_url' => 'http://broker.test/api/v5', 'devices.emqx_key' => 'key', 'devices.emqx_secret' => 'secret']);
        Http::fakeSequence()
            ->push([], 409)
            ->push([], 204)
            ->push([], 409)
            ->push([], 204);

        $method = new ReflectionMethod(BrokerProvisioner::class, 'provision');
        $method->invoke(app(BrokerProvisioner::class), 'existing-user', 'new-password', [
            ['permission' => 'allow', 'action' => 'publish', 'topic' => 'demo/#'],
        ]);

        Http::assertSentCount(4);
        Http::assertSent(fn (Request $request): bool => $request->method() === 'PUT'
            && $request->url() === 'http://broker.test/api/v5/authentication/password_based:built_in_database/users/existing-user'
            && $request['password'] === 'new-password');
        Http::assertSent(fn (Request $request): bool => $request->method() === 'PUT'
            && $request->url() === 'http://broker.test/api/v5/authorization/sources/built_in_database/rules/users/existing-user'
            && $request['username'] === 'existing-user'
            && $request['rules'][0]['topic'] === 'demo/#'
            && $request['rules'][1]['permission'] === 'deny');
    }
}
