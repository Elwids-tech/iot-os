<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Controllers;

use App\Domain\Authentication\Actions\ResetTwoStep;
use App\Domain\Shared\Models\User;
use Illuminate\Http\Request;
use Illuminate\Http\Response;

/**
 * A platform administrator resets a locked-out person's two-step sign-in, giving a reason
 * (spec 034, FR-024, FR-025). The route needs `PlatformAdministration.reset-two-step`.
 */
final class TwoStepResetController
{
    public function __invoke(Request $request, User $user, ResetTwoStep $reset): Response
    {
        $validated = $request->validate([
            'reason' => ['required', 'string', 'max:500'],
        ]);

        /** @var User $actor */
        $actor = $request->user();
        $reset($user, $actor, trim((string) $validated['reason']), ResetTwoStep::ADMIN, $request);

        return response()->noContent();
    }
}
