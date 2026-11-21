<?php

declare(strict_types=1);

namespace App\Domain\Branding\Services;

use App\Domain\Billing\Models\BillingAccount;
use App\Domain\Branding\Exceptions\BrandingRefusal;
use App\Domain\Branding\Models\BrandAsset;
use App\Domain\Shared\Models\Organization;
use App\Domain\Shared\Models\User;
use Carbon\CarbonImmutable;
use GdImage;
use Illuminate\Http\UploadedFile;
use Illuminate\Support\Facades\Storage;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Brand images (spec 036, research R2). The type comes from the content, never the name
 * or the browser. Every image is decoded and re-encoded as PNG, so nothing but pixels
 * survives; SVG is never accepted. Files go to the private disk and are served only
 * through the public route, under a name that changes with the content.
 */
final class BrandImages
{
    public const DISK = 'local';

    public const TYPES = ['image/png', 'image/jpeg', 'image/webp'];

    /** A logo is scaled down to fit this box, never up. */
    public const LOGO_WIDTH = 480;

    public const LOGO_HEIGHT = 160;

    /** Icon sizes kept as they are; `180` and `maskable` get a white background. */
    public const ICON_SIZES = [512, 192, 64];

    /** How much of a maskable icon the image fills, inside the safe zone. */
    private const MASKABLE_FILL = 0.8;

    public function store(UploadedFile $file, string $role, BillingAccount|Organization $owner, ?User $actor): BrandAsset
    {
        $source = $this->read($file, $role === BrandAsset::ICON);
        $uuid = (string) Str::uuid();
        $directory = self::directory($uuid);
        $disk = Storage::disk(self::DISK);

        try {
            $variants = [];
            foreach ($this->render($source, $role === BrandAsset::ICON) as $name => $image) {
                $bytes = self::png($image);
                $path = $directory.'/'.$name.'.png';
                if (! $disk->put($path, $bytes)) {
                    throw new \RuntimeException('The image could not be stored.');
                }
                $variants[$name] = ['path' => $path, 'width' => imagesx($image), 'height' => imagesy($image), 'bytes' => strlen($bytes)];
            }

            return BrandAsset::query()->create([
                'uuid' => $uuid,
                'billing_account_id' => $owner instanceof BillingAccount ? $owner->getKey() : null,
                'organization_id' => $owner instanceof Organization ? $owner->getKey() : null,
                'role' => $role,
                'content_hash' => hash('sha256', self::png($source)),
                'variants' => $variants,
                'uploaded_by' => $actor?->getKey(),
            ]);
        } catch (\Throwable $exception) {
            $disk->deleteDirectory($directory);

            throw $exception;
        }
    }

    /** A replaced or removed image keeps being served for a day, for pages already open. */
    public function retire(?BrandAsset $asset): void
    {
        $asset?->forceFill(['replaced_at' => now()])->save();
    }

    /** Deletes images replaced before the given time, with their files. */
    public function prune(CarbonImmutable $before): int
    {
        $deleted = 0;
        BrandAsset::query()->whereNotNull('replaced_at')->where('replaced_at', '<', $before)->orderBy('id')
            ->chunkById(200, function ($assets) use (&$deleted): void {
                foreach ($assets as $asset) {
                    Storage::disk(self::DISK)->deleteDirectory(self::directory($asset->uuid));
                    $asset->delete();
                    $deleted++;
                }
            });

        return $deleted;
    }

    /** The stored file, or null when the variant is unknown or its file is gone. */
    public function response(BrandAsset $asset, string $variant): ?StreamedResponse
    {
        $path = $asset->variants[$variant]['path'] ?? null;
        if ($path === null || ! Storage::disk(self::DISK)->exists($path)) {
            return null;
        }

        // The name changes with the content, so the file never changes under its URL.
        return Storage::disk(self::DISK)->response($path, $variant.'.png', [
            'Content-Type' => 'image/png',
            'X-Content-Type-Options' => 'nosniff',
            'Cache-Control' => 'public, max-age=31536000, immutable',
            'Content-Security-Policy' => "default-src 'none'; sandbox",
        ]);
    }

    /**
     * Checks the upload and decodes it. Size and dimensions are checked before
     * decoding, so a small file cannot expand into a huge bitmap.
     */
    private function read(UploadedFile $file, bool $icon): GdImage
    {
        $limits = (array) config('branding.images');
        $path = (string) $file->getRealPath();

        if (! $file->isValid() || (int) $file->getSize() > (int) $limits['max_bytes']) {
            throw BrandingRefusal::image('image_too_large', sprintf('The image is larger than %s MB.', rtrim(rtrim(number_format($limits['max_bytes'] / 1048576, 1), '0'), '.')));
        }

        $size = in_array((string) (new \finfo(FILEINFO_MIME_TYPE))->file($path), self::TYPES, true) ? @getimagesize($path) : false;
        if ($size === false || $size[0] < 1 || $size[1] < 1) {
            throw BrandingRefusal::image('image_type', 'Upload a PNG, JPEG or WebP image.');
        }
        [$width, $height] = $size;

        if ($icon) {
            if (abs($width - $height) / max($width, $height) > 0.02) {
                throw BrandingRefusal::image('image_not_square', 'The icon must be square.');
            }
            if (min($width, $height) < (int) $limits['icon_min']) {
                throw BrandingRefusal::image('image_too_small', sprintf('The icon must be at least %1$d × %1$d pixels.', $limits['icon_min']));
            }
        }

        $largest = (int) $limits[$icon ? 'icon_max' : 'logo_max'];
        if (max($width, $height) > $largest) {
            throw BrandingRefusal::image('image_too_large', sprintf('The image is larger than %1$d × %1$d pixels.', $largest));
        }

        $image = @imagecreatefromstring((string) file_get_contents($path));
        if ($image === false) {
            throw BrandingRefusal::image('image_type', 'Upload a PNG, JPEG or WebP image.');
        }
        imagepalettetotruecolor($image);
        imagealphablending($image, false);
        imagesavealpha($image, true);

        return $image;
    }

    /**
     * @return array<string, GdImage>
     */
    private function render(GdImage $source, bool $icon): array
    {
        $width = imagesx($source);
        $height = imagesy($source);

        if (! $icon) {
            $scale = min(self::LOGO_WIDTH / $width, self::LOGO_HEIGHT / $height, 1);

            return ['logo' => self::resample($source, 0, 0, $width, $height, max(1, (int) round($width * $scale)), max(1, (int) round($height * $scale)))];
        }

        // An icon up to 2% off square is cropped to its centre.
        $side = min($width, $height);
        $x = intdiv($width - $side, 2);
        $y = intdiv($height - $side, 2);
        $variants = [];
        foreach (self::ICON_SIZES as $size) {
            $variants[(string) $size] = self::resample($source, $x, $y, $side, $side, $size, $size);
        }
        // iOS shows transparency as black, and a maskable icon must fill its square.
        $variants['180'] = self::resample($source, $x, $y, $side, $side, 180, 180, 1.0, true);
        $variants['maskable'] = self::resample($source, $x, $y, $side, $side, 512, 512, self::MASKABLE_FILL, true);

        return $variants;
    }

    private static function resample(GdImage $source, int $x, int $y, int $width, int $height, int $toWidth, int $toHeight, float $fill = 1.0, bool $opaque = false): GdImage
    {
        $target = imagecreatetruecolor($toWidth, $toHeight);
        if ($target === false) {
            throw new \RuntimeException('The image could not be resized.');
        }

        if ($opaque) {
            imagefill($target, 0, 0, (int) imagecolorallocate($target, 255, 255, 255));
            imagealphablending($target, true);
        } else {
            imagealphablending($target, false);
            imagefill($target, 0, 0, (int) imagecolorallocatealpha($target, 0, 0, 0, 127));
        }
        imagesavealpha($target, ! $opaque);

        $drawWidth = (int) round($toWidth * $fill);
        $drawHeight = (int) round($toHeight * $fill);
        imagecopyresampled($target, $source, intdiv($toWidth - $drawWidth, 2), intdiv($toHeight - $drawHeight, 2), $x, $y, $drawWidth, $drawHeight, $width, $height);

        return $target;
    }

    private static function png(GdImage $image): string
    {
        ob_start();
        imagepng($image, null, 9);

        return (string) ob_get_clean();
    }

    private static function directory(string $uuid): string
    {
        return 'branding/'.$uuid;
    }
}
