<?php

declare(strict_types=1);

namespace App\Domain\Branding\Models;

use App\Domain\Billing\Models\BillingAccount;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Support\Str;

/**
 * A billing account's brand (spec 036, ADR-050): the product name, images and support
 * link shown instead of the platform's. Only `Brands` writes it. It takes effect only
 * while the account's `branding` allowance is on and it has a product name; the row is
 * kept when the allowance goes (FR-037).
 *
 * @property string $uuid
 * @property int $billing_account_id
 * @property string|null $product_name
 * @property string|null $short_name
 * @property string|null $support_url
 * @property int $revision
 */
final class Brand extends Model
{
    /** Role => the column holding that image. */
    public const IMAGE_COLUMNS = [
        BrandAsset::LOGO => 'logo_asset_id',
        BrandAsset::LOGO_DARK => 'logo_dark_asset_id',
        BrandAsset::ICON => 'icon_asset_id',
    ];

    protected $guarded = [];

    protected $attributes = ['revision' => 0];

    protected static function booted(): void
    {
        self::creating(static function (self $brand): void {
            $brand->uuid ??= (string) Str::uuid();
        });
    }

    protected function casts(): array
    {
        return ['revision' => 'integer'];
    }

    /**
     * @return BelongsTo<BillingAccount, $this>
     */
    public function billingAccount(): BelongsTo
    {
        return $this->belongsTo(BillingAccount::class);
    }

    /**
     * @return BelongsTo<BrandAsset, $this>
     */
    public function logo(): BelongsTo
    {
        return $this->belongsTo(BrandAsset::class, 'logo_asset_id');
    }

    /**
     * @return BelongsTo<BrandAsset, $this>
     */
    public function logoDark(): BelongsTo
    {
        return $this->belongsTo(BrandAsset::class, 'logo_dark_asset_id');
    }

    /**
     * @return BelongsTo<BrandAsset, $this>
     */
    public function icon(): BelongsTo
    {
        return $this->belongsTo(BrandAsset::class, 'icon_asset_id');
    }

    /** The installed-app name: the short name, else the product name cut to 12 characters. */
    public function shortName(): ?string
    {
        return $this->short_name ?? ($this->product_name === null ? null : rtrim(mb_substr($this->product_name, 0, 12)));
    }
}
