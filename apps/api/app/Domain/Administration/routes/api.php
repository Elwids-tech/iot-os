<?php

declare(strict_types=1);

use App\Domain\Administration\Http\Controllers\OrganizationAdministrationController;
use App\Domain\Administration\Http\Controllers\OrganizationInvitationController;
use App\Domain\Administration\Http\Controllers\OrganizationMemberController;
use App\Domain\Administration\Http\Controllers\OrganizationRoleController;
use App\Domain\Administration\Http\Controllers\PlatformInvitationController;
use App\Domain\Administration\Http\Controllers\PlatformOrganizationController;
use App\Domain\Administration\Http\Controllers\PlatformOrganizationDeletionController;
use App\Domain\Administration\Http\Controllers\PlatformOrganizationPermissionController;
use App\Domain\Administration\Http\Controllers\PlatformOrganizationRoleController;
use App\Domain\Administration\Http\Controllers\PlatformRoleController;
use App\Domain\Administration\Http\Controllers\PlatformRolePermissionController;
use App\Domain\Administration\Http\Controllers\PlatformTeamController;
use App\Domain\Administration\Http\Controllers\PlatformUserController;
use App\Domain\Administration\Http\Controllers\PublicOrganizationInvitationController;
use App\Domain\Administration\Http\Controllers\SuperAdministratorController;
use App\Domain\Administration\Http\Controllers\SuperAdministratorInvitationController;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use Illuminate\Support\Facades\Route;

Route::prefix('v1')->name('api.v1.')->group(function (): void {
    Route::get('invitations/{token}', [PublicOrganizationInvitationController::class, 'show'])
        ->name('invitations.show');
    Route::post('invitations/{token}/accept', [PublicOrganizationInvitationController::class, 'accept'])
        ->name('invitations.accept');

    Route::middleware('auth:sanctum')->group(function (): void {
        Route::prefix('admin')->name('admin.')->group(function (): void {
            Route::get('organizations', [PlatformOrganizationController::class, 'index'])
                ->middleware('can:'.PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)
                ->name('organizations.index');
            Route::post('organizations', [PlatformOrganizationController::class, 'store'])
                ->middleware('can:'.PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)
                ->name('organizations.store');
            Route::patch('organizations/{organization}', [PlatformOrganizationController::class, 'update'])
                ->middleware('can:'.PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)
                ->name('organizations.update');
            Route::get('organizations/{organization}/deletion', [PlatformOrganizationDeletionController::class, 'show'])
                ->whereUuid('organization')
                ->middleware('can:'.PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)
                ->name('organizations.deletion.show');
            Route::delete('organizations/{organization}', [PlatformOrganizationDeletionController::class, 'destroy'])
                ->whereUuid('organization')
                ->middleware('can:'.PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)
                ->name('organizations.destroy');
            Route::get('users', [PlatformUserController::class, 'index'])
                ->middleware('can:'.PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)
                ->name('users.index');
            Route::get('invitations', [PlatformInvitationController::class, 'index'])
                ->middleware('can:'.PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)
                ->name('invitations.index');
            Route::post('organizations/{organization}/invitations', [PlatformInvitationController::class, 'store'])
                ->middleware('can:'.PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)
                ->name('organizations.invitations.store');
            Route::get('organizations/{organization}/permissions', [PlatformOrganizationPermissionController::class, 'show'])
                ->middleware('can:'.PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)
                ->name('organizations.permissions.show');
            Route::put('organizations/{organization}/permissions', [PlatformOrganizationPermissionController::class, 'update'])
                ->middleware('can:'.PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)
                ->name('organizations.permissions.update');
            Route::get('organizations/{organization}/roles', [PlatformOrganizationRoleController::class, 'index'])
                ->middleware('can:'.PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)
                ->name('organizations.roles.index');
            Route::delete('invitations/{invitation}', [PlatformInvitationController::class, 'destroy'])
                ->middleware('can:'.PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)
                ->name('invitations.destroy');
            Route::get('roles', [PlatformRoleController::class, 'index'])
                ->middleware('can:'.PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)
                ->name('roles.index');
            Route::get('roles/{role}', [PlatformRolePermissionController::class, 'show'])
                ->middleware('can:'.PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)
                ->name('roles.show');
            Route::put('roles/{role}/permissions', [PlatformRolePermissionController::class, 'update'])
                ->middleware('can:'.PlatformAdministrationPermission::MANAGE_ORGANIZATIONS->value)
                ->name('roles.permissions.update');
            Route::get('platform-team', [PlatformTeamController::class, 'index'])->name('platform-team.index');
            Route::put('platform-team/{user}', [PlatformTeamController::class, 'update'])->name('platform-team.update');
            Route::post('super-administrators/invitations', [SuperAdministratorInvitationController::class, 'store'])
                ->name('super-administrators.invitations.store');
            Route::put('super-administrators/{user}', [SuperAdministratorController::class, 'update'])
                ->whereNumber('user')
                ->name('super-administrators.update');
            Route::delete('super-administrators/{user}', [SuperAdministratorController::class, 'destroy'])
                ->whereNumber('user')
                ->name('super-administrators.destroy');
        });

        Route::prefix('organizations/{organization}')->name('organizations.')->whereUuid(['organization', 'invitation'])->group(function (): void {
            Route::get('administration', [OrganizationAdministrationController::class, 'show'])
                ->name('administration.show');

            Route::get('roles', [OrganizationRoleController::class, 'index'])->name('roles.index');
            Route::get('role-permissions', [OrganizationRoleController::class, 'permissions'])->name('roles.permissions');
            Route::post('roles', [OrganizationRoleController::class, 'store'])->name('roles.store');
            Route::patch('roles/{role}', [OrganizationRoleController::class, 'update'])->whereNumber('role')->name('roles.update');
            Route::delete('roles/{role}', [OrganizationRoleController::class, 'destroy'])->whereNumber('role')->name('roles.destroy');

            Route::get('members', [OrganizationMemberController::class, 'index'])->name('members.index');
            Route::put('members/{member}', [OrganizationMemberController::class, 'update'])->whereNumber('member')->name('members.update');
            Route::delete('members/{member}', [OrganizationMemberController::class, 'destroy'])->whereNumber('member')->name('members.destroy');

            Route::get('invitations', [OrganizationInvitationController::class, 'index'])->name('invitations.index');
            Route::post('invitations', [OrganizationInvitationController::class, 'store'])
                ->middleware('throttle:organization-invitations')
                ->name('invitations.store');
            Route::post('invitations/{invitation}/resend', [OrganizationInvitationController::class, 'resend'])
                ->middleware('throttle:organization-invitations')
                ->name('invitations.resend');
            Route::delete('invitations/{invitation}', [OrganizationInvitationController::class, 'destroy'])
                ->name('invitations.destroy');
        });
    });
});
