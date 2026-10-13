<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Integrations;

use App\Domain\Automation\Models\Alert;
use App\Domain\Automation\Models\Deployment;
use App\Domain\Automation\Models\Workflow;
use App\Domain\Automation\Services\AlertProjector;
use App\Domain\Devices\Models\Device;
use App\Domain\Integrations\Models\IntegrationApplication;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Tests\TestCase;

final class EventJournalTest extends TestCase
{
    use RefreshDatabase;

    private Organization $org;

    private Workflow $workflow;

    private Deployment $deployment;

    private IntegrationApplication $application;

    private User $admin;

    private string $token;

    private string $url;

    protected function setUp(): void
    {
        parent::setUp();
        $this->seed(DatabaseSeeder::class);
        $this->org = Organization::where('slug', 'acme-manufacturing')->firstOrFail();
        $actor = User::where('is_super_admin', true)->firstOrFail();
        $this->admin = $actor;
        $device = Device::create(['organization_id' => $this->org->id, 'code' => 'events', 'name' => 'Event tag']);
        $this->workflow = Workflow::create(['organization_id' => $this->org->id, 'name' => 'Boundary', 'workflow' => [], 'definition' => [], 'definition_hash' => str_repeat('a', 64), 'updated_by' => $actor->id]);
        $this->deployment = Deployment::create(['automation_workflow_id' => $this->workflow->id, 'created_by' => $actor->id, 'created_at' => now(), 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'status' => 'applied', 'definition_hash' => str_repeat('a', 64), 'definition' => ['binding' => ['device_uuid' => $device->uuid]]]);
        $this->application = IntegrationApplication::create(['organization_id' => $this->org->id, 'name' => 'Consumer', 'abilities' => ['events:read', 'alerts:read'], 'device_uuids' => [$device->uuid]])->fresh();
        $this->token = $this->credential();
        $this->url = '/api/integration/v1/organizations/'.$this->org->uuid.'/events';
    }

    private function credential(array $abilities = ['events:read', 'alerts:read']): string
    {
        $secret = Str::random(40);
        $token = $this->application->tokens()->create(['name' => 'test', 'token' => hash('sha256', $secret), 'abilities' => $abilities, 'expires_at' => now()->addDay()]);

        return $token->id.'|'.$secret;
    }

    /** A person signs in with a session; an integration application presents its token. */
    private function api(string $path, User|string|null $actor = null, string $method = 'GET', array $body = [])
    {
        Auth::forgetGuards();

        return $actor instanceof User
            ? $this->withoutToken()->actingAs($actor)->json($method, $path, $body)
            : $this->withToken($actor ?? $this->token)->json($method, $path, $body);
    }

    private function emit(string $type, int $episode = 1): void
    {
        DB::transaction(function () use ($type, $episode): void {
            Workflow::whereKey($this->workflow->id)->lockForUpdate()->firstOrFail();
            app(AlertProjector::class)->project($this->workflow, $this->deployment, ['id' => hash('sha256', $type.$episode), 'episode' => $episode, 'type' => $type, 'occurred_at' => now()->toIso8601String()]);
        });
    }

    public function test_atomic_projection_replay_and_acknowledgement(): void
    {
        try {
            DB::transaction(function (): void {
                $this->emit('activated');
                throw new \RuntimeException('rollback');
            });
        } catch (\RuntimeException) {
        }
        $this->assertDatabaseCount('integration_events', 0);
        $this->assertDatabaseCount('integration_streams', 0);
        $this->emit('activated');
        $this->emit('activated');
        $checkpoint = $this->api($this->url.'/checkpoint')->assertOk()->json('cursor');
        $alert = Alert::firstOrFail();
        $ack = '/api/v1/organizations/'.$this->org->uuid.'/alerts/'.$alert->uuid.'/acknowledge';
        $this->api($ack, $this->admin, 'POST')->assertOk();
        $this->api($ack, $this->admin, 'POST')->assertOk();
        $this->emit('cleared');
        $this->assertDatabaseCount('integration_events', 3);
        $first = $this->api($this->url.'?limit=1')->assertOk()->assertJsonPath('has_more', true)->assertJsonPath('data.0.type', 'alert.activated.v1')->json();
        $this->api($this->url.'?limit=1')->assertJsonPath('data.0.id', $first['data'][0]['id']);
        $second = $this->api($this->url.'?cursor='.urlencode($first['next_cursor']).'&limit=1')->assertJsonPath('data.0.type', 'alert.acknowledged.v1')->json();
        $third = $this->api($this->url.'?cursor='.urlencode($second['next_cursor']))->assertJsonPath('has_more', false)->assertJsonPath('data.0.data.condition', 'cleared')->json();
        $this->assertNotNull($third['data'][0]['data']['acknowledged_at']);
        $this->api($this->url.'?cursor='.urlencode($third['next_cursor']))->assertJsonCount(0, 'data');
        $this->api($this->url.'?cursor='.urlencode($checkpoint))->assertJsonCount(2, 'data');
    }

    public function test_late_activation_does_not_reopen_the_public_snapshot(): void
    {
        $this->emit('cleared');
        $this->emit('activated');
        $this->api($this->url)->assertJsonCount(2, 'data')->assertJsonPath('data.0.data.condition', 'cleared')->assertJsonPath('data.1.data.condition', 'cleared');
    }

    public function test_cursor_is_application_bound_and_grant_changes_require_rebuild(): void
    {
        $this->emit('activated');
        $cursor = $this->api($this->url)->json('next_cursor');
        $this->api($this->url.'?cursor=invalid')->assertUnprocessable();
        $manage = '/api/v1/organizations/'.$this->org->uuid.'/applications/'.$this->application->uuid;
        $rotated = $this->api($manage.'/token', $this->admin, 'POST', ['revision' => 1, 'abilities' => ['events:read', 'alerts:read'], 'expires_in_days' => 1])->assertCreated()->json('data');
        $this->token = $rotated['token'];
        $this->api($this->url.'?cursor='.urlencode($cursor))->assertOk()->assertJsonCount(0, 'data');
        $this->api($manage, $this->admin, 'PUT', ['revision' => 2, 'name' => 'Changed', 'abilities' => ['events:read', 'alerts:read'], 'device_uuids' => $this->application->device_uuids])->assertOk();
        $this->application->refresh();
        $this->token = $this->credential();
        $this->api($this->url.'?cursor='.urlencode($cursor))->assertConflict();
        $other = $this->application->replicate(['uuid']);
        $other->name = 'Other';
        $other->save();
        $this->application = $other;
        $this->token = $this->credential();
        $this->api($this->url.'?cursor='.urlencode($cursor))->assertUnprocessable();
    }

    public function test_hidden_device_events_are_skipped_and_current_permissions_apply(): void
    {
        $hidden = Device::create(['organization_id' => $this->org->id, 'code' => 'hidden', 'name' => 'Hidden']);
        $original = $this->deployment;
        $this->deployment = $original->replicate(['uuid']);
        $this->deployment->fill(['created_at' => now(), 'generation' => 2, 'definition' => ['binding' => ['device_uuid' => $hidden->uuid]]])->save();
        $this->emit('activated');
        $cursor = $this->api($this->url)->assertJsonCount(0, 'data')->assertJsonPath('has_more', false)->json('next_cursor');
        $this->deployment = $original;
        $this->emit('activated', 2);
        $this->api($this->url.'?cursor='.urlencode($cursor))->assertJsonCount(1, 'data')->assertJsonPath('data.0.data.episode', 2);
        $this->api($this->url, $this->credential(['events:read']))->assertForbidden();
        $this->api($this->url, $this->credential(['alerts:read']))->assertForbidden();
        $this->application->update(['revoked_at' => now()]);
        $this->api($this->url)->assertUnauthorized();
    }
}
