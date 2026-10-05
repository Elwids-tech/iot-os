<?php

declare(strict_types=1);

namespace Tests\Unit\Domain\Devices;

use App\Domain\Devices\Services\BrokerProvisioner;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use ReflectionMethod;
use Symfony\Component\HttpKernel\Exception\HttpException;
use Tests\TestCase;

final class BrokerProvisionerTest extends TestCase
{
    public function test_mosquitto_uses_private_adapter_with_exact_existing_rules(): void
    {
        config(['devices.broker_provider' => 'mosquitto', 'devices.broker_admin_url' => 'http://private-broker.test', 'devices.broker_admin_token' => 'private-token']);
        Http::fake(['private-broker.test/*' => Http::response(null, 204)]);
        $rules = [['permission' => 'allow', 'action' => 'subscribe', 'topic' => 'spBv1.0/tenant/NBIRTH/+']];
        (new ReflectionMethod(BrokerProvisioner::class, 'provision'))->invoke(app(BrokerProvisioner::class), 'host-existing', 'existing-password', $rules);
        Http::assertSentCount(1);
        Http::assertSent(fn (Request $request): bool => $request->method() === 'PUT'
            && $request->url() === 'http://private-broker.test/clients'
            && $request->hasHeader('Authorization', 'Bearer private-token')
            && $request['password'] === 'existing-password'
            && $request['rules'] === $rules);
    }

    public function test_mosquitto_failure_is_not_reported_as_provisioned(): void
    {
        config(['devices.broker_provider' => 'mosquitto', 'devices.broker_admin_url' => 'http://private-broker.test', 'devices.broker_admin_token' => 'private-token']);
        Http::fake(['private-broker.test/*' => Http::response(null, 503)]);
        $this->expectException(HttpException::class);
        (new ReflectionMethod(BrokerProvisioner::class, 'provision'))->invoke(app(BrokerProvisioner::class), 'edge-existing', 'existing-password', []);
    }

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
