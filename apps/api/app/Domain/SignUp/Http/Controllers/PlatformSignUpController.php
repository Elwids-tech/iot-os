<?php

declare(strict_types=1);

namespace App\Domain\SignUp\Http\Controllers;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\SignUp\Http\Resources\SignUpResource;
use App\Domain\SignUp\Models\SignUp;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\AnonymousResourceCollection;
use Illuminate\Support\Facades\Gate;
use Illuminate\Validation\Rule;

/**
 * Who signed up, for follow-up and abuse review (spec 035 FR-028). Platform
 * administrators who manage organizations read it; nobody changes it here.
 */
final class PlatformSignUpController
{
    public function index(Request $request): AnonymousResourceCollection
    {
        Gate::authorize(PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value);
        $request->validate([
            /** Waiting, expired (a waiting sign-up whose link ran out), completed or refused. */
            'state' => ['nullable', Rule::in([SignUp::WAITING, SignUp::EXPIRED, SignUp::COMPLETED, SignUp::REFUSED])],
            /** Matches the person's name, email or the organization's name. */
            'search' => ['nullable', 'string', 'max:255'],
            /** Sign-ups per page, 1 to 100 (default 25). */
            'per_page' => ['nullable', 'integer'],
        ]);

        $search = trim((string) $request->query('search', ''));
        $state = (string) $request->query('state', '');
        $perPage = min(max((int) $request->query('per_page', 25), 1), 100);

        $signUps = SignUp::query()
            ->when($state === SignUp::WAITING, fn ($query) => $query->where('state', SignUp::WAITING)->where('token_expires_at', '>', now()))
            ->when($state === SignUp::EXPIRED, fn ($query) => $query->where('state', SignUp::WAITING)->where(fn ($query) => $query->whereNull('token_expires_at')->orWhere('token_expires_at', '<=', now())))
            ->when(in_array($state, [SignUp::COMPLETED, SignUp::REFUSED], true), fn ($query) => $query->where('state', $state))
            ->when($search !== '', function ($query) use ($search): void {
                $query->where(function ($query) use ($search): void {
                    $query->whereLike('name', "%{$search}%")
                        ->orWhereLike('email', "%{$search}%")
                        ->orWhereLike('organization_name', "%{$search}%");
                });
            })
            ->with('organization')
            ->orderByDesc('created_at')
            ->orderByDesc('id')
            ->paginate($perPage)
            ->withQueryString();

        return SignUpResource::collection($signUps);
    }
}
