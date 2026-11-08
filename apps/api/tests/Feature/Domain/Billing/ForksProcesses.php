<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Billing;

use Illuminate\Database\Connection;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;
use Throwable;

/**
 * Runs work in forked processes, each on its own database connection, to prove that
 * row locks hold under real concurrency (spec 028 SC-002, spec 029 SC-003). PostgreSQL
 * only: SQLite has no row locks. `RefreshDatabase` keeps the default connection in a
 * transaction the children cannot see, so rows they read go in through
 * `committedConnection()`, and the test deletes them afterwards.
 */
trait ForksProcesses
{
    protected function skipUnlessForkable(): void
    {
        if (DB::getDriverName() !== 'pgsql' || ! function_exists('pcntl_fork')) {
            $this->markTestSkipped('Needs PostgreSQL row locks and pcntl.');
        }
    }

    /** A connection outside the test's transaction, whose writes the children see. */
    protected function committedConnection(): Connection
    {
        $base = config('database.connections.'.config('database.default'));
        config(['database.connections.fork_setup' => $base, 'database.connections.fork_child' => $base]);

        return DB::connection('fork_setup');
    }

    /**
     * Forks `$processes` children. Each runs `$work($index, $ready)` on a fresh connection,
     * calling `$ready()` once prepared so that all of them start together, and returns a
     * string; an exception becomes "error: …". The outputs come back in index order.
     *
     * @param  callable(int, callable(): void): string  $work
     * @return list<string>
     */
    protected function inForkedProcesses(int $processes, callable $work): array
    {
        DB::connection('fork_setup')->disconnect();
        $directory = sys_get_temp_dir().'/forked-'.Str::uuid();
        mkdir($directory);
        $start = microtime(true) + 1.0;
        $children = [];

        try {
            for ($i = 0; $i < $processes; $i++) {
                $pid = pcntl_fork();

                if ($pid === 0) {
                    $this->runChild($directory.'/'.$i, $i, $work, $start);
                }

                $children[] = $pid;
            }

            foreach ($children as $pid) {
                pcntl_waitpid($pid, $status);
            }

            return array_map(fn (int $i): string => (string) @file_get_contents($directory.'/'.$i), range(0, $processes - 1));
        } finally {
            array_map('unlink', glob($directory.'/*') ?: []);
            rmdir($directory);
            DB::connection('fork_setup')->reconnect();
        }
    }

    /**
     * Runs in a forked child: its own connection, the parent's left untouched, and a
     * SIGKILL at the end so no destructor closes the parent's inherited sockets.
     */
    private function runChild(string $file, int $index, callable $work, float $start): never
    {
        try {
            DB::setDefaultConnection('fork_child');
            DB::connection('fork_child')->getPdo();
            $output = $work($index, static fn () => time_sleep_until($start));
        } catch (Throwable $exception) {
            $output = 'error: '.$exception->getMessage();
        }

        file_put_contents($file, $output);
        posix_kill(getmypid(), SIGKILL);

        exit(1);
    }
}
