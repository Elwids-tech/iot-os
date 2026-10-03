<?php

declare(strict_types=1);

namespace App\Support;

use App\Domain\Devices\Services\RetentionService;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Http;

final class Operations
{
    private static int $lastHeartbeat = 0;

    public static function heartbeat(?string $name = null): void
    {
        $name ??= config('deployment.worker_name');
        if (! config('deployment.ops_enabled') || ! $name || time() - self::$lastHeartbeat < 15) {
            return;
        }
        DB::table('operation_heartbeats')->updateOrInsert(['name' => $name], ['seen_at' => time()]);
        self::$lastHeartbeat = time();
    }

    public function ready(): bool
    {
        try {
            DB::select('SELECT 1');

            return Http::timeout(3)->get(rtrim(config('devices.runtime_url'), '/').'/health/ready')->successful();
        } catch (\Throwable) {
            return false;
        }
    }

    public function metrics(): string
    {
        $lines = [];
        $gauge = static function (string $name, int|float $value, string $labels = '') use (&$lines): void {
            $lines[] = "iot_{$name}{$labels} $value";
        };
        $gauge('failed_jobs', DB::table('failed_jobs')->count());
        $http = DB::table('operation_http_buckets')->where('minute', '>=', intdiv(time(), 60) * 60 - 240)
            ->selectRaw('status_class, SUM(requests) AS requests, SUM(duration_seconds) AS duration')->groupBy('status_class')->get()->keyBy('status_class');
        foreach ([2, 3, 4, 5] as $class) {
            $gauge('http_requests_window', (int) ($http[$class]->requests ?? 0), '{status_class="'.$class.'xx"}');
            $gauge('http_duration_window_seconds', (float) ($http[$class]->duration ?? 0), '{status_class="'.$class.'xx"}');
        }
        foreach (['default', 'alerts', 'assistant'] as $queue) {
            $query = DB::table('jobs')->where('queue', $queue);
            $gauge('queue_depth', (clone $query)->count(), '{queue="'.$queue.'"}');
            $oldest = (clone $query)->min('created_at');
            $gauge('queue_oldest_seconds', $oldest ? max(0, time() - $oldest) : 0, '{queue="'.$queue.'"}');
        }
        foreach (config('deployment.expected_workers') as $worker) {
            $gauge('worker_heartbeat_timestamp_seconds', (int) DB::table('operation_heartbeats')->where('name', $worker)->value('seen_at'), '{worker="'.$worker.'"}');
        }
        $gauge('device_outbox_pending', DB::table('device_outbox')->whereNull('published_at')->count());
        $gauge('commands_uncertain', DB::table('device_commands')->where('status', 'uncertain')->count());
        $gauge('retention_cleanup_failures', app(RetentionService::class)->inspection()['cleanup_failures']);
        $gauge('commands_pending', DB::table('device_commands')->whereNotNull('outstanding_key')->count());
        foreach (['accepted', 'dispatched', 'succeeded', 'observed_at_target', 'failed', 'expired', 'uncertain', 'cancelled'] as $status) {
            $gauge('automation_actions', DB::table('automation_actions')->where('status', $status)->count(), '{status="'.$status.'"}');
        }
        $oldestAction = DB::table('automation_actions')->whereIn('status', ['accepted', 'dispatched'])->min('created_at');
        $gauge('automation_oldest_pending_seconds', $oldestAction ? max(0, time() - strtotime($oldestAction)) : 0);
        $gauge('automation_uncertain_targets', DB::table('automation_command_targets')->whereNotNull('uncertain_command_uuid')->count());
        $gauge('simulator_expected_devices', config('deployment.expected_simulators'));
        $budget = DB::table('assistant_budgets')->where('day', gmdate('Y-m-d'))->first();
        $gauge('assistant_daily_budget_usd', (float) config('assistant.daily_budget_usd'));
        $gauge('assistant_enabled', (int) config('assistant.enabled'));
        $gauge('assistant_spent_usd', (float) ($budget->spent_usd ?? 0));
        $gauge('assistant_reserved_usd', (float) ($budget->reserved_usd ?? 0));
        if (DB::getDriverName() === 'pgsql') {
            $gauge('postgres_connections', (int) DB::selectOne('SELECT COUNT(*) AS count FROM pg_stat_activity')->count);
            $gauge('postgres_database_bytes', (int) DB::selectOne('SELECT pg_database_size(current_database()) AS size')->size);
            // Aggregate across configured simulators: one healthy source must not hide a stalled one.
            $freshness = DB::selectOne("SELECT COALESCE(MIN(COALESCE(latest.seen, 0)), 0) AS oldest, COUNT(*) AS devices FROM public.devices d LEFT JOIN LATERAL (SELECT EXTRACT(EPOCH FROM MAX(received_at)) AS seen FROM device_runtime.latest l WHERE l.device_uuid=d.uuid AND l.configuration_uuid=d.applied_configuration_uuid) latest ON true WHERE d.applied_configuration_uuid IS NOT NULL AND d.reserved_source_uuid IN (SELECT c.uuid FROM public.device_discovery_candidates c JOIN public.sparkplug_gateways g ON g.id=c.sparkplug_gateway_id WHERE g.edge_node_id LIKE 'simulator-%')");
            $gauge('simulator_oldest_observation_timestamp_seconds', (float) $freshness->oldest);
            $gauge('simulator_active_devices', (int) $freshness->devices);
            foreach (['outbox', 'telemetry_outbox'] as $table) {
                $gauge('runtime_outbox_pending', DB::table('device_runtime.'.$table)->whereNull('published_at')->count(), '{stream="'.$table.'"}');
            }
            $gauge('workflow_executions', DB::table('device_runtime.rule_executions')->where('enabled', true)->count());
            $gauge('dag_executions', DB::table('device_runtime.dag_executions')->where('enabled', true)->count());
            $gauge('dag_due_timers', DB::table('device_runtime.dag_executions')->where('enabled', true)->where('next_timer', '<=', now())->count());
            $oldestTimer = DB::table('device_runtime.dag_executions')->where('enabled', true)->min('next_timer');
            $gauge('dag_oldest_timer_seconds', $oldestTimer ? max(0, time() - strtotime($oldestTimer)) : 0);
            $gauge('dag_suspended', (int) DB::selectOne("SELECT count(*) AS count FROM (SELECT DISTINCT ON (workflow_uuid) enabled, stopped_reason FROM device_runtime.dag_executions ORDER BY workflow_uuid, started_at DESC) latest WHERE NOT enabled AND stopped_reason NOT IN ('disabled', 'superseded')")->count);
            try {
                $health = Http::withToken(config('devices.runtime_token'))->timeout(2)
                    ->get(rtrim(config('devices.runtime_url'), '/').'/internal/dag/health')->throw()->json();
                $gauge('dag_consumer_healthy', (int) ($health['consumer_healthy'] ?? false));
            } catch (\Throwable) {
                $gauge('dag_consumer_healthy', 0);
            }
        }
        try {
            $nats = Http::timeout(3)->get('http://nats:8222/jsz', ['accounts' => 'true', 'streams' => 'true', 'consumers' => 'true', 'config' => 'true'])->throw()->json();
            $gauge('nats_monitor_up', 1);
            $gauge('nats_store_bytes', (int) ($nats['storage'] ?? 0));
            $gauge('nats_store_limit_bytes', (int) ($nats['config']['max_storage'] ?? 0));
            $pending = 0;
            $unmanagedPending = 0;
            $expectedConsumers = [
                'IOT_DEVICE_CONTROL' => 'devices-control',
                'IOT_DEVICE_EVENTS' => 'devices-control-inbox',
                'IOT_DEVICE_TELEMETRY' => 'devices-storage',
                'IOT_COMMITTED_TELEMETRY' => 'workflow-evaluator-v1',
            ];
            foreach ($nats['account_details'] ?? [] as $account) {
                foreach ($account['stream_detail'] ?? [] as $stream) {
                    // Fixed platform streams only: never export arbitrary tenant labels.
                    if (in_array($stream['name'] ?? '', ['IOT_DEVICE_CONTROL', 'IOT_DEVICE_TELEMETRY', 'IOT_COMMITTED_TELEMETRY', 'IOT_DEVICE_EVENTS'], true)) {
                        $labels = '{stream="'.$stream['name'].'"}';
                        $gauge('nats_stream_bytes', (int) ($stream['state']['bytes'] ?? 0), $labels);
                        $gauge('nats_stream_limit_bytes', (int) ($stream['config']['max_bytes'] ?? 0), $labels);
                    }
                    foreach ($stream['consumer_detail'] ?? [] as $consumer) {
                        $count = ($consumer['num_pending'] ?? 0) + ($consumer['num_ack_pending'] ?? 0);
                        if (($expectedConsumers[$stream['name'] ?? ''] ?? null) === ($consumer['name'] ?? '')) {
                            $pending += $count;
                        } else {
                            $unmanagedPending += $count;
                        }
                    }
                }
            }
            $gauge('nats_consumer_pending', $pending);
            $gauge('nats_unmanaged_consumer_pending', $unmanagedPending);
        } catch (\Throwable) {
            $gauge('nats_monitor_up', 0);
        }

        return implode("\n", $lines)."\n";
    }
}
