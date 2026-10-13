<?php

declare(strict_types=1);

namespace App\Domain\Agents\Http\Controllers;

use Illuminate\Contracts\Auth\Authenticatable;
use Laravel\Passport\Client;
use Laravel\Passport\Http\Controllers\AuthorizationController as PassportAuthorizationController;

/**
 * Passport's authorize endpoint, except that it always asks for consent. Passport would
 * otherwise approve silently while the agent still holds a valid token, skipping the
 * portal, where the person chooses the organization and access level (spec 004 D5).
 */
final class AuthorizationController extends PassportAuthorizationController
{
    protected function hasGrantedScopes(Authenticatable $user, Client $client, array $scopes): bool
    {
        return false;
    }
}
