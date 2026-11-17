<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Notifications;

use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Notifications\Services\AlertPushPayload;
use App\Domain\Shared\Models\Organization;
use Carbon\CarbonImmutable;
use Tests\Support\AssertsContracts;
use Tests\TestCase;

/** The push body matches contracts/push/v1/alert-push.v1 (spec 033, principle IV). */
final class AlertPushPayloadTest extends TestCase
{
    use AssertsContracts;

    private const SCHEMA = 'push/v1/alert-push.v1.schema.json';

    public function test_an_activation_is_the_golden_fixture(): void
    {
        $fixture = json_decode((string) file_get_contents(self::contractsRoot().'/push/v1/alert-push.v1.fixture.json'), true);
        [$alert, $organization] = $this->alert($fixture);

        $payload = AlertPushPayload::transition($alert, $organization, 'activated', $fixture['alert']['device']);

        $this->assertSame($fixture, $payload);
        $this->assertProduced(self::SCHEMA, $payload);
        $this->assertSame(['TTL' => 86400, 'urgency' => 'high', 'topic' => str_replace('-', '', $fixture['alert']['uuid'])], AlertPushPayload::options($payload));
    }

    public function test_every_builder_produces_a_valid_body(): void
    {
        $fixture = json_decode((string) file_get_contents(self::contractsRoot().'/push/v1/alert-push.v1.fixture.json'), true);
        [$alert, $organization] = $this->alert($fixture);
        $alert->cleared_at = CarbonImmutable::parse('2026-11-21T02:31:40Z');
        $at = CarbonImmutable::parse('2026-11-21T02:15:03Z');

        $cleared = AlertPushPayload::transition($alert, $organization, 'cleared', null);
        $summary = AlertPushPayload::summary($organization, 7, $at);
        $test = AlertPushPayload::test($at);

        foreach ([$cleared, $summary, $test] as $payload) {
            $this->assertProduced(self::SCHEMA, $payload);
        }
        $this->assertSame(['cleared', null, '2026-11-21T02:31:40Z'], [$cleared['kind'], $cleared['alert']['device'], $cleared['occurred_at']]);
        $this->assertSame('normal', AlertPushPayload::options($cleared)['urgency']);
        $this->assertSame(str_replace('-', '', (string) $organization->uuid), AlertPushPayload::options($summary)['topic']);
        $this->assertArrayNotHasKey('topic', AlertPushPayload::options($test));
        $this->assertSame('/organizations/'.$organization->uuid.'/alerts?condition=active&acknowledged=0', $summary['url']);
    }

    public function test_long_names_are_cut_and_the_body_stays_small(): void
    {
        $fixture = json_decode((string) file_get_contents(self::contractsRoot().'/push/v1/alert-push.v1.fixture.json'), true);
        [$alert, $organization] = $this->alert($fixture);
        $alert->workflow->name = str_repeat('Long automation name ', 20);
        $organization->name = str_repeat('Organization ', 30);

        $payload = AlertPushPayload::transition($alert, $organization, 'activated', str_repeat('Device ', 40));

        $this->assertSame(120, mb_strlen($payload['alert']['automation']));
        $this->assertSame(120, mb_strlen($payload['organization']['name']));
        $this->assertSame(120, mb_strlen($payload['alert']['device']));
        $this->assertLessThan(2048, strlen(json_encode($payload)));
        $this->assertProduced(self::SCHEMA, $payload);
    }

    /** @return array{Alert, Organization} */
    private function alert(array $fixture): array
    {
        $organization = new Organization;
        $organization->forceFill(['uuid' => $fixture['organization']['uuid'], 'name' => $fixture['organization']['name']]);
        $alert = new Alert;
        $alert->forceFill(['uuid' => $fixture['alert']['uuid'], 'severity' => 'warning', 'activated_at' => CarbonImmutable::parse($fixture['occurred_at'])]);
        $alert->setRelation('workflow', (new Workflow)->forceFill(['name' => $fixture['alert']['automation']]));

        return [$alert, $organization];
    }
}
