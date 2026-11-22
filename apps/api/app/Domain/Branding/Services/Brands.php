<?php

declare(strict_types=1);

namespace App\Domain\Branding\Services;

use App\Domain\Audit\Services\ActivityLog;
use App\Domain\Billing\Enums\AllowanceKind;
use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Billing\Services\Allowances;
use App\Domain\Branding\Exceptions\BrandingRefusal;
use App\Domain\Branding\Models\Brand;
use App\Domain\Branding\Models\BrandAsset;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\DB;

/**
 * Brands and logos (spec 036, ADR-050). A billing account's brand takes effect only
 * while its `branding` allowance is on and it has a product name. An organization shows
 * its own logo, else its account's brand logo while that brand is in effect, else the
 * platform's name (FR-004).
 */
final class Brands
{
    /** Where one request keeps the brands it has resolved, by billing account id. */
    private const MEMO = 'branding.effective';

    public function __construct(
        private readonly Allowances $allowances,
        private readonly BrandImages $images,
    ) {}

    /** The account's brand, or an unsaved empty one at revision 0. */
    public function for(BillingAccount $account): Brand
    {
        return Brand::query()->with(['logo', 'logoDark', 'icon'])->where('billing_account_id', $account->getKey())->first()
            ?? new Brand(['billing_account_id' => $account->getKey()]);
    }

    public function inEffect(BillingAccount $account, ?Brand $brand): bool
    {
        return $brand !== null && $brand->product_name !== null && $this->allowances->allows($account, AllowanceKind::Branding);
    }

    /**
     * What the portal shows for an organization (FR-004). A null product name means the
     * platform's. The organization's own logo wins as a pair: its account's dark logo is
     * never mixed with its own light one.
     *
     * @return array{product_name: string|null, logo: BrandAsset|null, logo_dark: BrandAsset|null}
     */
    public function forOrganization(Organization $organization): array
    {
        $brand = $this->effective([(int) $organization->billing_account_id])[(int) $organization->billing_account_id] ?? null;
        $own = $organization->logo;

        return [
            'product_name' => $brand?->product_name,
            'logo' => $own ?? $brand?->logo,
            'logo_dark' => $own !== null ? $organization->logoDark : $brand?->logoDark,
        ];
    }

    /**
     * The product's name in text written for an organization (FR-009): the name its
     * account gave it, else the platform's. With no organization given, the one the
     * request is about.
     */
    public function nameFor(?Organization $organization = null): string
    {
        $organization ??= request()->attributes->get('organization');
        $account = $organization instanceof Organization ? $organization->billingAccount : null;
        // Read fresh, not from the request's memo: queue workers write text too, and theirs never ends.
        $brand = $account === null ? null : $this->for($account);

        return $account !== null && $this->inEffect($account, $brand) ? (string) $brand->product_name : (string) config('branding.platform_name');
    }

    /**
     * Resolves the brands of many organizations in one pass, before a list of them is
     * rendered.
     *
     * @param  iterable<Organization>  $organizations
     */
    public function preload(iterable $organizations): void
    {
        $ids = [];
        foreach ($organizations as $organization) {
            $ids[] = (int) $organization->billing_account_id;
        }
        $this->effective(array_values(array_unique($ids)));
    }

    /**
     * The platform's own brand: what shows where no account's brand is in effect.
     *
     * @return array{product_name: string, logo: null, logo_dark: null}
     */
    public function platform(): array
    {
        return ['product_name' => (string) config('app.name'), 'logo' => null, 'logo_dark' => null];
    }

    /**
     * Saves the name, short name and support link. `$revision` is the one the editor
     * read; a brand changed since answers 409.
     *
     * @param  array{product_name?: string|null, short_name?: string|null, support_url?: string|null}  $values
     */
    public function update(BillingAccount $account, array $values, int $revision, ?User $actor): Brand
    {
        return DB::transaction(function () use ($account, $values, $revision, $actor): Brand {
            $brand = $this->locked($account);
            if ($brand->revision !== $revision) {
                throw new BrandingRefusal(409, 'brand_changed', 'The brand was changed since you opened it. Reload to see the latest version.');
            }

            $changes = [];
            foreach (['product_name', 'short_name', 'support_url'] as $field) {
                $to = $values[$field] ?? null;
                if ($to !== $brand->getAttribute($field)) {
                    $changes[$field] = ['from' => $brand->getAttribute($field), 'to' => $to];
                    $brand->setAttribute($field, $to);
                }
            }

            if ($changes !== [] || ! $brand->exists) {
                $this->save($brand, $actor);
                ActivityLog::record('brand.updated', null, $actor, $account, ['changed' => array_keys($changes), 'changes' => $changes]);
            }

            return $brand->load(['logo', 'logoDark', 'icon']);
        });
    }

    public function setImage(BillingAccount $account, string $role, UploadedFile $file, ?User $actor): Brand
    {
        // Decoded and stored first: a refused image changes nothing.
        $asset = $this->images->store($file, $role, $account, $actor);

        return $this->swapImage($account, $role, $asset, $actor);
    }

    public function removeImage(BillingAccount $account, string $role, ?User $actor): Brand
    {
        return $this->swapImage($account, $role, null, $actor);
    }

    public function setOrganizationLogo(Organization $organization, string $role, UploadedFile $file, ?User $actor): Organization
    {
        $asset = $this->images->store($file, $role, $organization, $actor);

        return $this->swapOrganizationLogo($organization, $role, $asset, $actor);
    }

    public function removeOrganizationLogo(Organization $organization, string $role, ?User $actor): Organization
    {
        return $this->swapOrganizationLogo($organization, $role, null, $actor);
    }

    private function swapImage(BillingAccount $account, string $role, ?BrandAsset $asset, ?User $actor): Brand
    {
        return DB::transaction(function () use ($account, $role, $asset, $actor): Brand {
            $brand = $this->locked($account);
            $column = Brand::IMAGE_COLUMNS[$role];
            $previous = $brand->getAttribute($column) === null ? null : BrandAsset::query()->find($brand->getAttribute($column));

            if ($asset !== null || $previous !== null) {
                $brand->setAttribute($column, $asset?->getKey());
                $this->save($brand, $actor);
                $this->images->retire($previous);
                ActivityLog::record('brand.image_changed', null, $actor, $account, ['image' => $role, 'change' => $asset === null ? 'removed' : 'set']);
            }

            return $brand->load(['logo', 'logoDark', 'icon']);
        });
    }

    private function swapOrganizationLogo(Organization $organization, string $role, ?BrandAsset $asset, ?User $actor): Organization
    {
        return DB::transaction(function () use ($organization, $role, $asset, $actor): Organization {
            $column = Brand::IMAGE_COLUMNS[$role];
            $locked = Organization::query()->whereKey($organization->getKey())->lockForUpdate()->firstOrFail();
            $previous = $locked->getAttribute($column) === null ? null : BrandAsset::query()->find($locked->getAttribute($column));

            if ($asset !== null || $previous !== null) {
                $locked->forceFill([$column => $asset?->getKey()])->save();
                $this->images->retire($previous);
                ActivityLog::record('organization.logo_changed', $locked, $actor, $locked, ['image' => $role, 'change' => $asset === null ? 'removed' : 'set']);
            }

            return $locked;
        });
    }

    private function locked(BillingAccount $account): Brand
    {
        // The account row serialises a brand's first save with any other.
        BillingAccount::query()->whereKey($account->getKey())->lockForUpdate()->firstOrFail();

        return Brand::query()->where('billing_account_id', $account->getKey())->lockForUpdate()->first()
            ?? new Brand(['billing_account_id' => $account->getKey()]);
    }

    private function save(Brand $brand, ?User $actor): void
    {
        $brand->revision++;
        $brand->updated_by = $actor?->getKey();
        $brand->save();
        // A first save is still a 200: the brand is one thing per account, not a new resource.
        $brand->wasRecentlyCreated = false;
    }

    /**
     * The brand in effect for each billing account, or null, remembered for the request
     * so a list of organizations costs one pass.
     *
     * @param  list<int>  $accountIds
     * @return array<int, Brand|null>
     */
    private function effective(array $accountIds): array
    {
        $request = request();
        /** @var array<int, Brand|null> $memo */
        $memo = $request->attributes->get(self::MEMO, []);
        $missing = array_values(array_diff($accountIds, array_keys($memo)));

        if ($missing !== []) {
            $accounts = BillingAccount::query()->whereKey($missing)
                ->with(['brand.logo', 'brand.logoDark', 'allowanceOverrides', 'openPlanAssignment.plan.allowances'])
                ->get()->keyBy(fn (BillingAccount $account): int => (int) $account->getKey());

            foreach ($missing as $id) {
                $account = $accounts->get($id);
                $memo[$id] = $account !== null && $this->inEffect($account, $account->brand) ? $account->brand : null;
            }
            $request->attributes->set(self::MEMO, $memo);
        }

        return $memo;
    }
}
