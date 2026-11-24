<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Resources;

use App\Domain\Authentication\Services\Impersonation;
use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Authorization\Services\PlatformAuthorization;
use App\Domain\Branding\Services\Brands;
use App\Domain\Branding\Services\PortalAccess;
use App\Domain\Notifications\Models\PushDevice;
use App\Domain\Shared\Http\Resources\OrganizationResource;
use App\Domain\Shared\Models\Organization;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\Request;
use Illuminate\Http\Resources\Json\JsonResource;

final class AuthenticatedUserResource extends JsonResource
{
    /**
     * @return array<string, mixed>
     */
    public function toArray(Request $request): array
    {
        $access = app(PortalAccess::class);
        $address = $access->address($request);
        $organizations = $this->is_super_admin
            ? $access->scope(Organization::query(), $request)->with(['logo', 'logoDark'])->orderBy('name')->get()
            : $this->whenLoaded('organizations');
        if ($address !== null && ! $this->is_super_admin && $organizations instanceof Collection) {
            // On a billing account's address, only its organizations (spec 036, FR-021).
            $organizations = $organizations->filter(fn (Organization $organization): bool => $access->reaches($organization, $request))->values();
        }
        if ($organizations instanceof Collection) {
            // One pass for every organization's logos and brand (spec 036).
            $organizations->loadMissing(['logo', 'logoDark']);
            app(Brands::class)->preload($organizations);
        }

        $impersonation = $this->impersonation($request);

        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'email_verified_at' => $this->email_verified_at?->toIso8601String(),
            'is_super_admin' => (bool) $this->is_super_admin,
            // Required two-step that is not set up (spec 034, FR-022): the apps open setup at once.
            // Not while a super administrator impersonates them: setting it up is the person's own.
            'two_step_setup_required' => $impersonation === null && ! $this->resource->twoStepSatisfied() && $this->resource->twoStepRequired(),
            'capabilities' => [
                'platform_administration' => app(PlatformAuthorization::class)->canAccessAdministration($this->resource),
                // Organizations, users, roles and every billing page (specs 008, 023, 028, 029).
                'manage_organizations' => app(PlatformAuthorization::class)->allows($this->resource, PlatformAdministrationPermission::MANAGE_ORGANIZATIONS),
                // Reset a locked-out person's two-step sign-in (spec 034).
                'reset_two_step' => app(PlatformAuthorization::class)->allows($this->resource, PlatformAdministrationPermission::RESET_TWO_STEP),
                'manage_retention' => app(PlatformAuthorization::class)->allows($this->resource, PlatformAdministrationPermission::MANAGE_RETENTION),
                // The assistant's provider keys spend the operator's money for every organization (spec 010).
                'manage_assistant' => (bool) $this->is_super_admin,
                // Super administrators work the support ticket queue (spec 015).
                'manage_tickets' => (bool) $this->is_super_admin,
                // Opening sign-up and choosing how staff hear of it (spec 035).
                'manage_sign_up' => (bool) $this->is_super_admin,
                // Owners see their billing accounts and create organizations under them (spec 023).
                'billing_accounts' => $this->resource->ownedBillingAccounts()->exists(),
            ],
            'organizations' => OrganizationResource::collection($organizations),
            /**
             * The portal address the request came from, or null on the platform's own.
             *
             * @var array{kind: 'name'|'domain', host: string}|null
             */
            'address' => $address === null ? null : ['kind' => $address->kind->value, 'host' => $address->host],
            /**
             * How many browsers the person has push on in at other portal addresses. Push
             * belongs to the address it was turned on at, so above zero the portal says
             * once that alerts must be turned on again here (spec 036, FR-032).
             */
            'push_devices_elsewhere' => PushDevice::elsewhere($this->resource, $address),
            /**
             * The super administrator acting as this person, or null. The apps show it and
             * offer to leave, which returns to the admin page impersonation started from.
             *
             * @var array{impersonator: array{id: int, name: string, email: string}, started_at: string}|null
             */
            'impersonation' => $impersonation,
        ];
    }

    /**
     * @return array{impersonator: array{id: int, name: string, email: string}, started_at: string}|null
     */
    private function impersonation(Request $request): ?array
    {
        $impersonation = app(Impersonation::class);
        $state = $impersonation->current($request);
        $impersonator = $state === null ? null : $impersonation->impersonator($request);
        if ($state === null || $impersonator === null || $request->user()?->getKey() !== $this->resource->getKey()) {
            return null;
        }

        return [
            'impersonator' => ['id' => (int) $impersonator->getKey(), 'name' => $impersonator->name, 'email' => $impersonator->email],
            'started_at' => $state['started_at'],
        ];
    }
}
