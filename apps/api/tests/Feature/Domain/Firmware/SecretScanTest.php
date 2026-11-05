<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Firmware;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Routing\Middleware\ThrottleRequests;
use Tests\TestCase;

/** Starters hold no credentials, connection details or tenant identity (spec 027 FR-004, SC-005). */
final class SecretScanTest extends TestCase
{
    use FirmwareTestSupport, RefreshDatabase;

    protected function setUp(): void
    {
        parent::setUp();
        $this->setUpFirmware();
    }

    protected function tearDown(): void
    {
        $this->tearDownFirmware();
        parent::tearDown();
    }

    public function test_no_starter_contains_a_credential_or_identity(): void
    {
        $this->withoutMiddleware(ThrottleRequests::class);
        $relay = $this->publish('relay')[1];
        $water = $this->publish('water-meter')[0];
        $gateway = $this->gateway();
        $direct = $this->directDevice($relay);
        $secrets = [...$this->secrets($gateway), ...$this->secrets($direct['gateway']), $direct['device']->code];
        $targets = $this->getJson($this->prefix.'/firmware/targets')->json('data');
        // Every built project is scanned, board files and port sources included.
        $this->assertSame(['esp32-esp-idf', 'nxp-imxrt1050-mcuxpresso', 'linux'], array_column(array_filter($targets, fn (array $target): bool => $target['kind'] === 'built'), 'id'));

        foreach ($targets as $target) {
            foreach ([
                ['target' => $target['id'], 'role' => 'direct', 'node_artifact_uuid' => $relay],
                ['target' => $target['id'], 'role' => 'gateway', 'device_type_artifact_uuids' => [$water], 'gateway_uuid' => $gateway->uuid],
            ] as $body) {
                $files = $this->unzip($this->postJson($this->prefix.'/firmware/starters', $body)->assertOk()->json('data.archive_base64'));
                foreach ($files as $path => $contents) {
                    $this->assertStringNotContainsString('sample-config/', $path);
                    if (str_contains($path, '/sdk/third_party/')) {
                        continue;
                    }
                    foreach ($secrets as $secret) {
                        $this->assertStringNotContainsString($secret, $contents, $target['id'].' '.$body['role'].': '.$path);
                    }
                }
            }
        }
    }
}
