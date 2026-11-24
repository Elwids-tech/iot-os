<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Controllers;

use App\Domain\Authentication\Services\Impersonation;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * Super administrators sign in as someone else from the admin app, and leave from the
 * portal or the admin app to return where they started.
 */
final class ImpersonationController
{
    public function __construct(private readonly Impersonation $impersonation) {}

    public function store(Request $request, User $user): Response
    {
        $validated = $request->validate([
            'return_url' => ['nullable', 'string', 'max:2048'],
        ]);
        /** @var User $impersonator */
        $impersonator = $request->user();

        $this->impersonation->start($impersonator, $user, $validated['return_url'] ?? null, $request);

        return response()->noContent();
    }

    public function destroy(Request $request): JsonResponse
    {
        return response()->json([
            'data' => ['return_url' => $this->impersonation->leave($request)],
        ]);
    }
}
