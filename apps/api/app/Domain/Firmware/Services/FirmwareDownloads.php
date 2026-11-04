<?php

declare(strict_types=1);

namespace App\Domain\Firmware\Services;

use Illuminate\Http\JsonResponse;

/** The archive response every firmware download uses (spec 027 platform API): private and never cached. */
final class FirmwareDownloads
{
    public function __construct(private readonly FirmwareArchive $archive) {}

    /** @param  array<string, string>  $files  archive path => contents */
    public function response(string $filename, ?array $manifest, array $files): JsonResponse
    {
        return response()->json(['data' => [
            'filename' => $filename,
            'manifest' => $manifest,
            'archive_base64' => $this->archive->zip($files),
        ]])->withHeaders(['Cache-Control' => 'no-store, private', 'Pragma' => 'no-cache', 'X-Content-Type-Options' => 'nosniff']);
    }

    /**
     * @param  array<string, string>  $files
     * @return array<string, string> the same files under one root folder
     */
    public function under(string $root, array $files): array
    {
        $rooted = [];
        foreach ($files as $path => $contents) {
            $rooted[$root.'/'.$path] = $contents;
        }

        return $rooted;
    }
}
