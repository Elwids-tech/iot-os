<?php

use App\Domain\Authorization\Http\Middleware\ResolveOrganizationContext;
use App\Domain\DeviceAdapters\Http\AdapterConnectionController;
use App\Domain\DeviceAdapters\Http\AdapterController;
use App\Domain\DeviceAdapters\Http\PointMapController;
use App\Domain\DeviceAdapters\Http\PollingController;
use App\Domain\DeviceAdapters\Http\WebhookController;
use Illuminate\Support\Facades\Route;

Route::prefix('v1/organizations/{organization}')->whereUuid(['organization', 'adapter', 'candidate', 'credential', 'proposal', 'secret', 'connection'])->middleware(['auth:sanctum', ResolveOrganizationContext::class])->group(function (): void {
    Route::get('device-adapters', [AdapterController::class, 'index']);
    Route::get('device-adapter-profiles', [AdapterController::class, 'profiles']);
    Route::post('device-adapters', [AdapterController::class, 'store']);
    // Spec 038: OPC UA connections and browsing (contracts/api.md).
    Route::get('adapter-connections', [AdapterConnectionController::class, 'index']);
    Route::post('adapter-connections', [AdapterConnectionController::class, 'store'])->middleware('throttle:20,1');
    Route::prefix('adapter-connections/{connection}')->group(function (): void {
        Route::get('', [AdapterConnectionController::class, 'show']);
        Route::put('', [AdapterConnectionController::class, 'update']);
        Route::delete('', [AdapterConnectionController::class, 'destroy']);
        Route::post('endpoints', [AdapterConnectionController::class, 'endpoints'])->middleware('throttle:opcua-browse');
        Route::post('server-certificate/accept', [AdapterConnectionController::class, 'acceptCertificate']);
        Route::get('client-certificate', [AdapterConnectionController::class, 'clientCertificate']);
        Route::post('test', [AdapterConnectionController::class, 'test'])->middleware('throttle:opcua-browse');
        Route::post('pause', [AdapterConnectionController::class, 'pause']);
        Route::post('resume', [AdapterConnectionController::class, 'resume']);
        Route::get('nodes', [AdapterConnectionController::class, 'nodes'])->middleware('throttle:opcua-browse');
        Route::post('nodes/read', [AdapterConnectionController::class, 'read'])->middleware('throttle:opcua-browse');
        Route::post('nodes/search', [AdapterConnectionController::class, 'search'])->middleware('throttle:opcua-browse');
        Route::post('nodes/similar', [PointMapController::class, 'similar'])->middleware('throttle:opcua-browse');
        Route::post('point-map/suggest', [PointMapController::class, 'suggest'])->middleware('throttle:opcua-browse');
    });
    Route::post('device-adapters/point-map/device-type', [PointMapController::class, 'deviceType'])->middleware('throttle:20,1');
    Route::prefix('device-adapters/{adapter}')->group(function (): void {
        Route::get('', [AdapterController::class, 'show']);
        Route::put('', [AdapterController::class, 'update']);
        Route::delete('', [AdapterController::class, 'destroy']);
        Route::post('test', [AdapterController::class, 'test'])->middleware('throttle:20,1');
        Route::post('connection-test', [AdapterController::class, 'connectionTest'])->middleware('throttle:6,1');
        Route::post('deploy', [AdapterController::class, 'deploy'])->middleware('throttle:10,1');
        Route::get('candidates', [AdapterController::class, 'candidates']);
        Route::get('candidates/{candidate}/last-report', [AdapterController::class, 'lastReport']);
        Route::post('candidates/activate', [AdapterController::class, 'activateMany'])->middleware('throttle:10,1');
        Route::get('candidates/activations/{batch}', [AdapterController::class, 'activation'])->whereUuid('batch');
        Route::post('candidates/{candidate}/activate', [AdapterController::class, 'activate']);
        Route::get('credentials', [AdapterController::class, 'credentials']);
        Route::post('credentials', [AdapterController::class, 'credential'])->middleware('throttle:10,1');
        Route::post('credentials/{credential}/kit', [AdapterController::class, 'kit']);
        Route::post('credentials/{credential}/rotate', [AdapterController::class, 'rotate']);
        Route::post('credentials/{credential}/revoke', [AdapterController::class, 'revoke']);
        Route::get('proposals', [AdapterController::class, 'proposals']);
        Route::post('proposals/{proposal}/decision', [AdapterController::class, 'proposalDecision']);
        Route::get('webhook', [WebhookController::class, 'show']);
        Route::post('webhook/secrets', [WebhookController::class, 'create'])->middleware('throttle:10,1');
        Route::post('webhook/secrets/{secret}/revoke', [WebhookController::class, 'revoke']);
        Route::get('deliveries', [WebhookController::class, 'deliveries']);
        Route::post('fetch-now', [PollingController::class, 'fetch']);
        Route::get('poll-runs', [PollingController::class, 'runs']);
        Route::post('cursor', [PollingController::class, 'cursor'])->middleware('throttle:10,1');
        Route::post('resume', [PollingController::class, 'resume'])->middleware('throttle:10,1');
    });
});
Route::post('internal/adapters/events', [AdapterController::class, 'event']);
Route::post('internal/adapters/receiver-reports', [WebhookController::class, 'reports']);
