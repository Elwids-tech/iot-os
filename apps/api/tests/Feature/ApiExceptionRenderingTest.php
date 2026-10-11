<?php

declare(strict_types=1);

namespace Tests\Feature;

use Illuminate\Support\Facades\Route;
use RuntimeException;
use Tests\TestCase;

final class ApiExceptionRenderingTest extends TestCase
{
    public function test_unexpected_api_error_returns_500_json_without_the_exception_message_when_debug_is_off(): void
    {
        config(['app.debug' => false]);
        Route::get('api/test/unexpected-failure', fn () => throw new RuntimeException('SQLSTATE[22P02]: invalid input syntax for type uuid: "settings"'));

        $this->get('/api/test/unexpected-failure')
            ->assertInternalServerError()
            ->assertExactJson(['message' => 'Server Error']);
    }
}
