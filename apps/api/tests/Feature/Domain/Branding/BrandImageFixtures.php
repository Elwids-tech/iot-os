<?php

declare(strict_types=1);

namespace Tests\Feature\Domain\Branding;

use Illuminate\Http\UploadedFile;

/** Images made in memory for the branding tests. */
trait BrandImageFixtures
{
    private function image(int $width, int $height, string $type = 'png', string $name = 'image'): UploadedFile
    {
        $image = imagecreatetruecolor($width, $height);
        imagefill($image, 0, 0, (int) imagecolorallocate($image, 20, 90, 200));
        ob_start();
        match ($type) {
            'jpeg' => imagejpeg($image),
            'webp' => imagewebp($image),
            default => imagepng($image),
        };

        return UploadedFile::fake()->createWithContent($name.'.'.$type, (string) ob_get_clean());
    }

    private function file(string $name, string $content): UploadedFile
    {
        return UploadedFile::fake()->createWithContent($name, $content);
    }

    /** A valid PNG carrying a text chunk, as cameras and editors add. */
    private function pngWithText(int $width, int $height, string $text): UploadedFile
    {
        $png = $this->image($width, $height)->getContent();
        $data = "Comment\0".$text;
        $chunk = pack('N', strlen($data)).'tEXt'.$data.pack('N', crc32('tEXt'.$data));

        // After the 8-byte signature and the 25-byte IHDR chunk.
        return $this->file('with-text.png', substr($png, 0, 33).$chunk.substr($png, 33));
    }
}
