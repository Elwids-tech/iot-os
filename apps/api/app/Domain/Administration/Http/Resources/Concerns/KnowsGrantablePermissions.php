<?php

declare(strict_types=1);

namespace App\Domain\Administration\Http\Resources\Concerns;

/**
 * Lets a resource report whether the acting user could manage it without escalating.
 */
trait KnowsGrantablePermissions
{
    /** @var list<string>|null */
    private ?array $grantable = null;

    /**
     * @param  list<string>  $grantable  the acting user's grantable permissions
     */
    public function withGrantable(array $grantable): static
    {
        $this->grantable = $grantable;

        return $this;
    }
}
