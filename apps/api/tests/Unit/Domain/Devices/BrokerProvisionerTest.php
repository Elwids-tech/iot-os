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
    public function test_broker_admin_receives_the_exact_existing_rules(): void
    {
        config(['devices.broker_admin_url' => 'http://private-broker.test', 'devices.broker_admin_token' => 'private-token']);
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

    public function test_broker_admin_failure_is_not_reported_as_provisioned(): void
    {
        config(['devices.broker_admin_url' => 'http://private-broker.test', 'devices.broker_admin_token' => 'private-token']);
        Http::fake(['private-broker.test/*' => Http::response(null, 503)]);
        $this->expectException(HttpException::class);
        (new ReflectionMethod(BrokerProvisioner::class, 'provision'))->invoke(app(BrokerProvisioner::class), 'edge-existing', 'existing-password', []);
    }

    public function test_provisioning_is_refused_without_the_broker_admin_token(): void
    {
        config(['devices.broker_admin_token' => null]);
        Http::fake();
        try {
            (new ReflectionMethod(BrokerProvisioner::class, 'provision'))->invoke(app(BrokerProvisioner::class), 'edge-existing', 'existing-password', []);
            $this->fail('Provisioning without a token must fail.');
        } catch (HttpException $exception) {
            $this->assertSame(503, $exception->getStatusCode());
        }
        Http::assertNothingSent();
    }
}
