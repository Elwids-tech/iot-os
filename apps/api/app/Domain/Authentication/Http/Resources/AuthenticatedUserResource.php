<?php

declare(strict_types=1);

namespace App\Domain\Authentication\Http\Resources;

use App\Domain\Authorization\Permissions\PlatformAdministrationPermission;
use App\Domain\Authorization\Services\PlatformAuthorization;
use App\Domain\Branding\Services\Brands;
use App\Domain\Branding\Services\PortalAccess;
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

        return [
            'id' => $this->id,
            'name' => $this->name,
            'email' => $this->email,
            'email_verified_at' => $this->email_verified_at?->toIso8601String(),
            'is_super_admin' => (bool) $this->is_super_admin,
            // Required two-step that is not set up (spec 034, FR-022): the apps open setup at once.
            'two_step_setup_required' => ! $this->resource->twoStepSatisfied() && $this->resource->twoStepRequired(),
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
        ];
    }
}
