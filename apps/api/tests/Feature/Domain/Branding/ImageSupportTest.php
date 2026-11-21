<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use Tests\TestCase;

/** Brand images are decoded and re-encoded with GD (spec 036, research R2). */
final class ImageSupportTest extends TestCase
{
    public function test_gd_reads_png_jpeg_and_webp(): void
    {
        $this->assertTrue(extension_loaded('gd'), 'The API image needs PHP\'s GD extension.');
        $info = gd_info();

        $this->assertTrue($info['PNG Support']);
        $this->assertTrue($info['JPEG Support']);
        $this->assertTrue($info['WebP Support']);
    }
}
