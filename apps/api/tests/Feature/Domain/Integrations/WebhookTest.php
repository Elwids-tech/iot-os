<?php
declare(strict_types=1);
namespace Tests\Feature\Domain\Integrations;
use App\Domain\Automation\Models\{Alert,Workflow,Deployment};
use App\Domain\Devices\Models\Device;
use App\Domain\Integrations\Models\{IntegrationApplication,Webhook,WebhookDelivery};
use App\Domain\Integrations\Services\{EventJournal,WebhookDestination,WebhookDispatch,WebhookTransport};
use App\Domain\Shared\Models\{Organization,User};
use Database\Seeders\DatabaseSeeder;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Illuminate\Support\Facades\{Auth,DB};
use Tests\TestCase;
final class WebhookTest extends TestCase
{
    use RefreshDatabase;
    private Organization $org; private IntegrationApplication $integration; private Alert $alert; private string $token; private string $url;
    protected function setUp(): void
    {
        parent::setUp(); $this->seed(DatabaseSeeder::class);
        $this->org=Organization::where('slug','acme-manufacturing')->firstOrFail();
        $user=User::where('is_super_admin',true)->firstOrFail();
        $this->token=$user->createToken('test')->plainTextToken;
        $device=Device::create(['organization_id'=>$this->org->id,'code'=>'hook','name'=>'Tag']);
        $workflow=Workflow::create(['organization_id'=>$this->org->id,'name'=>'Boundary','workflow'=>[],'definition'=>[],'definition_hash'=>str_repeat('a',64),'updated_by'=>$user->id]);
        $deployment=Deployment::create(['automation_workflow_id'=>$workflow->id,'created_by'=>$user->id,'created_at'=>now(),'generation'=>1,'draft_revision'=>1,'target'=>'active','status'=>'applied','definition_hash'=>str_repeat('a',64),'definition'=>['binding'=>['device_uuid'=>$device->uuid]]]);
        $this->alert=Alert::create(['organization_id'=>$this->org->id,'automation_workflow_id'=>$workflow->id,'automation_deployment_id'=>$deployment->id,'episode'=>1,'activated_at'=>now()]);
        $this->integration=IntegrationApplication::create(['organization_id'=>$this->org->id,'name'=>'Consumer','abilities'=>['events:read','alerts:read'],'device_uuids'=>[$device->uuid]])->fresh();
        $this->url='/api/v1/organizations/'.$this->org->uuid.'/applications/'.$this->integration->uuid.'/webhook';
        config(['webhooks.allowed_hosts'=>['receiver.example.test']]);
        app()->instance(WebhookDestination::class,new class extends WebhookDestination { protected function resolve(string $host): array { return ['8.8.8.8']; } });
    }
    private function api(string $method,string $path,array $body=[])
    {
        Auth::forgetGuards(); return $this->withToken($this->token)->json($method,$path,$body);
    }
    private function configure(): Webhook
    {
        $result=$this->api('PUT',$this->url,['revision'=>0,'url'=>'https://receiver.example.test/events'])->assertOk()->json('data');
        $this->assertStringStartsWith('whsec_',$result['signing_secret']);
        $this->api('GET',$this->url)->assertJsonMissingPath('data.signing_secret')->assertJsonMissingPath('data.secret');
        $hook=Webhook::firstOrFail();
        $this->assertNotSame($result['signing_secret'],DB::table('integration_webhooks')->value('secret'));
        return $hook;
    }
    private function emit(string $change='activated'): void
    {
        DB::transaction(function () use ($change): void { EventJournal::alert($this->alert,$change); });
    }
    public function test_durable_cursor_retry_history_and_logical_identity(): void
    {
        $hook=$this->configure(); $this->emit(); $this->emit();
        $transport=$this->mock(WebhookTransport::class);
        $transport->shouldReceive('send')->once()->andReturn(503);
        $worker=app(WebhookDispatch::class); $worker->tick($hook->id);
        $delivery=WebhookDelivery::firstOrFail(); $uuid=$delivery->uuid;
        $this->assertSame('pending',$delivery->status);
        $this->assertDatabaseCount('integration_webhook_deliveries',1);
        $this->travel(11)->seconds();
        $transport->shouldReceive('send')->once()->withArgs(fn ($url,$target,$body,$id,$secret)=>$id===$uuid && json_decode($body,true)['id']===DB::table('integration_events')->value('uuid'))->andReturn(204);
        $worker->tick($hook->id); $worker->tick($hook->id);
        $this->assertSame('delivered',$delivery->fresh()->status);
        $this->assertDatabaseCount('integration_webhook_attempts',2);
        $this->api('GET',$this->url.'/deliveries')->assertOk()->assertJsonPath('data.0.history.1.http_status',204);
    }
    public function test_terminal_recovery_is_revision_checked_and_bounded(): void
    {
        $hook=$this->configure(); $this->emit();
        $transport=$this->mock(WebhookTransport::class); $transport->shouldReceive('send')->times(5)->andReturn(null);
        for ($i=0;$i<5;$i++) { app(WebhookDispatch::class)->tick($hook->id); $this->travel(601)->seconds(); }
        $delivery=WebhookDelivery::firstOrFail(); $this->assertSame('failed',$delivery->status);
        $path=$this->url.'/deliveries/'.$delivery->uuid.'/retry';
        $this->api('POST',$path,['retry_revision'=>0])->assertAccepted();
        $this->api('POST',$path,['retry_revision'=>0])->assertConflict();
        $transport->shouldReceive('send')->once()->andReturn(400);
        app(WebhookDispatch::class)->tick($hook->id);
        $this->assertSame('failed',$delivery->fresh()->status); $this->assertSame(6,$delivery->fresh()->attempts);
    }
    public function test_revocation_cancels_pending_and_scope_is_enforced(): void
    {
        $hook=$this->configure(); $this->emit();
        $transport=$this->mock(WebhookTransport::class); $transport->shouldReceive('send')->once()->andReturn(503);
        app(WebhookDispatch::class)->tick($hook->id);
        $other=Organization::where('slug','northstar-utilities')->firstOrFail();
        $this->api('GET',str_replace($this->org->uuid,$other->uuid,$this->url))->assertNotFound();
        $this->api('POST',str_replace('/webhook','/revoke',$this->url),['revision'=>1])->assertOk();
        $this->travel(20)->seconds(); app(WebhookDispatch::class)->tick($hook->id);
        $this->assertSame('cancelled',WebhookDelivery::firstOrFail()->status);
        $this->assertFalse($hook->fresh()->enabled);
    }
    public function test_reconfiguration_skips_old_events_and_cancels_old_revision(): void
    {
        $this->emit(); $hook=$this->configure();
        $transport=$this->mock(WebhookTransport::class); $transport->shouldNotReceive('send');
        app(WebhookDispatch::class)->tick($hook->id); $this->assertDatabaseCount('integration_webhook_deliveries',0);
        $this->api('PUT',$this->url,['revision'=>0,'url'=>'https://receiver.example.test/events'])->assertConflict();
    }
    public function test_destination_policy_rejects_private_mixed_and_unapproved_hosts(): void
    {
        foreach (['http://receiver.example.test/events','https://127.0.0.1/events','https://receiver.example.test:8443/events','https://receiver.example.test/events?token=x','https://user@receiver.example.test/events','https://unapproved.test/events'] as $url) {
            $this->api('PUT',$this->url,['revision'=>0,'url'=>$url])->assertUnprocessable();
        }
        foreach (['127.0.0.1','10.0.0.1','169.254.169.254','100.64.0.1','192.0.2.1','224.0.0.1','::1'] as $ip) {
            $policy=new class($ip) extends WebhookDestination { public function __construct(private string $ip) {} protected function resolve(string $host): array {return ['8.8.8.8',$this->ip];} };
            try { $policy->target('https://receiver.example.test/events'); $this->fail('Private/mixed DNS accepted'); }
            catch (\InvalidArgumentException) { $this->assertTrue(true); }
        }
    }

    public function test_dns_change_is_revalidated_before_network_io(): void
    {
        $hook=$this->configure(); $this->emit();
        app()->instance(WebhookDestination::class,new class extends WebhookDestination { protected function resolve(string $host): array {return ['127.0.0.1'];} });
        $this->mock(WebhookTransport::class)->shouldNotReceive('send');
        app(WebhookDispatch::class)->tick($hook->id);
        $this->assertFalse($hook->fresh()->enabled);
        $this->assertSame('failed',WebhookDelivery::firstOrFail()->status);
        $this->assertDatabaseCount('integration_webhook_attempts',0);
    }
    public function test_expired_pending_delivery_and_manager_permission(): void
    {
        $hook=$this->configure(); $this->emit();
        $this->mock(WebhookTransport::class)->shouldReceive('send')->once()->andReturn(503);
        app(WebhookDispatch::class)->tick($hook->id);
        $this->travel(25)->hours(); app(WebhookDispatch::class)->tick($hook->id);
        $this->assertSame('failed',WebhookDelivery::firstOrFail()->status);
        $member=User::where('email','acme.member@example.test')->firstOrFail();
        $this->token=$member->createToken('member')->plainTextToken;
        $this->api('GET',$this->url)->assertForbidden();
        $this->api('PUT',$this->url,['revision'=>1,'url'=>'https://receiver.example.test/events'])->assertForbidden();
    }
}
