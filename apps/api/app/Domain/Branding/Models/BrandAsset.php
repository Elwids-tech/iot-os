<?php

declare(strict_types=1);

namespace App\Domain\Branding\Models;

use Carbon\CarbonImmutable;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Support\Str;

/**
 * One uploaded brand image and its stored sizes (spec 036, data-model.md). It belongs to
 * a billing account (a brand's logo or icon) or to an organization (its logo). Files are
 * on the private disk and are served only through the public, hash-named route.
 *
 * @property string $uuid
 * @property int|null $billing_account_id
 * @property int|null $organization_id
 * @property string $role
 * @property string $content_hash
 * @property array<string, array{path: string, width: int, height: int, bytes: int}> $variants
 * @property CarbonImmutable|null $replaced_at
 */
final class BrandAsset extends Model
{
    public const LOGO = 'logo';

    public const LOGO_DARK = 'logo_dark';

    public const ICON = 'icon';

    public const ROLES = [self::LOGO, self::LOGO_DARK, self::ICON];

    /** Characters of the content hash in the public URL. */
    public const HASH_LENGTH = 12;

    protected $guarded = [];

    protected static function booted(): void
    {
        self::creating(static function (self $asset): void {
            $asset->uuid ??= (string) Str::uuid();
        });
    }

    protected function casts(): array
    {
        return [
            'variants' => 'array',
            'replaced_at' => 'immutable_datetime',
        ];
    }

    /** The asset's name in public URLs: its uuid, then the start of its content hash. */
    public function publicKey(): string
    {
        return $this->uuid.substr($this->content_hash, 0, self::HASH_LENGTH);
    }

    /** The variant shown by default: the logo, or the icon's largest size. */
    public function mainVariant(): string
    {
        return $this->role === self::ICON ? '512' : 'logo';
    }

    public function url(?string $variant = null): string
    {
        return route('api.v1.brand-assets.show', ['asset' => $this->publicKey(), 'variant' => $variant ?? $this->mainVariant()]);
    }

    /**
     * What clients get for an image: where it is and its size.
     *
     * @return array{url: string, width: int, height: int}
     */
    public function image(?string $variant = null): array
    {
        $variant ??= $this->mainVariant();
        $stored = $this->variants[$variant] ?? ['width' => 0, 'height' => 0];

        return [
            'url' => $this->url($variant),
            'width' => (int) $stored['width'],
            'height' => (int) $stored['height'],
        ];
    }
}
