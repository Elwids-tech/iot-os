<?php

declare(strict_types=1);

namespace App\Domain\Shared\Models\Concerns;

use App\Domain\Shared\Concurrency\EntityTag;

trait HasRevisionEntityTag
{
    abstract protected function entityTagResource(): string;

    public function entityTag(): EntityTag
    {
        return EntityTag::for(
            $this->entityTagResource(),
            (string) $this->getAttribute('uuid'),
            (int) $this->getAttribute('revision'),
        );
    }

    public function etag(): string
    {
        return (string) $this->entityTag();
    }

    public function assertExpectedEntityTag(?string $candidate): void
    {
        $this->entityTag()->assertMatches($candidate);
    }
}
