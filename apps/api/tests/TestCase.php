<?php

namespace Tests;

use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\ConfigurationUrlParser;

abstract class TestCase extends BaseTestCase
{
    public function createApplication()
    {
        $app = parent::createApplication();
        $connection = $app['config']->get('database.default');
        // Resolve DB_URL the way the database manager will, so a URL cannot point the suite elsewhere.
        $config = (new ConfigurationUrlParser)->parseConfiguration($app['config']->get("database.connections.{$connection}", []));
        $database = (string) ($config['database'] ?? '');
        $isolated = match ($config['driver'] ?? null) {
            'sqlite' => $database === ':memory:',
            // RefreshDatabase drops every table, so only a dedicated *_test database is acceptable.
            'pgsql' => str_ends_with($database, '_test'),
            default => false,
        };
        if (! $isolated) {
            throw new \LogicException("Tests must use the in-memory SQLite database or a PostgreSQL database whose name ends in _test, not [{$connection}] database [{$database}]. Clear cached configuration before testing.");
        }

        return $app;
    }

    /**
     * PostgreSQL jsonb does not keep object key order, so compare stored documents
     * with keys sorted. List order and scalar types must still match exactly.
     */
    protected function assertSameJsonDocument(mixed $expected, mixed $actual, string $message = ''): void
    {
        $this->assertSame($this->sortObjectKeys($expected), $this->sortObjectKeys($actual), $message);
    }

    private function sortObjectKeys(mixed $value): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        if (! array_is_list($value)) {
            ksort($value, SORT_STRING);
        }

        return array_map(fn (mixed $item): mixed => $this->sortObjectKeys($item), $value);
    }
}
