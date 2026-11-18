<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Controllers;

use App\Domain\Authentication\Http\Requests\AddPasskeyRequest;
use App\Domain\Authentication\Http\Resources\PasskeyResource;
use App\Domain\Authentication\Notifications\SecurityChanged;
use App\Domain\Authentication\Services\SecurityAudit;
use App\Domain\Shared\Models\User;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Laravel\Passkeys\Actions\DeletePasskey;
use Laravel\Passkeys\Actions\GenerateRegistrationOptions;
use Laravel\Passkeys\Actions\StorePasskey;
use Laravel\Passkeys\Passkey;
use Laravel\Passkeys\Support\WebAuthn;

/**
 * A person's own passkeys (spec 034, FR-016, FR-019): add and remove, behind a password
 * or passkey confirmed in the last 15 minutes. Adding or removing one does not end the
 * person's other sign-ins; it emails them and writes an activity entry that names the
 * passkey and never holds credential material.
 */
final class PasskeyController
{
    public const OPTIONS = 'passkey.registration_options';

    public function __construct(private readonly SecurityAudit $audit) {}

    /**
     * WebAuthn creation options for the person, kept in the session for the answer. The
     * person's existing passkeys are excluded, so one authenticator is not added twice.
     */
    public function options(Request $request, GenerateRegistrationOptions $generate): JsonResponse
    {
        $options = $generate($this->person($request));
        $request->session()->put(self::OPTIONS, WebAuthn::toJson($options));

        return response()->json(['options' => WebAuthn::toBrowserArray($options)]);
    }

    public function store(AddPasskeyRequest $request, StorePasskey $store): JsonResponse
    {
        $user = $this->person($request);
        $name = trim($request->string('name')->toString());

        $passkey = DB::transaction(function () use ($user, $name, $request, $store) {
            $passkey = $store($user, $name, $request->credential(), $request->registrationOptions());
            $this->audit->record($user, SecurityChanged::PASSKEY_ADDED, $user, ['name' => $name]);

            return $passkey;
        });

        return PasskeyResource::make($passkey)->response()->setStatusCode(201);
    }

    public function destroy(Request $request, Passkey $passkey, DeletePasskey $delete): Response
    {
        $user = $this->person($request);
        // Only the owner can address a passkey; anyone else's is not found.
        abort_unless((string) $passkey->user_id === (string) $user->getKey(), 404);
        $record = $passkey;

        DB::transaction(function () use ($user, $record, $delete): void {
            $delete($user, $record);
            $this->audit->record($user, SecurityChanged::PASSKEY_REMOVED, $user, ['name' => (string) $record->name]);
        });

        return response()->noContent();
    }

    private function person(Request $request): User
    {
        /** @var User $user */
        $user = $request->user();

        return $user;
    }
}
