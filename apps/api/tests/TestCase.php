<?php

namespace Tests;

use Illuminate\Foundation\Http\Events\RequestHandled;
use Illuminate\Foundation\Testing\TestCase as BaseTestCase;
use Illuminate\Support\ConfigurationUrlParser;
use ReflectionMethod;
use Tests\Support\Contract\ContractDocument;
use Tests\Support\Contract\CoverageRecorder;
use Tests\Support\Contract\ResponseChecker;
use Tests\Support\Contract\WithoutContractCheck;

abstract class TestCase extends BaseTestCase
{
    protected function setUp(): void
    {
        $this->afterApplicationCreated($this->checkResponsesAgainstContract(...));

        parent::setUp();
    }

    /**
     * Gate G4: every response from an /api/v1 or /api/integration/v1 route is checked
     * against contracts/openapi/openapi.json, and a mismatch fails the test that made the
     * request (tests/Support/Contract). `#[WithoutContractCheck('reason')]` on a test
     * method turns this off for that test. Event::fake() without a list of events would
     * swallow RequestHandled, so fake only the events a test asserts on.
     */
    private function checkResponsesAgainstContract(): void
    {
        $test = static::class.'::'.$this->name();
        $optOut = method_exists($this, $this->name())
            ? ((new ReflectionMethod($this, $this->name()))->getAttributes(WithoutContractCheck::class)[0] ?? null)
            : null;
        if ($optOut !== null) {
            CoverageRecorder::skip($test, $optOut->newInstance()->reason);

            return;
        }

        $this->app['events']->listen(RequestHandled::class, static function (RequestHandled $event) use ($test): void {
            $document = ContractDocument::committed();
            $checked = (new ResponseChecker($document))->check($event->request, $event->response);
            if ($checked === null) {
                return;
            }
            if (! $checked->passed()) {
                static::fail(implode("\n", $checked->failures));
            }
            CoverageRecorder::record($checked->operation, $checked->status, $test, $document->sha256);
        });
    }

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
