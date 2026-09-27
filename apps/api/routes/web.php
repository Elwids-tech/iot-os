<?php

use App\Support\Operations;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;

Route::get('/', function () {
    return view('welcome');
});

Route::get('/health/ready', function (Operations $operations) {
    abort_unless(config('deployment.ops_enabled'), 404);
    $ready = $operations->ready();

    return response()->json(['ok' => $ready], $ready ? 200 : 503);
});
Route::get('/internal/ops/metrics', function (Request $request, Operations $operations) {
    $token = config('deployment.metrics_token');
    abort_unless(config('deployment.ops_enabled') && is_string($token) && strlen($token) >= 32 && hash_equals($token, $request->bearerToken() ?? ''), 403);

    return response($operations->metrics(), 200, ['Content-Type' => 'text/plain; version=0.0.4']);
});
