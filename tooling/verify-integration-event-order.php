<?php
// Real PostgreSQL concurrency check. Does not change existing organizations.
declare(strict_types=1);
use App\Domain\Shared\Models\{Organization, User};
use App\Domain\Automation\Models\{Alert, Workflow, Deployment};
use App\Domain\Integrations\Services\EventJournal;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
require '/var/www/html/vendor/autoload.php';
$app = require '/var/www/html/bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();
if (!$app->environment('local', 'testing') || DB::getDriverName() !== 'pgsql' || !function_exists('pcntl_fork')) { throw new RuntimeException('Local PostgreSQL with pcntl required.'); }
$org = Organization::create(['name' => 'Temporary journal order check', 'slug' => 'event-order-'.Str::uuid()]);
$prefix = '/tmp/event-order-'.Str::uuid();
$pid = null;
$check = static function ($ok, $message): void { if (!$ok) throw new RuntimeException($message); };
$wait = static function (callable $predicate) use ($check): void {
    $until = microtime(true) + 10;
    while (!$predicate() && microtime(true) < $until) { usleep(20000); }
    $check($predicate(), 'Concurrent journal check timed out.');
};
try {
    $actor = User::where('is_super_admin', true)->firstOrFail();
    $workflow = Workflow::create(['organization_id' => $org->id, 'name' => 'Order fixture', 'workflow' => [], 'definition' => [], 'definition_hash' => str_repeat('a',64), 'updated_by' => $actor->id]);
    $deployment = Deployment::create(['automation_workflow_id' => $workflow->id, 'created_by' => $actor->id, 'created_at' => now(), 'generation' => 1, 'draft_revision' => 1, 'target' => 'active', 'status' => 'applied', 'definition_hash' => str_repeat('a',64), 'definition' => ['binding' => ['device_uuid' => (string) Str::uuid()]]]);
    $ids = [];
    foreach ([1,2] as $episode) { $ids[] = Alert::create(['organization_id' => $org->id, 'automation_workflow_id' => $workflow->id, 'automation_deployment_id' => $deployment->id, 'episode' => $episode])->id; }
    $write = static function (int $id, string $type): void {
        $alert = Alert::whereKey($id)->lockForUpdate()->firstOrFail();
        $alert->update([$type === 'activated' ? 'activated_at' : 'acknowledged_at' => now()]);
        EventJournal::alert($alert, $type);
    };
    config(['database.connections.journal_observer' => config('database.connections.'.config('database.default'))]);
    foreach (['activated', 'acknowledged'] as $round => $type) {
        // Never share an inherited PostgreSQL socket across forked processes.
        foreach (array_keys(DB::getConnections()) as $name) { DB::purge($name); }
        $ready = $prefix.'-'.$round;
        $pid = pcntl_fork();
        if ($pid === -1) { throw new RuntimeException('Could not fork verifier.'); }
        if ($pid === 0) {
            try {
                $wait(fn () => file_exists($ready.'-parent'));
                DB::transaction(function () use ($ids, $type, $write, $ready): void {
                    Alert::whereKey($ids[1])->lockForUpdate()->firstOrFail();
                    file_put_contents($ready.'-child', 'ready');
                    $write($ids[1], $type);
                });
                file_put_contents($ready.'-done', 'done');
                exit(0);
            } catch (Throwable) { file_put_contents($ready.'-error', 'failed'); exit(1); }
        }
        DB::beginTransaction();
        $write($ids[0], $type);
        file_put_contents($ready.'-parent', 'ready');
        $wait(fn () => file_exists($ready.'-child'));
        usleep(300000);
        $check(!file_exists($ready.'-done'), 'A later writer bypassed the tenant stream lock.');
        $visible = (int) DB::connection('journal_observer')->table('integration_streams')->where('organization_id', $org->id)->value('sequence');
        $check($visible === ($round === 0 ? 0 : 2), 'An uncommitted checkpoint became visible.');
        $round === 0 ? DB::commit() : DB::rollBack();
        $wait(fn () => file_exists($ready.'-done') || file_exists($ready.'-error'));
        pcntl_waitpid($pid, $status); $pid = null;
        $check(pcntl_wexitstatus($status) === 0, 'Concurrent writer failed.');
    }
    $sequences = DB::table('integration_events')->where('organization_id', $org->id)->orderBy('sequence')->pluck('sequence')->map(fn ($n) => (int) $n)->all();
    $check($sequences === [1,2,3], 'Rollback or concurrency skipped a committed event.');
    echo "PASS PostgreSQL journal: concurrent writers wait for commit; readers see committed checkpoints only; rollback leaves no lost sequence.\n";
} finally {
    if ($pid) { posix_kill($pid, SIGTERM); pcntl_waitpid($pid, $status); }
    while (DB::transactionLevel()) { DB::rollBack(); }
    DB::table('integration_events')->where('organization_id', $org->id)->delete();
    DB::table('integration_streams')->where('organization_id', $org->id)->delete();
    Alert::where('organization_id', $org->id)->delete();
    if (isset($deployment)) Deployment::whereKey($deployment->id)->delete();
    if (isset($workflow)) Workflow::whereKey($workflow->id)->delete();
    $org->forceDelete();
    foreach (glob($prefix.'-*') as $file) { unlink($file); }
    echo "Temporary ordering records removed.\n";
}
